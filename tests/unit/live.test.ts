import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_MODEL, liveConnectConfig } from "@/lib/ai/live";
import { REVIEW_TOOL } from "@/lib/ai/prompts";
import { scenarioById } from "@/lib/scenarios";
import {
  base64ToBytes,
  bytesToBase64,
  ClipBuffer,
  floatToPcm16Bytes,
  LIVE_INPUT_MIME,
  micChunkToLive,
  pcm16BytesToFloat,
  speechLevel,
} from "@/lib/live/pcm";
import { LATE_TEXT_MS, LiveTranscript, SPEECH_LEAD_MS, upsertTurn, type Review } from "@/lib/live/transcript";
import { rateLimited } from "@/lib/ai/guard";
import { normalizeReview } from "@/lib/ai/schemas";

describe("live audio: PCM conversion", () => {
  it("encodes Float32 as 16-bit little-endian PCM and decodes it back", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const bytes = floatToPcm16Bytes(samples);
    expect(bytes.length).toBe(samples.length * 2);
    // 0.5 * 0x7fff = 16383 -> 0xff 0x3f little-endian
    expect([bytes[2], bytes[3]]).toEqual([0xff, 0x3f]);
    const back = pcm16BytesToFloat(bytes);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[2]).toBeCloseTo(-0.5, 3);
    expect(back[5]).toBeCloseTo(1, 3); // clamped
    expect(back[6]).toBe(-1); // clamped
  });

  it("ignores a trailing odd byte when decoding", () => {
    expect(pcm16BytesToFloat(new Uint8Array([0, 0x40, 7])).length).toBe(1);
  });

  it("round-trips base64, including large chunks", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("turns a 48 kHz mic chunk into 16 kHz base64 PCM for Gemini Live", () => {
    const chunk = new Float32Array(4800).fill(0.25); // 100 ms at 48 kHz
    const { base64, pcm16k } = micChunkToLive(chunk, 48_000);
    expect(pcm16k.length).toBe(1600); // 100 ms at 16 kHz
    expect(base64ToBytes(base64).length).toBe(3200);
    expect(LIVE_INPUT_MIME).toBe("audio/pcm;rate=16000");
  });

  it("reports silence as 0 and speech as a higher level, capped at 1", () => {
    expect(speechLevel(new Float32Array(0))).toBe(0);
    expect(speechLevel(new Float32Array(100))).toBe(0);
    expect(speechLevel(new Float32Array(100).fill(0.1))).toBeGreaterThan(0.3);
    expect(speechLevel(new Float32Array(100).fill(1))).toBe(1);
  });
});

describe("live audio: clip buffer for 'Play yours'", () => {
  it("cuts out the audio between two times and forgets old audio", () => {
    const buf = new ClipBuffer(1000);
    buf.push(new Float32Array([1, 1]), 0);
    buf.push(new Float32Array([2, 2]), 500);
    buf.push(new Float32Array([3, 3]), 900);
    expect(Array.from(buf.slice(400, 1000))).toEqual([2, 2, 3, 3]);
    buf.push(new Float32Array([4]), 1600); // drops everything before 600
    expect(Array.from(buf.slice(0, 2000))).toEqual([3, 3, 4]);
    buf.clear();
    expect(buf.slice(0, 2000).length).toBe(0);
  });
});


function recorder(firstCoachId?: string) {
  const log: string[] = [];
  const reviews: Record<string, Review> = {};
  const done: Record<string, [number, number]> = {};
  let n = 0;
  const t = new LiveTranscript(
    {
      userText: (id, text) => log.push(`user ${id}: ${text}`),
      userDone: (id, a, b) => (done[id] = [a, b]),
      coachText: (id, text) => log.push(`coach ${id}: ${text}`),
      review: (id, r) => (reviews[id] = r),
    },
    () => `t${++n}`,
    firstCoachId,
  );
  return { t, log, reviews, done };
}

const FLAG = { word: "think", said: "tink", expected: "THINK", expectedIpa: "/θɪŋk/", phoneme: "/θ/", tip: "Tongue between teeth." };

