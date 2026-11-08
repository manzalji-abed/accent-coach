"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DemoNotice } from "@/components/DemoNotice";
import { CloseIcon, SpeakerIcon } from "@/components/icons";
import { MicButton, formatSeconds } from "@/components/MicButton";
import { SessionSummary } from "@/components/SessionSummary";
import { Transcript } from "@/components/Transcript";
import { useProfileGate } from "@/components/useProfileGate";
import { WordSheet } from "@/components/WordSheet";
import { scenarioById } from "@/lib/scenarios";
import { speak, stopSpeaking } from "@/lib/speech";
import { newId, saveSession } from "@/lib/store";
import type { Session, Takeaway, Turn, TurnAnalysis, WordFlag } from "@/lib/types";
import { RECORDER_MESSAGES, useRecorder, type Recording } from "@/lib/useRecorder";

function TalkScreen() {
  const params = useSearchParams();
  const app = useProfileGate();
  const scenario = scenarioById(params.get("scenario") ?? "") ?? scenarioById("free-daily")!;
  const accent = app?.profile?.accent ?? "us";

  const [session, setSession] = useState<Session>(() => ({
    id: newId(),
    mode: scenario.mode,
    scenarioId: scenario.id,
    startedAt: new Date().toISOString(),
    turns: [{ id: newId(), role: "coach", text: scenario.opener }],
    speakingSeconds: 0,
  }));
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Recording | null>(null);
  const [clips, setClips] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ flag: WordFlag; clip?: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Keep a copy saved as we go, so a refresh doesn't lose the conversation.
  useEffect(() => {
    if (session.turns.some((t) => t.role === "user")) saveSession(session, { finished: Boolean(session.endedAt) });
  }, [session]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [session.turns.length, thinking]);

  useEffect(() => () => stopSpeaking(), []);

  const send = useCallback(
    async (rec: Recording) => {
      setError(null);
      setFailed(null);
      setThinking(true);
      const form = new FormData();
      form.append("audio", rec.wav, "turn.wav");
      form.append("scenarioId", scenario.id);
      form.append("accent", accent);
      form.append("history", JSON.stringify(session.turns.map(({ role, text }) => ({ role, text }))));
      try {
        const res = await fetch("/api/turn", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as Partial<TurnAnalysis> & { error?: string };
        if (!res.ok) throw new Error(data.error || "Couldn't reach the coach. Try again.");
        if (!data.transcript) {
          setError(data.reply || "I didn't catch that. Try again a little closer to the mic.");
          return;
        }
        const userTurn: Turn = { id: newId(), role: "user", text: data.transcript, clarity: data.clarity, flags: data.flags ?? [] };
        const coachTurn: Turn = { id: newId(), role: "coach", text: data.reply! };
        setClips((c) => ({ ...c, [userTurn.id]: rec.url }));
        setSession((s) => ({ ...s, turns: [...s.turns, userTurn, coachTurn], speakingSeconds: s.speakingSeconds + rec.seconds }));
        speak(coachTurn.text, accent);
      } catch (e) {
        setError((e as Error).message);
        setFailed(rec);
      } finally {
        setThinking(false);
      }
    },
    [accent, scenario.id, session.turns],
  );

  const recorder = useRecorder(send);

  const finish = async () => {
    stopSpeaking();
    const userTurns = session.turns.filter((t) => t.role === "user");
    const ended: Session = { ...session, endedAt: new Date().toISOString() };
    setSession(ended);
    setFinished(true);
    if (!userTurns.length) return;
    setSummaryLoading(true);
    let takeaway: Takeaway;
    try {
      const res = await fetch("/api/takeaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, turns: userTurns.map(({ text, clarity, flags }) => ({ text, clarity, flags })) }),
      });
      takeaway = res.ok ? await res.json() : { takeaway: "Nice work today. Come back tomorrow to keep the streak going.", focus: "Keep going" };
    } catch {
      takeaway = { takeaway: "Nice work today. Come back tomorrow to keep the streak going.", focus: "Keep going" };
    }
    setSession((s) => ({ ...s, takeaway: { takeaway: takeaway.takeaway, focus: takeaway.focus } }));
    setSummaryLoading(false);
  };

  if (!app) return null;

  const userTurnCount = session.turns.filter((t) => t.role === "user").length;
  if (finished && userTurnCount > 0) {
    return (
      <>
        <SessionSummary session={session} loading={summaryLoading} onPick={(flag) => setOpen({ flag })} againHref={`/talk?scenario=${scenario.id}`} />
        {open && <WordSheet flag={open.flag} accent={accent} onClose={() => setOpen(null)} />}
      </>
    );
  }
  if (finished) {
    return (
      <main className="page">
        <h1 className="page-title">No worries.</h1>
        <p className="lede">You didn&apos;t say anything this time, so nothing was saved.</p>
        <Link className="btn" href="/">
          Back to today
        </Link>
      </main>
    );
  }

  const hint =
    error ??
    (recorder.error
      ? RECORDER_MESSAGES[recorder.error]
      : recorder.state === "recording"
        ? `Listening ${formatSeconds(recorder.elapsed)}. Tap to send.`
        : thinking
          ? "Your coach is listening back…"
          : userTurnCount === 0
            ? "Tap the mic and answer out loud"
            : "Tap a highlighted word to see how to say it");

  return (
    <div className="talk">
      <header className="talk-head">
        <div className="grow">
          <h1>{scenario.title}</h1>
          <p>{scenario.persona ? scenario.persona.split(",")[0] : scenario.brief}</p>
        </div>
        <Link href="/" className="icon-btn" aria-label="Leave without saving">
          <CloseIcon />
        </Link>
      </header>

      <div className="chat" ref={chatRef} aria-live="polite" data-testid="chat">
        <DemoNotice />
        {session.turns.map((t) =>
          t.role === "coach" ? (
            <div key={t.id} className="bubble coach">
              {t.text}
              <div>
                <button type="button" className="speak-again" onClick={() => speak(t.text, accent)}>
                  <SpeakerIcon size={14} /> Hear it
                </button>
              </div>
            </div>
          ) : (
            <div key={t.id} className="bubble user" data-testid="user-bubble">
              <Transcript text={t.text} flags={t.flags ?? []} onPick={(flag) => setOpen({ flag, clip: clips[t.id] })} />
              <div className="bubble-meta">
                {typeof t.clarity === "number" && (
                  <span className="score-chip" data-low={t.clarity < 75} aria-label={`Clarity ${t.clarity} percent`}>
                    {t.clarity}%
                  </span>
                )}
              </div>
            </div>
          ),
        )}
        {thinking && (
          <div className="bubble coach" aria-label="Coach is thinking">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      <div className="dock">
        <p className="dock-hint" data-error={Boolean(error || recorder.error)} role={error ? "alert" : undefined} data-testid="dock-hint">
          {hint}
        </p>
        <div className="dock-row">
          {failed ? (
            <button type="button" className="small-btn" onClick={() => send(failed)}>
              Send again
            </button>
          ) : (
            <span />
          )}
          <MicButton state={thinking ? "processing" : recorder.state} level={recorder.level} onClick={recorder.toggle} />
          <button type="button" className="small-btn" onClick={finish} disabled={thinking || recorder.state === "recording"}>
            Finish
          </button>
        </div>
      </div>

      {open && <WordSheet flag={open.flag} accent={accent} clipUrl={open.clip} onClose={() => setOpen(null)} />}
    </div>
  );
}

export default function TalkPage() {
  return (
    <Suspense>
      <TalkScreen />
    </Suspense>
  );
}
