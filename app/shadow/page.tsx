"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DemoNotice } from "@/components/DemoNotice";
import { CloseIcon, SpeakerIcon } from "@/components/icons";
import { MicButton, formatSeconds } from "@/components/MicButton";
import { Transcript } from "@/components/Transcript";
import { useProfileGate } from "@/components/useProfileGate";
import { WordSheet } from "@/components/WordSheet";
import { SHADOW_SENTENCES } from "@/lib/scenarios";
import { speak, stopSpeaking } from "@/lib/speech";
import { newId, saveSession } from "@/lib/store";
import type { Session, ShadowResult, WordFlag } from "@/lib/types";
import { RECORDER_MESSAGES, useRecorder, type Recording } from "@/lib/useRecorder";

type Status = "done" | "now" | "todo";

export default function ShadowPage() {
  const app = useProfileGate();
  const goal = app?.profile?.goal ?? "daily";
  const accent = app?.profile?.accent ?? "us";
  const sentences = SHADOW_SENTENCES[goal];

  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [clip, setClip] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<WordFlag | null>(null);
  const [firstTry, setFirstTry] = useState(0);
  const [complete, setComplete] = useState(false);
  const session = useRef<Session>({
    id: newId(),
    mode: "shadow",
    scenarioId: `shadow-${goal}`,
    startedAt: new Date().toISOString(),
    turns: [],
    speakingSeconds: 0,
  });

  const sentence = sentences[index];
  useEffect(() => () => stopSpeaking(), []);

  const check = useCallback(
    async (rec: Recording) => {
      setChecking(true);
      setError(null);
      const form = new FormData();
      form.append("audio", rec.wav, "shadow.wav");
      form.append("sentence", sentence);
      form.append("accent", accent);
      form.append("attempt", String(attempt));
      try {
        const res = await fetch("/api/shadow", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as ShadowResult & { error?: string };
        if (!res.ok) throw new Error(data.error || "Couldn't check that. Try again.");
        setResult(data);
        setClip(rec.url);
        setAttempt((a) => a + 1);
        if (data.pass && attempt === 0) setFirstTry((n) => n + 1);
        const s = session.current;
        s.turns.push({ id: newId(), role: "user", text: data.transcript || sentence, clarity: data.clarity, flags: data.flags });
        s.speakingSeconds += rec.seconds;
        saveSession({ ...s });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setChecking(false);
      }
    },
    [accent, attempt, sentence],
  );

  const recorder = useRecorder(check);

  const next = () => {
    stopSpeaking();
    setResult(null);
    setAttempt(0);
    setClip(undefined);
    if (index + 1 >= sentences.length) {
      session.current.endedAt = new Date().toISOString();
      if (session.current.turns.length) saveSession({ ...session.current }, { finished: true });
      setComplete(true);
    } else {
      setIndex(index + 1);
    }
  };

  if (!app) return null;

  if (complete) {
    return (
      <main className="page summary" data-testid="shadow-complete">
        <p className="lede" style={{ marginBottom: 4 }}>
          Passed on the first try
        </p>
        <div className="big-score">
          {firstTry}
          <small>/{sentences.length}</small>
        </div>
        <p className="lede" style={{ marginTop: 16 }}>
          {firstTry === sentences.length ? "Every sentence, first time. Excellent." : "Words you missed are saved in Progress for review."}
        </p>
        <div className="actions">
          {/* Plain link: a full reload starts a fresh round */}
          <a className="btn btn-ghost" href="/shadow">
            Go again
          </a>
          <Link className="btn" href="/">
            Done
          </Link>
        </div>
      </main>
    );
  }

  const dots: Status[] = sentences.map((_, i) => (i < index ? "done" : i === index ? "now" : "todo"));

  return (
    <div className="talk">
      <header className="talk-head">
        <div className="grow">
          <h1>Shadowing</h1>
          <p>
            Sentence {index + 1} of {sentences.length}
          </p>
        </div>
        <Link href="/" className="icon-btn" aria-label="Leave">
          <CloseIcon />
        </Link>
      </header>

      <div className="chat">
        <DemoNotice />
        <div className="progress-dots" aria-hidden>
          {dots.map((d, i) => (
            <i key={i} data-state={d} />
          ))}
        </div>
        <section className="shadow-card">
          <p className="lede" style={{ margin: 0 }}>
            Listen, then say it the same way
          </p>
          <p className="shadow-sentence" data-testid="shadow-sentence">
            {sentence}
          </p>
          <div className="listen-row">
            <button type="button" className="btn btn-quiet" onClick={() => speak(sentence, accent)}>
              <SpeakerIcon size={20} /> Hear it
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => speak(sentence, accent, { rate: 0.7 })}>
              Slowly
            </button>
          </div>
        </section>

        {result && (
          <section className="shadow-card" aria-live="polite" data-testid="shadow-result">
            <p className="verdict" data-pass={result.pass}>
              {result.pass ? "Clear. Nice." : "Try again"}
            </p>
            <p style={{ margin: "0 0 12px" }}>{result.feedback}</p>
            {result.flags.length > 0 && (
              <p style={{ margin: "0 0 16px" }}>
                <Transcript text={result.transcript || sentence} flags={result.flags} onPick={setOpen} />
              </p>
            )}
            <button type="button" className="btn btn-block" onClick={next}>
              {result.pass ? (index + 1 >= sentences.length ? "Finish" : "Next sentence") : "Skip this one"}
            </button>
          </section>
        )}
      </div>

      <div className="dock">
        <p className="dock-hint" data-error={Boolean(error || recorder.error)} data-testid="dock-hint">
          {error ??
            (recorder.error
              ? RECORDER_MESSAGES[recorder.error]
              : recorder.state === "recording"
                ? `Listening ${formatSeconds(recorder.elapsed)}. Tap to check.`
                : checking
                  ? "Checking…"
                  : result && !result.pass
                    ? "Tap the mic to try again"
                    : "Tap the mic and repeat the sentence")}
        </p>
        <div className="dock-row">
          <span />
          <MicButton
            state={checking ? "processing" : recorder.state}
            level={recorder.level}
            onClick={recorder.toggle}
            disabled={Boolean(result?.pass)}
          />
          <span />
        </div>
      </div>

      {open && <WordSheet flag={open} accent={accent} clipUrl={clip} onClose={() => setOpen(null)} />}
    </div>
  );
}
