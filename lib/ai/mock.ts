import type { ShadowResult, Takeaway, Turn, TurnAnalysis, WordFlag } from "../types";

/**
 * Deterministic stand-in for Gemini. Used when GEMINI_API_KEY is missing or
 * MOCK_AI=1, so the app runs in CI and local dev without spending credits,
 * and UI tests always see the same flagged words.
 */
const COMFORTABLE: WordFlag = {
  word: "comfortable",
  said: "com-for-TA-ble",
  expected: "COMF-ter-bul",
  expectedIpa: "/ˈkʌmf.tɚ.bəl/",
  phoneme: "/ˈ/",
  tip: "Stress the first syllable and drop the middle 'or' sound entirely.",
};
const THINK: WordFlag = {
  word: "think",
  said: "tink",
  expected: "THINK",
  expectedIpa: "/θɪŋk/",
  phoneme: "/θ/",
  tip: "Put your tongue tip lightly between your teeth and blow air out softly.",
};

const MOCK_LINES = [
  { transcript: "I think I feel comfortable talking about my work.", reply: "That's great to hear! What do you enjoy most about it?", clarity: 78, flags: [THINK, COMFORTABLE] },
  { transcript: "I like working with people and solving problems.", reply: "Nice. Can you tell me about a problem you solved recently?", clarity: 91, flags: [] },
  { transcript: "Last week I think we fixed a big bug in the system.", reply: "Impressive! How did your team find it?", clarity: 84, flags: [THINK] },
];

export function mockTurn(history: Turn[]): TurnAnalysis {
  const userTurns = history.filter((t) => t.role === "user").length;
  return structuredClone(MOCK_LINES[userTurns % MOCK_LINES.length]);
}

/** Alternates fail, pass, so tests can exercise both paths. */
export function mockShadow(sentence: string, attempt: number): ShadowResult {
  const words = sentence.replace(/[^\p{L}\s']/gu, "").split(/\s+/).filter(Boolean);
  const target = words.find((w) => w.length > 5) ?? words[0] ?? "word";
  if (attempt % 2 === 0) {
    return {
      transcript: sentence,
      pass: false,
      clarity: 64,
      flags: [{ word: target, said: target.toLowerCase(), expected: target.toUpperCase(), expectedIpa: "/…/", phoneme: "/ˈ/", tip: "Slow down and lean on the stressed syllable." }],
      feedback: `Almost. Try "${target}" again with clearer stress.`,
    };
  }
  return { transcript: sentence, pass: true, clarity: 92, flags: [], feedback: "Clear and natural. Nice work!" };
}

export function mockTakeaway(userTurns: Turn[]): Takeaway {
  const counts = new Map<string, number>();
  for (const t of userTurns) for (const f of t.flags ?? []) counts.set(f.phoneme, (counts.get(f.phoneme) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return { takeaway: "Great conversation! Everything you said came through clearly. Keep it up tomorrow.", focus: "Keep the streak" };
  return {
    takeaway: `Great conversation! Your main takeaway today: ${top === "/ˈ/" ? "watch which syllable you stress" : `watch your ${top} sound`}. It came up more than anything else.`,
    focus: top === "/ˈ/" ? "Word stress" : `The ${top} sound`,
  };
}
