"use client";
import { useEffect, useRef } from "react";
import { speak } from "@/lib/speech";
import type { Accent, Comms, Correction } from "@/lib/types";
import { SpeakerIcon } from "./icons";

/** "Better way to say it": the learner's sentence next to a more natural version, as a bottom sheet. */
export function CorrectionSheet(props: {
  said: string;
  /** Absent when only the communication tip applies. */
  correction?: Correction;
  /** Audience-aware communication tip, shown only when there is something to improve. */
  comms?: Comms;
  /** e.g. "For a CEO" */
  audienceLabel?: string;
  accent: Accent;
  /** A native sample in Gemini's voice; false means fall back to the device voice. */
  playNative?: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { said, correction, comms, audienceLabel, accent, playNative, onClose } = props;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-fix" data-testid="correction-sheet">
        <div className="sheet-grip" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="sheet-fix">Better way to say it</h2>
          <button ref={closeRef} type="button" className="small-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="compare compare-stack">
          <div className="said">
            <small>You said</small>
            <p>{said}</p>
          </div>
          {correction && (
            <div className="expected">
              <small>Try</small>
              <p>{correction.better}</p>
            </div>
          )}
        </div>

        {correction?.why && (
          <div className="tip">
            <p>{correction.why}</p>
          </div>
        )}

        {comms && (
          <div className="tip comms-tip" data-testid="comms-tip">
            <small>{audienceLabel ?? "For your listener"}</small>
            <p>{comms.tip}</p>
          </div>
        )}

        {correction && (
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            onClick={async () => {
              if (playNative && (await playNative(correction.better))) return;
              speak(correction.better, accent, { rate: 0.9 });
            }}
          >
            <SpeakerIcon size={20} /> Hear it
          </button>
        )}
      </div>
    </>
  );
}
