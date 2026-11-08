import "server-only";
import { GoogleGenAI, Modality } from "@google/genai";
import { base64ToBytes } from "../live/pcm";

/** Gemini's speech model for "native" samples; override with GEMINI_TTS_MODEL. */
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_VOICE = "Kore";
export const MAX_TTS_CHARS = 200;
const TTS_TIMEOUT_MS = 15_000;

let client: GoogleGenAI | null = null;
const getClient = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

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
    const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("no audio in response");
    return base64ToBytes(data);
  } finally {
    clearTimeout(timer);
  }
}
