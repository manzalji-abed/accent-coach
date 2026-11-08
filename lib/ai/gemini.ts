import "server-only";
import { GoogleGenAI } from "@google/genai";

/** Default to the current GA Flash model; override with GEMINI_MODEL. */
export const DEFAULT_MODEL = "gemini-3.8-flash";

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

  let raw: string | undefined;
  try {
    const res = await getClient().models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: opts.schema,
        temperature: 0.4,
      },
    });
    raw = res.text;
  } catch (err) {
    const status = (err as { status?: number }).status;
    console.error("Gemini request failed", status, (err as Error).message);
    if (status === 429) throw new AiError("The coach is busy right now. Try again in a minute.", 429);
    throw new AiError("Couldn't reach the coach. Check your connection and try again.", 502);
  }
  if (!raw) throw new AiError("The coach didn't answer. Try again.", 502);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AiError("The coach's answer was garbled. Try again.", 502);
  }
}
