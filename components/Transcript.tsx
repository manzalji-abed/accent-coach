"use client";
import { segmentTranscript } from "@/lib/highlight";
import type { WordFlag } from "@/lib/types";

/** Renders a learner's line with flagged words as tappable, wavy-underlined buttons. */
export function Transcript(props: { text: string; flags: WordFlag[]; onPick: (flag: WordFlag) => void }) {
  return (
    <>
      {segmentTranscript(props.text, props.flags).map((seg, i) =>
        seg.flag ? (
          <button
            key={i}
            type="button"
            className="slip"
            onClick={() => props.onPick(seg.flag!)}
            aria-label={`${seg.text}: see how to say it`}
          >
            {seg.text}
          </button>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
