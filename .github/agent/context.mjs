import { BRANCH_PREFIX, MARK, REVIEW_STATUS_CONTEXT, REVIEW_WORKFLOW, issueFromBranch, readConfig } from "./config.mjs";

/**
 * Collects everything decide() needs from the event payload plus a few API
 * calls. Labels are re-read from the API because payloads can be stale when
 * events arrive close together.
 */
export async function gatherContext(gh, event, payload, env = process.env) {
  const ctx = {
    event,
    payload,
    actor: payload.sender?.login,
    config: readConfig(env),
    hasAnthropicKey: env.HAS_ANTHROPIC_KEY === "true",
    issue: null,
    pr: null,
    linkedIssue: null,
    openAgentPr: null,
    run: null, // workflow_run events: the run, with the PR's branch/commit filled in for Agent Review
    prComments: [],
    actorCanWrite: false,
  };

  if (event === "issues" || event === "issue_comment") {
    ctx.issue = await gh.getIssue(payload.issue.number);
    if (ctx.issue.isPr) {
      ctx.pr = await gh.getPull(ctx.issue.number);
      ctx.linkedIssue = issueFromBranch(ctx.pr.headRef);
      ctx.prComments = await gh.listComments(ctx.pr.number);
    } else {
      ctx.openAgentPr = await gh.findOpenPrForBranch(`${BRANCH_PREFIX}${ctx.issue.number}`);
    }
    if (event === "issues" && ctx.actor) ctx.actorCanWrite = await gh.canWrite(ctx.actor);
  }

  if (event === "repository_dispatch" && payload.client_payload?.issue) {
    ctx.issue = await gh.getIssue(Number(payload.client_payload.issue));
    ctx.openAgentPr = await gh.findOpenPrForBranch(`${BRANCH_PREFIX}${ctx.issue.number}`);
  }

  if (event === "workflow_run") {
    const run = payload.workflow_run;
    ctx.run = run;
    let prNumber = run.pull_requests?.[0]?.number ?? null;
    if (!prNumber && run.name === REVIEW_WORKFLOW) {
      // Agent Review is itself started by a workflow_run, so GitHub reports it
      // on the default branch with no PRs attached. The review marks the PR's
      // head commit with a status linking back to this run: find the PR by that.
      // A PR that moved on to a newer commit won't match, which is what we want.
      const found = await gh.findPrByStatus(REVIEW_STATUS_CONTEXT, run.html_url);
      if (found) {
        prNumber = found.number;
        ctx.run = { ...run, head_branch: found.headRef, head_sha: found.sha };
      }
    } else if (!prNumber) {
      prNumber = await gh.findOpenPrForBranch(run.head_branch);
    }
    if (prNumber) {
      const pr = await gh.getPull(prNumber);
      if (pr.state === "open") {
        ctx.pr = pr;
        ctx.prComments = await gh.listComments(pr.number);
        ctx.linkedIssue = issueFromBranch(pr.headRef);
      }
    }
  }

  return ctx;
}

/**
 * The conversation the agent gets to read: the issue plus comments from people
 * with write access and the pipeline's own notes. Comments from anyone else are
 * left out, so a stranger can't steer the agent (prompt injection).
 */
export async function trustedThread(gh, number) {
  const issue = await gh.getIssue(number);
  const comments = (await gh.listComments(number)).filter((c) => c.canWrite || (c.isBot && c.body.includes(MARK.any)));
  const lines = comments.map((c) => `--- ${c.isBot ? "agent pipeline" : `@${c.author}`} (${c.createdAt}):\n${c.body.replace(/<!--[\s\S]*?-->/g, "").trim()}`);
  return { issue, text: `# #${issue.number}: ${issue.title}\n\n${issue.body || "(no description)"}\n\n${lines.join("\n\n")}`.trim() };
}

/** Human comments on a PR since the agent last acted: the guidance to apply. */
export function latestHumanGuidance(comments) {
  const out = [];
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (c.isBot && c.body.includes(MARK.any)) break;
    if (!c.isBot && c.canWrite) out.unshift(`@${c.author}: ${c.body}`);
  }
  return out.join("\n\n");
}
