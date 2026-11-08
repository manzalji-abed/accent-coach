import { describe, expect, it } from "vitest";
import { encodeWav, looksLikeWav, toMono16k } from "@/lib/audio";
import { segmentTranscript } from "@/lib/highlight";
import { dailyReminderIcs } from "@/lib/ics";
import { currentStreak, mergeTroubleWords, phonemeHeatmap, sessionClarity } from "@/lib/progress";
import { normalizeShadow, normalizeTurn } from "@/lib/ai/schemas";
import { mockShadow, mockTakeaway, mockTurn } from "@/lib/ai/mock";
import { lessonForDay, SCENARIOS, SHADOW_SENTENCES } from "@/lib/scenarios";
import type { Session, WordFlag } from "@/lib/types";

const flag = (word: string, phoneme = "/θ/"): WordFlag => ({ word, said: "x", expected: "Y", expectedIpa: "/y/", phoneme, tip: "tip" });

const session = (daysAgo: number, opts: Partial<Session> = {}, now = new Date("2026-11-08T12:00:00")): Session => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return {
    id: `s${daysAgo}-${Math.random()}`,
    mode: "talk",
    scenarioId: "free-daily",
    startedAt: d.toISOString(),
    endedAt: d.toISOString(),
    turns: [{ id: "u", role: "user", text: "hi", clarity: 80 }],
    speakingSeconds: 30,
    ...opts,
  };
};

describe("audio encoding", () => {
  it("writes a valid 16 kHz mono WAV header", () => {
    const wav = new Uint8Array(encodeWav(new Float32Array(1600)));
    expect(looksLikeWav(wav)).toBe(true);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(wav.byteLength).toBe(44 + 1600 * 2);
  });

  it("clips samples outside -1..1 instead of wrapping", () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2])));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("downmixes stereo and resamples 48k to 16k", () => {
    const left = new Float32Array(48000).fill(1);
    const right = new Float32Array(48000).fill(0);
    const out = toMono16k([left, right], 48000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.5);
  });

  it("rejects files that aren't WAV", () => {
    expect(looksLikeWav(new TextEncoder().encode("<html>not audio at all, definitely not a wav file</html>"))).toBe(false);
    expect(looksLikeWav(new Uint8Array(10))).toBe(false);
  });
});

describe("transcript highlighting", () => {
  it("marks flagged words and keeps punctuation outside", () => {
    const segs = segmentTranscript("I think, comfortable!", [flag("think"), flag("comfortable")]);
    expect(segs.map((s) => [s.text, Boolean(s.flag)])).toEqual([
      ["I ", false],
      ["think", true],
      [", ", false],
      ["comfortable", true],
      ["!", false],
    ]);
  });

  it("is case-insensitive and highlights only the first occurrence per flag", () => {
    const segs = segmentTranscript("Think think", [flag("think")]);
    expect(segs.filter((s) => s.flag)).toHaveLength(1);
    expect(segs.map((s) => s.text).join("")).toBe("Think think");
  });

  it("ignores flags for words that aren't present", () => {
    expect(segmentTranscript("hello there", [flag("banana")])).toEqual([{ text: "hello there" }]);
  });
});

describe("model output normalisation", () => {
  it("clamps scores, drops unmatched flags and caps at three", () => {
    const out = normalizeTurn({
      transcript: "one two three four",
      reply: "ok",
      clarity: 140,
      flags: [flag("one"), flag("two"), flag("ghost"), flag("three"), flag("four")],
    });
    expect(out.clarity).toBe(100);
    expect(out.flags.map((f) => f.word)).toEqual(["one", "two", "three"]);
  });

  it("survives garbage", () => {
    expect(normalizeTurn(null)).toMatchObject({ transcript: "", clarity: 0, flags: [] });
    expect(normalizeTurn({ clarity: "abc", flags: "nope" }).clarity).toBe(0);
    expect(normalizeShadow({ pass: "true" }).pass).toBe(false); // only a real boolean passes
  });
});

