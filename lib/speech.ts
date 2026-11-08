"use client";
import type { Accent } from "./types";

/**
 * The "native" sample uses the device's built-in voices: free, instant, and
 * offline. Gemini TTS could replace this later for a more natural voice.
 */

/** Until when (performance.now ms) the built-in voice is expected to be talking. */
let builtInVoiceUntil = 0;
let speechSeq = 0;
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Rough speaking time for the device voice (about 13 characters a second at normal rate), capped at 8 s. */
export function estimateSpeechMs(text: string, rate = 0.95): number {
  return Math.min(8000, Math.max(700, (text.length / 13 / rate) * 1000) + 400);
}

/**
 * Whether the built-in voice is (probably) talking right now. Timed from when
 * it started, not from speechSynthesis.speaking: on iPhone that flag can stay
 * true forever after an audio interruption, which kept the live mic muted.
 */
export function builtInVoiceActive(): boolean {
  return clock() < builtInVoiceUntil;
}

export function speak(text: string, accent: Accent, opts: { rate?: number; onEnd?: () => void } = {}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const lang = accent === "uk" ? "en-GB" : "en-US";
  const rate = opts.rate ?? 0.95;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  const voice =
    voices.find((v) => v.lang === lang && /natural|premium|enhanced|google/i.test(v.name)) ??
    voices.find((v) => v.lang === lang);
  if (voice) utterance.voice = voice;
  // Cancelling the previous utterance fires its end event late; only the latest one may clear the timer.
  const id = ++speechSeq;
  const done = () => {
    if (id === speechSeq) builtInVoiceUntil = 0;
    opts.onEnd?.();
  };
  utterance.onend = done;
  utterance.onerror = done;
  window.speechSynthesis.cancel();
  builtInVoiceUntil = clock() + estimateSpeechMs(text, rate);
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  speechSeq++;
  builtInVoiceUntil = 0;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
