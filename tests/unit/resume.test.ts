import { describe, expect, it } from "vitest";
import { findResumable, recentResumable, reopen } from "@/lib/resume";
import type { Session } from "@/lib/types";

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
});
