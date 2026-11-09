"use client";
import Link from "next/link";
import { AREA_LABEL, commsSummary } from "@/lib/comms";
import { phonemeLabel, sessionClarity } from "@/lib/progress";
import { speak } from "@/lib/speech";
import type { Accent, Session, WordFlag } from "@/lib/types";
import { SpeakerIcon } from "./icons";

export function SessionSummary(props: { session: Session; loading: boolean; onPick: (f: WordFlag) => void; againHref: string; accent: Accent }) {
  const { session, loading } = props;
  const score = sessionClarity(session);
  const flags = session.turns.flatMap((t) => t.flags ?? []);
  const unique = flags.filter((f, i) => flags.findIndex((g) => g.word.toLowerCase() === f.word.toLowerCase()) === i);
  const minutes = Math.max(1, Math.round(session.speakingSeconds / 60));
  const habits = commsSummary(session.turns);
  const corrections = session.turns.filter((t) => t.role === "user" && t.correction).slice(-5);

  return (
    <main className="page summary" data-testid="summary">
      <p className="lede" style={{ marginBottom: 4 }}>
        Session clarity
      </p>
      <div className="big-score" data-testid="session-score">
        {score ?? "–"}
        <small>%</small>
      </div>
      <div className="stat-row" style={{ marginTop: 12 }}>
        <span>
          <b>{session.turns.filter((t) => t.role === "user").length}</b>turns
        </span>
        <span>
          <b>{minutes}</b>min speaking
        </span>
        <span>
          <b>{unique.length}</b>words to fix
        </span>
      </div>

      <div className="takeaway" aria-live="polite" data-testid="takeaway">
        {loading || !session.takeaway ? (
          <span className="typing" aria-label="Writing your takeaway">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <>
            <strong>{session.takeaway.focus}</strong>
            <p>{session.takeaway.takeaway}</p>
          </>
        )}
        {habits && (
          <ul className="comms-habits" data-testid="comms-habits">
            {habits.strongest && (
              <li>
                <b>Strongest habit:</b> {AREA_LABEL[habits.strongest]}
              </li>
            )}
            {habits.change ? (
              <li>
                <b>Change this:</b> {AREA_LABEL[habits.change]}
              </li>
            ) : (
              <li>No communication habits to fix this time. Nicely done.</li>
            )}
          </ul>
        )}
      </div>

      {corrections.length > 0 && (
        <div style={{ textAlign: "left" }} data-testid="summary-corrections">
          <h2 className="section-title">Better ways to say it</h2>
          <ul className="corrections">
            {corrections.map((t) => (
              <li key={t.id} className="correction">
                <p className="correction-said">You said: {t.text}</p>
                <p>
                  <span className="correction-label">Better:</span> {t.correction!.better}
                </p>
                {t.correction!.why && <p className="correction-why">{t.correction!.why}</p>}
                <button type="button" className="speak-again" onClick={() => speak(t.correction!.better, props.accent)}>
                  <SpeakerIcon size={14} /> Hear it
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unique.length > 0 && (
        <div style={{ textAlign: "left" }}>
          <h2 className="section-title">Saved to your trouble words</h2>
          <ul className="words">
            {unique.map((f) => (
              <li key={f.word}>
                <button type="button" className="word-item" style={{ width: "100%", textAlign: "left" }} onClick={() => props.onPick(f)}>
                  <span className="grow">
                    <strong>{f.word}</strong>
                    <small>Say it like {f.expected}</small>
                  </span>
                  <span className="ipa">{phonemeLabel(f.phoneme)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <Link className="btn btn-ghost" href={props.againHref}>
          Practise again
        </Link>
        <Link className="btn" href="/">
          Done
        </Link>
      </div>
    </main>
  );
}
