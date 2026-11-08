"use client";
import { useSyncExternalStore } from "react";
import { mergeTroubleWords } from "./progress";
import type { Profile, Session, TroubleWord } from "./types";

/**
 * Everything lives on the device for the MVP (no accounts). One localStorage
 * key, versioned so a future migration can read old data.
 */
const KEY = "accent-coach:v1";

export interface AppState {
  profile: Profile | null;
  sessions: Session[];
  trouble: TroubleWord[];
}

const EMPTY: AppState = { profile: null, sessions: [], trouble: [] };
let state: AppState | null = null;
const listeners = new Set<() => void>();

function load(): AppState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    state = EMPTY;
  }
  return state!;
}

function commit(next: AppState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private mode): keep working in memory.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      state = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns null during server render / before hydration. */
export function useAppState(): AppState | null {
  return useSyncExternalStore(subscribe, load, () => null);
}

export function saveProfile(profile: Profile) {
  commit({ ...load(), profile });
}

/** Insert or update a session. Finishing a session files its flags into the trouble bank. */
export function saveSession(session: Session, opts: { finished?: boolean } = {}) {
  const current = load();
  const previous = current.sessions.find((s) => s.id === session.id);
  const sessions = [session, ...current.sessions.filter((s) => s.id !== session.id)].slice(0, 200);
  let trouble = current.trouble;
  // File flags only the first time a session is saved as finished; later saves
  // (e.g. when the takeaway arrives) must not count the same slips again.
  if (opts.finished && !previous?.endedAt) {
    const flags = session.turns.flatMap((t) => (t.role === "user" ? (t.flags ?? []) : []));
    trouble = mergeTroubleWords(trouble, flags, new Date(session.endedAt ?? Date.now()));
  }
  commit({ ...current, sessions, trouble });
}

export function removeTroubleWord(word: string) {
  const current = load();
  commit({ ...current, trouble: current.trouble.filter((w) => w.word !== word) });
}

export function resetAll() {
  commit(EMPTY);
}

export const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
