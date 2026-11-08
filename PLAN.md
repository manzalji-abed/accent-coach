# Plan

Unchecked items become issues when this file changes on `main`. The agent works
through them one at a time: each starts after the previous one's PR merges.
Indented lines under an item become the issue's description.

- [ ] Light / dark mode switch in Settings
  The app already follows the phone's colour scheme via prefers-color-scheme. Add a "Theme" setting with System (default), Light and Dark.
  Store the choice with the profile in lib/store.ts, apply it on <html> as data-theme="light" | "dark" (omit for System), and make the existing dark tokens in app/globals.css apply for data-theme="dark" as well as for prefers-color-scheme when no theme is set. Light must win over a dark system setting when chosen.
  Apply it before first paint so there is no flash of the wrong theme. Every screen must stay readable in both themes; use the existing tokens only.
  Tests: unit test for the stored setting; Playwright test that switching to Dark and Light changes data-theme and survives a reload.

- [ ] Named conversation partners (personas) with male and female voices
  Replace the single hard-coded persona names (e.g. "Priya") with a small cast of realistic people, each with a name, role, short personality and a Gemini Live voice:
  Daniel Brooks, CTO, direct and technical (voice Charon); Maya Chen, CEO, busy and big-picture (voice Kore); Omar Haddad, hiring manager, warm but probing (voice Puck); Sofia Martins, customer, friendly but impatient (voice Aoede); James Walker, teammate, casual (voice Fenrir); Leila Rahman, product manager, curious and organised (voice Leda).
  Each role-play scenario in lib/scenarios.ts names its default persona; free talk lets the learner pick who to talk to on the Talk screen before starting (show name, role, one-line personality).
  The persona's voice and personality must be chosen server-side: /api/live receives a personaId, validates it against the list, and locks the voice (speechConfig) and persona description into the token in lib/ai/live.ts. Never let the client send free text into the prompt.
  Update lib/ai/mock.ts if shapes change. Tests: unit tests for persona lookup/validation and for liveConnectConfig using the persona's voice; Playwright test picking a persona and seeing their name on the Talk screen.

- [ ] Communication coaching: audience and goal aware feedback
  The coach should improve how the learner communicates, not only pronunciation. Before a session the learner picks who they're talking to (CEO, CTO, manager, peer, customer, interviewer) and what they're doing (explain a problem, status update, ask for something, push back, deliver bad news, small talk). Default: peer + small talk.
  Pass both as validated ids to /api/live (never free text) and build them into the live prompt in lib/ai/prompts.ts, with audience rules, e.g. CEO/executives: bottom line first, short, impact and decision, no implementation detail; CTO: technical depth welcome but structured; customer: plain words and empathy; interviewer: concrete examples (situation, action, result).
  Extend the review_turn tool (lib/ai/schemas.ts, normalized in normalizeReview) with a short "comms" note: structure (did they lead with the point?), level of detail for this audience (too much / too little / right), concision (fillers, rambling), confidence (hedging, apologising), and tone. Show it in the existing "Better way to say it" sheet as a "For a CEO" style tip, only when there is something worth improving.
  Add a few scenario packs to lib/scenarios.ts, e.g. "Explain an outage to your CEO in 60 seconds", "Ask your manager for a raise", "Push back on a deadline with your CTO".
  The end-of-session summary should mention the strongest communication habit and the one thing to change. Update the mock and its tests.

- [ ] Continue a previous conversation
  On the home screen and the history/progress screen, show recent unfinished or finished talk sessions with a "Continue" button that opens /talk?resume=<sessionId>.
  The Talk screen loads that session's turns from lib/store.ts, shows them, and when the learner taps the mic the live session starts with the earlier conversation as context (the same "here is the conversation so far" path used after reconnects in lib/live/useLiveCoach.ts) without repeating the greeting. New turns are appended to the same saved session.
  Tests: unit test for loading a session by id; Playwright test that finishes a session, taps Continue, sees the old turns, talks once more and ends up with one more user bubble.
