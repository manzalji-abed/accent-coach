import "server-only";
import { looksLikeWav } from "../audio";

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60 s of 16 kHz mono WAV

/**
 * Tiny in-memory rate limit per client IP. Good enough for a single instance;
 * swap for a shared store (e.g. Upstash) if you deploy multiple instances.
 */
const hits = new Map<string, number[]>();
export function rateLimited(req: Request, limit = 30, windowMs = 60_000): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > limit;
}

export type AudioResult = { ok: true; audio: Uint8Array } | { ok: false; status: number; error: string };

export async function readAudio(form: FormData): Promise<AudioResult> {
  const file = form.get("audio");
  if (!(file instanceof Blob)) return { ok: false, status: 400, error: "No recording was attached." };
  if (file.size > MAX_AUDIO_BYTES) return { ok: false, status: 413, error: "That recording is too long. Keep it under a minute." };
  const audio = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeWav(audio)) return { ok: false, status: 415, error: "The recording format wasn't recognised." };
  return { ok: true, audio };
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
