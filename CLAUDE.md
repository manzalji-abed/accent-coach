# Accent Coach: notes for coding agents

> **Asked to set up this repo on GitHub (create the repo, secrets, protection, the agent pipeline)?**
> Follow [SETUP.md](SETUP.md) step by step. Everything below is about working on the app's code.

A mobile-first web app where learners talk to an AI pronunciation coach. Gemini
listens to their raw audio and returns structured feedback; the UI underlines
mispronounced words and explains how to fix them.

## Commands

| What | Command |
|---|---|
| Install | `npm ci` |
| Dev server (demo mode without a key) | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Unit + pipeline tests | `npm test` |
| Production build | `npm run build` |
| UI tests (Playwright, fake mic) | `npx playwright test` |
| Cloudflare build + local run | `npm run preview` |

Deploys: every merge to `main` auto-deploys to Cloudflare Workers (`wrangler.jsonc`, via the OpenNext adapter) at `coaccent.abedmanzalji.com`, behind Cloudflare Access. Don't deploy by hand from a PR, and keep server code compatible with Workers (`nodejs_compat`).

Before pushing, all of `npm run typecheck && npm test && npm run build` must pass.
Run `npx playwright test` whenever you touch anything under `app/` or `components/`.

## Layout

- `app/` Next.js App Router pages; `app/api/*` are the only server code (Gemini calls).
- `components/` UI pieces. `lib/` logic with no React (easy to unit test).
- `lib/ai/` prompts, JSON schemas, the Gemini client, input guards, and the **mock** coach.
- `lib/store.ts` all user data lives in localStorage on the device (no accounts yet).
- `tests/unit` Vitest. `tests/e2e` Playwright. `.github/agent` the issue-to-merge pipeline (don't edit).

## Rules

- **Demo mode:** with no `GEMINI_API_KEY` (or `MOCK_AI=1`) the API routes return deterministic sample data from `lib/ai/mock.ts`. UI tests depend on it. If you change response shapes, update the mock too.
- **Model output is untrusted.** Every Gemini response goes through a normalizer in `lib/ai/schemas.ts`. Keep it that way.
- **API routes:** validate every input, cap sizes (`lib/ai/guard.ts`), rate-limit, never echo the API key, never put user free text into prompts beyond the transcript history.
- **Tests:** new logic gets a unit test; any visible change gets a Playwright test. Use `data-testid` for things tests need to find. Never weaken or delete a test to make it pass.
- **Design:** use the CSS tokens in `app/globals.css` (`--voice` for primary actions and the learner, `--slip` for mispronounced, `--clear` for good). Mobile first; check 390px wide. Respect `prefers-reduced-motion`. Keep the mic button the one bold element on talk screens.
- **Copy:** sentence case, plain verbs, say what happens ("Start lesson", not "Submit"). Errors say what went wrong and what to do next.
- Do not edit `.github/`, `.env*`, or anything with secrets. Do not add dependencies unless the issue needs them.
