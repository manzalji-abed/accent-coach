import { isMockMode } from "@/lib/ai/gemini";
import { json, rateLimited } from "@/lib/ai/guard";
import { createLiveToken } from "@/lib/ai/live";
import { audienceById, DEFAULT_AUDIENCE_ID, DEFAULT_INTENT_ID, intentById } from "@/lib/comms";
import { DEFAULT_PERSONA_ID, personaById } from "@/lib/personas";
import { scenarioById } from "@/lib/scenarios";
import type { Accent } from "@/lib/types";

export const runtime = "nodejs";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/**
 * Starts a live voice session: returns a single-use token the browser uses to
 * talk to Gemini directly. The coach's instructions are built here from our own
 * scenario data and locked into the token. In demo mode it returns
 * { mock: true } and the browser plays a scripted conversation instead.
 */
export async function POST(req: Request) {
  // Each session is minutes long, so a person needs only a few of these per minute.
  if (rateLimited(req, 10, 60_000, "live")) return json({ error: "Slow down a little and try again in a minute." }, 429);
  const body = await req.json().catch(() => null);
  const scenario = scenarioById(clip(body?.scenarioId, 40));
  if (!scenario) return json({ error: "Unknown practice scenario." }, 400);
  // Only an id from our own list is accepted; it picks the voice and personality server-side.
  const persona = personaById(body?.personaId ?? (scenario.personaId || DEFAULT_PERSONA_ID));
  if (!persona) return json({ error: "Unknown conversation partner." }, 400);
  // Audience and goal are ids from our own lists too; missing means the scenario's choice, else peer + small talk.
  const audience = audienceById(body?.audienceId ?? scenario.audienceId ?? DEFAULT_AUDIENCE_ID);
  if (!audience) return json({ error: "Unknown audience." }, 400);
  const intent = intentById(body?.intentId ?? scenario.intentId ?? DEFAULT_INTENT_ID);
  if (!intent) return json({ error: "Unknown goal for this conversation." }, 400);
  const accent: Accent = body?.accent === "uk" ? "uk" : "us";

  if (isMockMode()) return json({ mock: true });

  try {
    return json(await createLiveToken({ accent, scenario, persona, audience, intent }));
  } catch (err) {
    console.error("Live token request failed", (err as { status?: number }).status, (err as Error).message);
    return json({ error: "Couldn't start a live session with your coach. Try again in a minute." }, 502);
  }
}