describe("live transcript: turning a voice stream into chat turns", () => {
  it("fills the opener bubble first, then streams learner and coach turns", () => {
    const { t, log, done } = recorder("opener");
    t.heardCoach("Hi! How", 0);
    t.heardCoach(" was your day?", 100);
    t.coachDone();
    t.heardUser(" I think", 5000);
    t.heardUser(" it was  good.", 5400);
    t.coachAudio(6500); // coach starts answering: the learner's turn is over
    t.heardCoach("Glad to hear it.", 6600);
    expect(log).toEqual([
      "coach opener: Hi! How",
      "coach opener: Hi! How was your day?",
      "user t1: I think",
      "user t1: I think it was good.",
      "coach t2: Glad to hear it.",
    ]);
    expect(done.t1).toEqual([5000 - SPEECH_LEAD_MS, 6500]);
  });

  it("attaches transcription that trails in right after the turn ended", () => {
    const { t, log } = recorder();
    t.heardUser("Hello", 0);
    t.coachAudio(1000);
    t.heardUser(" there", 1000 + LATE_TEXT_MS - 1); // late, coach hasn't spoken words yet
    expect(log.at(-1)).toBe("user t1: Hello there");
  });

  it("starts a new learner turn when they jump in while the coach is talking", () => {
    const { t, log } = recorder();
    t.heardUser("Hello", 0);
    t.heardCoach("So tell me", 1000);
    expect(t.coachTalking).toBe(true);
    t.heardUser("Sorry, one thing", 1200);
    expect(t.coachTalking).toBe(false);
    expect(log.at(-1)).toBe("user t3: Sorry, one thing");
  });

  it("applies the coach's review to the learner's latest turn, normalized", () => {
    const { t, reviews } = recorder();
    t.heardUser("I think so", 0);
    t.coachAudio(900);
    t.reviewed({ clarity: 140, flags: [FLAG, { ...FLAG, word: "banana" }, "junk"] });
    expect(reviews.t1.clarity).toBe(100); // clamped
    expect(reviews.t1.flags.map((f) => f.word)).toEqual(["think"]); // word must be in what was said
  });

  it("uses the review's transcript when live transcription caught nothing", () => {
    const { t, log, reviews } = recorder();
    t.heardUser("   ", 0); // only whitespace so far
    t.reviewed({ transcript: "I think so", clarity: 80, flags: [FLAG] });
    expect(log.at(-1)).toBe("user t1: I think so");
    expect(reviews.t1.flags).toHaveLength(1);
  });

  it("ignores a review when nobody has spoken yet, and drops empty turns", () => {
    const { t, reviews, done } = recorder();
    t.reviewed({ clarity: 50, flags: [] });
    t.heardUser("  ", 0);
    t.coachAudio(100);
    expect(reviews).toEqual({});
    expect(done).toEqual({});
  });

  it("formats recent history for a reconnect", () => {
    const text = LiveTranscript.historyText([
      { role: "coach", text: "Hi" },
      { role: "user", text: "" },
      { role: "user", text: "Hello" },
    ]);
    expect(text).toBe("You: Hi\nLearner: Hello");
  });
});

describe("live transcript: upsertTurn", () => {
  it("adds new turns at the end and patches existing ones in place", () => {
    let turns = upsertTurn([], "a", { role: "user", text: "Hi" });
    turns = upsertTurn(turns, "b", { role: "coach", text: "Hello" });
    turns = upsertTurn(turns, "a", { role: "user", clarity: 90 });
    expect(turns).toEqual([
      { id: "a", role: "user", text: "Hi", clarity: 90 },
      { id: "b", role: "coach", text: "Hello" },
    ]);
  });
});


describe("rate limiting", () => {
  it("keeps the live-session limit separate from other routes", () => {
    const req = new Request("https://x/api", { headers: { "x-forwarded-for": "203.0.113.7" } });
    for (let i = 0; i < 20; i++) rateLimited(req); // a burst of shadowing attempts
    expect(rateLimited(req, 10, 60_000, "live")).toBe(false); // starting a live session still works
    for (let i = 0; i < 9; i++) rateLimited(req, 10, 60_000, "live");
    expect(rateLimited(req, 10, 60_000, "live")).toBe(true); // the 11th live start in a minute is refused
  });
});

