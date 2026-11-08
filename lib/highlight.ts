import type { WordFlag } from "./types";

export type Segment = { text: string; flag?: WordFlag };

const normalize = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Split a transcript into plain and flagged segments so the chat bubble can
 * underline the words the coach flagged. Each flag marks at most one
 * occurrence, matching left to right, ignoring case and punctuation.
 */
export function segmentTranscript(transcript: string, flags: WordFlag[]): Segment[] {
  const tokens = transcript.split(/(\s+)/);
  const pending = flags.map((f) => ({ flag: f, key: normalize(f.word) })).filter((f) => f.key);
  const segments: Segment[] = [];
  let buffer = "";

  for (const token of tokens) {
    const key = normalize(token);
    const idx = key ? pending.findIndex((p) => p.key === key) : -1;
    if (idx === -1) {
      buffer += token;
      continue;
    }
    // Keep leading/trailing punctuation outside the highlight.
    const match = token.match(/^([^\p{L}\p{N}']*)(.*?)([^\p{L}\p{N}']*)$/u)!;
    buffer += match[1];
    if (buffer) segments.push({ text: buffer });
    segments.push({ text: match[2], flag: pending[idx].flag });
    buffer = match[3];
    pending.splice(idx, 1);
  }
  if (buffer) segments.push({ text: buffer });
  return segments;
}
