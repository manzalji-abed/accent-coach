import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { DEFAULT_MODEL, isMockMode } from "@/lib/ai/gemini";
import { json, rateLimited } from "@/lib/ai/guard";
import { synthesize } from "@/lib/ai/tts";

export const runtime = "nodejs";

/**
 * TEMPORARY diagnostic (remove once the summary timeout is understood):
 * times a few Gemini call styles from the Worker to find which one hangs.
 * Behind Cloudflare Access, rate-limited, fixed prompts only, no secrets returned.
 */
const LIMIT_MS = 25_000;
const schema = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] };

async function timed(name: string, run: (signal: AbortSignal, mark: () => void) => Promise<unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMIT_MS);
  const t0 = Date.now();
  let first: number | undefined;
  try {
    await run(controller.signal, () => (first ??= Date.now() - t0));
    return { name, ok: true, ms: Date.now() - t0, firstChunkMs: first };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, firstChunkMs: first, timedOut: controller.signal.aborted, error: String((e as Error)?.message ?? e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  if (rateLimited(req, 2, 60_000, "diag")) return json({ error: "Wait a minute and try again." }, 429);
  if (isMockMode()) return json({ mock: true });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const contents = [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }];
  const drain = async (stream: AsyncIterable<unknown>, mark: () => void) => {
    for await (const _ of stream) mark();
  };
  const results = await Promise.all([
    timed("plain", (abortSignal) => ai.models.generateContent({ model, contents, config: { abortSignal } })),
    timed("plain-stream", async (abortSignal, mark) => drain(await ai.models.generateContentStream({ model, contents, config: { abortSignal } }), mark)),
    timed("json-low-thinking", (abortSignal) =>
      ai.models.generateContent({ model, contents, config: { abortSignal, responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } }),
    ),
    timed("json-low-thinking-stream (app's path)", async (abortSignal, mark) =>
      drain(
        await ai.models.generateContentStream({
          model,
          contents,
          config: { abortSignal, responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        }),
        mark,
      ),
    ),
    timed("tts", () => synthesize("comfortable")),
  ]);
  console.log("gemini-diag", JSON.stringify({ model, results }));
  return json({ model, results });
}
