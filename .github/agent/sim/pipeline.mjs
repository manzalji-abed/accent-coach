import { BRANCH_PREFIX, CI_WORKFLOW, MARK, REVIEW_STATUS_CONTEXT, REVIEW_WORKFLOW, issueFromBranch } from "../config.mjs";
import { gatherContext, latestHumanGuidance, trustedThread } from "../context.mjs";
import { decide } from "../decide.mjs";
import { planBefore, planBuildResult, planFixResult, planReview } from "../effects.mjs";
import { execOps } from "../github.mjs";
import { FakeGitHub } from "./fake-github.mjs";

/**
 * Replays what the GitHub workflows do, step for step, against FakeGitHub:
 *
 *   agent.yml   issues / issue_comment / workflow_run / pull_request  -> decide -> build|fix
 *   ci.yml      on every push to a PR                                 -> scripted pass/fail
 *   review.yml  after CI passes                                       -> scripted verdict
 *
 * Agents, CI and the reviewer are scripted per scenario. Everything else
 * (decisions, labels, comments, retry counting, loop guards) is the real code.
 */
export class PipelineSim {
  constructor({ env = {}, script = {}, writers } = {}) {
    this.gh = new FakeGitHub({ writers });
    this.env = { HAS_ANTHROPIC_KEY: "true", AGENT_MAX_FIX_ATTEMPTS: "3", ...env };
    this.script = { build: [], fix: [], review: [], ci: [], ...script };
    this.queue = [];
    this.log = [];
    this.runs = 0;
    this.prompts = [];
    this.gh.onDispatch = (type, payload) =>
      this.emit("repository_dispatch", { action: type, client_payload: payload, sender: { login: "github-actions[bot]" } });
  }

  // ---------------- what humans do ----------------
  newIssue(title, body) {
    return this.gh.createIssue({ title, body });
  }
  addLabel(issue, label, actor = "me") {
    this.gh.items.get(issue).labels.add(label);
    this.emit("issues", { action: "labeled", label: { name: label }, issue: { number: issue }, sender: { login: actor } });
  }
  removeLabel(issue, label, actor = "me") {
    this.gh.items.get(issue).labels.delete(label);
    this.emit("issues", { action: "unlabeled", label: { name: label }, issue: { number: issue }, sender: { login: actor } });
  }
  comment(n, body, author = "me", { bot = false } = {}) {
    const c = this.gh.humanComment(n, author, body);
    if (bot) c.type = "Bot";
    const assoc = this.gh.writers.has(author) ? (author === "me" ? "OWNER" : "COLLABORATOR") : "NONE";
    this.emit("issue_comment", {
      action: "created",
      issue: { number: n },
      comment: { body, author_association: bot ? "NONE" : assoc, user: { login: author, type: bot ? "Bot" : "User" } },
      sender: { login: author },
    });
  }
  merge(pr) {
    this.gh.close(pr, { merged: true });
    const issue = issueFromBranch(this.gh.items.get(pr).headRef);
    if (issue && this.gh.items.get(issue).state === "open") this.gh.close(issue); // "Closes #N"
    this.emit("pull_request", { action: "closed", pull_request: { number: pr, merged: true, head: { ref: this.gh.items.get(pr).headRef } } });
  }
  closePr(pr) {
    this.gh.close(pr);
    this.emit("pull_request", { action: "closed", pull_request: { number: pr, merged: false, head: { ref: this.gh.items.get(pr).headRef } } });
  }

  // ---------------- engine ----------------
  emit(event, payload) {
    this.queue.push({ event, payload });
  }

  /** Process events until the system is quiet. Throws if it never settles (a loop). */
  async settle(maxSteps = 60) {
    let steps = 0;
    while (this.queue.length) {
      if (++steps > maxSteps) throw new Error(`pipeline did not settle after ${maxSteps} steps: probable loop\n${this.log.join("\n")}`);
      const { event, payload } = this.queue.shift();
      if (event === "ci") await this.runCi(payload);
      else if (event === "review") await this.runReview(payload);
      else await this.runAgentWorkflow(event, payload);
    }
    return this;
  }

  async runAgentWorkflow(event, payload) {
    const ctx = await gatherContext(this.gh, event, payload, this.env);
    const d = decide(ctx);
    this.log.push(`${describe(event, payload)} -> ${d.action}${d.mode ? `:${d.mode}` : ""}${d.cause ? `:${d.cause}` : ""} (${d.reason})`);
    const runUrl = `https://github.com/run/${++this.runs}`;
    await execOps(this.gh, planBefore(d, { runUrl, maxFixAttempts: ctx.config.maxFixAttempts }), () => {});

    if (d.action === "build") await this.runBuild(d, runUrl);
    if (d.action === "fix") await this.runFix(d, runUrl);
    if (d.action === "ready" && d.autoMerge && this.gh.autoMerge.has(d.pr)) this.merge(d.pr);
  }

