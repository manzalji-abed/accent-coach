"use client";
import { useEffect, useRef } from "react";
import { phonemeLabel } from "@/lib/progress";
import { speak } from "@/lib/speech";
import type { Accent, WordFlag } from "@/lib/types";
import { SpeakerIcon } from "./icons";

/** The "Said vs. Expected" card, as a bottom sheet so it's reachable one-handed. */
export function WordSheet(props: { flag: WordFlag; accent: Accent; clipUrl?: string; onClose: () => void }) {
  const { flag, accent, clipUrl, onClose } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      audioRef.current?.pause();
    };
  }, [onClose]);

  const playMine = () => {
    if (!clipUrl) return;
    audioRef.current?.pause();
    audioRef.current = new Audio(clipUrl);
    void audioRef.current.play();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-word" data-testid="word-sheet">
        <div className="sheet-grip" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="sheet-word">{flag.word}</h2>
          <button ref={closeRef} type="button" className="small-btn" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="compare">
          <div className="said">
            <small>You said</small>
            <b>{flag.said}</b>
          </div>
          <div className="expected">
            <small>Say it like</small>
            <b>{flag.expected}</b>
            {flag.expectedIpa && <span className="ipa">{flag.expectedIpa}</span>}
          </div>
        </div>

        <div className="tip">
          {flag.phoneme && <span className="ipa">{phonemeLabel(flag.phoneme)}</span>}
          <p>{flag.tip}</p>
        </div>

        <div className="listen-row">
          <button type="button" className="btn btn-ghost" onClick={playMine} disabled={!clipUrl}>
            <SpeakerIcon size={20} /> Play yours
          </button>
          <button type="button" className="btn" onClick={() => speak(flag.word, accent, { rate: 0.8 })}>
            <SpeakerIcon size={20} /> Play native
          </button>
        </div>
        {!clipUrl && <p className="lede" style={{ marginTop: 10, fontSize: "0.85rem" }}>Your recording is only kept until you leave this session.</p>}
      </div>
    </>
  );
}
