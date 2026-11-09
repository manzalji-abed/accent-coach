"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav } from "../audio";
import { mockTurn } from "../ai/mock";
import { REVIEW_TOOL } from "../ai/prompts";
import { builtInVoiceActive, speak, stopSpeaking } from "../speech";
import type { Accent, Turn } from "../types";
import { base64ToBytes, ClipBuffer, estimateWordSpan, FrozenInput, LIVE_INPUT_MIME, LIVE_INPUT_RATE, LIVE_OUTPUT_RATE, micChunkToLive, pcm16BytesToFloat, SPEECH_THRESHOLD, speechLevel } from "./pcm";
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

/** While the coach's voice is playing, only clearly louder sound counts as the learner jumping in (not speaker echo). */
const BARGE_IN_LEVEL = 0.3;
/** Demo mode: how long the learner "talks" before their scripted turn appears. */
const MOCK_TURN_MS = 1200;
const MOCK_NEXT_TURN_MS = 3000;
/** Longest we wait for the mic's first audio before showing "Listening" anyway. */
const MIC_WARMUP_MAX_MS = 5000;
/** If the learner spoke and the coach sends nothing at all for this long, the session is stuck: restart it. */
const STUCK_AFTER_MS = 9000;
const MAX_RESTARTS_PER_MIN = 2;
const MIC_CONSTRAINTS: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
/** No mic audio for this long while the audio engine runs means the phone stopped the mic: reconnect it. */
const MIC_STALL_MS = 1500;
// Each play on iPhone can interrupt the audio engine and so need one rebuild; 6 a minute
// covers a learner replaying samples, while a mic that keeps failing still ends in the
// "reconnect" message instead of a loop.
const MAX_MIC_RESTARTS_PER_MIN = 6;
/** The same mic buffer repeating this many times in a row means Safari froze the mic input. */
const MIC_FROZEN_CHUNKS = 6;
/** iOS marked the mic track muted for this long: reconnect. */
const MIC_MUTED_MS = 1000;
/** The mic delivered exact zeros for this long while listening: reconnect. */
const MIC_SILENT_MS = 2000;

/** Fixed text (never learner input) sent when the coach ends a turn without answering. */
const NUDGE_TEXT = "(Answer the learner out loud now and keep the conversation going.)";
const NUDGE_WAIT_MS = 8000;
/** What the app answers to review_turn; the coach then carries on. */
const REVIEW_SAVED = "Saved. Now reply to the learner out loud, without mentioning this.";
/** How often diagnostics are sent to the server log. */
const DIAG_FLUSH_MS = 5000;

interface Driver {
  sendAudio(base64: string): void;
  setListening(on: boolean): void;
  close(): void;
}

interface TokenResponse {
  mock?: boolean;
  token?: string;
  model?: string;
  apiVersion?: string;
  error?: string;
}

/**
 * A live voice conversation with the coach: mic in, voice out, transcript and
 * pronunciation feedback as callbacks. Uses Gemini Live through a single-use
 * token from /api/live, or a scripted conversation in demo mode.
 */
