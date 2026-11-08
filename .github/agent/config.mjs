// Labels are the pipeline's state. You can read where any issue is at a glance,
// and you can move it yourself by adding or removing a label.
export const LABELS = {
  trigger: "agent", //            you add this to hand an issue to the agent
  working: "agent:working", //    an agent run is in progress
  needsInput: "agent:needs-input", // agent asked you questions; reply to continue
  inReview: "agent:in-review", // PR is open and going through tests + review
  blocked: "agent:blocked", //    agent gave up after its retries; reply with guidance
  queued: "agent:queued", //      from PLAN.md, waiting for the previous item to merge
};

export const LABEL_COLORS = {
  [LABELS.trigger]: ["5319e7", "Hand this issue to the agent"],
  [LABELS.working]: ["fbca04", "Agent is working on it"],
  [LABELS.needsInput]: ["d93f0b", "Agent is waiting for your answer"],
  [LABELS.inReview]: ["0e8a16", "PR open: tests and security review"],
  [LABELS.blocked]: ["b60205", "Agent is stuck and needs a human"],
  [LABELS.queued]: ["c5def5", "Planned: starts after the previous item merges"],
};

// Hidden markers let the pipeline find its own comments and never react to them.
export const MARK = {
  status: "<!-- agent:status -->",
  fixAttempt: "<!-- agent:fix-attempt -->",
  review: "<!-- agent:review -->",
  uiReport: "<!-- agent:ui-report -->",
  setup: "<!-- agent:setup-needed -->",
  plan: "<!-- agent:plan -->",
  any: "<!-- agent:",
};

export const BRANCH_PREFIX = "agent/issue-";
export const REVIEW_STATUS_CONTEXT = "agent/security-review";
export const CI_WORKFLOW = "CI";
export const REVIEW_WORKFLOW = "Agent Review";

/**
 * A PR touching any of these always waits for a human, whatever the reviewer
 * says: server code, AI prompts and guards, stored data, dependencies, build,
 * deploy and pipeline config, secrets.
 */
export const SENSITIVE_PATHS = [
  /^app\/api\//,
  /^lib\/ai\//,
  /^lib\/store\.ts$/,
  /^package(-lock)?\.json$/,
  /^\.github\//,
  /^\.env/,
  /^wrangler\.jsonc?$/,
  /^(next|open-next|playwright|vitest)\.config\./,
  /^tsconfig\.json$/,
];
export const sensitiveFiles = (files = []) => files.filter((f) => SENSITIVE_PATHS.some((re) => re.test(f)));

export function readConfig(env = process.env) {
  const max = parseInt(env.AGENT_MAX_FIX_ATTEMPTS ?? "", 10);
  return {
    maxFixAttempts: Number.isFinite(max) && max > 0 ? max : 3,
    // Only ever merges PRs the reviewer rated high confidence; see decide.mjs.
    autoMerge: String(env.AGENT_AUTO_MERGE ?? "").toLowerCase() === "true",
  };
}

/**
 * The review comment carries a hidden line the Agent workflow reads later to
 * decide whether it may merge on its own:
 *   <!-- agent:review-meta {"sha":"…","eligible":true,"why":"…"} -->
 * `sha` pins it to the reviewed commit, so a later push can't inherit it.
 */
// Anchored to the end: the genuine marker is always the comment's last line,
// after any model-written text (which planReview also strips of comment markers).
const META_RE = /<!-- agent:review-meta (\{[^\n]*\}) -->\s*$/;
export function formatReviewMeta(meta) {
  const safe = { ...meta, why: String(meta.why ?? "").replace(/-->|<!--/g, "").slice(0, 300) };
  return `<!-- agent:review-meta ${JSON.stringify(safe)} -->`;
}
export function readReviewMeta(comments = []) {
  // Only the review job's own account counts: the coding agent (claude[bot]) must never be able to vouch for itself.
  const review = comments.find((c) => c.author === "github-actions[bot]" && c.body.startsWith(MARK.review));
  const m = review?.body.match(META_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export const issueFromBranch = (ref) => {
  const m = typeof ref === "string" && ref.match(/^agent\/issue-(\d+)$/);
  return m ? Number(m[1]) : null;
};
