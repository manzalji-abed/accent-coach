"use client";
import type { Accent } from "./types";

/**
 * The "native" sample uses the device's built-in voices: free, instant, and
 * offline. Gemini TTS could replace this later for a more natural voice.
 */
export function speak(text: string, accent: Accent, opts: { rate?: number; onEnd?: () => void } = {}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const lang = accent === "uk" ? "en-GB" : "en-US";
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = opts.rate ?? 0.95;
  const voices = window.speechSynthesis.getVoices();
  const voice =
    voices.find((v) => v.lang === lang && /natural|premium|enhanced|google/i.test(v.name)) ??
    voices.find((v) => v.lang === lang);
  if (voice) utterance.voice = voice;
  if (opts.onEnd) {
    utterance.onend = opts.onEnd;
    utterance.onerror = opts.onEnd;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
