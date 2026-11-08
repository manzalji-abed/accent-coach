import { LABELS, MARK, formatReviewMeta } from "./config.mjs";

/**
 * Turns decisions and agent results into a list of GitHub operations.
 * Pure functions: the workflow executes the ops, the simulator applies them
 * to a fake repo, and tests assert on them.
 *
 * Noise budget: each issue has ONE status comment that edits itself. New
 * comments (which notify you) are only posted when you need to act or
 * something finished: questions, blocked, ready to merge.
 */

const ALL_STATE = [LABELS.working, LABELS.needsInput, LABELS.inReview, LABELS.blocked, LABELS.queued];
const swap = (target, add) => [
  { op: "removeLabels", target, labels: ALL_STATE.filter((l) => !add.includes(l)) },
  ...(add.length ? [{ op: "addLabels", target, labels: add }] : []),
];
const status = (target, text, runUrl) => ({
  op: "upsertComment",
  target,
  marker: MARK.status,
  body: `${MARK.status}\n**Agent status:** ${text}${runUrl ? `\n\n[View the run](${runUrl})` : ""}`,
});

/** After an agent PR is merged or closed: tidy labels, say so, start the next PLAN.md item. */
function doneOps(d) {
  return d.merged
    ? [{ op: "removeLabels", target: d.issue, labels: ALL_STATE }, status(d.issue, `shipped in #${d.pr}.`), { op: "startNextQueued" }]
    : [
        { op: "removeLabels", target: d.issue, labels: ALL_STATE },
        status(d.issue, `#${d.pr} was closed without merging. Comment \`/agent retry\` to try again from scratch.`),
      ];
}

/** Ops to run before the agent starts (or instead of it, for simple actions). */
export function planBefore(d, { runUrl, maxFixAttempts = 3 } = {}) {
  switch (d.action) {
    case "build":
      return [
        ...(d.addTrigger ? [{ op: "addLabels", target: d.issue, labels: [LABELS.trigger] }] : []),
        ...swap(d.issue, [LABELS.working]),
        status(d.issue, d.mode === "resume" ? "picking this back up with your answer." : "working on it.", runUrl),
      ];
    case "fix":
      return [
        ...swap(d.pr, [LABELS.working]),
        ...(d.issue ? swap(d.issue, [LABELS.working]) : []),
        status(
          d.issue ?? d.pr,
          d.cause === "human" ? `applying your guidance to #${d.pr}.` : `${d.cause === "ci" ? "tests failed" : "review asked for changes"} on #${d.pr}; fixing (attempt ${d.attempt} of ${maxFixAttempts}).`,
          runUrl,
        ),
      ];
    case "block":
      return [
        ...swap(d.pr, [LABELS.blocked]),
        ...(d.issue ? swap(d.issue, [LABELS.blocked]) : []),
        status(d.issue ?? d.pr, `blocked on #${d.pr}. Waiting for you.`),
        {
          op: "comment",
          target: d.pr,
          body:
            `${MARK.any}blocked -->\n**I need a human here.** ${d.cause === "review" ? "The security review" : "The tests"} still fail after ${d.attempts} fix attempts.\n\n` +
            `[Latest failing run](${d.runUrl})\n\n` +
            "Reply on this PR with guidance (for example *\"the test is wrong, update it\"* or *\"skip the animation\"*) and I'll try again. " +
            "Comment `/agent stop` to leave it to you.",
        },
      ];
    case "stop":
      return [
        { op: "removeLabels", target: d.issue, labels: [LABELS.trigger, ...ALL_STATE] },
        ...(d.pr ? [{ op: "removeLabels", target: d.pr, labels: ALL_STATE }] : []),
        status(d.issue, "stopped. Add the `agent` label or comment `/agent retry` to start again."),
      ];
    case "ready": {
      const labels = [...(d.issue ? swap(d.issue, [LABELS.inReview]) : []), ...swap(d.pr, [LABELS.inReview])];
      const readyComment = (note) => ({
        op: "upsertComment",
        target: d.pr,
        marker: `${MARK.any}ready -->`,
        body: `${MARK.any}ready -->\n✅ **Tests and security review passed.** Ready for you to merge.${note ? `\n\n${note}` : ""}`,
      });
      if (d.autoMerge) {
        // The pipeline merges itself (works on any GitHub plan). Merges made with
        // the Actions token don't fire the "PR closed" workflow, so the
        // after-merge steps run right here instead.
        return [
          ...labels,
          ...(d.issue ? [status(d.issue, `#${d.pr} passed tests and security review with high confidence. Merging automatically.`)] : []),
          {
            op: "merge",
            pr: d.pr,
            sha: d.headSha,
            then: doneOps({ merged: true, issue: d.issue, pr: d.pr }),
            otherwise: [
              ...(d.issue ? [status(d.issue, `#${d.pr} passed tests and security review. Ready for you to merge.`)] : []),
              readyComment("I tried to merge it automatically, but GitHub refused ({error}). Please take a look and merge it yourself."),
            ],
          },
        ];
      }
      const why = d.manualReason ? `Not merged automatically: ${d.manualReason}` : "";
      return [
        ...labels,
        ...(d.issue ? [status(d.issue, `#${d.pr} passed tests and security review. Ready for you to merge.${why ? ` ${why}` : ""}`)] : []),
        readyComment(why),
      ];
    }
    case "done":
      return doneOps(d);
    case "setup":
      return [
        {
          op: "upsertComment",
          target: d.issue,
          marker: MARK.setup,
          body: [
            MARK.setup,
            "**The agent isn't set up yet.** Add one repository secret (Settings → Secrets and variables → Actions):",
            "",
            "- `CLAUDE_CODE_OAUTH_TOKEN`: uses your Claude Pro/Max plan. Run `claude setup-token` on your computer and paste the token it prints.",
            "- or `ANTHROPIC_API_KEY`: a pay-per-use key from console.anthropic.com.",
            "",
            "Then comment `/agent retry`.",
          ].join("\n"),
        },
      ];
    default:
      return [];
  }
}

