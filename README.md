# Accent Coach

Talk to an AI coach, see exactly which sounds slipped, and fix them.
A mobile-first web app powered by Gemini's audio understanding, plus an
agent pipeline that turns GitHub issues into tested, reviewed pull requests.

<img src="docs/walkthrough.gif" width="280" alt="Speaking a turn, opening a flagged word, finishing a session, and the progress screen">

**What's here**

| | |
|---|---|
| **The app** | Onboarding (goal, accent, practice time) · free talk and role-play with flagged words · "Said vs. Expected" card with play-yours / play-native · shadowing loop · end-of-session takeaway · clarity trend, problem-sound heatmap, trouble-word bank, history · streaks · calendar reminder · installable on your phone |
| **The pipeline** | Label an issue `agent` → it builds, opens a PR → CI + UI tests (videos on the PR) → security review → you merge (or auto-merge). It stops and asks when something is unclear or it's stuck, and your reply resumes it. |

---

## Run the app

```bash
npm ci
cp .env.example .env.local     # add GEMINI_API_KEY for real coaching
npm run dev                    # http://localhost:3000
```

Without a key the app runs in **demo mode**: everything works, feedback is sample data, and a banner says so.
Open it on your phone (same Wi-Fi, `http://<your-computer-ip>:3000`) to try the mic; browsers only allow the mic on `localhost` or HTTPS, so for real phone testing deploy it (below).

**Deploy:** import the repo on [Vercel](https://vercel.com/new), add `GEMINI_API_KEY` as an environment variable, deploy. On your phone, open the site and use *Add to Home Screen*.

The default model is `gemini-3.8-flash`. Override it with `GEMINI_MODEL`.

---

## Set up the agent pipeline (about 10 minutes)

1. **Push this repo to GitHub** (private is fine).
2. **Install the Claude GitHub App** on the repo: <https://github.com/apps/claude>.
   This matters: commits the agent pushes as `claude[bot]` trigger CI. (Pushes made with the default Actions token don't.)
3. **Add a secret:** Settings → Secrets and variables → Actions → *New repository secret* → `ANTHROPIC_API_KEY`.
   CI never needs your Gemini key; tests run in demo mode.
4. **Protect `main`:** Settings → Rules → Rulesets → New branch ruleset for `main`:
   - Require a pull request before merging
   - Require status checks: `Typecheck, unit tests, build`, `UI tests (Playwright)`, `agent/security-review`
     (they appear in the list after the first PR has run)
5. **Optional, auto-merge:** Settings → General → *Allow auto-merge*, then Settings → Secrets and variables → Actions → **Variables** → `AGENT_AUTO_MERGE` = `true`.
   Leave this off for the first couple of weeks and merge yourself.
6. **Optional, full HTML test reports:** Settings → Pages → Deploy from branch → `test-media` / root.
   (Appears after the first PR. Pages on private repos needs a paid plan; without it, the comment links to the run instead.)

Labels are created automatically on first use.

### Using it

| You do | The pipeline does |
|---|---|
| Add the `agent` label to an issue | Builds it on `agent/issue-N`, opens a PR that closes the issue |
| Answer its questions on the issue | Picks up where it stopped |
| Reply on a blocked PR with guidance | Applies it, with a fresh budget of 3 attempts |
| Comment `/agent <request>` on its PR | Makes that change |
| Comment `/agent stop` (or remove the label) | Stops and clears its labels |
| Comment `/agent retry` | Starts again (on the same PR if one is open) |
| Add `- [ ] items` to `PLAN.md` on main | Creates issues and runs them one at a time |

Labels show where everything is: `agent:working`, `agent:needs-input` (waiting for you), `agent:in-review`, `agent:blocked` (waiting for you), `agent:queued`.

Each issue gets **one** status comment that edits itself. You're only notified when it needs you, or when something is ready.

### Settings (repository variables)

| Variable | Default | |
|---|---|---|
| `AGENT_MAX_FIX_ATTEMPTS` | `3` | Automatic fix tries before it stops and asks you |
| `AGENT_AUTO_MERGE` | `false` | Merge automatically when tests and review pass |

### Safety

- Only people with **write access** can start or steer the agent. Comments from anyone else are ignored and never reach the agent's prompt.
- Bot comments and the pipeline's own comments never trigger it, so it can't loop.
- The agent can't edit `.github/`, force-push, read secrets, or use `curl`/`wget`. The fix job refuses to push to any branch that isn't `agent/issue-*`.
- Forks never get agent runs or reviews.
- The review only *reads* PR code. A reviewer can be fooled by text in the code it's reviewing, so keep a human merge step until you trust it.

---

## How it's tested

```bash
npm test                  # 63 tests: app logic + 31 pipeline scenarios + CLI against a mock GitHub API
npx playwright test       # 10 UI tests on mobile Chrome with a fake microphone
npm run agent:scenarios   # writes docs/PIPELINE_SCENARIOS.md: a readable log of every scenario
```

The pipeline's decisions live in plain modules (`.github/agent/*.mjs`); the workflows just call them. A simulator (`.github/agent/sim`) replays real GitHub events (labels, replies, CI failing, reviews rejecting, strangers commenting, a PR closed, PLAN.md queues…) through that same code. See [docs/PIPELINE_SCENARIOS.md](docs/PIPELINE_SCENARIOS.md).

**What the simulator can't prove:** GitHub-side plumbing (tokens, app permissions, the Claude action's inputs). Do the live check below once after setup.

### First live check on GitHub

1. Open an issue "Add a 'Slow' button to the Said vs Expected sheet", add the `agent` label. Expect: `agent:working` → a PR → CI with a GIF comment → security review → "Ready for you to merge".
2. Open a vague issue "Make the app better", label it. Expect: it asks questions and labels `agent:needs-input`. Reply; it continues.
3. On the PR from step 1, comment `/agent make the button say "Slower"`. Expect a new commit and CI again.
4. Comment `/agent stop` on the issue from step 2. Expect labels cleared.

If a step doesn't behave, the Actions tab → **Agent** run → `decide` step logs one line saying what it decided and why.

---

## Project layout

```
app/                 pages + API routes (Gemini)
components/          UI
lib/                 logic (audio encoding, scoring, streaks, store, prompts, schemas, mock coach)
tests/unit, tests/e2e
.github/workflows    ci.yml · agent.yml · review.yml · plan.yml
.github/agent        pipeline logic, prompts, simulator, tests
CLAUDE.md            instructions the agents follow
PLAN.md              optional queue of work
```
