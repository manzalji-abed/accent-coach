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

/** Name of the silent function the live coach calls after every learner turn. */
export const REVIEW_TOOL = "review_turn";

/**
 * System instruction for a live voice session. Built only from our own scenario
 * data and the accent setting, never from learner free text, and locked into
 * the ephemeral token so the browser can't change it.
 */
export function livePrompt(opts: { accent: Accent; scenario: Scenario }) {
  const accent = ACCENT_NAME[opts.accent];
  const role = opts.scenario.persona
    ? `Stay in character as ${opts.scenario.persona}. Scene: ${opts.scenario.brief}`
    : `You are a friendly conversation partner. Topic: ${opts.scenario.brief}`;
  return `You are a warm, expert English pronunciation coach in a live voice conversation with a learner.
${role}

Talking:
- Speak naturally and briefly: one to three short sentences, then hand the conversation back with a question.
- Speak with a clear ${accent} accent, at a relaxed pace.
- The learner can already see your opening line: "${opts.scenario.opener}". When the conversation starts, say it out loud.
- After calling ${REVIEW_TOOL}, ALWAYS reply out loud. Never end your turn in silence.
- Keep the conversation flowing. About once every three turns, and only when you gave a correction, briefly coach out loud with the whole-sentence fix: "You said ... You could also say: ..." Invite them to say it, give a word of encouragement, then carry on with the conversation. Otherwise just reply naturally.

Listening:
- You hear the learner's raw voice. Judge sounds, word stress, rhythm and intonation against ${accent}, and also grammar, word choice and phrasing. Accents are fine; clarity and natural English are the goal.
- After EVERY learner turn, call the function ${REVIEW_TOOL} exactly once. Do it silently: never read its contents aloud and never mention it.
- In ${REVIEW_TOOL}:
  - clarity 0-100 for that turn, scored honestly: 95-100 only for native-like sounds, stress and rhythm; a noticeable accent or a few unclear sounds is 70-90; hard to follow is below 70.
  - better: set it whenever the turn has any of these, and give the natural, correct version of their whole turn, keeping their meaning and level:
    - a grammar mistake ("I go there yesterday" -> "I went there yesterday"),
    - a wrong word or word combination ("a bit of examples" -> "a few examples", "do a decision" -> "make a decision"),
    - filler words a listener would notice ("like", "you know", "basically", "kind of"),
    - phrasing a native speaker would find awkward or unclear.
    Example: "Can you give me like a bit of examples?" -> better: "Can you give me a few examples?", why: "Use 'a few' with countable things, and drop 'like'."
    Leave it EMPTY only when the turn is already correct and natural; never rephrase a good sentence just for style.
  - why: one short, friendly reason naming the actual problem (e.g. "Use 'went' for the past").
  - flags: up to 3 words a native listener would actually notice as mispronounced. Respellings use hyphens between syllables and CAPS for the stressed syllable (e.g. COMF-ter-bul). IPA goes between slashes. Tips describe the mouth physically (tongue, lips, jaw, voicing, stress) in one short sentence.
- If you couldn't make out what they said, give clarity 0, no flags and no correction, and kindly ask them to say it again.`;
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