/** After a build run. `result` is the agent's structured output, or null if the run crashed. */
export function planBuildResult(d, result, { runUrl } = {}) {
  if (!result || !result.status) {
    return [
      ...swap(d.issue, [LABELS.blocked]),
      status(d.issue, "the run crashed before finishing.", runUrl),
      { op: "comment", target: d.issue, body: `${MARK.any}crash -->\n**The agent run failed unexpectedly.** [See the logs](${runUrl}). Comment \`/agent retry\` to try again.` },
    ];
  }
  if (result.status === "pr_opened" && Number.isInteger(result.pr_number)) {
    return [
      ...swap(d.issue, [LABELS.inReview]),
      { op: "addLabels", target: result.pr_number, labels: [LABELS.inReview] },
      status(d.issue, `opened #${result.pr_number}. Tests and security review are running.\n\n${result.summary ?? ""}`.trim(), runUrl),
    ];
  }
  if (result.status === "needs_input" && result.questions?.length) {
    return [
      ...swap(d.issue, [LABELS.needsInput]),
      status(d.issue, "waiting for your answers (see below).", runUrl),
      {
        op: "comment",
        target: d.issue,
        body: `${MARK.any}questions -->\n**Before I build this, I need to check a few things:**\n\n${result.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReply in one comment and I'll continue automatically.`,
      },
    ];
  }
  return [
    ...swap(d.issue, [LABELS.blocked]),
    status(d.issue, "couldn't do this.", runUrl),
    { op: "comment", target: d.issue, body: `${MARK.any}cannot -->\n**I couldn't do this one.** ${result.summary || "No reason given."}\n\nReply with more detail and I'll try again.` },
  ];
}

