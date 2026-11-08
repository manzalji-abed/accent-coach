"use client";
import Link from "next/link";
import { DemoNotice } from "@/components/DemoNotice";
import { TabBar } from "@/components/TabBar";
import { useProfileGate } from "@/components/useProfileGate";
import { currentStreak, practisedToday } from "@/lib/progress";
import { GOALS, SCENARIOS, lessonForDay } from "@/lib/scenarios";

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function Home() {
  const app = useProfileGate();
  if (!app) return null;
  const { profile, sessions } = app;
  const now = new Date();
  const lesson = lessonForDay(profile!.goal, now);
  const streak = currentStreak(sessions);
  const done = practisedToday(sessions);
  const goalLabel = GOALS.find((g) => g.id === profile!.goal)!.label;
  const roleplays = SCENARIOS.filter((s) => s.goal === profile!.goal && s.mode === "roleplay" && s.id !== lesson.id);
  const freeTalk = SCENARIOS.find((s) => s.goal === profile!.goal && s.mode === "talk")!;

  return (
    <>
      <main className="page">
        <div className="hello">
          <div>
            <h1 className="page-title">{greeting(now)}</h1>
            <p className="lede">{done ? "You've practised today. Nice." : `${goalLabel} practice`}</p>
          </div>
          <div className="streak" data-hot={streak > 0} aria-label={`${streak} day streak`} data-testid="streak">
            <b>{streak}</b>
            <small>day streak</small>
          </div>
        </div>

        <DemoNotice />

        <section className="lesson" aria-labelledby="lesson-title">
          <p className="lesson-when">Today&apos;s lesson, {formatTime(profile!.reminderTime)}</p>
          <h2 id="lesson-title">{lesson.title}</h2>
          <p>{lesson.brief}</p>
          <Link className="btn btn-block" href={`/talk?scenario=${lesson.id}`}>
            Start lesson
          </Link>
        </section>

        <div className="modes">
          <Link className="mode" href={`/talk?scenario=${freeTalk.id}`}>
            <strong>Free talk</strong>
            <span>Chat about anything. Feedback as you go.</span>
          </Link>
          <Link className="mode" href="/shadow">
            <strong>Shadowing</strong>
            <span>Hear a sentence, repeat it, pass to move on.</span>
          </Link>
        </div>

        <h2 className="section-title">More role-plays</h2>
        <ul className="scenario-list">
          {roleplays.map((s) => (
            <li key={s.id}>
              <Link href={`/talk?scenario=${s.id}`}>
                <span>
                  {s.title}
                  <small>{s.brief}</small>
                </span>
                <span aria-hidden>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <TabBar />
    </>
  );
}
