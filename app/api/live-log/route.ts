import { rateLimited } from "@/lib/ai/guard";
import { cleanEvents, MAX_BODY_BYTES } from "@/lib/live/diag";

export const runtime = "nodejs";

/**
 * Diagnostics from live voice sessions. The voice itself goes phone <-> Gemini
 * directly, so the phone reports connection events and counters here to make
 * problems visible in the Worker logs (`wrangler tail`, lines start with
 * `live-diag`). Only known event types and known keys are kept, with numbers,
 * booleans and short strings, so free text like a transcript can't get in.
 */
export async function POST(req: Request) {
  // Always 204: diagnostics must never break or slow the app, and give nothing back to probe.
  const ok = () => new Response(null, { status: 204 });
  if (rateLimited(req, 60, 60_000, "live-log")) return ok();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return ok();
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return ok();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return ok();
  }
  const kept = cleanEvents(body);
  if (kept.length) console.log("live-diag", JSON.stringify(kept));
  return ok();
}
