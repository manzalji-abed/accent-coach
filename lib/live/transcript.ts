/**
 * Turns the live session's stream of transcription fragments, audio and tool
 * calls into chat turns. Pure logic (no audio or network), so it's unit tested.
 */
import { normalizeReview } from "../ai/schemas";
import type { Correction, Turn, WordFlag } from "../types";

export interface Review {
  transcript: string;
  clarity: number;
  flags: WordFlag[];
  correction?: Correction;
}

export interface TranscriptEvents {
  /** The learner's turn so far (create or update the bubble with this id). */
  userText(id: string, text: string): void;
  /** The learner finished a turn that ran from `startedAt` to `endedAt` (ms, same clock as `now`). */
  userDone(id: string, startedAt: number, endedAt: number): void;
  /** The coach's spoken reply so far (create or update the bubble with this id). */
  coachText(id: string, text: string): void;
  /** Feedback for a learner turn, already normalized. */
  review(id: string, review: Review): void;
}

/** Speech starts a little before its first transcription fragment arrives. */
export const SPEECH_LEAD_MS = 1500;
/** Transcription that trails in this soon after a turn ends still belongs to it. */
export const LATE_TEXT_MS = 1500;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

export class LiveTranscript {
  private user: { id: string; text: string; start: number } | null = null;
  private lastUser: { id: string; text: string; end: number } | null = null;
  private coach: { id: string; text: string } | null = null;

  constructor(
    private readonly ev: TranscriptEvents,
    private readonly newId: () => string,
    /** The opener bubble already on screen: the coach's first spoken words fill it. */
    private firstCoachId?: string,
  ) {}

  get coachTalking() {
    return this.coach !== null;
  }

  /** A fragment of what the learner is saying. */
  heardUser(fragment: string, now: number) {
    if (!fragment) return;
    if (!this.user) {
      // Late transcription of the turn that just ended, before the coach has said a word.
      const late = this.lastUser && now - this.lastUser.end < LATE_TEXT_MS && !this.coach?.text;
      if (late && this.lastUser) {
        this.lastUser.text += fragment;
        this.ev.userText(this.lastUser.id, tidy(this.lastUser.text));
        return;
      }
      if (this.coach) this.coachDone(); // the learner jumped in
      this.user = { id: this.newId(), text: "", start: now - SPEECH_LEAD_MS };
    }
    this.user.text += fragment;
    const text = tidy(this.user.text);
    if (text) this.ev.userText(this.user.id, text);
  }

  /** A fragment of what the coach is saying. */
  heardCoach(fragment: string, now: number) {
    this.endUser(now);
    const coach = this.startCoach();
    coach.text += fragment;
    const text = tidy(coach.text);
    if (text) this.ev.coachText(coach.id, text);
  }

  /** Coach audio arrived: the learner's turn is over even if transcription lags. */
  coachAudio(now: number) {
    this.endUser(now);
    this.startCoach();
  }

  /** The coach finished, or was interrupted. */
  coachDone() {
    this.coach = null;
  }

  /** The coach's silent review_turn call. Applies to the learner's current or most recent turn. */
  reviewed(args: unknown) {
    const target = this.user ?? this.lastUser;
    if (!target) return;
    const heard = tidy(target.text);
    const review = normalizeReview(args, heard);
    if (!heard && review.transcript) {
      target.text = review.transcript;
      this.ev.userText(target.id, review.transcript);
    }
    this.ev.review(target.id, review);
  }

  /** Everything the learner and coach said so far, for picking a session back up after a reconnect. */
  static historyText(turns: Pick<Turn, "role" | "text">[], max = 8) {
    return turns
      .filter((t) => t.text)
      .slice(-max)
      .map((t) => `${t.role === "user" ? "Learner" : "You"}: ${t.text}`)
      .join("\n");
  }

  private endUser(now: number) {
    if (!this.user) return;
    const { id, text, start } = this.user;
    this.user = null;
    if (!tidy(text)) return;
    this.lastUser = { id, text, end: now };
    this.ev.userDone(id, start, now);
  }

  private startCoach() {
    if (!this.coach) {
      this.coach = { id: this.firstCoachId ?? this.newId(), text: "" };
      this.firstCoachId = undefined;
    }
    return this.coach;
  }
}

/** Create or update a turn by id, keeping order. */
export function upsertTurn(turns: Turn[], id: string, patch: Partial<Turn> & Pick<Turn, "role">): Turn[] {
  const i = turns.findIndex((t) => t.id === id);
  if (i === -1) return [...turns, { id, text: "", ...patch }];
  const next = turns.slice();
  next[i] = { ...next[i], ...patch };
  return next;
}