export function useLiveCoach(opts: {
  scenarioId: string;
  personaId: string;
  accent: Accent;
  opener: string;
  openerId: string;
  /** Latest turns, so a restart can tell the coach what was already said. */
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
    source: null as MediaStreamAudioSourceNode | null,
    /** Last time the mic delivered audio; iOS can silently stop the mic after its own voice plays. */
    lastChunkAt: 0,
    /** When the mic started delivering digital silence (exact zeros), or iOS marked the track muted. */
    silentSince: 0,
    mutedSince: 0,
    /** The audio engine was interrupted; when it comes back the mic input must be rebuilt. */
    wasInterrupted: false,
    frozen: new FrozenInput(MIC_FROZEN_CHUNKS),
    micRestarting: false,
    micRestarts: [] as number[],
    nudgeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    node: null as AudioWorkletNode | null,
    driver: null as Driver | null,
    transcript: null as LiveTranscript | null,
    clips: new ClipBuffer(),
    listening: false,
    playhead: 0,
    sources: new Set<AudioBufferSourceNode>(),
    /** Wall-clock time (performance.now) the coach's queued voice ends. Doesn't depend on the audio engine running. */
    playEndsAt: 0,
    speakingTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** While the learner replays their own clip, the mic must not forward it to the coach. */
    clipPlayingUntil: 0,
    clipSource: null as AudioBufferSourceNode | null,
    /** End of the last learner turn or coach reply: a new learner clip starts after this. */
    lastClipEnd: 0,
    started: false, // the coach has opened the conversation in this page visit
    closing: false,
    gen: 0, // bumped on every start and teardown; see start()
    micReady: Promise.resolve() as Promise<void>,
    onFirstAudio: null as null | (() => void),
    lastAudioAt: 0,
    lastNudgeAt: 0,
    // stuck-session watchdog: speech heard since the coach last produced anything (voice, words or feedback)
    lastModelAt: 0,
    lastSpeechAt: 0,
    speechMsSinceModel: 0,
    restarts: [] as number[],
    restarting: false,
    // diagnostics (real sessions only)
    diag: null as null | ((type: string, detail?: Record<string, unknown>) => void),
    stats: { silent: 0, sent: 0, gated: 0, msgs: 0, audio: 0, inText: 0, outText: 0, tools: 0, turns: 0, interrupts: 0 },
  });

  const fail = useCallback((kind: LiveError, message = LIVE_MESSAGES[kind]) => {
    r.current.diag?.("fail", { kind });
    teardown();
    setError({ kind, message });
    setStatus("idle");
  }, []);

  // ---- audio out --------------------------------------------------------
  const coachAudible = () => performance.now() < r.current.playEndsAt;

  const markSpeakingUntil = (endsAt: number) => {
    const s = r.current;
    s.playEndsAt = endsAt;
    clearTimeout(s.speakingTimer);
    setCoachSpeaking(endsAt > performance.now());
    s.speakingTimer = setTimeout(() => setCoachSpeaking(false), Math.max(0, endsAt - performance.now()) + 50);
  };

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
    markSpeakingUntil(0);
  };

  const play = (base64: string) => {
    const s = r.current;
    const ctx = s.ctx;
    if (!ctx) return;
    const samples = pcm16BytesToFloat(base64ToBytes(base64));
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, LIVE_OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, s.playhead);
    src.start(at);
    s.playhead = at + buffer.duration;
    s.sources.add(src);
    src.onended = () => s.sources.delete(src);
    // Track the end on the wall clock: if the phone pauses the audio engine, the
    // echo guard still lifts on time instead of muting the learner forever.
    markSpeakingUntil(performance.now() + (s.playhead - ctx.currentTime) * 1000);
  };

  /**
   * Play the learner's own clip through the live audio engine (loud speaker, not the earpiece).
   * With a word, plays just that word's estimated stretch of the sentence.
   */
  const playClip = useCallback(async (url: string, focus?: { text: string; word: string }): Promise<boolean> => {
    try {
      return await playBytes(await (await fetch(url)).arrayBuffer(), focus);
    } catch {
      return false;
    }
  }, []);

  /**
   * Plays audio bytes (WAV) through the live audio engine, keeping the mic muted
   * meanwhile so the coach doesn't hear it. Outside a session it uses a plain
   * <audio> element (no mic is open then, so the speaker is used anyway).
   */
  const playBytes = async (bytes: ArrayBuffer, focus?: { text: string; word: string }): Promise<boolean> => {
    const s = r.current;
    const ctx = s.ctx;
    if (!ctx || ctx.state === "closed") {
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const audio = new Audio(url);
      audio.onended = audio.onerror = () => URL.revokeObjectURL(url);
      await audio.play();
      return true;
    }
    const buffer = await ctx.decodeAudioData(bytes.slice(0)); // decodeAudioData takes ownership; keep the cached copy intact
    try {
      s.clipSource?.stop();
    } catch {
      /* already stopped */
    }
    const span = focus ? estimateWordSpan(buffer.getChannelData(0), buffer.sampleRate, focus.text, focus.word) : null;
    const offset = span?.start ?? 0;
    const duration = span ? span.end - span.start : buffer.duration;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0, offset, duration);
    s.clipSource = src;
    s.clipPlayingUntil = performance.now() + duration * 1000 + 200;
    return true;
  };

  /**
   * A native-speaker sample in Gemini's voice (/api/tts), cached per text.
   * Returns false in demo mode or on failure, so callers can fall back to the device voice.
   */
  const nativeCache = useRef(new Map<string, ArrayBuffer>());
  const playNative = useCallback(async (text: string): Promise<boolean> => {
    try {
      let bytes = nativeCache.current.get(text);
      if (!bytes) {
        const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) return false;
        bytes = await res.arrayBuffer();
        nativeCache.current.set(text, bytes);
      }
      return await playBytes(bytes);
    } catch {
      return false;
    }
  }, []);

  // ---- transcript wiring ----------------------------------------------------
  const makeTranscript = (firstCoachId?: string) =>
    new LiveTranscript(
      {
        userText: (id, text) => optsRef.current.callbacks.userText(id, text),
        coachText: (id, text) => optsRef.current.callbacks.coachText(id, text),
        review: (id, review) => {
          r.current.diag?.("review", { flags: review.flags.length, correction: Boolean(review.correction), clarity: review.clarity });
          optsRef.current.callbacks.review(id, review);
        },
        userDone: (id, startedAt, endedAt) => {
          const s = r.current;
          optsRef.current.callbacks.userDone(id, startedAt, endedAt);
          // Cut the clip from where the learner actually spoke since the last turn ended.
          const from = Math.max(s.lastClipEnd, endedAt - 30_000);
          const span = s.clips.speechSpan(from, endedAt);
          const samples = span ? s.clips.slice(span.start, span.end) : s.clips.slice(Math.max(from, endedAt - 4000), endedAt);
          s.lastClipEnd = endedAt;
          if (samples.length) {
            const url = URL.createObjectURL(new Blob([encodeWav(samples, LIVE_INPUT_RATE)], { type: "audio/wav" }));
            optsRef.current.callbacks.userClip(id, url, samples.length / LIVE_INPUT_RATE);
          }
        },
      },
      optsRef.current.newId,
      firstCoachId,
    );

  // ---- diagnostics ------------------------------------------------------------
  /**
   * Real sessions report connection events and counters (never what was said)
   * to /api/live-log, so problems on the phone show up in the server logs.
   */
  const startDiagnostics = (meta: Record<string, unknown>) => {
    const s = r.current;
    const queue: { t: number; type: string; detail?: Record<string, unknown> }[] = [];
    const t0 = performance.now();
    const flush = (beacon = false) => {
      if (!queue.length) return;
      const body = JSON.stringify({ events: queue.splice(0, 40) });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/live-log", new Blob([body], { type: "application/json" }));
      else void fetch("/api/live-log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    s.diag = (type, detail) => {
      queue.push({ t: Math.round(performance.now() - t0), type, detail });
      if (queue.length >= 40) flush();
    };
    s.diag("start", { ...meta, ua: navigator.userAgent.slice(0, 120) });
    const timer = setInterval(() => {
      s.diag?.("stats", { ...s.stats, ctx: s.ctx?.state, listening: s.listening, coachAudible: coachAudible() });
      flush();
    }, DIAG_FLUSH_MS);
    return () => {
      clearInterval(timer);
      s.diag?.("end", { ...s.stats });
      flush(true);
      s.diag = null;
    };
  };

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
      t.reviewed({ transcript: line.transcript, clarity: line.clarity, flags: line.flags, better: line.correction?.better ?? "", why: line.correction?.why ?? "" });
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
  const liveDriver = async (token: TokenResponse): Promise<Driver> => {
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: token.token!, httpOptions: { apiVersion: token.apiVersion } });
    let handle: string | undefined;
    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    const s = r.current;

    const onMessage = (msg: import("@google/genai").LiveServerMessage) => {
      const t = s.transcript;
      if (!t) return;
      const now = performance.now();
      s.stats.msgs++;
      const modelSpoke = Boolean(msg.toolCall || msg.serverContent?.modelTurn || msg.serverContent?.outputTranscription || msg.serverContent?.turnComplete);
      if (modelSpoke) {
        s.lastModelAt = now;
        s.speechMsSinceModel = 0;
      }
      if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) handle = msg.sessionResumptionUpdate.newHandle;
      if (msg.goAway) {
        s.diag?.("goaway", { timeLeft: msg.goAway.timeLeft });
        void reconnect();
      }
      const calls = msg.toolCall?.functionCalls ?? [];
      if (calls.length) {
        s.stats.tools += calls.length;
        for (const call of calls) if (call.name === REVIEW_TOOL) t.reviewed(call.args);
        // review_turn is blocking: the coach waits for this answer, then carries on talking.
        session?.sendToolResponse({ functionResponses: calls.map((c) => ({ id: c.id, name: c.name, response: { result: REVIEW_SAVED } })) });
      }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.inputTranscription?.text) {
        s.stats.inText++;
        t.heardUser(sc.inputTranscription.text, now);
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          s.stats.audio++;
          s.lastAudioAt = now;
          t.coachAudio(now);
          play(part.inlineData.data);
        }
      }
      if (sc.outputTranscription?.text) {
        s.stats.outText++;
        s.lastAudioAt = now;
        t.heardCoach(sc.outputTranscription.text, now);
      }
      if (sc.interrupted) {
        s.stats.interrupts++;
        stopPlayback();
        t.coachDone();
      }
      if (sc.turnComplete) {
        s.stats.turns++;
        const silent = t.modelTurnComplete(now);
        // The learner's next clip starts once the coach has finished talking.
        s.lastClipEnd = Math.max(s.lastClipEnd, now, s.playEndsAt);
        if (silent) nudge();
      }
    };

    /**
     * The coach ended its turn without answering the learner (seen live: a
     * review, then silence, then a dead session). Ask it to reply; if it still
     * says nothing, swap in a fresh session with the conversation so far.
     */
    const nudge = () => {
      const now = performance.now();
      if (!session || now - s.lastNudgeAt < NUDGE_WAIT_MS) return;
      s.lastNudgeAt = now;
      s.diag?.("silent-turn");
      session.sendClientContent({ turns: [{ role: "user", parts: [{ text: NUDGE_TEXT }] }], turnComplete: true });
      const gen = s.gen;
      clearTimeout(s.nudgeTimer);
      s.nudgeTimer = setTimeout(() => {
        if (s.closing || s.gen !== gen || s.lastAudioAt > now) return; // the coach answered (voice or words)
        void restart("still silent after nudge");
      }, NUDGE_WAIT_MS);
    };

    const open = async (resume?: string) => {
      const next = await ai.live.connect({
        model: token.model!,
        config: { responseModalities: [Modality.AUDIO], ...(resume ? { sessionResumption: { handle: resume } } : {}) },
        callbacks: {
          onopen: () => s.diag?.("open", { resume: Boolean(resume) }),
          onmessage: onMessage,
          onerror: (e: ErrorEvent) => {
            s.diag?.("ws-error", { message: String(e?.message ?? "").slice(0, 200) });
            if (!s.closing && session === next) fail("dropped");
          },
          onclose: (e: CloseEvent) => {
            s.diag?.("ws-close", { code: e?.code, reason: String(e?.reason ?? "").slice(0, 200), current: session === next });
            if (!s.closing && session === next) fail("dropped");
          },
        },
      });
      // Finish or leaving may have happened while we were connecting.
      if (s.closing) {
        next.close();
        throw new Error("closed while connecting");
      }
      session = next;
      return next;
    };

    // The ~10-minute connection limit: hop to a fresh connection on the same session.
    const reconnect = async () => {
      const old = session;
      if (!handle || !old) return;
      try {
        session = null;
        old.close();
        await open(handle);
        s.diag?.("resumed");
      } catch (e) {
        s.diag?.("resume-failed", { message: String((e as Error)?.message ?? "").slice(0, 200) });
        if (!s.closing) fail("dropped");
      }
    };

    const first = await open();
    const history = LiveTranscript.historyText(optsRef.current.turns());
    const kickoff = s.started
      ? `(We were cut off. Here is the conversation so far:\n${history}\nPick up naturally from there. Don't repeat your greeting.)`
      : "(The learner just joined. Say your opening line now.)";
    first.sendClientContent({ turns: [{ role: "user", parts: [{ text: kickoff }] }], turnComplete: true });

    return {
      sendAudio: (data) => {
        s.stats.sent++;
        session?.sendRealtimeInput({ audio: { data, mimeType: LIVE_INPUT_MIME } });
      },
      setListening: () => {},
      close: () => {
        const sess = session;
        session = null;
        sess?.close();
      },
    };
  };

  const fetchToken = async (): Promise<TokenResponse & { ok: boolean }> => {
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: optsRef.current.scenarioId, personaId: optsRef.current.personaId, accent: optsRef.current.accent }),
    });
    const data = (await res.json().catch(() => ({}))) as TokenResponse;
    return { ...data, ok: res.ok };
  };

  /**
   * A session that hears the learner but never answers is stuck (seen on phones).
   * Swap in a fresh session with the conversation so far, keeping the mic and screen as they are.
   */
  const restart = async (reason: string) => {
    const s = r.current;
    const now = performance.now();
    s.restarts = s.restarts.filter((t) => now - t < 60_000);
    if (s.restarting || s.restarts.length >= MAX_RESTARTS_PER_MIN) return fail("dropped");
    s.restarts.push(now);
    s.restarting = true;
    clearTimeout(s.nudgeTimer);
    s.diag?.("restart", { reason });
    const gen = s.gen;
    s.driver?.close();
    s.driver = null;
    stopPlayback();
    try {
      const data = await fetchToken();
      if (s.gen !== gen) return;
      if (!data.ok || data.mock) return fail("dropped");
      s.transcript = makeTranscript();
      const driver = await liveDriver(data);
      if (s.gen !== gen) return driver.close();
      s.driver = driver;
      s.lastModelAt = performance.now();
      s.speechMsSinceModel = 0;
    } catch {
      if (s.gen === gen) fail("dropped");
    } finally {
      s.restarting = false;
    }
  };

  // ---- lifecycle --------------------------------------------------------------
  const stopDiagRef = useRef<null | (() => void)>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  function teardown() {
    const s = r.current;
    s.gen++; // any start() still in flight is now stale and must not open a session
    s.closing = true;
    s.listening = false;
    clearInterval(watchdogRef.current);
    clearTimeout(s.nudgeTimer);
    s.micRestarts = [];
    s.driver?.close();
    s.driver = null;
    stopPlayback();
    try {
      s.clipSource?.stop();
    } catch {
      /* already stopped */
    }
    s.clipSource = null;
    s.source?.disconnect();
    s.source = null;
    s.node?.port.close();
    s.node?.disconnect();
    s.node = null;
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
    void s.ctx?.close().catch(() => {});
    s.ctx = null;
    s.clips.clear();
    s.lastClipEnd = 0;
    stopDiagRef.current?.();
    stopDiagRef.current = null;
    setLevel(0);
  }

  /** Connect a mic stream to the worklet, and watch for the phone muting or ending it. */
  const attachMic = (ctx: AudioContext, node: AudioWorkletNode, stream: MediaStream) => {
    const s = r.current;
    s.stream = stream;
    s.source = ctx.createMediaStreamSource(stream);
    s.source.connect(node);
    s.lastChunkAt = performance.now();
    s.silentSince = 0;
    s.mutedSince = 0;
    s.frozen.reset();
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => void restartMic("ended");
      track.onmute = () => {
        s.diag?.("mic-mute");
        s.mutedSince = performance.now();
      };
      track.onunmute = () => {
        s.diag?.("mic-unmute");
        s.mutedSince = 0;
      };
    }
  };

  /** Swap in a fresh mic stream (permission is already granted, so no prompt). */
  const restartMic = async (reason: string) => {
    const s = r.current;
    const ctx = s.ctx;
    const node = s.node;
    if (s.micRestarting || s.closing || !ctx || !node) return;
    // If the phone keeps the mic blocked (a call, another app), stop retrying and say so.
    const t0 = performance.now();
    s.micRestarts = s.micRestarts.filter((t) => t0 - t < 60_000);
    if (s.micRestarts.length >= MAX_MIC_RESTARTS_PER_MIN) return fail("dropped");
    s.micRestarts.push(t0);
    s.micRestarting = true;
    s.diag?.("mic-restart", { reason });
    const gen = s.gen;
    try {
      s.source?.disconnect();
      s.stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (s.gen !== gen || s.closing) return stream.getTracks().forEach((t) => t.stop());
      attachMic(ctx, node, stream);
    } catch (e) {
      s.diag?.("mic-restart-failed", { message: String((e as Error)?.message ?? "").slice(0, 120) });
      if (s.gen === gen) fail("dropped");
    } finally {
      s.micRestarting = false;
    }
  };

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
    // Phones pause the audio engine on route changes or interruptions; resume it.
    ctx.onstatechange = () => {
      s.diag?.("ctx-state", { state: ctx.state });
      if (ctx.state !== "running" && ctx.state !== "closed" && !s.closing) {
        s.wasInterrupted = true;
        void ctx.resume().catch(() => {});
      } else if (ctx.state === "running" && s.wasInterrupted && !s.closing) {
        // Seen live on iPhone: after an interruption the mic keeps "delivering" a loud,
        // frozen buffer that isn't speech, so the coach hears noise forever. Rebuild it.
        s.wasInterrupted = false;
        if (s.node) void restartMic("after interruption");
      }
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      if (stale()) return;
      return fail((e as Error).name === "NotAllowedError" || (e as Error).name === "SecurityError" ? "denied" : "unsupported");
    }
    if (stale()) return stream.getTracks().forEach((t) => t.stop());
    try {
      await ctx.audioWorklet.addModule("/live-mic-worklet.js");
      if (stale()) return stream.getTracks().forEach((t) => t.stop());
      const node = new AudioWorkletNode(ctx, "live-mic");
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the worklet running without playing the mic back
      node.connect(sink).connect(ctx.destination);
      s.node = node;
      attachMic(ctx, node, stream);
      s.micReady = new Promise<void>((resolve) => (s.onFirstAudio = resolve));
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        s.onFirstAudio?.();
        s.onFirstAudio = null;
        const lvl = speechLevel(e.data);
        setLevel(s.listening ? lvl : 0);
        const now = performance.now();
        s.lastChunkAt = now;
        // Frozen input: the very same buffer over and over (a real mic never repeats exactly).
        if (s.frozen.push(e.data, lvl) && !s.micRestarting) void restartMic("frozen input");
        // A real microphone always has some noise. Exact zeros mean iOS muted it behind our back.
        if (lvl === 0) {
          s.stats.silent++;
          s.silentSince ||= now;
        } else s.silentSince = 0;
        const { base64, pcm16k } = micChunkToLive(e.data, ctx.sampleRate);
        // Buffered from the moment the mic opens (kept only on this device), so the
        // start of a turn is there for "Play yours" even if connecting was slow.
        s.clips.push(pcm16k, now, lvl);
        if (!s.listening || !s.driver) return;
        // Keep the stream continuous, but send silence for speaker echo (quiet sound while the
        // coach talks) and for the learner's own clip being replayed.
        const echo = (coachAudible() && lvl < BARGE_IN_LEVEL) || now < s.clipPlayingUntil || builtInVoiceActive();
        if (echo) s.stats.gated++;
        else if (lvl >= SPEECH_THRESHOLD) {
          s.lastSpeechAt = now;
          s.speechMsSinceModel += (e.data.length / ctx.sampleRate) * 1000;
        }
        s.driver.sendAudio(echo ? micChunkToLive(new Float32Array(e.data.length), ctx.sampleRate).base64 : base64);
      };
    } catch {
      if (stale()) return;
      return fail("unsupported");
    }

    let data: TokenResponse & { ok: boolean };
    try {
      data = await fetchToken();
      if (stale()) return;
      if (!data.ok) return fail("network", data.error || LIVE_MESSAGES.network);
    } catch {
      if (stale()) return;
      return fail("network");
    }

    if (!data.mock) stopDiagRef.current = startDiagnostics({ model: data.model, apiVersion: data.apiVersion, resumed: s.started });
    // Gemini speaks the opener first, so its words fill the opener bubble. Demo mode reads the opener
    // out locally, so its first scripted reply needs a bubble of its own.
    s.transcript = makeTranscript(s.started || data.mock ? undefined : optsRef.current.openerId);
    let driver: Driver;
    try {
      driver = data.mock ? mockDriver() : await liveDriver(data);
    } catch (e) {
      s.diag?.("connect-failed", { message: String((e as Error)?.message ?? "").slice(0, 200) });
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
    s.lastModelAt = performance.now();
    s.speechMsSinceModel = 0;
    s.driver.setListening(true);
    setStatus("listening");

    if (!data.mock) {
      // Watchdog: the learner clearly spoke (over a second of speech), went quiet, and the coach
      // produced nothing at all (no voice, words or feedback) for a while: the session is stuck.
      watchdogRef.current = setInterval(() => {
        const now = performance.now();
        // iOS can stop the mic (track muted or no frames) after its own voice plays, while the audio engine keeps running.
        if (s.ctx?.state === "running" && !s.micRestarting && now - s.lastChunkAt > MIC_STALL_MS && !builtInVoiceActive()) {
          void restartMic("stalled");
        } else if (!s.micRestarting && !builtInVoiceActive() && now > s.clipPlayingUntil) {
          // The mic still delivers frames but iOS has muted it: reconnect it.
          if (s.mutedSince && now - s.mutedSince > MIC_MUTED_MS) void restartMic("muted");
          else if (s.listening && s.silentSince && now - s.silentSince > MIC_SILENT_MS) void restartMic("digital silence");
        }
        if (!s.listening || s.restarting || coachAudible()) return;
        if (s.speechMsSinceModel > 1000 && s.lastSpeechAt > s.lastModelAt && now - s.lastSpeechAt > STUCK_AFTER_MS) {
          s.diag?.("stuck", { sinceSpeech: Math.round(now - s.lastSpeechAt), sinceModel: Math.round(now - s.lastModelAt), speechMs: Math.round(s.speechMsSinceModel) });
          s.speechMsSinceModel = 0;
          void restart("no reply after speech");
        }
      }, 1000);
    }
  };

  const toggle = () => {
    const s = r.current;
    if (status === "connecting") return;
    if (status === "idle") return void start();
    s.listening = status === "paused";
    s.driver?.setListening(s.listening);
    s.diag?.(s.listening ? "resume-mic" : "pause-mic");
    setStatus(s.listening ? "listening" : "paused");
  };

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
  }, []);

  useEffect(() => () => teardown(), []);

  return { status, error, level, coachSpeaking, toggle, stop, playClip, playNative };
}
