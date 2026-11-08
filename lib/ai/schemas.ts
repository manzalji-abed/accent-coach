import type { ShadowResult, Takeaway, TurnAnalysis, WordFlag } from "../types";

/** JSON Schemas handed to Gemini so it must answer in exactly this shape. */
const flagSchema = {
  type: "object",
  properties: {
    word: { type: "string", description: "The word exactly as it appears in the transcript" },
    said: { type: "string", description: "How the learner said it, as a friendly respelling with the stressed syllable in CAPS, e.g. com-for-TA-ble" },
    expected: { type: "string", description: "How it should sound, as a friendly respelling with the stressed syllable in CAPS, e.g. COMF-ter-bul" },
    expectedIpa: { type: "string", description: "IPA for the target accent, between slashes" },
    phoneme: { type: "string", description: "The single sound that went most wrong, as IPA between slashes, e.g. /θ/. Use a stress marker /ˈ/ if the problem was stress." },
    tip: { type: "string", description: "One concrete instruction about the mouth, tongue, lips or stress, under 25 words" },
  },
  required: ["word", "said", "expected", "expectedIpa", "phoneme", "tip"],
} as const;

export const turnSchema = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "What the learner actually said, verbatim, in normal spelling" },
    reply: { type: "string", description: "Your in-character conversational reply, 1-3 short sentences, ending with something that invites them to keep talking" },
    clarity: { type: "integer", minimum: 0, maximum: 100, description: "Overall pronunciation clarity of this utterance: accuracy, rhythm and stress" },
    flags: { type: "array", maxItems: 3, items: flagSchema, description: "Up to 3 words that a listener would notice as mispronounced, most important first. Empty if none." },
  },
  required: ["transcript", "reply", "clarity", "flags"],
} as const;

export const shadowSchema = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    pass: { type: "boolean", description: "True if a native listener would understand every word without effort" },
    clarity: { type: "integer", minimum: 0, maximum: 100 },
    flags: { type: "array", maxItems: 3, items: flagSchema },
    feedback: { type: "string", description: "One short sentence: praise if passed, the single fix to try if not" },
  },
  required: ["transcript", "pass", "clarity", "flags", "feedback"],
} as const;

export const takeawaySchema = {
  type: "object",
  properties: {
    takeaway: { type: "string", description: "Two sentences max: one genuine compliment, then the single most important thing to work on" },
    focus: { type: "string", description: "The focus area in 2-5 words, e.g. 'R after vowels'" },
  },
  required: ["takeaway", "focus"],
} as const;

/* ---- Defensive normalizers: never trust model output blindly ---- */

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const score = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
};

function normalizeFlags(v: unknown, transcript: string): WordFlag[] {
  if (!Array.isArray(v)) return [];
  const lower = transcript.toLowerCase();
  return v
    .map((f) => ({
      word: str(f?.word, 40),
      said: str(f?.said, 60),
      expected: str(f?.expected, 60),
      expectedIpa: str(f?.expectedIpa, 60),
      phoneme: str(f?.phoneme, 12),
      tip: str(f?.tip, 200),
    }))
    // A flag for a word that isn't in the transcript can't be highlighted; drop it.
    .filter((f) => f.word && f.expected && lower.includes(f.word.toLowerCase()))
    .slice(0, 3);
}

export function normalizeTurn(raw: unknown): TurnAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const transcript = str(r.transcript, 2000);
  return {
    transcript,
    reply: str(r.reply, 800) || "Sorry, could you say that again?",
    clarity: score(r.clarity),
    flags: normalizeFlags(r.flags, transcript),
  };
}

export function normalizeShadow(raw: unknown): ShadowResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const transcript = str(r.transcript, 1000);
  return {
    transcript,
    pass: r.pass === true,
    clarity: score(r.clarity),
    flags: normalizeFlags(r.flags, transcript),
    feedback: str(r.feedback, 300),
  };
}

export function normalizeTakeaway(raw: unknown): Takeaway {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { takeaway: str(r.takeaway, 400), focus: str(r.focus, 60) };
}
