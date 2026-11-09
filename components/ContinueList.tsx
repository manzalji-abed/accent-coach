import Link from "next/link";
import { recentResumable } from "@/lib/resume";
import { scenarioById } from "@/lib/scenarios";
import type { Session } from "@/lib/types";

/** Recent conversations, each with a Continue button that reopens it on the Talk screen. */
export function ContinueList({ sessions, limit = 3 }: { sessions: Session[]; limit?: number }) {
  const recent = recentResumable(sessions, limit);
  if (!recent.length) return null;
  return (
    <section aria-labelledby="continue-title" data-testid="continue-list">
      <h2 className="section-title" id="continue-title">
        Pick up where you left off
      </h2>
      <ul className="scenario-list">
        {recent.map((s) => (
          <li key={s.id}>
            <Link href={`/talk?resume=${encodeURIComponent(s.id)}`} data-testid="continue-link" aria-label={`Continue ${scenarioById(s.scenarioId)?.title ?? "conversation"}`}>
              <span>
                {scenarioById(s.scenarioId)?.title ?? "Conversation"}
                <small>
                  {s.endedAt ? "Finished" : "Not finished"}, {new Date(s.startedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </small>
              </span>
              <span className="btn-text">Continue</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
