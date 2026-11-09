import type { Session } from "./types";

/** A saved talk or role-play session by id, if it can be continued (shadowing has no conversation). */
export function findResumable(sessions: Session[], id: string): Session | null {
  const s = sessions.find((x) => x.id === id);
  return s && s.mode !== "shadow" && s.turns.some((t) => t.role === "user") ? s : null;
}

/** Recent sessions the learner can continue, newest first. */
export function recentResumable(sessions: Session[], limit = 3): Session[] {
  return sessions.filter((s) => findResumable([s], s.id)).slice(0, limit);
}

/** The session as it is when picked back up: same id and turns, open again, takeaway to be rewritten. */
export function reopen(s: Session): Session {
  const copy: Session = { ...s };
  delete copy.endedAt;
  delete copy.takeaway;
  return copy;
}
