import type { Accent, Turn } from "../types";
import type { Scenario } from "../scenarios";

const ACCENT_NAME: Record<Accent, string> = { us: "General American", uk: "Standard Southern British (RP)" };

const COACH_RULES = (accent: Accent) => `You are a warm, expert English pronunciation coach.
Listen to the learner's raw audio, not just the words. Judge sounds, word stress, rhythm and intonation against ${ACCENT_NAME[accent]}.
Only flag words a native listener would actually notice. Accents are fine; clarity is the goal. Never flag more than 3 words.
Respellings use hyphens between syllables and CAPS for the stressed syllable (e.g. COMF-ter-bul). IPA goes between slashes.
Tips describe the mouth physically (tongue, lips, jaw, voicing, stress) in one short sentence.
If the audio is silent or unintelligible, return an empty transcript, clarity 0, no flags, and a reply asking them to try again.`;

export function turnPrompt(opts: { accent: Accent; scenario: Scenario; history: Turn[] }) {
  const role = opts.scenario.persona
    ? `Stay in character as ${opts.scenario.persona}. Scene: ${opts.scenario.brief}`
    : `You are a friendly conversation partner. Topic: ${opts.scenario.brief}`;
  const history = opts.history
    .slice(-8)
    .map((t) => `${t.role === "user" ? "Learner" : "You"}: ${t.text}`)
    .join("\n");
  return {
    system: `${COACH_RULES(opts.accent)}\n\n${role}\nYour reply continues the conversation naturally; do not mention pronunciation in the reply itself (feedback goes in the flags).`,
    text: `Conversation so far:\n${history || "(none)"}\n\nThe attached audio is the learner's next turn. Analyse it and reply.`,
  };
}

export function shadowPrompt(opts: { accent: Accent; sentence: string }) {
  return {
    system: COACH_RULES(opts.accent),
    text: `The learner is shadowing (repeating) this exact sentence:\n"${opts.sentence}"\n\nThe attached audio is their attempt. Pass them if every word is clear to a native listener, even with an accent.`,
  };
}

export function takeawayPrompt(opts: { scenarioTitle: string; userTurns: Turn[] }) {
  const lines = opts.userTurns.map((t) => {
    const flags = (t.flags ?? []).map((f) => `${f.word} (${f.phoneme}: said ${f.said}, expected ${f.expected})`).join("; ");
    return `- "${t.text}" clarity ${t.clarity ?? "?"}${flags ? ` | flagged: ${flags}` : ""}`;
  });
  return {
    system: "You are a warm pronunciation coach writing a one-line end-of-session takeaway. Find the pattern across turns, not a single slip.",
    text: `Session: ${opts.scenarioTitle}\nLearner turns:\n${lines.join("\n")}`,
  };
}
