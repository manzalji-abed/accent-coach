import { describe, expect, it, vi } from "vitest";
import { findResumable, recentResumable, reopen } from "@/lib/resume";
import { saveSession } from "@/lib/store";
import type { Session, WordFlag } from "@/lib/types";

const slip = (word: string): WordFlag => ({ word, said: "x", expected: "Y", expectedIpa: "/y/", phoneme: "/θ/", tip: "tip" });

const make = (id: string, opts: Partial<Session> = {}): Session => ({
  id,
  mode: "talk",
  scenarioId: "free-daily",
  startedAt: "2026-11-08T12:00:00.000Z",
  endedAt: "2026-11-08T12:05:00.000Z",
  turns: [
    { id: "c", role: "coach", text: "Hi!" },
    { id: "u", role: "user", text: "hello there", clarity: 80 },
  ],
  speakingSeconds: 30,
  ...opts,
});

describe("continuing a conversation", () => {
  it("loads a talk session by id, but not shadowing, empty or unknown ones", () => {
    const a = make("a");
    const shadow = make("sh", { mode: "shadow" });
    const empty = make("e", { turns: [{ id: "c", role: "coach", text: "hi" }] });
    const all = [shadow, empty, a];
    expect(findResumable(all, "a")).toBe(a);
    expect(findResumable(all, "sh")).toBeNull();
    expect(findResumable(all, "e")).toBeNull();
    expect(findResumable(all, "nope")).toBeNull();
  });

  it("lists recent sessions that can be continued, newest first, up to the limit", () => {
    const all = [make("sh", { mode: "shadow" }), make("a"), make("b"), make("c")];
    expect(recentResumable(all).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(recentResumable(all, 2).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("reopens a session with the same id and turns, no longer finished", () => {
    const a = make("a", { takeaway: { takeaway: "t", focus: "f" } });
    const open = reopen(a);
    expect(open.id).toBe("a");
    expect(open.turns).toEqual(a.turns);
    expect(open.endedAt).toBeUndefined();
    expect(open.takeaway).toBeUndefined();
    expect(a.endedAt).toBeDefined();
  });

  it("files only the new turns' slips when a continued conversation is finished again", () => {
    const written: Record<string, string> = {};
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: (k: string, v: string) => void (written[k] = v) });
    const stored = () => JSON.parse(written["accent-coach:v1"]) as { sessions: Session[]; trouble: { word: string; misses: number }[] };
    const first = make("trouble", {
      endedAt: "2026-11-08T12:05:00.000Z",
      turns: [
        { id: "c", role: "coach", text: "Hi!" },
        { id: "u1", role: "user", text: "think", flags: [slip("think")] },
      ],
    });
    saveSession(first, { finished: true });
    // The takeaway arrives: saved again, still counted once.
    saveSession({ ...first, takeaway: { takeaway: "t", focus: "f" } }, { finished: true });
    expect(stored().trouble).toMatchObject([{ word: "think", misses: 1 }]);

    const reopened = reopen(stored().sessions[0]);
    const more: Session = { ...reopened, turns: [...reopened.turns, { id: "u2", role: "user", text: "think thing", flags: [slip("think"), slip("thing")] }] };
    saveSession(more, { finished: false });
    saveSession({ ...more, endedAt: "2026-11-08T13:00:00.000Z" }, { finished: true });

    expect(Object.fromEntries(stored().trouble.map((w) => [w.word, w.misses]))).toEqual({ think: 2, thing: 1 });
    vi.unstubAllGlobals();
  });
});
