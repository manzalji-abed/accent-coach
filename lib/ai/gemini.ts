import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/** Default to the current GA Flash model; override with GEMINI_MODEL. */
export const DEFAULT_MODEL = "gemini-3.8-flash";

/**
 * Give up well before Cloudflare's ~100 s limit, so the learner gets a clear
 * message quickly instead of a long spinner followed by error 524.
 */
export const GEMINI_TIMEOUT_MS = 45_000;

export function isMockMode(): boolean {
  return process.env.MOCK_AI === "1" || !process.env.GEMINI_API_KEY;
}

let client: GoogleGenAI | null = null;
function getClient() {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Joins streamed chunks into the full answer. The SDK's `text` already leaves out thought parts. */
export async function collectStreamText(stream: AsyncIterable<{ text?: string }>): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk.text ?? "";
  return out;
}

/** Turns an SDK or network failure into a message the learner can act on. */
export function aiErrorFrom(err: unknown): AiError {
  const e = (err ?? {}) as { status?: number; name?: string };
  if (e.status === 429) return new AiError("The coach is busy right now. Try again in a minute.", 429);
  if (e.name === "AbortError" || e.name === "TimeoutError" || e.status === 504 || e.status === 524) {
    return new AiError("The coach took too long to answer. Try again with a shorter recording.", 504);
  }
  return new AiError("Couldn't reach the coach. Check your connection and try again.", 502);
}

/**
 * One structured call: system prompt + text + optional WAV audio in, parsed JSON out.
 * Throws AiError with a status the API route can pass straight to the client.
 */
export async function generateJson(opts: {
  system: string;
  text: string;
  audio?: Uint8Array;
  schema: object;
}): Promise<unknown> {
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [{ text: opts.text }];
  if (opts.audio) parts.push({ inlineData: { mimeType: "audio/wav", data: Buffer.from(opts.audio).toString("base64") } });

  let raw: string;
  try {
    // Streaming makes Gemini answer with headers right away, so a slow reply can't
    // trip Cloudflare's "no response within 100 s" limit (error 524).
    const stream = await getClient().models.generateContentStream({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: opts.schema,
        temperature: 0.4,
        // Gemini 3 thinks at length by default. Low keeps feedback fast and about halves the cost.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      },
    });
    raw = await collectStreamText(stream);
  } catch (err) {
    console.error("Gemini request failed", (err as { status?: number }).status, (err as Error).message);
    throw aiErrorFrom(err);
  }
  if (!raw) throw new AiError("The coach didn't answer. Try again.", 502);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AiError("The coach's answer was garbled. Try again.", 502);
  }
}