describe("live session config (locked into the token)", () => {
  const scenario = scenarioById("rp-interview")!;

  it("builds the coach from our scenario and accent only, with silent feedback and transcripts", () => {
    const cfg = liveConnectConfig({ accent: "uk", scenario });
    const system = String(cfg.systemInstruction);
    expect(system).toContain(scenario.opener);
    expect(system).toContain("Standard Southern British (RP)");
    expect(system).toContain(REVIEW_TOOL);
    expect(cfg.responseModalities).toEqual(["AUDIO"]);
    expect(cfg.inputAudioTranscription).toEqual({});
    expect(cfg.outputAudioTranscription).toEqual({});
    const fn = (cfg.tools?.[0] as { functionDeclarations?: { name?: string; behavior?: string; parameters?: unknown }[] } | undefined)?.functionDeclarations?.[0];
    expect(fn?.name).toBe(REVIEW_TOOL);
    expect(fn?.behavior).toBe("NON_BLOCKING");
    expect(JSON.stringify(fn?.parameters)).toContain("clarity");
  });

  it("uses the American target when asked, and the 3.8 Live model by default", () => {
    expect(String(liveConnectConfig({ accent: "us", scenario }).systemInstruction)).toContain("General American");
    expect(DEFAULT_LIVE_MODEL).toBe("gemini-3.8-live");
  });
});

describe("rate limiting identity", () => {
  it("trusts Cloudflare's client IP over a spoofable forwarded header", () => {
    const spoofA = new Request("https://x/api", { headers: { "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "1.1.1.1" } });
    const spoofB = new Request("https://x/api", { headers: { "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "2.2.2.2" } });
    for (let i = 0; i < 2; i++) rateLimited(spoofA, 2, 60_000, "ident");
    expect(rateLimited(spoofB, 2, 60_000, "ident")).toBe(true); // changing x-forwarded-for doesn't reset the limit
  });
});


describe("sentence corrections from the live coach", () => {
  it("keeps a real rewording with its reason", () => {
    const r = normalizeReview({ clarity: 80, flags: [], better: "  I went to the store yesterday. ", why: "Use 'went' for the past." }, "I go to the store yesterday");
    expect(r.correction).toEqual({ better: "I went to the store yesterday.", why: "Use 'went' for the past." });
  });

  it("drops a 'correction' that just repeats what was said (ignoring case and punctuation)", () => {
    const r = normalizeReview({ clarity: 90, flags: [], better: "i feel GREAT today!", why: "x" }, "I feel great today.");
    expect(r.correction).toBeUndefined();
  });

  it("drops empty or missing corrections and caps lengths", () => {
    expect(normalizeReview({ clarity: 90, flags: [], better: "", why: "" }, "Hello").correction).toBeUndefined();
    expect(normalizeReview({ clarity: 90, flags: [] }, "Hello").correction).toBeUndefined();
    const long = normalizeReview({ clarity: 90, flags: [], better: "x".repeat(1000), why: "y".repeat(1000) }, "Hello");
    expect(long.correction?.better.length).toBe(300);
    expect(long.correction?.why.length).toBe(200);
  });

  it("flows through the live transcript to the learner's turn", () => {
    const seen: Review[] = [];
    const t = new LiveTranscript({ userText() {}, userDone() {}, coachText() {}, review: (_id, r) => seen.push(r) }, () => "u1");
    t.heardUser("I go there yesterday", 0);
    t.reviewed({ clarity: 70, flags: [], better: "I went there yesterday.", why: "Past tense." });
    expect(seen[0].correction?.better).toBe("I went there yesterday.");
  });
});

describe("live audio: finding the learner's actual speech for 'Play yours'", () => {
  it("cuts from the first to the last loud chunk, padded, inside the window", () => {
    const buf = new ClipBuffer();
    buf.push(new Float32Array(10), 1000, 0.01); // quiet before speaking
    buf.push(new Float32Array(10), 2000, 0.5); // speech starts
    buf.push(new Float32Array(10), 2500, 0.3);
    buf.push(new Float32Array(10), 3000, 0.02); // quiet gap after
    expect(buf.speechSpan(0, 4000)).toEqual({ start: 1700, end: 2800 });
    expect(buf.speechSpan(0, 4000, 0.4, 0)).toEqual({ start: 2000, end: 2000 });
    expect(buf.speechSpan(1900, 2100, undefined, 500)).toEqual({ start: 1900, end: 2100 }); // padding stays inside the window
  });

  it("returns null when the learner was quiet the whole window", () => {
    const buf = new ClipBuffer();
    buf.push(new Float32Array(10), 1000, 0.01);
    expect(buf.speechSpan(0, 2000)).toBeNull();
  });
});
