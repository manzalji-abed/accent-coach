# Setup runbook (for Claude Code)

This file is written for Claude Code to follow when the user asks to set up this
repo on GitHub. A human can follow it too. Work through the steps in order,
check each one, and stop at the steps marked **USER** until the user says they're done.

Some things only the user can do, because they need a browser login or a secret:
installing the Claude GitHub App, and creating the Claude token.
**Never ask the user to paste a token or API key into the chat.** They set secrets themselves with `gh secret set`, which reads the value without echoing it.

## 0. Check the tools

```bash
gh auth status      # must be logged in; if not, ask the user to run: gh auth login
node -v             # needs 20 or newer
git status          # this folder is already a git repo with history and no remote
```

## 1. Ask the user (one message, all at once)

1. Repo name, and private or public? Default: `accent-coach`, private.
2. How should the agent pay for Claude?
   - **Claude Pro/Max subscription** (recommended for one person): secret `CLAUDE_CODE_OAUTH_TOKEN`. Runs count toward their plan's usage limits.
   - **API key** (pay per use): secret `ANTHROPIC_API_KEY`.
3. Auto-merge when tests pass and the reviewer rates the PR high confidence? Lower-confidence PRs always wait for the user. Recommend **no** for the first couple of weeks.

## 2. Sanity check locally

```bash
npm ci
npm run typecheck && npm test
```

Expect all tests to pass. If they don't, stop and tell the user. Don't "fix" tests to get past this.

## 3. Create the GitHub repo and push

```bash
gh repo create <name> --private --source=. --remote=origin --push   # or --public
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner); echo "$REPO"
```

## 4. USER: install the Claude GitHub App

Ask the user to open <https://github.com/apps/claude>, click **Install** (or **Configure**), and give it access to this repo.

Why it matters: commits the agent pushes as `claude[bot]` trigger CI. Pushes made with the default Actions token don't, so without the app the agent's PRs never get tested.

There's no reliable CLI check for this, so wait for the user to confirm.

## 5. USER: add the Claude secret

Give the user these commands to run **in their own terminal** (not through you), depending on their answer in step 1:

```bash
# Subscription:
claude setup-token                                          # opens a browser login, then prints a token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner/name>    # paste the token when prompted

# or API key (from https://console.anthropic.com):
gh secret set ANTHROPIC_API_KEY --repo <owner/name>
```

Then check that it exists (this shows names only, never values):

```bash
gh secret list --repo "$REPO"
```

The app's Gemini key is **not** needed on GitHub: CI runs the app in demo mode.

## 6. Repo settings

```bash
gh repo edit "$REPO" --enable-auto-merge --delete-branch-on-merge
gh variable set AGENT_AUTO_MERGE --repo "$REPO" --body false      # true if the user said yes
gh variable set AGENT_MAX_FIX_ATTEMPTS --repo "$REPO" --body 3
```

Create the labels now so the user can see them right away. The pipeline also creates them itself on first run.

```bash
gh label create agent              --repo "$REPO" --force --color 5319e7 --description "Hand this issue to the agent"
gh label create agent:working      --repo "$REPO" --force --color fbca04 --description "Agent is working on it"
gh label create agent:needs-input  --repo "$REPO" --force --color d93f0b --description "Agent is waiting for your answer"
gh label create agent:in-review    --repo "$REPO" --force --color 0e8a16 --description "PR open: tests and security review"
gh label create agent:blocked      --repo "$REPO" --force --color b60205 --description "Agent is stuck and needs a human"
gh label create agent:queued       --repo "$REPO" --force --color c5def5 --description "Planned: starts after the previous item merges"
```

## 7. Protect `main`

This makes tests and the security review required before anything merges.
Repo admins can still push directly, for example to edit `PLAN.md`.

```bash
gh api -X POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "Typecheck, unit tests, build" },
          { "context": "UI tests (Playwright)" },
          { "context": "agent/security-review" } ] } }
  ]
}
JSON
```

- If this returns **403 or "Upgrade to GitHub Pro"**: rulesets on private repos need a paid plan. Tell the user. The options are to upgrade, make the repo public, or skip this step. Without it everything still works, but nothing *forces* tests to pass before merging.
- If the API rejects a field, check the current ruleset API docs and adjust. Keep the same three required checks.

## 8. Smoke test: one real issue, end to end

```bash
gh issue create --repo "$REPO" \
  --title "Add a 'Slow' button to the Said vs Expected sheet" \
  --body "Next to 'Play native', add 'Slow' that plays the native sample at 0.6x speed." \
  --label agent
sleep 10 && gh run list --repo "$REPO" --workflow Agent --limit 3
```

Then watch it: `gh run watch --repo "$REPO" <run-id>`. It takes about 5 to 15 minutes. Expect, in order:

1. The issue gets `agent:working`, then a PR from branch `agent/issue-<n>`, and the issue moves to `agent:in-review`.
2. **CI** runs on the PR, and a comment appears with UI test results and a GIF.
3. **Agent Review** runs, posts a security review comment, and sets the `agent/security-review` check.
4. The PR gets "Tests and security review passed. Ready for you to merge."

Check it with:

```bash
gh issue view <n> --repo "$REPO" --comments
gh pr checks <pr> --repo "$REPO"
```

### If something's off

| Symptom | Likely cause | Fix |
|---|---|---|
| `decide` logs `noop (... does not have write access)` | Issue labeled by an account without write access | Label it from the owner account |
| Issue gets "The agent isn't set up yet" | Secret missing or misnamed | Step 5; check the exact name with `gh secret list` |
| `claude` step fails with an auth error | Token expired or wrong | Re-run `claude setup-token` and `gh secret set` |
| PR opened but **CI never runs** on it | Claude GitHub App not installed on this repo | Step 4, then `/agent retry` on the issue |
| UI report comment fails to push media | Branch rules block `test-media` | Make sure the ruleset only targets the default branch |
| Agent run "crashed" | Read the run log: `gh run view <id> --log-failed` | Then comment `/agent retry` on the issue |

The `decide` step of every **Agent** run logs one line: what it decided and why. Start there.

## 9. Optional: hosted HTML test reports

Only after the first PR has run (the `test-media` branch must exist):

```bash
gh api -X POST "repos/$REPO/pages" -f "source[branch]=test-media" -f "source[path]=/"
```

Pages on a private repo needs a paid plan. Without it, the report comment links to the run's downloadable artifacts instead.

## 10. Optional: deploy the app

The pipeline doesn't need this; it's only for using the app on a phone. Ask the user whether they want it. With [Vercel](https://vercel.com): import the GitHub repo, add the `GEMINI_API_KEY` environment variable (from <https://aistudio.google.com/apikey>), and deploy. The user does this in their browser, or runs `npx vercel` themselves.

## 11. Tell the user how to use it

When done, summarize in plain words:

- Add the `agent` label to an issue to hand it to the agent.
- If it asks questions (label `agent:needs-input`), reply on the issue and it continues.
- If it gets stuck (label `agent:blocked`), reply with guidance and it tries again.
- Comment `/agent stop`, `/agent retry`, or `/agent <change>` on an issue or PR.
- Add `- [ ] items` to `PLAN.md` on main to queue work that runs one item at a time.
