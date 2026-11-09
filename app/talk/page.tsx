"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { DemoNotice } from "@/components/DemoNotice";
import { CorrectionSheet } from "@/components/CorrectionSheet";
import { CloseIcon, SpeakerIcon } from "@/components/icons";
import { MicButton, type MicState } from "@/components/MicButton";
import { SessionSummary } from "@/components/SessionSummary";
import { Transcript } from "@/components/Transcript";
import { useProfileGate } from "@/components/useProfileGate";
import { WordSheet } from "@/components/WordSheet";
import { upsertTurn } from "@/lib/live/transcript";
import { useLiveCoach, type LiveStatus } from "@/lib/live/useLiveCoach";
import { DEFAULT_PERSONA_ID, PERSONAS, personaById } from "@/lib/personas";
import { scenarioById } from "@/lib/scenarios";
import { speak, stopSpeaking } from "@/lib/speech";
import { findResumable, reopen } from "@/lib/resume";
import { newId, saveSession, type AppState } from "@/lib/store";
import type { Correction, Session, Takeaway, WordFlag } from "@/lib/types";

const MIC_STATE: Record<LiveStatus, MicState> = { idle: "idle", connecting: "requesting", listening: "recording", paused: "paused" };
const MIC_LABEL: Record<LiveStatus, string> = {
  idle: "Start talking with your coach",
  connecting: "Connecting to your coach",
  listening: "Pause the microphone",
  paused: "Keep talking",
};

function TalkScreen() {
  const params = useSearchParams();
  const app = useProfileGate();
  if (!app) return null;
  // Wait for the stored data, so the session to continue is known when the screen first renders.
  const resumeId = params.get("resume") ?? "";
  const earlier = resumeId ? findResumable(app.sessions, resumeId) : null;
  return <Talk key={earlier?.id ?? params.get("scenario") ?? ""} app={app} earlier={earlier} scenarioParam={params.get("scenario") ?? ""} />;
}