  async runBuild(d, runUrl) {
    const { text } = await trustedThread(this.gh, d.issue);
    this.prompts.push({ kind: "build", issue: d.issue, thread: text });
    const step = this.script.build.shift();
    if (step === undefined) throw new Error(`scenario has no scripted build result for #${d.issue}`);
    let result = typeof step === "function" ? step({ d, thread: text, gh: this.gh }) : structuredClone(step);
    this.log.push(`  build agent -> ${outcome(result)}`);
    const branch = `${BRANCH_PREFIX}${d.issue}`;
    if (result?.status === "pr_opened") {
      const existing = await this.gh.findOpenPrForBranch(branch);
      const pr = existing ?? this.gh.openPr({ headRef: branch, title: `Fix #${d.issue}` });
      if (existing) this.gh.pushCommit(pr);
      result = { ...result, pr_number: pr };
      this.emit("ci", { pr });
    }
    await execOps(this.gh, planBuildResult(d, result, { runUrl }), () => {});
  }

  async runFix(d, runUrl) {
    const comments = await this.gh.listComments(d.pr);
    this.prompts.push({ kind: "fix", pr: d.pr, cause: d.cause, guidance: latestHumanGuidance(comments) });
    const step = this.script.fix.shift();
    if (step === undefined) throw new Error(`scenario has no scripted fix result for #${d.pr}`);
    const result = typeof step === "function" ? step({ d, gh: this.gh }) : structuredClone(step);
    this.log.push(`  fix agent -> ${outcome(result)}`);
    if (result?.status === "pushed") {
      this.gh.pushCommit(d.pr);
      this.emit("ci", { pr: d.pr });
    }
    const ops = planFixResult(d, result?.status === "no_change" ? { ...result, status: undefined } : result, { runUrl });
    await execOps(this.gh, ops, () => {});
    // A re-run of the failed checks produces another failed workflow_run.
    if (ops.some((o) => o.op === "rerunFailed" && o.runId)) this.emit("ci", { pr: d.pr, rerun: true });
  }

  async runCi({ pr }) {
    const p = await this.gh.getPull(pr);
    if (p.state !== "open") return;
    const outcome = this.script.ci.shift() ?? "success";
    this.log.push(`CI on #${pr} -> ${outcome}`);
    this.emit("workflow_run", runPayload(CI_WORKFLOW, outcome, p, ++this.runs));
    if (outcome === "success") this.emit("review", { pr });
  }

  async runReview({ pr }) {
    const p = await this.gh.getPull(pr);
    if (p.state !== "open") return;
    const step = this.script.review.shift() ?? { verdict: "approve", summary: "Looks good.", findings: [] };
    const result = typeof step === "function" ? step({ gh: this.gh, pr }) : structuredClone(step);
    this.log.push(`Review on #${pr} -> ${result?.verdict ?? "crashed"}`);
    await execOps(this.gh, planReview(result, { pr, sha: p.headSha, runUrl: "https://github.com/run/review", context: REVIEW_STATUS_CONTEXT }), () => {});
    this.emit("workflow_run", runPayload(REVIEW_WORKFLOW, result?.verdict === "approve" ? "success" : "failure", p, ++this.runs));
  }

  // ---------------- assertions helpers ----------------
  labels(n) {
    return this.gh.labels(n);
  }
  status(n) {
    return this.gh.botComments(n).find((b) => b.startsWith(MARK.status)) ?? "";
  }
  agentPr(issue) {
    for (const it of this.gh.items.values()) if (it.isPr && it.headRef === `${BRANCH_PREFIX}${issue}`) return it.number;
    return null;
  }
}

function outcome(r) {
  if (!r) return "crashed (no result)";
  if (r.status === "needs_input") return `asked ${r.questions.length} question(s): "${r.questions[0]}"`;
  return `${r.status}${r.summary ? ` (${r.summary})` : ""}`;
}

function runPayload(name, conclusion, pr, id) {
  return {
    action: "completed",
    workflow_run: { id, name, conclusion, head_branch: pr.headRef, head_sha: pr.headSha, html_url: `https://github.com/run/${id}`, pull_requests: [{ number: pr.number }] },
  };
}

function describe(event, p) {
  if (event === "issues") return `${p.sender.login} ${p.action} "${p.label.name}" on #${p.issue.number}`;
  if (event === "issue_comment") return `${p.comment.user.login} commented on #${p.issue.number}: "${p.comment.body.slice(0, 40)}"`;
  if (event === "workflow_run") return `${p.workflow_run.name} ${p.workflow_run.conclusion} on ${p.workflow_run.head_branch}`;
  if (event === "pull_request") return `PR #${p.pull_request.number} ${p.pull_request.merged ? "merged" : "closed"}`;
  if (event === "repository_dispatch") return `pipeline dispatched ${p.action} for #${p.client_payload.issue}`;
  return event;
}
