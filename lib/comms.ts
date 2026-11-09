import type { CommsArea, Turn } from "./types";

/** Who the learner is talking to. Only these ids are accepted from the browser, never free text. */
export interface Audience {
  id: string;
  label: string;
  /** Shown on the tip in the "Better way to say it" sheet, e.g. "For a CEO". */
  forLabel: string;
  /** What good communication looks like for this listener. Goes into the live prompt. */
  rules: string;
}

/** What the learner is trying to get done in the conversation. */
export interface Intent {
  id: string;
  label: string;
  /** What a good version of this looks like. Goes into the live prompt. */
  rules: string;
}

export const AUDIENCES: Audience[] = [
  {
    id: "ceo",
    label: "CEO",
    forLabel: "For a CEO",
    rules: "Executives want the bottom line first, in few words: the impact and the decision needed. No implementation detail unless asked.",
  },
  {
    id: "cto",
    label: "CTO",
    forLabel: "For a CTO",
    rules: "Technical depth is welcome, but it must be structured: the point first, then cause, options and trade-offs in a clear order.",
  },
  {
    id: "manager",
    label: "Manager",
    forLabel: "For your manager",
    rules: "A manager wants the point, what you need from them, and the evidence or progress behind it. Be direct and respectful, with no waffle.",
  },
  {
    id: "peer",
    label: "Peer",
    forLabel: "For a peer",
    rules: "Peers are relaxed and informal. Natural, friendly, clear wording is enough. Don't over-formalise.",
  },
  {
    id: "customer",
    label: "Customer",
    forLabel: "For a customer",
    rules: "Customers want plain words with no jargon, empathy for their situation, and a clear next step.",
  },
  {
    id: "interviewer",
    label: "Interviewer",
    forLabel: "For an interviewer",
    rules: "Interviewers want concrete examples: the situation, the action you took, and the result, ideally with a number.",
  },
];

export const INTENTS: Intent[] = [
  { id: "explain-problem", label: "Explain a problem", rules: "Explaining a problem: say what happened and the impact first, then the cause, then what is being done." },
  { id: "status-update", label: "Status update", rules: "A status update: progress, risks, then what happens next. Keep it short." },
  { id: "ask", label: "Ask for something", rules: "Asking for something: state the request clearly up front, then give the reason and the benefit." },
  { id: "push-back", label: "Push back", rules: "Pushing back: stay calm and respectful, state the concern, give the reason, and offer an alternative." },
  { id: "bad-news", label: "Deliver bad news", rules: "Delivering bad news: be direct and early, own it without over-apologising, and move to the plan." },
  { id: "small-talk", label: "Small talk", rules: "Small talk: light and friendly. Don't push the learner on structure; only note habits that would get in the way." },
];

export const DEFAULT_AUDIENCE_ID = "peer";
export const DEFAULT_INTENT_ID = "small-talk";

const pick = <T extends { id: string }>(list: T[], id: unknown) => (typeof id === "string" ? list.find((x) => x.id === id) : undefined);
export const audienceById = (id: unknown) => pick(AUDIENCES, id);
export const intentById = (id: unknown) => pick(INTENTS, id);

export const COMMS_AREAS: CommsArea[] = ["structure", "detail", "concision", "confidence", "tone"];

/** What each communication habit is called in the summary. */
export const AREA_LABEL: Record<CommsArea, string> = {
  structure: "Leading with the point",
  detail: "Right level of detail",
  concision: "Staying concise",
  confidence: "Sounding confident",
  tone: "Tone",
};

/**
 * Across a session: the communication habit that held up best, and the one to change.
 * A habit is only called strong if it was flagged less than the weakest one.
 * Returns null when no learner turn has been reviewed.
 */
export function commsSummary(turns: Pick<Turn, "role" | "comms" | "clarity">[]): { strongest?: CommsArea; change?: CommsArea } | null {
  const reviewed = turns.filter((t) => t.role === "user" && typeof t.clarity === "number");
  if (!reviewed.length) return null;
  const counts = new Map<CommsArea, number>(COMMS_AREAS.map((a) => [a, 0]));
  for (const t of reviewed) for (const a of t.comms?.issues ?? []) counts.set(a, (counts.get(a) ?? 0) + 1);
  // Stable sort keeps the COMMS_AREAS order on ties.
  const ranked = [...COMMS_AREAS].sort((a, b) => counts.get(b)! - counts.get(a)!);
  const worst = ranked[0];
  const best = ranked[ranked.length - 1];
  return {
    ...(counts.get(best)! < counts.get(worst)! ? { strongest: best } : {}),
    ...(counts.get(worst)! > 0 ? { change: worst } : {}),
  };
}
