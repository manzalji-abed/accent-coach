/**
 * Browsers record in different formats (Chrome: webm/opus, Safari: mp4/aac).
 * Gemini reliably accepts WAV, so we decode whatever the browser gave us and
 * re-encode it as 16 kHz mono 16-bit PCM WAV. 30 seconds is about 1 MB.
 */
export const TARGET_SAMPLE_RATE = 16_000;

/** Average channels and linearly resample to the target rate. */
export function toMono16k(channels: Float32Array[], sampleRate: number): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
  if (sampleRate === TARGET_SAMPLE_RATE) return mono;

  const ratio = sampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, length - 1);
    const frac = pos - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Browser only: turn a recorded Blob into a WAV Blob. */
export async function blobToWav(blob: Blob): Promise<{ wav: Blob; seconds: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const samples = toMono16k(channels, decoded.sampleRate);
    return { wav: new Blob([encodeWav(samples)], { type: "audio/wav" }), seconds: decoded.duration };
  } finally {
    void ctx.close();
  }
}

/** Server side: a cheap sanity check that an upload really is a WAV file. */
export function looksLikeWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  return tag(0) === "RIFF" && tag(8) === "WAVE";
}
