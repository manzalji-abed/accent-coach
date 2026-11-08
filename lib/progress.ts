import type { Session, TroubleWord, WordFlag } from "./types";

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Sessions that count: finished, with at least one spoken turn. */
export function practisedSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.endedAt && s.turns.some((t) => t.role === "user"));
}

/**
 * Consecutive days with practice, ending today. If today has no practice yet
 * but yesterday does, the streak is still alive (you have until midnight).
 */
export function currentStreak(sessions: Session[], today = new Date()): number {
  const days = new Set(practisedSessions(sessions).map((s) => dayKey(new Date(s.startedAt))));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function practisedToday(sessions: Session[], today = new Date()): boolean {
  return practisedSessions(sessions).some((s) => dayKey(new Date(s.startedAt)) === dayKey(today));
}

export function sessionClarity(session: Session): number | null {
  const scores = session.turns.filter((t) => t.role === "user" && typeof t.clarity === "number").map((t) => t.clarity!);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** Rounded up, so any practice at all shows as at least 1 minute. */
export function totalSpeakingMinutes(sessions: Session[]): number {
  return Math.ceil(sessions.reduce((a, s) => a + s.speakingSeconds, 0) / 60);
}

/** Stress problems come back as "/ˈ/", which means nothing to a learner. */
export function phonemeLabel(phoneme: string): string {
  const p = phoneme.trim();
  return p === "/ˈ/" || p === "ˈ" || /stress/i.test(p) ? "Stress" : p;
}

/** Fold a session's flags into the trouble-word bank. */
export function mergeTroubleWords(bank: TroubleWord[], flags: WordFlag[], at = new Date()): TroubleWord[] {
  const next = bank.map((w) => ({ ...w }));
  for (const f of flags) {
    const key = f.word.toLowerCase().replace(/[^\p{L}']/gu, "");
    if (!key) continue;
    const existing = next.find((w) => w.word === key);
    if (existing) {
      existing.misses++;
      existing.lastMissed = at.toISOString();
      existing.tip = f.tip;
    } else {
      next.push({
        word: key,
        expected: f.expected,
        expectedIpa: f.expectedIpa,
        phoneme: f.phoneme,
        tip: f.tip,
        misses: 1,
        lastMissed: at.toISOString(),
      });
    }
  }
  return next.sort((a, b) => b.misses - a.misses || b.lastMissed.localeCompare(a.lastMissed));
}

export interface PhonemeRow {
  phoneme: string;
  /** misses per week, oldest first; `weeks` entries */
  weekly: number[];
  total: number;
}

/** Misses per problem sound, bucketed into the last `weeks` weeks. */
export function phonemeHeatmap(sessions: Session[], weeks = 6, now = new Date()): PhonemeRow[] {
  const rows = new Map<string, number[]>();
  const weekMs = 7 * 86_400_000;
  for (const s of sessions) {
    const age = Math.floor((now.getTime() - new Date(s.startedAt).getTime()) / weekMs);
    if (age < 0 || age >= weeks) continue;
    for (const t of s.turns) {
      for (const f of t.flags ?? []) {
        const p = f.phoneme.trim();
        if (!p) continue;
        if (!rows.has(p)) rows.set(p, new Array(weeks).fill(0));
        rows.get(p)![weeks - 1 - age]++;
      }
    }
  }
  return [...rows.entries()]
    .map(([phoneme, weekly]) => ({ phoneme, weekly, total: weekly.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
}
