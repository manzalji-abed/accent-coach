import { isMockMode } from "@/lib/ai/gemini";
import { json, rateLimited } from "@/lib/ai/guard";
import { MAX_TTS_CHARS, synthesize } from "@/lib/ai/tts";

export const runtime = "nodejs";

/**
 * A native-speaker sample of a word or short sentence, as WAV audio.
 * The text is only spoken, never sent to the model as instructions.
 * In demo mode it answers { mock: true } and the browser uses the device voice.
 */
export async function POST(req: Request) {
  if (rateLimited(req, 30, 60_000, "tts")) return json({ error: "Slow down a little and try again in a minute." }, 429);
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return json({ error: "Nothing to say." }, 400);
  if (text.length > MAX_TTS_CHARS) return json({ error: "That's too long to play." }, 413);

  if (isMockMode()) return json({ mock: true });

  try {
    const wav = await synthesize(text);
    return new Response(new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    console.error("TTS failed", (err as { status?: number }).status, (err as Error).message);
    return json({ error: "Couldn't play the sample. Try again." }, 502);
  }
}
