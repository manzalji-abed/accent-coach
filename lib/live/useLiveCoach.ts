"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "../audio";
import { mockTurn } from "../ai/mock";
import { REVIEW_TOOL } from "../ai/prompts";
import { speak, stopSpeaking } from "../speech";
import type { Accent, Turn } from "../types";
import { base64ToBytes, ClipBuffer, LIVE_INPUT_MIME, LIVE_INPUT_RATE, LIVE_OUTPUT_RATE, micChunkToLive, pcm16BytesToFloat, speechLevel } from "./pcm";
import { LiveTranscript, type TranscriptEvents } from "./transcript";

export type LiveStatus = "idle" | "connecting" | "listening" | "paused";
export type LiveError = "denied" | "unsupported" | "network" | "dropped";

export const LIVE_MESSAGES: Record<LiveError, string> = {
  denied: "Microphone access is off. Allow it in your browser settings, then tap the mic.",
  unsupported: "This browser can't do live voice. Try the latest Chrome or Safari.",
  network: "Couldn't reach the coach. Check your connection and try again.",
  dropped: "Lost the connection to your coach. Tap the mic to pick up where you left off.",
};

export interface LiveCallbacks extends TranscriptEvents {
  /** The learner's own audio for a finished turn, for "Play yours". */
  userClip(id: string, url: string, seconds: number): void;
}

/** While the coach is talking, only clearly louder sound counts as the learner jumping in (not speaker echo). */
const BARGE_IN_LEVEL = 0.45;
/** Demo mode: how long the learner "talks" before their scripted turn appears. */
const MOCK_TURN_MS = 1200;
const MOCK_NEXT_TURN_MS = 3000;
/** Longest we wait for the mic's first audio before showing "Listening" anyway. */
const MIC_WARMUP_MAX_MS = 5000;

interface Driver {
  sendAudio(base64: string): void;
  setListening(on: boolean): void;
  close(): void;
}

/**
 * A live voice conversation with the coach: mic in, voice out, transcript and
 * pronunciation feedback as callbacks. Uses Gemini Live through a single-use
 * token from /api/live, or a scripted conversation in demo mode.
 */
