import "server-only";
import { GoogleGenAI, Modality } from "@google/genai";
import { encodeWav } from "../audio";
import { base64ToBytes, pcm16BytesToFloat } from "../live/pcm";

/** Gemini's speech model for "native" samples; override with GEMINI_TTS_MODEL. */
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_VOICE = "Kore";
export const MAX_TTS_CHARS = 200;
const TTS_TIMEOUT_MS = 15_000;

let client: GoogleGenAI | null = null;
const getClient = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

/**
 * Gemini 3.8 TTS returns WAV for single requests, but earlier models returned
 * headerless 16-bit PCM (e.g. "audio/L16;rate=24000"). Wrap raw PCM in a WAV
 * header so browsers can always decode it.
 */
export function ensureWav(bytes: Uint8Array, mimeType = ""): Uint8Array {
  const riff = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE";
  if (riff) return bytes;
  const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1]) || 24_000;
  return new Uint8Array(encodeWav(pcm16BytesToFloat(bytes), rate));
}

/**
 * Speaks a short phrase with Gemini's voice and returns WAV bytes
 * (24 kHz mono, the 3.8 TTS default for single requests).
 *
 * Used instead of the phone's built-in voice during live conversations:
 * on iPhone the built-in voice can't play while the mic is live, and it
 * interrupts the mic and audio engine every time it tries.
 */
export async function synthesize(text: string, voice = TTS_VOICE): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    const res = await getClient().models.generateContent({
      model: process.env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        abortSignal: controller.signal,
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new Error("no audio in response");
    return ensureWav(base64ToBytes(part.data), part.mimeType);
  } finally {
    clearTimeout(timer);
  }
}