function Talk({ app, earlier, scenarioParam }: { app: AppState; earlier: Session | null; scenarioParam: string }) {
  const scenario = scenarioById(earlier?.scenarioId ?? scenarioParam) ?? scenarioById("free-daily")!;
  const accent = app?.profile?.accent ?? "us";
  const [personaId, setPersonaId] = useState(scenario.personaId || DEFAULT_PERSONA_ID);
  const persona = personaById(personaId) ?? personaById(DEFAULT_PERSONA_ID)!;

  const [session, setSession] = useState<Session>(() =>
    earlier
      ? reopen(earlier)
      : {
          id: newId(),
          mode: scenario.mode,
          scenarioId: scenario.id,
          startedAt: new Date().toISOString(),
          turns: [{ id: newId(), role: "coach", text: scenario.opener }],
          speakingSeconds: 0,
        },
  );
  const [clips, setClips] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ flag: WordFlag; clip?: string; text?: string } | null>(null);
  const [fix, setFix] = useState<{ said: string; correction: Correction } | null>(null);
  const [finished, setFinished] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const live = useLiveCoach({
    scenarioId: scenario.id,
    personaId: persona.id,
    accent,
    opener: scenario.opener,
    openerId: session.turns[0].id,
    turns: () => sessionRef.current.turns,
    resume: Boolean(earlier),
    newId,
    callbacks: {
      userText: (id, text) => setSession((s) => ({ ...s, turns: upsertTurn(s.turns, id, { role: "user", text }) })),
      coachText: (id, text) => setSession((s) => ({ ...s, turns: upsertTurn(s.turns, id, { role: "coach", text }) })),
      review: (id, r) =>
        setSession((s) => ({
          ...s,
          turns: upsertTurn(s.turns, id, {
            role: "user",
            clarity: r.clarity,
            flags: r.flags,
            ...(r.transcript ? { text: r.transcript } : {}),
            ...(r.correction ? { correction: r.correction } : {}),
          }),
        })),
      userDone: () => {},
      userClip: (id, url, seconds) => {
        setClips((c) => ({ ...c, [id]: url }));
        setSession((s) => ({ ...s, speakingSeconds: s.speakingSeconds + seconds }));
      },
    },
  });

  // Keep a copy saved as we go, so a refresh doesn't lose the conversation.
  useEffect(() => {
    // A reopened conversation stays saved as finished until the learner says something new.
    const earlierIds = new Set(earlier?.turns.map((t) => t.id));
    if (session.turns.some((t) => t.role === "user" && !earlierIds.has(t.id))) saveSession(session, { finished: Boolean(session.endedAt) });
  }, [session, earlier]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [session.turns]);

  useEffect(() => () => stopSpeaking(), []);

  const finish = async () => {
    live.stop();
    stopSpeaking();
    const userTurns = session.turns.filter((t) => t.role === "user" && t.text);
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

  const userTurnCount = session.turns.filter((t) => t.role === "user").length;
  if (finished && userTurnCount > 0) {
    return (
      <>
        <SessionSummary session={session} loading={summaryLoading} onPick={(flag) => setOpen({ flag })} againHref={`/talk?scenario=${scenario.id}`} accent={accent} />
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
    live.error?.message ??
    {
      idle: "Tap the mic to start talking with your coach",
      connecting: "Connecting to your coach…",
      listening: live.coachSpeaking
        ? "Your coach is talking. Jump in any time."
        : userTurnCount === 0
          ? "Listening. Just talk; your coach answers out loud."
          : "Listening. Tap a highlighted word to see how to say it.",
      paused: "Paused. Tap the mic to keep talking.",
    }[live.status];

  return (
    <div className="talk">
      <header className="talk-head">
        <div className="grow">
          <h1>{scenario.title}</h1>
          <p data-testid="persona-name">
            {persona.name}, {persona.role.toLowerCase()}
          </p>
        </div>
        <Link href="/" className="icon-btn" aria-label="Leave without saving">
          <CloseIcon />
        </Link>
      </header>

      {scenario.mode === "talk" && userTurnCount === 0 && live.status === "idle" && (
        <fieldset className="personas" data-testid="persona-picker">
          <legend>Who do you want to talk to?</legend>
          {PERSONAS.map((p) => (
            <label key={p.id} className="persona" data-on={p.id === persona.id}>
              <input type="radio" name="persona" value={p.id} checked={p.id === persona.id} onChange={() => setPersonaId(p.id)} />
              <strong>{p.name}</strong>
              <span>
                {p.role}. {p.personality}.
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="chat" ref={chatRef} aria-live="polite" data-testid="chat">
        <DemoNotice />
        {session.turns.map((t) =>
          t.role === "coach" ? (
            <div key={t.id} className="bubble coach">
              {t.text}
              <div>
                <button
                  type="button"
                  className="speak-again"
                  onClick={async () => {
                    if (!(await live.playNative(t.text))) speak(t.text, accent);
                  }}
                >
                  <SpeakerIcon size={14} /> Hear it
                </button>
              </div>
            </div>
          ) : (
            <div key={t.id} className="bubble user" data-testid="user-bubble">
              <Transcript text={t.text} flags={t.flags ?? []} onPick={(flag) => setOpen({ flag, clip: clips[t.id], text: t.text })} />
              <div className="bubble-meta">
                {t.correction && (
                  <button type="button" className="correction-chip" data-testid="correction-chip" onClick={() => setFix({ said: t.text, correction: t.correction! })}>
                    Better way to say it
                  </button>
                )}
                {typeof t.clarity === "number" && (
                  <span className="score-chip" data-low={t.clarity < 75} aria-label={`Clarity ${t.clarity} percent`}>
                    {t.clarity}%
                  </span>
                )}
              </div>
            </div>
          ),
        )}
        {live.coachSpeaking && session.turns.at(-1)?.role !== "coach" && (
          <div className="bubble coach" aria-label="Coach is talking">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      <div className="dock">
        <p className="dock-hint" data-error={Boolean(live.error)} role={live.error ? "alert" : undefined} data-testid="dock-hint">
          {hint}
        </p>
        <div className="dock-row">
          <span className="live-pill" data-on={live.status === "listening"} data-testid="live-status">
            {live.status === "listening" ? "Live" : live.status === "paused" ? "Paused" : ""}
          </span>
          <MicButton state={MIC_STATE[live.status]} level={live.level} label={MIC_LABEL[live.status]} onClick={live.toggle} />
          <button type="button" className="small-btn" onClick={finish} disabled={live.status === "connecting"}>
            Finish
          </button>
        </div>
      </div>

      {open && (
        <WordSheet
          flag={open.flag}
          accent={accent}
          clipUrl={open.clip}
          playClip={(url) => live.playClip(url, open.text ? { text: open.text, word: open.flag.word } : undefined)}
          playNative={live.playNative}
          onClose={() => setOpen(null)}
        />
      )}
      {fix && <CorrectionSheet said={fix.said} correction={fix.correction} accent={accent} playNative={live.playNative} onClose={() => setFix(null)} />}
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
