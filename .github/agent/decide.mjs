import { CI_WORKFLOW, LABELS, MARK, REVIEW_WORKFLOW, issueFromBranch } from "./config.mjs";

/**
 * The whole pipeline's decision logic as one pure function.
 *
 *   decide(ctx) -> { action, reason, ...details }
 *
 * Actions:
 *   build    start (or resume) work on an issue; details.mode = "start" | "resume"
 *   fix      push fixes to an open agent PR; details.cause = "ci" | "review" | "human"
 *   block    stop retrying and ask a human for help
 *   stop     a human said stop: clear agent labels
 *   ready    tests and review passed: tell the human (or auto-merge)
 *   done     PR merged or closed: tidy labels
 *   setup    the repo is missing a required secret: explain once
 *   noop     nothing to do (reason says why, for the logs)
 *
 * ctx is gathered by run.mjs from the GitHub event + API, and by the
 * simulator in tests, so every branch below is covered by a scenario.
 */
export function decide(ctx) {
  const { event, payload } = ctx;
  const noop = (reason) => ({ action: "noop", reason });

  if (event === "issues") return onIssues(ctx, noop);
  if (event === "issue_comment") return onComment(ctx, noop);
  if (event === "workflow_run") return onWorkflowRun(ctx, noop);
  if (event === "pull_request") return onPullRequest(ctx, noop);
  if (event === "repository_dispatch") return onDispatch(ctx, noop);
  return noop(`unhandled event ${event}`);

  // ---------------------------------------------------------------- issues
  function onIssues(ctx, noop) {
    const issue = ctx.issue;
    if (payload.action === "unlabeled" && payload.label?.name === LABELS.trigger) {
      return hasAnyAgentState(issue.labels) || ctx.openAgentPr
        ? { action: "stop", reason: "agent label removed", issue: issue.number, pr: ctx.openAgentPr ?? undefined }
        : noop("label removed, nothing running");
    }
    if (payload.action !== "labeled" || payload.label?.name !== LABELS.trigger) return noop("not the agent label");
    if (issue.isPr) return noop("agent label on a PR is not a trigger; comment /agent on the PR instead");
    if (issue.state !== "open") return noop("issue is closed");
    if (!ctx.actorCanWrite) return noop(`${ctx.actor} does not have write access`);
    if (!ctx.hasAnthropicKey) return { action: "setup", reason: "ANTHROPIC_API_KEY secret is missing", issue: issue.number };
    if (issue.labels.includes(LABELS.working)) return noop("a run is already in progress");
    if (ctx.openAgentPr) return noop(`PR #${ctx.openAgentPr} is already open for this issue`);
    return { action: "build", mode: "start", reason: "agent label added", issue: issue.number };
  }

  // -------------------------------------------------------------- comments
  function onComment(ctx, noop) {
    if (payload.action !== "created") return noop("comment edited or deleted");
    const c = payload.comment;
    const body = (c.body ?? "").trim();
    // Loop guards: never react to bots, ourselves, or people without write access.
    if (c.user?.type === "Bot" || /\[bot\]$/.test(c.user?.login ?? "")) return noop("comment from a bot");
    if (body.includes(MARK.any)) return noop("comment written by the pipeline");
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(c.author_association)) return noop(`${c.user?.login} does not have write access`);

    const command = body.match(/^\/agent(?:\s+(\w+))?/i);
    const verb = command?.[1]?.toLowerCase();
    const issue = ctx.issue;

    if (verb === "stop") return { action: "stop", reason: "/agent stop", issue: ctx.linkedIssue ?? issue.number, pr: issue.isPr ? issue.number : (ctx.openAgentPr ?? undefined) };
    if (issue.state !== "open") return noop("closed");

    if (!ctx.hasAnthropicKey && (command || hasAnyAgentState(issue.labels))) {
      return { action: "setup", reason: "ANTHROPIC_API_KEY secret is missing", issue: ctx.linkedIssue ?? issue.number };
    }

    if (issue.isPr) {
      if (!ctx.pr || issueFromBranch(ctx.pr.headRef) === null) return noop("not an agent PR");
      if (!ctx.pr.sameRepo) return noop("PR from a fork");
      const waiting = issue.labels.includes(LABELS.blocked) || issue.labels.includes(LABELS.needsInput);
      if (waiting || command) {
        if (issue.labels.includes(LABELS.working)) return noop("a run is already in progress; your comment will be read by the next one");
        return { action: "fix", cause: "human", reason: waiting ? "human replied to a waiting PR" : "/agent command on PR", issue: ctx.linkedIssue, pr: issue.number };
      }
      return noop("ordinary PR discussion");
    }

    // A comment on an issue.
    if (issue.labels.includes(LABELS.working)) return noop("a run is already in progress");
    if (ctx.openAgentPr && (command || issue.labels.includes(LABELS.blocked))) {
      // The work lives on the PR now; route the human's guidance there.
      return { action: "fix", cause: "human", reason: "guidance on issue routed to its open PR", issue: issue.number, pr: ctx.openAgentPr };
    }
    if (verb === "retry" || verb === "start" || issue.labels.includes(LABELS.needsInput) || issue.labels.includes(LABELS.blocked)) {
      const mode = hasAnyAgentState(issue.labels) || verb === "retry" ? "resume" : "start";
      return { action: "build", mode, reason: verb ? `/agent ${verb}` : "human answered the agent's questions", issue: issue.number, addTrigger: !issue.labels.includes(LABELS.trigger) };
    }
    return noop("ordinary issue discussion");
  }

  // ---------------------------------------------------------- workflow runs
  function onWorkflowRun(ctx, noop) {
    const run = payload.workflow_run;
    if (payload.action !== "completed") return noop("run not finished");
    const issueNumber = issueFromBranch(run.head_branch);
    const isAgentBranch = issueNumber !== null;
    if (!ctx.pr) return noop("no open PR for this run");
    if (!ctx.pr.sameRepo) return noop("PR from a fork");
    if (ctx.pr.headSha && run.head_sha !== ctx.pr.headSha) return noop("stale run: the PR has newer commits");

    if (run.conclusion === "cancelled" || run.conclusion === "skipped") return noop(`run ${run.conclusion}`);

    if (run.conclusion === "success") {
      if (run.name === CI_WORKFLOW) return noop("CI passed; Agent Review runs next");
      if (run.name === REVIEW_WORKFLOW) return { action: "ready", reason: "tests and review passed", issue: issueNumber, pr: ctx.pr.number, autoMerge: isAgentBranch && ctx.config.autoMerge };
      return noop(`ignoring ${run.name}`);
    }

    // Failure (or timed_out / action_required).
    if (!isAgentBranch) return noop("human PR failed; the agent leaves those alone");
    if (ctx.pr.labels.includes(LABELS.blocked) || ctx.pr.labels.includes(LABELS.needsInput)) return noop("already waiting for a human");
    const cause = run.name === REVIEW_WORKFLOW ? "review" : "ci";
    const attempts = fixAttemptsSinceHuman(ctx.prComments);
    if (attempts >= ctx.config.maxFixAttempts) {
      return { action: "block", reason: `${cause} still failing after ${attempts} fix attempts`, cause, issue: issueNumber, pr: ctx.pr.number, runUrl: run.html_url, attempts };
    }
    return { action: "fix", cause, reason: `${run.name} failed`, issue: issueNumber, pr: ctx.pr.number, runId: run.id, runUrl: run.html_url, attempt: attempts + 1 };
  }

  // ------------------------------------------- dispatch (PLAN.md queue)
  // Sent by the pipeline itself (plan sync, or after a merge) to start the
  // next queued item. Only workflows with write access can send it.
  function onDispatch(ctx, noop) {
    if (payload.action !== "agent-start") return noop(`unknown dispatch ${payload.action}`);
    const issue = ctx.issue;
    if (!issue || issue.state !== "open") return noop("queued issue is closed");
    if (!ctx.hasAnthropicKey) return { action: "setup", reason: "ANTHROPIC_API_KEY secret is missing", issue: issue.number };
    if (issue.labels.includes(LABELS.working) || ctx.openAgentPr) return noop("already started");
    return { action: "build", mode: "start", reason: "next item in PLAN.md", issue: issue.number, addTrigger: true };
  }

  // ---------------------------------------------------------- pull requests
  function onPullRequest(ctx, noop) {
    if (payload.action !== "closed") return noop("PR not closed");
    const issueNumber = issueFromBranch(payload.pull_request.head.ref);
    if (issueNumber === null) return noop("not an agent PR");
    return { action: "done", merged: Boolean(payload.pull_request.merged), startNext: Boolean(payload.pull_request.merged), reason: payload.pull_request.merged ? "PR merged" : "PR closed without merging", issue: issueNumber, pr: payload.pull_request.number };
  }
}

const hasAnyAgentState = (labels) => labels.some((l) => l === LABELS.trigger || l.startsWith("agent:"));

/** Fix attempts since the last time a human with write access said something. */
export function fixAttemptsSinceHuman(comments = []) {
  let count = 0;
  for (const c of comments) {
    const fromHuman = !c.isBot && c.canWrite && !c.body.includes(MARK.any);
    if (fromHuman) count = 0;
    else if (c.body.includes(MARK.fixAttempt)) count++;
  }
  return count;
}
