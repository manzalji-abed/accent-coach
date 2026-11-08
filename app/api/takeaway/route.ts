import { AiError, generateJson, isMockMode } from "@/lib/ai/gemini";
import { json, rateLimited } from "@/lib/ai/guard";
import { mockTakeaway } from "@/lib/ai/mock";
import { takeawayPrompt } from "@/lib/ai/prompts";
import { normalizeTakeaway, takeawaySchema } from "@/lib/ai/schemas";
import { scenarioById } from "@/lib/scenarios";
import type { Turn, WordFlag } from "@/lib/types";

export const runtime = "nodejs";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

function parseTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-20).map((t, i) => ({
    id: String(i),
    role: "user" as const,
    text: clip(t?.text, 600),
    clarity: typeof t?.clarity === "number" ? t.clarity : undefined,
    flags: Array.isArray(t?.flags)
      ? t.flags.slice(0, 3).map(
          (f: Partial<WordFlag>): WordFlag => ({
            word: clip(f?.word, 40),
            said: clip(f?.said, 60),
            expected: clip(f?.expected, 60),
            expectedIpa: clip(f?.expectedIpa, 60),
            phoneme: clip(f?.phoneme, 12),
            tip: clip(f?.tip, 200),
          }),
        )
      : [],
  }));
}

export async function POST(req: Request) {
  if (rateLimited(req)) return json({ error: "Slow down a little and try again in a minute." }, 429);
  const body = await req.json().catch(() => null);
  const scenario = scenarioById(clip(body?.scenarioId, 40));
  if (!scenario) return json({ error: "Unknown practice scenario." }, 400);
  const userTurns = parseTurns(body?.turns);
  if (!userTurns.length) return json({ error: "Say something first, then finish the session." }, 400);

  if (isMockMode()) return json({ ...mockTakeaway(userTurns), mock: true });

  try {
    const raw = await generateJson({ ...takeawayPrompt({ scenarioTitle: scenario.title, userTurns }), schema: takeawaySchema });
    const result = normalizeTakeaway(raw);
    // Fall back to the local summary rather than show an empty card.
    return json(result.takeaway ? result : mockTakeaway(userTurns));
  } catch (err) {
    if (err instanceof AiError) return json(mockTakeaway(userTurns));
    console.error(err);
    return json(mockTakeaway(userTurns));
  }
}
