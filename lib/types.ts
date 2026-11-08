export type Goal = "business" | "travel" | "exams" | "daily";
export type Accent = "us" | "uk";

export interface Profile {
  goal: Goal;
  accent: Accent;
  /** "HH:MM", 24h, the user's local time */
  reminderTime: string;
  createdAt: string;
}

/** One word the coach flagged as mispronounced. */
export interface WordFlag {
  /** The word as it appears in the transcript, e.g. "comfortable" */
  word: string;
  /** How the learner said it, in friendly respelling, e.g. "com-for-TA-ble" */
  said: string;
  /** How it should sound, in friendly respelling, e.g. "COMF-ter-bul" */
  expected: string;
  /** IPA for the target pronunciation, e.g. "/ˈkʌmf.tɚ.bəl/" */
  expectedIpa: string;
  /** The sound that went wrong, as IPA between slashes, e.g. "/θ/" */
  phoneme: string;
  /** One mouth/tongue instruction */
  tip: string;
}

/** A whole-sentence fix: a more natural or correct way to say what the learner meant. */
export interface Correction {
  better: string;
  /** one short reason, e.g. "Use 'went' for the past" */
  why: string;
}

export interface TurnAnalysis {
  transcript: string;
  reply: string;
  /** 0-100 */
  clarity: number;
  flags: WordFlag[];
  correction?: Correction;
}

export interface ShadowResult {
  transcript: string;
  pass: boolean;
  clarity: number;
  flags: WordFlag[];
  feedback: string;
}

export interface Takeaway {
  takeaway: string;
  focus: string;
}

export type Mode = "talk" | "roleplay" | "shadow";

export interface Turn {
  id: string;
  role: "user" | "coach";
  text: string;
  clarity?: number;
  flags?: WordFlag[];
  correction?: Correction;
}

export interface Session {
  id: string;
  mode: Mode;
  scenarioId: string;
  startedAt: string;
  endedAt?: string;
  turns: Turn[];
  /** seconds of the learner actually speaking */
  speakingSeconds: number;
  takeaway?: Takeaway;
}

export interface TroubleWord {
  word: string;
  expected: string;
  expectedIpa: string;
  phoneme: string;
  tip: string;
  misses: number;
  lastMissed: string;
}
