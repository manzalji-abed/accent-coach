"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { blobToWav } from "./audio";

export type RecorderState = "idle" | "requesting" | "recording" | "processing";
export type RecorderError = "denied" | "unsupported" | "too-short" | "failed";

export interface Recording {
  wav: Blob;
  /** Object URL of the original clip, for "play yours" */
  url: string;
  seconds: number;
}

const MAX_SECONDS = 45;

/**
 * Tap to start, tap to stop. Exposes a live 0..1 input level so the mic
 * button can pulse with the learner's voice.
 */
export function useRecorder(onDone: (rec: Recording) => void) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const media = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; timer: number } | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const cleanup = useCallback(() => {
    const m = media.current;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    clearInterval(m.timer);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close();
    media.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    const m = media.current;
    if (m && m.rec.state === "recording") m.rec.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("unsupported");
      return;
    }
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("denied");
      setState("idle");
      return;
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      if (media.current) media.current.raf = requestAnimationFrame(tick);
    };

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    const startedAt = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      cleanup();
      const seconds = (Date.now() - startedAt) / 1000;
      if (seconds < 0.6) {
        setError("too-short");
        setState("idle");
        return;
      }
      setState("processing");
      try {
        const blob = new Blob(chunks, { type: rec.mimeType });
        const { wav } = await blobToWav(blob);
        onDoneRef.current({ wav, url: URL.createObjectURL(blob), seconds });
      } catch {
        setError("failed");
      }
      setState("idle");
    };

    media.current = {
      rec,
      stream,
      ctx,
      raf: requestAnimationFrame(tick),
      timer: window.setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setElapsed(s);
        if (s >= MAX_SECONDS) stop();
      }, 200),
    };
    setElapsed(0);
    rec.start();
    setState("recording");
  }, [cleanup, stop]);

  const toggle = useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [state, start, stop]);

  return { state, error, level, elapsed, toggle, maxSeconds: MAX_SECONDS };
}

export const RECORDER_MESSAGES: Record<RecorderError, string> = {
  denied: "Microphone access is off. Allow it in your browser settings, then tap the mic again.",
  unsupported: "This browser can't record audio. Try the latest Chrome or Safari.",
  "too-short": "That was too quick. Tap once to start, speak, then tap again to stop.",
  failed: "The recording didn't work. Tap the mic and try again.",
};
