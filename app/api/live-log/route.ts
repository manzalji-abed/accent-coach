import { rateLimited } from "@/lib/ai/guard";

export const runtime = "nodejs";

/**
 * Diagnostics from live voice sessions. The voice itself goes phone <-> Gemini
 * directly, so the phone reports connection events and counters here to make
 * problems visible in the Worker logs (`wrangler tail`). Only known event
 * types and small primitive values are kept; transcripts are never sent.
 */
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

function clean(detail: unknown): Record<string, string | number | boolean> | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(detail).slice(0, 16)) {
    const key = k.slice(0, 32);
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "string") out[key] = v.slice(0, 200);
  }
  return out;
}

export async function POST(req: Request) {
  const ok = new Response(null, { status: 204 });
  if (rateLimited(req, 60, 60_000, "live-log")) return ok;
  const body = await req.json().catch(() => null);
  const events = Array.isArray(body?.events) ? body.events.slice(0, 40) : [];
  const kept = events
    .filter((e: { type?: unknown }) => typeof e?.type === "string" && TYPES.has(e.type))
    .map((e: { t?: unknown; type: string; detail?: unknown }) => ({ t: Math.round(Number(e.t) || 0), type: e.type, detail: clean(e.detail) }));
  if (kept.length) console.log("live-diag", JSON.stringify(kept).slice(0, 4000));
  return ok;
}
