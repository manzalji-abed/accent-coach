/**
 * Audio plumbing for live voice, with no browser APIs so it's easy to unit test.
 *
 * The mic gives Float32 samples at the device rate. Gemini Live wants 16-bit
 * little-endian PCM at 16 kHz in, and sends 16-bit PCM at 24 kHz out, both
 * base64-encoded inside JSON messages.
 */
import { TARGET_SAMPLE_RATE, toMono16k } from "../audio";

export const LIVE_INPUT_RATE = TARGET_SAMPLE_RATE; // 16 kHz
export const LIVE_OUTPUT_RATE = 24_000;
export const LIVE_INPUT_MIME = `audio/pcm;rate=${LIVE_INPUT_RATE}`;

/** Float32 in [-1, 1] to 16-bit little-endian PCM bytes. */
export function floatToPcm16Bytes(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** 16-bit little-endian PCM bytes to Float32 in [-1, 1]. A trailing odd byte is ignored. */
export function pcm16BytesToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // keep String.fromCharCode's argument list small
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** One mic chunk (any rate) to the base64 PCM Gemini Live expects. Returns the 16 kHz samples too, for the clip buffer. */
export function micChunkToLive(samples: Float32Array, sampleRate: number): { base64: string; pcm16k: Float32Array } {
  const pcm16k = toMono16k([samples], sampleRate);
  return { base64: bytesToBase64(floatToPcm16Bytes(pcm16k)), pcm16k };
}

/** Level above which a mic chunk counts as speech (see speechLevel's scale). */
export const SPEECH_THRESHOLD = 0.12;

/** Root-mean-square level, scaled so normal speech lands roughly between 0.3 and 1. Drives the mic halo. */
export function speechLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 6);
}

/**
 * Keeps the last few seconds of 16 kHz mic audio with timestamps, so the
 * learner's own turn can be cut out afterwards for "Play yours".
 */
export class ClipBuffer {
  private chunks: { at: number; samples: Float32Array; level: number }[] = [];
  constructor(private readonly keepMs = 60_000) {}

  push(samples: Float32Array, at: number, level = speechLevel(samples)) {
    this.chunks.push({ at, samples, level });
    const cutoff = at - this.keepMs;
    while (this.chunks.length && this.chunks[0].at < cutoff) this.chunks.shift();
  }

  /**
   * Where the learner actually spoke within a window: from the first loud chunk
   * to the last, with a little padding. Null if they were quiet the whole time.
   * Used to cut "Play yours" from real speech instead of guessing from
   * transcription timing, which tends to arrive late.
   */
  speechSpan(fromMs: number, toMs: number, threshold = SPEECH_THRESHOLD, padMs = 300): { start: number; end: number } | null {
    const loud = this.chunks.filter((c) => c.at >= fromMs && c.at <= toMs && c.level >= threshold);
    if (!loud.length) return null;
    return { start: Math.max(fromMs, loud[0].at - padMs), end: Math.min(toMs, loud[loud.length - 1].at + padMs) };
  }

  /** Audio captured between two timestamps (ms), joined into one array. */
  slice(fromMs: number, toMs: number): Float32Array {
    const parts = this.chunks.filter((c) => c.at >= fromMs && c.at <= toMs).map((c) => c.samples);
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  clear() {
    this.chunks = [];
  }
}
