import { AiError, generateJson, isMockMode } from "@/lib/ai/gemini";
import { json, rateLimited, readAudio } from "@/lib/ai/guard";
import { mockShadow } from "@/lib/ai/mock";
import { shadowPrompt } from "@/lib/ai/prompts";
import { normalizeShadow, shadowSchema } from "@/lib/ai/schemas";
import { SHADOW_SENTENCES } from "@/lib/scenarios";
import type { Accent } from "@/lib/types";

export const runtime = "nodejs";

const ALLOWED = new Set(Object.values(SHADOW_SENTENCES).flat());

export async function POST(req: Request) {
  if (rateLimited(req)) return json({ error: "Slow down a little and try again in a minute." }, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Bad request." }, 400);

  // Only sentences we ship; this also keeps user text out of the prompt.
  const sentence = String(form.get("sentence") ?? "");
  if (!ALLOWED.has(sentence)) return json({ error: "Unknown practice sentence." }, 400);
  const accent: Accent = form.get("accent") === "uk" ? "uk" : "us";
  const attempt = Math.max(0, parseInt(String(form.get("attempt") ?? "0"), 10) || 0);

  const audio = await readAudio(form);
  if (!audio.ok) return json({ error: audio.error }, audio.status);

  if (isMockMode()) return json({ ...mockShadow(sentence, attempt), mock: true });

  try {
    const raw = await generateJson({ ...shadowPrompt({ accent, sentence }), audio: audio.audio, schema: shadowSchema });
    return json(normalizeShadow(raw));
  } catch (err) {
    if (err instanceof AiError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