/** After a fix run on a PR. */
export function planFixResult(d, result, { runUrl } = {}) {
  const issue = d.issue ?? d.pr;
  if (result?.status === "needs_input" && result.questions?.length) {
    return [
      ...swap(d.pr, [LABELS.needsInput]),
      ...(d.issue ? swap(d.issue, [LABELS.needsInput]) : []),
      status(issue, `waiting for your answers on #${d.pr}.`, runUrl),
      {
        op: "comment",
        target: d.pr,
        body: `${MARK.any}questions -->\n**I need a decision before fixing this:**\n\n${result.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReply on this PR and I'll continue.`,
      },
    ];
  }
  if (result?.status === "pushed") {
    return [
      ...swap(d.pr, [LABELS.inReview]),
      ...(d.issue ? swap(d.issue, [LABELS.inReview]) : []),
      // Counted by fixAttemptsSinceHuman(); a human reply resets the count.
      { op: "comment", target: d.pr, body: `${MARK.fixAttempt}\n🔧 **Fix ${d.cause === "human" ? "from your guidance" : `attempt ${d.attempt}`}:** ${result.summary ?? "pushed changes"}` },
      status(issue, `pushed a fix to #${d.pr}; tests are running again.`, runUrl),
    ];
  }
  // Your guidance didn't lead to a change: ask rather than guess.
  if (d.cause === "human") {
    return [
      ...swap(d.pr, [LABELS.needsInput]),
      ...(d.issue ? swap(d.issue, [LABELS.needsInput]) : []),
      status(issue, `couldn't turn your last comment into a change on #${d.pr}.`, runUrl),
      { op: "comment", target: d.pr, body: `${MARK.any}unclear -->\n**I couldn't work out what to change from that.** ${result?.summary ?? ""}\n\nCould you say which file or behaviour you mean?`.trim() },
    ];
  }
  // Crashed, or nothing to push: count it as an attempt and re-run the failed
  // checks, so the retry limit still applies and we can't stall or loop forever.
  return [
    ...swap(d.pr, [LABELS.inReview]),
    ...(d.issue ? swap(d.issue, [LABELS.inReview]) : []),
    { op: "comment", target: d.pr, body: `${MARK.fixAttempt}\n⚠️ **Fix attempt ${d.attempt ?? ""} didn't produce a change.** ${result?.summary ?? `[See the logs](${runUrl}).`}` },
    { op: "rerunFailed", pr: d.pr, runId: d.runId },
  ];
}

/** Agent Review result: one sticky comment plus a commit status branch protection can require. */
export function planReview(result, { pr, sha, runUrl, context }) {
  const ok = result?.verdict === "approve";
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  // Model-written text must never be able to forge the hidden meta marker (or any other).
  const clean = (s) => String(s ?? "").replace(/<!--|-->/g, "");
  const cell = (s) => clean(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = findings
    .slice(0, 15)
    .map((f) => `| ${cell(f.severity ?? "?")} | \`${cell(f.file ?? "?")}${f.line ? `:${Number(f.line) || ""}` : ""}\` | ${cell(f.issue)} | ${cell(f.fix)} |`);
  // Auto-merge eligibility is decided here, in code: the model's "high" only
  // counts when it also approved and every finding is low severity.
  const confidence = ["high", "medium", "low"].includes(result?.confidence) ? result.confidence : null;
  const reason = clean(result?.confidence_reason).trim();
  const serious = findings.filter((f) => f.severity !== "low").length;
  const eligible = ok && confidence === "high" && serious === 0;
  const why = !ok
    ? "the review didn't approve it"
    : confidence !== "high"
      ? `the reviewer's confidence is ${confidence ?? "missing"}${reason ? ` (${reason})` : ""}`
      : serious
        ? `the review has ${serious} finding${serious === 1 ? "" : "s"} above low severity`
        : "";
  const body = [
    MARK.review,
    `### ${ok ? "✅ Security review: approved" : result ? "❌ Security review: changes requested" : "⚠️ Security review didn't finish"}`,
    "",
    result?.summary != null ? clean(result.summary) : `[See the logs](${runUrl})`,
    ...(ok && confidence ? ["", `**Confidence:** ${confidence}${reason ? `. ${reason}` : ""}`] : []),
    ...(rows.length ? ["", "| Severity | Where | Issue | Fix |", "|---|---|---|---|", ...rows] : []),
    formatReviewMeta({ sha, eligible, why }),
  ].join("\n");
  return [
    { op: "upsertComment", target: pr, marker: MARK.review, body },
    { op: "setStatus", sha, context, state: ok ? "success" : "failure", description: ok ? "Approved" : result ? "Changes requested" : "Review failed to run", url: runUrl },
  ];
}
