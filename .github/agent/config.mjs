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

export function readConfig(env = process.env) {
  const max = parseInt(env.AGENT_MAX_FIX_ATTEMPTS ?? "", 10);
  return {
    maxFixAttempts: Number.isFinite(max) && max > 0 ? max : 3,
    autoMerge: String(env.AGENT_AUTO_MERGE ?? "").toLowerCase() === "true",
  };
}

export const issueFromBranch = (ref) => {
  const m = typeof ref === "string" && ref.match(/^agent\/issue-(\d+)$/);
  return m ? Number(m[1]) : null;
};
