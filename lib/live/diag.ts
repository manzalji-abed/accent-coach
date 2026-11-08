/**
 * Cleaning for live-session diagnostics (see app/api/live-log). Only known
 * event types and known keys survive, with numbers, booleans and short
 * strings, so free text like a transcript can't get into the logs.
 */
export const MAX_BODY_BYTES = 16_000;
const MAX_EVENTS = 40;
const MAX_STRING = 120;

const TYPES = new Set([
  "start",
  "open",
  "stats",
  "end",
  "fail",
  "review",
  "goaway",
  "resumed",
  "resume-failed",
  "ws-error",
  "ws-close",
  "restart",
  "stuck",
  "ctx-state",
  "connect-failed",
  "pause-mic",
  "resume-mic",
]);

/** Allowed detail keys and the one value type each may have. */
const KEYS: Record<string, "number" | "boolean" | "string"> = {
  sent: "number",
  gated: "number",
  msgs: "number",
  audio: "number",
  inText: "number",
  outText: "number",
  tools: "number",
  turns: "number",
  interrupts: "number",
  flags: "number",
  clarity: "number",
  code: "number",
  sinceSpeech: "number",
  sinceModel: "number",
  speechMs: "number",
  listening: "boolean",
  coachAudible: "boolean",
  correction: "boolean",
  current: "boolean",
  resume: "boolean",
  resumed: "boolean",
  ctx: "string",
  state: "string",
  kind: "string",
  reason: "string",
  message: "string",
  timeLeft: "string",
  model: "string",
  apiVersion: "string",
  ua: "string",
};

type Detail = Record<string, string | number | boolean>;

export function cleanDetail(detail: unknown): Detail | undefined {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const out: Detail = {};
  for (const [key, value] of Object.entries(detail)) {
    const want = KEYS[key];
    if (!want || typeof value !== want) continue;
    if (want === "number" && !Number.isFinite(value)) continue;
    out[key] = want === "string" ? (value as string).slice(0, MAX_STRING) : (value as number | boolean);
  }
  return Object.keys(out).length ? out : undefined;
}

export function cleanEvents(body: unknown) {
  const events = Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events.slice(0, MAX_EVENTS) : [];
  return events
    .filter((e): e is { t?: unknown; type: string; detail?: unknown } => typeof (e as { type?: unknown })?.type === "string" && TYPES.has((e as { type: string }).type))
    .map((e) => ({ t: Math.round(Number(e.t) || 0), type: e.type, detail: cleanDetail(e.detail) }));
}
