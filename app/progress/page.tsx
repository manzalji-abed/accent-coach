"use client";
import Link from "next/link";
import { useState } from "react";
import { ContinueList } from "@/components/ContinueList";
import { TabBar } from "@/components/TabBar";
import { useProfileGate } from "@/components/useProfileGate";
import { WordSheet } from "@/components/WordSheet";
import { currentStreak, phonemeHeatmap, phonemeLabel, practisedSessions, sessionClarity, totalSpeakingMinutes } from "@/lib/progress";
import { scenarioById } from "@/lib/scenarios";
import { removeTroubleWord } from "@/lib/store";
import type { Session, TroubleWord } from "@/lib/types";

const WEEKS = 6;

function ClarityChart({ sessions }: { sessions: Session[] }) {
  const points = sessions
    .map((s) => sessionClarity(s))
    .filter((v): v is number => v !== null)
    .reverse()
    .slice(-14);
  if (points.length < 2) return <p className="empty">Finish two sessions to see your clarity trend.</p>;
  const w = 320;
  const h = 130;
  const left = 26; // room for the axis labels
  const pad = 10;
  // Zoom to the range the learner actually moves in, so progress is visible.
  const lo = Math.max(0, Math.min(60, Math.floor((Math.min(...points) - 5) / 10) * 10));
  const grid = [lo, Math.round((lo + 100) / 2), 100];
  const x = (i: number) => left + (i * (w - left - pad)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - lo) / (100 - lo)) * (h - pad * 2);
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Clarity over your last ${points.length} sessions, latest ${points.at(-1)}%`}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={left} x2={w - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={left - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
              {g}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--voice)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={i === points.length - 1 ? 5 : 3} fill="var(--voice)" />
        ))}
      </svg>
    </div>
  );
}

export default function ProgressPage() {
  const app = useProfileGate();
  const [open, setOpen] = useState<TroubleWord | null>(null);
  if (!app) return null;

  const done = practisedSessions(app.sessions);
  const recent = done.slice(0, 7).map(sessionClarity).filter((v): v is number => v !== null);
  const avg = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
  const heat = phonemeHeatmap(done, WEEKS).slice(0, 6);
  const maxHeat = Math.max(1, ...heat.flatMap((r) => r.weekly));

  return (
    <>
      <main className="page">
        <h1 className="page-title">Progress</h1>
        <p className="lede">How your speaking is changing over time.</p>

        <div className="kpis">
          <div className="kpi">
            <b>{currentStreak(app.sessions)}</b>
            <small>day streak</small>
          </div>
          <div className="kpi">
            <b>{avg ?? "–"}</b>
            <small>avg clarity, last 7</small>
          </div>
          <div className="kpi">
            <b>{totalSpeakingMinutes(done)}</b>
            <small>minutes spoken</small>
          </div>
        </div>

        <h2 className="section-title">Clarity</h2>
        <ClarityChart sessions={done} />

        <h2 className="section-title">Sounds to work on</h2>
        {heat.length ? (
          <div className="chart-wrap">
            <div className="heat" style={{ "--weeks": WEEKS } as React.CSSProperties} data-testid="heatmap">
              {heat.map((row) => (
                <div className="heat-row" key={row.phoneme}>
                  <span className="ipa">{phonemeLabel(row.phoneme)}</span>
                  {row.weekly.map((v, i) => (
                    <span
                      key={i}
                      className="heat-cell"
                      style={{ "--v": v / maxHeat } as React.CSSProperties}
                      title={`${v} slips, ${WEEKS - 1 - i === 0 ? "this week" : `${WEEKS - 1 - i} weeks ago`}`}
                    />
                  ))}
                </div>
              ))}
              <div className="heat-row">
                <span />
                {Array.from({ length: WEEKS }, (_, i) => (
                  <span key={i} className="heat-axis">
                    {i === WEEKS - 1 ? "now" : `-${WEEKS - 1 - i}w`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="empty">Sounds you slip on will show up here, week by week.</p>
        )}

        <h2 className="section-title">Trouble words</h2>
        {app.trouble.length ? (
          <ul className="words" data-testid="trouble-words">
            {app.trouble.map((w) => (
              <li key={w.word} className="word-item">
                <button type="button" className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0 }} onClick={() => setOpen(w)}>
                  <strong>{w.word}</strong>
                  <small>Say it like {w.expected}</small>
                </button>
                <span className="misses">{w.misses}×</span>
                <button type="button" className="small-btn" onClick={() => removeTroubleWord(w.word)} aria-label={`Mark ${w.word} as learned`}>
                  Got it
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">
            No trouble words yet. <Link href="/">Start a session</Link> and any word that slips lands here.
          </p>
        )}

        <ContinueList sessions={app.sessions} limit={5} />

        <h2 className="section-title">History</h2>
        {done.length ? (
          <ul className="history">
            {done.slice(0, 30).map((s) => {
              const title = s.mode === "shadow" ? "Shadowing" : (scenarioById(s.scenarioId)?.title ?? "Session");
              const score = sessionClarity(s);
              return (
                <li key={s.id}>
                  <details>
                    <summary>
                      <span>
                        {title}
                        <small>{new Date(s.startedAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                      </span>
                      <span className="score-chip" data-low={score !== null && score < 75}>
                        {score ?? "–"}%
                      </span>
                    </summary>
                    {s.takeaway && <p style={{ margin: "10px 0 0" }}>{s.takeaway.takeaway}</p>}
                    <ol>
                      {s.turns
                        .filter((t) => t.role === "user")
                        .map((t) => (
                          <li key={t.id}>{t.text}</li>
                        ))}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty">Your past conversations will be listed here.</p>
        )}
      </main>
      <TabBar />
      {open && (
        <WordSheet
          flag={{ word: open.word, said: `missed ${open.misses}×`, expected: open.expected, expectedIpa: open.expectedIpa, phoneme: open.phoneme, tip: open.tip }}
          accent={app.profile!.accent}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
