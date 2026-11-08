import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/live-log/route";
import { cleanDetail, cleanEvents, MAX_BODY_BYTES } from "@/lib/live/diag";

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("https://x/api/live-log", { method: "POST", body, headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 250)}`, ...headers } }));

afterEach(() => vi.restoreAllMocks());

describe("/api/live-log diagnostics", () => {
  it("keeps known events and known keys only, with the right value types", () => {
    const events = cleanEvents({
      events: [
        { t: 12.7, type: "ws-close", detail: { code: 1011, reason: "internal", transcript: "I think I feel comfortable", code2: 5 } },
        { t: 20, type: "made-up", detail: { code: 1 } },
        { t: 30, type: "stats", detail: { sent: "10", msgs: 4, listening: true, ctx: 42 } },
      ],
    });
    expect(events).toEqual([
      { t: 13, type: "ws-close", detail: { code: 1011, reason: "internal" } },
      { t: 30, type: "stats", detail: { msgs: 4, listening: true } },
    ]);
  });

  it("caps string length and event count, and ignores non-object details", () => {
    expect(cleanDetail({ message: "x".repeat(500) })?.message).toHaveLength(120);
    expect(cleanDetail("text")).toBeUndefined();
    expect(cleanDetail(["a"])).toBeUndefined();
    expect(cleanDetail({ code: Number.NaN })).toBeUndefined();
    const many = cleanEvents({ events: Array.from({ length: 100 }, () => ({ type: "open" })) });
    expect(many).toHaveLength(40);
  });

  it("always answers 204 and logs only cleaned events", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post(JSON.stringify({ events: [{ t: 1, type: "open", detail: { resume: false, secret: "x" } }] }));
    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledWith("live-diag", JSON.stringify([{ t: 1, type: "open", detail: { resume: false } }]));
  });

  it("survives invalid JSON and refuses oversized bodies without logging", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await post("{not json")).status).toBe(204);
    expect((await post(JSON.stringify({ events: [{ type: "open" }], pad: "x".repeat(MAX_BODY_BYTES) }))).status).toBe(204);
    expect((await post("{}", { "content-length": String(MAX_BODY_BYTES + 1) })).status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });
});
