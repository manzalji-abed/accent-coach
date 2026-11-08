import "server-only";
import { Behavior, GoogleGenAI, Modality, type LiveConnectConfig, type Schema } from "@google/genai";
import type { Scenario } from "../scenarios";
import type { Accent } from "../types";
import { livePrompt, REVIEW_TOOL } from "./prompts";
import { reviewToolParams } from "./schemas";

/** Gemini's realtime native-audio model; override with GEMINI_LIVE_MODEL. */
export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
/** Ephemeral tokens live on v1beta (the SDK defaults to v1); override with GEMINI_LIVE_API_VERSION. */
export const DEFAULT_LIVE_API_VERSION = "v1beta";
export const LIVE_VOICE = "Kore";

export const liveModel = () => process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL;
export const liveApiVersion = () => process.env.GEMINI_LIVE_API_VERSION || DEFAULT_LIVE_API_VERSION;

/**
 * The whole session setup. It is locked into the ephemeral token, so the
 * browser can open a session but can't change the coach's instructions,
 * tools or voice.
 */
export function liveConnectConfig(opts: { accent: Accent; scenario: Scenario }): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: livePrompt(opts),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [
      {
        functionDeclarations: [
          {
            name: REVIEW_TOOL,
            description: "Silently record pronunciation feedback for the learner's last turn. Call once after every learner turn. Never mention it out loud.",
            parameters: reviewToolParams as unknown as Schema,
            // Blocking: the coach waits for the app's instant answer, then always carries on talking.
            // Non-blocking + a silent answer let it end turns without replying (seen on a real phone).
            behavior: Behavior.BLOCKING,
          },
        ],
      },
    ],
    // End of turn after ~0.7 s of silence: snappy, but learners get room to think.
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 700 } },
    // Lets sessions run past the 15-minute audio limit and survive the ~10-minute reconnect.
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
  };
}

/**
 * A single-use token the browser uses to open one live session straight to
 * Gemini. The real API key never leaves the server.
 */
export async function createLiveToken(opts: { accent: Accent; scenario: Scenario }, now = Date.now()) {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: liveApiVersion() } });
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(), // the session (and its reconnects) must finish within 30 min
      newSessionExpireTime: new Date(now + 60_000).toISOString(), // and must start within a minute
      liveConnectConstraints: { model: liveModel(), config: liveConnectConfig(opts) },
      lockAdditionalFields: [],
    },
  });
  if (!token.name) throw new Error("Gemini returned no token");
  return { token: token.name, model: liveModel(), apiVersion: liveApiVersion() };
}