describe("streaks and progress", () => {
  const now = new Date("2026-11-08T12:00:00");
  it("counts consecutive days including today", () => {
    expect(currentStreak([session(0), session(1), session(2), session(4)], now)).toBe(3);
  });
  it("keeps the streak alive until midnight if yesterday was practised", () => {
    expect(currentStreak([session(1), session(2)], now)).toBe(2);
  });
  it("breaks after a missed day", () => {
    expect(currentStreak([session(2), session(3)], now)).toBe(0);
  });
  it("ignores unfinished and silent sessions", () => {
    expect(currentStreak([session(0, { endedAt: undefined }), session(0, { turns: [] })], now)).toBe(0);
  });
  it("averages clarity per session", () => {
    const s = session(0, { turns: [{ id: "a", role: "user", text: "a", clarity: 70 }, { id: "b", role: "coach", text: "b" }, { id: "c", role: "user", text: "c", clarity: 91 }] });
    expect(sessionClarity(s)).toBe(81);
  });
  it("merges trouble words and sorts by misses", () => {
    let bank = mergeTroubleWords([], [flag("Think"), flag("world", "/ɝ/")]);
    bank = mergeTroubleWords(bank, [flag("think.")]);
    expect(bank[0]).toMatchObject({ word: "think", misses: 2 });
    expect(bank).toHaveLength(2);
  });
  it("buckets phoneme slips by week", () => {
    const withFlags = (daysAgo: number, phoneme: string) =>
      session(daysAgo, { turns: [{ id: "u", role: "user", text: "x", flags: [flag("x", phoneme)] }] });
    const rows = phonemeHeatmap([withFlags(0, "/θ/"), withFlags(1, "/θ/"), withFlags(8, "/θ/"), withFlags(0, "/r/"), withFlags(60, "/v/")], 6, now);
    expect(rows[0]).toEqual({ phoneme: "/θ/", weekly: [0, 0, 0, 0, 1, 2], total: 3 });
    expect(rows.find((r) => r.phoneme === "/v/")).toBeUndefined(); // older than 6 weeks
  });
});

describe("calendar reminder", () => {
  it("creates a daily repeating event with an alarm at the chosen local time", () => {
    const ics = dailyReminderIcs({ time: "19:30", title: "Practice; daily", url: "https://x.test", now: new Date("2026-11-08T08:00:00") });
    expect(ics).toContain("DTSTART:20261108T193000");
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("SUMMARY:Practice\\; daily");
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
  });
  it("starts tomorrow if today's time has passed", () => {
    expect(dailyReminderIcs({ time: "07:00", title: "t", url: "u", now: new Date("2026-11-08T08:00:00") })).toContain("DTSTART:20261109T070000");
  });
  it("rejects bad times", () => {
    expect(() => dailyReminderIcs({ time: "25:00", title: "t", url: "u" })).toThrow();
  });
});

describe("content and demo mode", () => {
  it("every goal has role-plays, free talk and shadow sentences", () => {
    for (const goal of ["business", "travel", "exams", "daily"] as const) {
      expect(SCENARIOS.filter((s) => s.goal === goal && s.mode === "roleplay").length).toBeGreaterThanOrEqual(2);
      expect(SCENARIOS.some((s) => s.goal === goal && s.mode === "talk")).toBe(true);
      expect(SHADOW_SENTENCES[goal].length).toBeGreaterThanOrEqual(5);
      expect(lessonForDay(goal, new Date()).goal).toBe(goal);
    }
  });
  it("lesson of the day changes day to day", () => {
    const a = lessonForDay("business", new Date("2026-11-08"));
    const b = lessonForDay("business", new Date("2026-11-09"));
    expect(a.id).not.toBe(b.id);
  });
  it("mock coach is deterministic and its flags always match the transcript", () => {
    const t = mockTurn([]);
    expect(normalizeTurn(t).flags).toHaveLength(t.flags.length);
    expect(mockShadow("Could I get the check, please?", 0).pass).toBe(false);
    expect(mockShadow("Could I get the check, please?", 1).pass).toBe(true);
    expect(mockTakeaway([{ id: "1", role: "user", text: "x", flags: [flag("x", "/θ/")] }]).takeaway).toContain("/θ/");
  });
});