export function useLiveCoach(opts: {
  scenarioId: string;
  accent: Accent;
  opener: string;
  openerId: string;
  /** Latest turns, so a reconnect can tell the coach what was already said. */
  turns: () => Turn[];
  newId: () => string;
  callbacks: LiveCallbacks;
}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<{ kind: LiveError; message: string } | null>(null);
  const [level, setLevel] = useState(0);
  const [coachSpeaking, setCoachSpeaking] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const r = useRef({
    ctx: null as AudioContext | null,
    stream: null as MediaStream | null,
    node: null as AudioWorkletNode | null,
    driver: null as Driver | null,
    transcript: null as LiveTranscript | null,
    clips: new ClipBuffer(),
    listening: false,
    playhead: 0,
    sources: new Set<AudioBufferSourceNode>(),
    started: false, // the coach has opened the conversation in this page visit
    closing: false,
    gen: 0, // bumped on every start and teardown; see start()
    micReady: Promise.resolve() as Promise<void>,
    onFirstAudio: null as null | (() => void),
  });

  const fail = useCallback((kind: LiveError, message = LIVE_MESSAGES[kind]) => {
    teardown();
    setError({ kind, message });
    setStatus("idle");
  }, []);

  // ---- audio out --------------------------------------------------------
  const stopPlayback = () => {
    const s = r.current;
    s.sources.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
    s.sources.clear();
    s.playhead = 0;
    setCoachSpeaking(false);
  };

  const play = (base64: string) => {
    const s = r.current;
    if (!s.ctx) return;
    const samples = pcm16BytesToFloat(base64ToBytes(base64));
    if (!samples.length) return;
    const buffer = s.ctx.createBuffer(1, samples.length, LIVE_OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const src = s.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(s.ctx.destination);
    const at = Math.max(s.ctx.currentTime + 0.02, s.playhead);
    src.start(at);
    s.playhead = at + buffer.duration;
    s.sources.add(src);
    setCoachSpeaking(true);
    src.onended = () => {
      s.sources.delete(src);
      if (!s.sources.size) setCoachSpeaking(false);
    };
  };

  // ---- transcript wiring ----------------------------------------------------
  const makeTranscript = (firstCoachId?: string) =>
    new LiveTranscript(
      {
        userText: (id, text) => optsRef.current.callbacks.userText(id, text),
        coachText: (id, text) => optsRef.current.callbacks.coachText(id, text),
        review: (id, review) => optsRef.current.callbacks.review(id, review),
        userDone: (id, startedAt, endedAt) => {
          optsRef.current.callbacks.userDone(id, startedAt, endedAt);
          const samples = r.current.clips.slice(startedAt, endedAt);
          if (samples.length) {
            const url = URL.createObjectURL(new Blob([encodeWav(samples, LIVE_INPUT_RATE)], { type: "audio/wav" }));
            optsRef.current.callbacks.userClip(id, url, samples.length / LIVE_INPUT_RATE);
          }
        },
      },
      optsRef.current.newId,
      firstCoachId,
    );

  // ---- drivers --------------------------------------------------------------
  /** Scripted conversation for demo mode and UI tests: one learner turn per stretch of listening. */
  const mockDriver = (): Driver => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let userTurns = 0;
    const turn = () => {
      const t = r.current.transcript;
      if (!t || !r.current.listening) return;
      const line = mockTurn(Array.from({ length: userTurns }, () => ({ id: "", role: "user" as const, text: "" })));
      userTurns++;
      const now = performance.now();
      t.heardUser(line.transcript, now);
      t.reviewed({ transcript: line.transcript, clarity: line.clarity, flags: line.flags });
      t.heardCoach(line.reply, now);
      t.coachDone();
      speak(line.reply, optsRef.current.accent);
      timer = setTimeout(turn, MOCK_NEXT_TURN_MS);
    };
    if (!r.current.started) speak(optsRef.current.opener, optsRef.current.accent);
    let armed = false;
    return {
      // Like the real coach, it only "hears" a turn once mic audio is actually arriving.
      sendAudio: () => {
        if (armed && timer === undefined) timer = setTimeout(turn, MOCK_TURN_MS);
      },
      setListening(on) {
        clearTimeout(timer);
        timer = undefined;
        armed = on;
      },
      close() {
        clearTimeout(timer);
        stopSpeaking();
      },
    };
  };

  /** Real Gemini Live session, opened straight from the browser with the single-use token. */
  const liveDriver = async (token: { token: string; model: string; apiVersion: string }): Promise<Driver> => {
    const { GoogleGenAI, Modality, FunctionResponseScheduling } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: token.apiVersion } });
    let handle: string | undefined;
    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    const onMessage = (msg: import("@google/genai").LiveServerMessage) => {
      const t = r.current.transcript;
      if (!t) return;
      const now = performance.now();
      if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) handle = msg.sessionResumptionUpdate.newHandle;
      if (msg.goAway) void reconnect();
      const calls = msg.toolCall?.functionCalls ?? [];
      if (calls.length) {
        for (const call of calls) if (call.name === REVIEW_TOOL) t.reviewed(call.args);
        session?.sendToolResponse({
          functionResponses: calls.map((c) => ({ id: c.id, name: c.name, response: { ok: true }, scheduling: FunctionResponseScheduling.SILENT })),
        });
      }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.inputTranscription?.text) t.heardUser(sc.inputTranscription.text, now);
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          t.coachAudio(now);
          play(part.inlineData.data);
        }
      }
      if (sc.outputTranscription?.text) t.heardCoach(sc.outputTranscription.text, now);
      if (sc.interrupted) {
        stopPlayback();
        t.coachDone();
      }
      if (sc.turnComplete) t.coachDone();
    };

    const open = async (resume?: string) => {
      const s = await ai.live.connect({
        model: token.model,
        config: { responseModalities: [Modality.AUDIO], ...(resume ? { sessionResumption: { handle: resume } } : {}) },
        callbacks: {
          onmessage: onMessage,
          onerror: () => {
            if (!r.current.closing) fail("dropped");
          },
          onclose: () => {
            if (!r.current.closing && session === s) fail("dropped");
          },
        },
      });
      session = s;
      return s;
    };

    // The ~10-minute connection limit: hop to a fresh connection on the same session.
    const reconnect = async () => {
      const old = session;
      if (!handle || !old) return;
      try {
        session = null;
        old.close();
        await open(handle);
      } catch {
        fail("dropped");
      }
    };

    const first = await open();
    const history = LiveTranscript.historyText(optsRef.current.turns());
    const kickoff = r.current.started
      ? `(We were cut off. Here is the conversation so far:\n${history}\nPick up naturally from there. Don't repeat your greeting.)`
      : "(The learner just joined. Say your opening line now.)";
    first.sendClientContent({ turns: [{ role: "user", parts: [{ text: kickoff }] }], turnComplete: true });

    return {
      sendAudio: (data) => session?.sendRealtimeInput({ audio: { data, mimeType: LIVE_INPUT_MIME } }),
      setListening: () => {},
      close: () => {
        const s = session;
        session = null;
        s?.close();
      },
    };
  };

  // ---- lifecycle --------------------------------------------------------------
  function teardown() {
    const s = r.current;
    s.gen++; // any start() still in flight is now stale and must not open a session
    s.closing = true;
    s.listening = false;
    s.driver?.close();
    s.driver = null;
    stopPlayback();
    s.node?.port.close();
    s.node?.disconnect();
    s.node = null;
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
    void s.ctx?.close().catch(() => {});
    s.ctx = null;
    s.clips.clear();
    setLevel(0);
  }

  const start = async () => {
    setError(null);
    setStatus("connecting");
    const s = r.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") return fail("unsupported");
    // Each start gets a generation number. If Finish, leaving the page or an error tears things
    // down while we're still awaiting, the number moves on and this attempt quietly stops,
    // closing anything it opened late, so no session is ever left running unowned.
    const gen = ++s.gen;
    const stale = () => s.gen !== gen;
    s.closing = false;
    // Create the audio context inside the tap itself: iOS keeps it silent if it's made after an await.
    const ctx = new AudioContext();
    s.ctx = ctx;
    void ctx.resume().catch(() => {});
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      if (stale()) return;
      return fail((e as Error).name === "NotAllowedError" || (e as Error).name === "SecurityError" ? "denied" : "unsupported");
    }
    if (stale()) return stream.getTracks().forEach((t) => t.stop());
    s.stream = stream;
    try {
      await ctx.audioWorklet.addModule("/live-mic-worklet.js");
      if (stale()) return;
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "live-mic");
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the worklet running without playing the mic back
      source.connect(node).connect(sink).connect(ctx.destination);
      s.node = node;
      s.micReady = new Promise<void>((resolve) => (s.onFirstAudio = resolve));
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        s.onFirstAudio?.();
        s.onFirstAudio = null;
        const lvl = speechLevel(e.data);
        setLevel(s.listening ? lvl : 0);
        const { base64, pcm16k } = micChunkToLive(e.data, ctx.sampleRate);
        // Buffered from the moment the mic opens (kept only on this device), so the
        // start of a turn is there for "Play yours" even if connecting was slow.
        s.clips.push(pcm16k, performance.now());
        if (!s.listening || !s.driver) return;
        // Keep the stream continuous, but send silence for quiet sound while the coach talks (speaker echo).
        const echo = s.sources.size > 0 && lvl < BARGE_IN_LEVEL;
        s.driver.sendAudio(echo ? micChunkToLive(new Float32Array(e.data.length), ctx.sampleRate).base64 : base64);
      };
    } catch {
      if (stale()) return;
      return fail("unsupported");
    }

    let data: { mock?: boolean; token?: string; model?: string; apiVersion?: string; error?: string };
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: optsRef.current.scenarioId, accent: optsRef.current.accent }),
      });
      data = await res.json().catch(() => ({}));
      if (stale()) return;
      if (!res.ok) return fail("network", data.error || LIVE_MESSAGES.network);
    } catch {
      if (stale()) return;
      return fail("network");
    }

    // Gemini speaks the opener first, so its words fill the opener bubble. Demo mode reads the opener
    // out locally, so its first scripted reply needs a bubble of its own.
    s.transcript = makeTranscript(s.started || data.mock ? undefined : optsRef.current.openerId);
    let driver: Driver;
    try {
      driver = data.mock ? mockDriver() : await liveDriver({ token: data.token!, model: data.model!, apiVersion: data.apiVersion! });
    } catch {
      if (stale()) return;
      return fail("network");
    }
    if (stale()) return driver.close(); // stopped while connecting: don't leave a session running
    s.driver = driver;
    // Only say "Listening" once the mic is really delivering audio (some phones take a moment to warm up).
    await Promise.race([s.micReady, new Promise((resolve) => setTimeout(resolve, MIC_WARMUP_MAX_MS))]);
    if (stale()) return;
    s.started = true;
    s.listening = true;
    s.driver.setListening(true);
    setStatus("listening");
  };

  const toggle = () => {
    const s = r.current;
    if (status === "connecting") return;
    if (status === "idle") return void start();
    s.listening = status === "paused";
    s.driver?.setListening(s.listening);
    setStatus(s.listening ? "listening" : "paused");
  };

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
  }, []);

  useEffect(() => () => teardown(), []);

  return { status, error, level, coachSpeaking, toggle, stop };
}
