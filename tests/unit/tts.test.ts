import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tts/route";
import { ensureWav, MAX_TTS_CHARS } from "@/lib/ai/tts";

const ip = () => `203.0.113.${Math.floor(Math.random() * 250)}`;
const tts = (body: unknown) =>
  POST(new Request("https://x/api/tts", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "cf-connecting-ip": ip() } }));

describe("/api/tts native samples", () => {
  it("rejects empty, non-text and over-long input", async () => {
    expect((await tts({ text: "   " })).status).toBe(400);
    expect((await tts({ text: 42 })).status).toBe(400);
    expect((await tts({ text: "x".repeat(MAX_TTS_CHARS + 1) })).status).toBe(413);
  });

  it("tells the browser to use the device voice in demo mode", async () => {
    const res = await tts({ text: "comfortable" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mock: true });
  });

  it("is rate limited per client", async () => {
    const headers = { "content-type": "application/json", "cf-connecting-ip": "198.51.100.77" };
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await POST(new Request("https://x/api/tts", { method: "POST", body: JSON.stringify({ text: "hi" }), headers }))).status;
    expect(last).toBe(429);
  });
});


describe("ensureWav", () => {
  it("wraps raw 16-bit PCM in a WAV header at the stated rate", () => {
    const wav = ensureWav(new Uint8Array(480), "audio/L16;rate=16000");
    const ascii = (a: number, b: number) => String.fromCharCode(...wav.subarray(a, b));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000);
    expect(wav.length).toBe(44 + 480);
  });

  it("leaves real WAV untouched and defaults raw PCM to 24 kHz", () => {
    const wav = ensureWav(new Uint8Array(100));
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(24000);
    expect(ensureWav(wav)).toBe(wav);
  });
});
