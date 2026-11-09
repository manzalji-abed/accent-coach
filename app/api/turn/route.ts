import { AiError, generateJson, isMockMode } from "@/lib/ai/gemini";
import { json, rateLimited, readAudio } from "@/lib/ai/guard";
import { mockTurn } from "@/lib/ai/mock";
import { turnPrompt } from "@/lib/ai/prompts";
import { normalizeTurn, turnSchema } from "@/lib/ai/schemas";
import { DEFAULT_PERSONA_ID, personaById } from "@/lib/personas";
import { scenarioById } from "@/lib/scenarios";
import type { Accent, Turn } from "@/lib/types";

export const runtime = "nodejs";

function parseHistory(raw: FormDataEntryValue | null): Turn[] {
  try {
    const parsed = JSON.parse(typeof raw === "string" ? raw : "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(-12)
      .filter((t) => (t?.role === "user" || t?.role === "coach") && typeof t?.text === "string")
      .map((t, i) => ({ id: String(i), role: t.role, text: t.text.slice(0, 600) }));
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return json({ error: "Slow down a little and try again in a minute." }, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Bad request." }, 400);

  const scenario = scenarioById(String(form.get("scenarioId") ?? ""));
  if (!scenario) return json({ error: "Unknown practice scenario." }, 400);
  const accent: Accent = form.get("accent") === "uk" ? "uk" : "us";
  const history = parseHistory(form.get("history"));

  const audio = await readAudio(form);
  if (!audio.ok) return json({ error: audio.error }, audio.status);

  if (isMockMode()) return json({ ...mockTurn(history), mock: true });

  try {
    const prompt = turnPrompt({ accent, scenario, persona: personaById(scenario.personaId) ?? personaById(DEFAULT_PERSONA_ID)!, history });
    const raw = await generateJson({ ...prompt, audio: audio.audio, schema: turnSchema });
    return json(normalizeTurn(raw));
  } catch (err) {
    if (err instanceof AiError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
