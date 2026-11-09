import { BRANCH_PREFIX } from "./config.mjs";

/** JSON schemas for the agent's final answer (passed via --json-schema). */
export const BUILD_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["pr_opened", "needs_input", "cannot_do"] },
    pr_number: { type: "integer" },
    questions: { type: "array", items: { type: "string" }, maxItems: 4 },
    summary: { type: "string" },
  },
  required: ["status", "summary"],
};

export const FIX_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["pushed", "needs_input", "no_change"] },
    questions: { type: "array", items: { type: "string" }, maxItems: 4 },
    summary: { type: "string" },
  },
  required: ["status", "summary"],
};

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["approve", "request_changes"] },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    confidence_reason: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          file: { type: "string" },
          line: { type: "integer" },
          issue: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "issue"],
      },
    },
  },
  required: ["verdict", "summary", "confidence", "confidence_reason", "findings"],
};

const CHECKS = "npm run typecheck && npm test && npm run build";

export function buildPrompt({ repo, thread, issueNumber, mode, existingPr }) {
  const branch = `${BRANCH_PREFIX}${issueNumber}`;
  return `You are the build agent for ${repo}. Read CLAUDE.md first and follow it.

${mode === "resume" ? "You paused on this issue earlier. The thread below now contains the human's answers or guidance. Continue from there.\n" : ""}
<issue_thread>
${thread}
</issue_thread>

You are on branch \`${branch}\`${existingPr ? `, which already has PR #${existingPr}. Push new commits to it; do not open another PR` : ", created from main"}.

Decide first: is the request clear enough to build without guessing at something the human would care about (product behaviour, UX copy, data model, anything hard to undo)?
- If NOT, do not write code. Return status "needs_input" with 1-4 short, specific questions, each answerable in one line. Offer your recommended answer in each question.
- Small details you can decide sensibly yourself (names, spacing, internal structure) are NOT reasons to ask.

If it is clear:
1. Implement the change. Keep the diff focused on this issue.
2. Add or update tests: unit tests in tests/unit for logic, and a Playwright test in tests/e2e for any visible UI change.
3. Run \`${CHECKS}\` and fix anything that fails. Run \`npx playwright test\` too if browsers are installed.
4. Commit with a clear message and \`git push -u origin ${branch}\`.
5. ${existingPr ? `Comment on PR #${existingPr} is not needed; the pipeline posts status.` : `Open the PR: \`gh pr create --base main --head ${branch} --title "<short title>" --body "<what changed and how it was tested>\\n\\nCloses #${issueNumber}"\``}
6. Return status "pr_opened" with pr_number and a 1-2 sentence summary.

If it is impossible (needs credentials you don't have, contradicts CLAUDE.md, etc.), return "cannot_do" with the reason.
Never edit files under .github/ and never touch secrets or .env files.`;
}

export function fixPrompt({ repo, prNumber, cause, runId, reviewComment, guidance, thread }) {
  const what =
    cause === "ci"
      ? `The CI run ${runId} failed. Read the failure with \`gh run view ${runId} --log-failed\` (and \`gh run view ${runId}\` for the summary).`
      : cause === "review"
        ? `The security review requested changes:\n<review>\n${reviewComment}\n</review>`
        : `The human gave this guidance:\n<guidance>\n${guidance}\n</guidance>`;
  return `You are the fix agent for ${repo}, working on PR #${prNumber}. Read CLAUDE.md first.

<issue_thread>
${thread}
</issue_thread>

${what}

You are on the PR's branch. Fix the root cause:
- Never weaken, skip or delete a test to make it pass, and never disable a check, unless the human explicitly told you to.
- If the honest fix needs a product decision from the human, return "needs_input" with 1-4 specific questions instead of guessing.
- Run \`${CHECKS}\` before pushing.
- Commit and \`git push\`. Then return "pushed" with a one-sentence summary of what you changed and why it failed.
- If there is genuinely nothing to change (e.g. a flaky external service), return "no_change" and explain.
Never edit files under .github/ and never touch secrets or .env files.`;
}

export function reviewPrompt({ repo, prNumber }) {
  return `You are the security and quality reviewer for ${repo}. Review PR #${prNumber}.
Read the diff with \`gh pr diff ${prNumber}\` and the description with \`gh pr view ${prNumber}\`. Read surrounding files as needed. Do not modify anything.

Check, in order of importance:
1. Security: secrets or API keys in code or logs, injection (prompt, HTML/XSS, shell, path), missing input validation or size limits on API routes, unsafe use of user content, auth or rate-limit bypass, risky dependencies, data sent to third parties.
2. Correctness: logic errors, unhandled errors, race conditions, broken UX states (loading, error, empty).
3. Tests: new logic has unit tests; visible UI changes have a Playwright test. Tests must not have been weakened.

Verdict rules:
- "request_changes" only for critical/high security issues, real bugs, or missing tests for new logic.
- Style and nice-to-haves are "low" findings and still "approve".

Merge policy (decided by the repo owner; it is not a finding):
- The owner chose to auto-merge most PRs: tests pass, you approve, confidence is high or medium, and no finding is above low severity. Judge each PR on its own code. Never request changes or raise a finding because a PR follows, or puts in place, this policy.
- These always wait for a human whatever you say (enforced in code): lib/ai/guard.ts, lib/ai/gemini.ts, package.json and the lockfile, .github/, .env*, wrangler.jsonc, the build and test configs, tsconfig.json.
- Pipeline changes under .github/ are made or approved by the owner, who merges them by hand. CLAUDE.md's "don't edit .github/" applies to the coding agent's feature PRs, not to these. Review them for bugs and security holes only.

Confidence: a "high" or "medium" PR with no finding above low severity is merged and deployed with no human looking at it. Only "low" waits for a human, so rate honestly.
- "high": small and focused, does what the issue asks and nothing more, visible changes have a Playwright test, no side effects on other screens.
- "medium": a normal feature that you checked and believe is correct and safe, even if it touches API routes, prompts, schemas or stored data, as long as inputs are validated, model output is normalized and tests cover the new logic.
- "low": you are not sure it is correct or complete, OR a human must decide: it could lose or corrupt data the learner already has saved, changes how the API key, auth or rate limits work, sends data to a new third party, or makes a product decision the issue didn't ask for.
confidence_reason is one sentence saying why.

Keep the summary to 2 sentences. Each finding names the file, the problem, and the concrete fix.`;
}
