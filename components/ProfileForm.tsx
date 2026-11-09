"use client";
import { useState } from "react";
import { GOALS } from "@/lib/scenarios";
import type { Accent, Goal, Profile } from "@/lib/types";

/**
 * Three quick steps: goal, accent, practice time. Used for onboarding and,
 * all on one screen, for settings.
 */
export function ProfileForm(props: { initial?: Profile | null; stepped: boolean; submitLabel: string; onSubmit: (p: Profile) => void }) {
  const [goal, setGoal] = useState<Goal | null>(props.initial?.goal ?? null);
  const [accent, setAccent] = useState<Accent>(props.initial?.accent ?? "us");
  const [time, setTime] = useState(props.initial?.reminderTime ?? "19:00");
  const [step, setStep] = useState(0);

  const submit = () =>
    goal &&
    props.onSubmit({ goal, accent, reminderTime: time, createdAt: props.initial?.createdAt ?? new Date().toISOString(), ...(props.initial?.theme ? { theme: props.initial.theme } : {}) });

  const goalStep = (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="section-title" style={{ marginTop: 0 }}>
        What are you practising for?
      </legend>
      <div className="choice-grid">
        {GOALS.map((g) => (
          <button key={g.id} type="button" className="choice" aria-pressed={goal === g.id} onClick={() => setGoal(g.id)}>
            <strong>{g.label}</strong>
            <span>{g.blurb}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );

  const accentStep = (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="section-title">Which accent are you aiming for?</legend>
      <div className="segmented">
        <button type="button" className="choice" aria-pressed={accent === "us"} onClick={() => setAccent("us")}>
          <strong>American</strong>
          <span>General American</span>
        </button>
        <button type="button" className="choice" aria-pressed={accent === "uk"} onClick={() => setAccent("uk")}>
          <strong>British</strong>
          <span>Southern British</span>
        </button>
      </div>
    </fieldset>
  );

  const timeStep = (
    <div>
      <h2 className="section-title">When should we practise each day?</h2>
      <label className="field">
        <span className="lede" style={{ margin: 0 }}>
          A 5 to 15 minute session at the same time each day builds the habit.
        </span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required aria-label="Daily practice time" />
      </label>
    </div>
  );

  if (!props.stepped) {
    return (
      <div>
        {goalStep}
        {accentStep}
        {timeStep}
        <div className="actions">
          <button type="button" className="btn" disabled={!goal || !time} onClick={submit}>
            {props.submitLabel}
          </button>
        </div>
      </div>
    );
  }

  const steps = [goalStep, accentStep, timeStep];
  const canNext = step === 0 ? Boolean(goal) : step === 2 ? Boolean(time) : true;
  return (
    <div>
      <div className="steps" aria-label={`Step ${step + 1} of 3`}>
        {steps.map((_, i) => (
          <i key={i} data-on={i <= step} />
        ))}
      </div>
      {steps[step]}
      <div className="actions">
        {step > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={!canNext}
          onClick={() => (step < 2 ? setStep(step + 1) : submit())}
        >
          {step < 2 ? "Continue" : props.submitLabel}
        </button>
      </div>
    </div>
  );
}
