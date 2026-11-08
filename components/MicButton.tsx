"use client";
import type { RecorderState } from "@/lib/useRecorder";
import { MicIcon, StopIcon } from "./icons";

const LABEL: Record<RecorderState, string> = {
  idle: "Start speaking",
  requesting: "Waiting for microphone",
  recording: "Stop and send",
  processing: "Sending",
};

export function MicButton(props: { state: RecorderState; level: number; disabled?: boolean; onClick: () => void }) {
  const busy = props.state === "processing" || props.state === "requesting";
  return (
    <button
      type="button"
      className="mic"
      data-state={props.state}
      style={{ "--level": props.level } as React.CSSProperties}
      onClick={props.onClick}
      disabled={props.disabled || busy}
      aria-label={LABEL[props.state]}
      aria-pressed={props.state === "recording"}
      data-testid="mic"
    >
      {busy ? <span className="spinner" /> : props.state === "recording" ? <StopIcon /> : <MicIcon />}
    </button>
  );
}

export function formatSeconds(s: number) {
  const whole = Math.floor(s);
  return `0:${String(whole).padStart(2, "0")}`;
}
