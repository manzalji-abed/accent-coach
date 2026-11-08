import { describe, expect, it } from "vitest";
import { GET as diag } from "@/app/api/diag/gemini/route";
import { POST } from "@/app/api/tts/route";
import { MAX_TTS_CHARS } from "@/lib/ai/tts";

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

describe("/api/diag/gemini (temporary)", () => {
  it("does nothing in demo mode and is limited to 2 calls a minute", async () => {
    const req = () => new Request("https://x/api/diag/gemini", { headers: { "cf-connecting-ip": "198.51.100.88" } });
    expect(await (await diag(req())).json()).toMatchObject({ mock: true });
    await diag(req());
    expect((await diag(req())).status).toBe(429);
  });
});
