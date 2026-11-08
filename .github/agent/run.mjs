#!/usr/bin/env node
/**
 * Entry point the workflows call. Each command is a thin wrapper around the
 * pure, tested modules in this folder.
 *
 *   node .github/agent/run.mjs decide            -> decision JSON + pre-run label/status updates
 *   node .github/agent/run.mjs prompt build|fix  -> writes the agent prompt to $PROMPT_FILE
 *   node .github/agent/run.mjs after build|fix   -> applies the agent's structured result
 *   node .github/agent/run.mjs after review      -> sticky review comment + commit status
 *   node .github/agent/run.mjs plan              -> PLAN.md items become queued issues
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
 *      GITHUB_OUTPUT, RUN_URL, DECISION, RESULT, HAS_ANTHROPIC_KEY,
 *      AGENT_MAX_FIX_ATTEMPTS, AGENT_AUTO_MERGE
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { MARK, REVIEW_STATUS_CONTEXT, readConfig } from "./config.mjs";
import { gatherContext, latestHumanGuidance, trustedThread } from "./context.mjs";
import { decide } from "./decide.mjs";
import { planBefore, planBuildResult, planFixResult, planReview } from "./effects.mjs";
import { GitHub, execOps } from "./github.mjs";
import { syncPlan } from "./plan.mjs";
import { BUILD_SCHEMA, FIX_SCHEMA, REVIEW_SCHEMA, buildPrompt, fixPrompt, reviewPrompt } from "./prompts.mjs";

const env = process.env;
const output = (key, value) => {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}<<__AGENT_EOF__\n${v}\n__AGENT_EOF__\n`);
  else console.log(`${key}=${v}`);
};
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

async function main() {
  const [cmd, kind] = process.argv.slice(2);
  const gh = new GitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, api: env.GITHUB_API_URL || undefined });

  if (cmd === "decide") {
    await gh.ensureLabels();
    const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const ctx = await gatherContext(gh, env.GITHUB_EVENT_NAME, payload, env);
    const d = decide(ctx);
    console.log(`Decision: ${d.action} (${d.reason})`);
    await execOps(gh, planBefore(d, { runUrl: env.RUN_URL, maxFixAttempts: ctx.config.maxFixAttempts }));
    output("action", d.action);
    output("decision", d);
    output("branch", d.issue ? `agent/issue-${d.issue}` : "");
    return;
  }

  if (cmd === "prompt") {
    const d = parse(env.DECISION);
    let prompt;
    let schema;
    if (kind === "build") {
      const { text } = await trustedThread(gh, d.issue);
      const existingPr = await gh.findOpenPrForBranch(`agent/issue-${d.issue}`);
      prompt = buildPrompt({ repo: env.GITHUB_REPOSITORY, thread: text, issueNumber: d.issue, mode: d.mode, existingPr });
      schema = BUILD_SCHEMA;
    } else if (kind === "fix") {
      const comments = await gh.listComments(d.pr);
      const review = comments.find((c) => c.isBot && c.body.startsWith(MARK.review));
      const { text } = await trustedThread(gh, d.issue ?? d.pr);
      prompt = fixPrompt({
        repo: env.GITHUB_REPOSITORY,
        prNumber: d.pr,
        cause: d.cause,
        runId: d.runId,
        reviewComment: review?.body.replace(MARK.review, "").trim(),
        guidance: latestHumanGuidance(comments) || latestHumanGuidance(await gh.listComments(d.issue ?? d.pr)),
        thread: text,
      });
      schema = FIX_SCHEMA;
    } else if (kind === "review") {
      prompt = reviewPrompt({ repo: env.GITHUB_REPOSITORY, prNumber: Number(env.PR_NUMBER) });
      schema = REVIEW_SCHEMA;
    } else throw new Error(`unknown prompt kind ${kind}`);
    writeFileSync(env.PROMPT_FILE || "agent-prompt.md", prompt);
    output("prompt", prompt);
    output("schema", JSON.stringify(schema));
    return;
  }

  if (cmd === "after") {
    const result = parse(env.RESULT);
    const runUrl = env.RUN_URL;
    if (kind === "build") {
      await execOps(gh, planBuildResult(parse(env.DECISION), result, { runUrl }));
    } else if (kind === "fix") {
      const d = parse(env.DECISION);
      if (result?.status === "no_change") result.status = undefined; // handled as a counted attempt
      await execOps(gh, planFixResult(d, result, { runUrl, maxFixAttempts: readConfig(env).maxFixAttempts }));
    } else if (kind === "review") {
      await execOps(gh, planReview(result, { pr: Number(env.PR_NUMBER), sha: env.HEAD_SHA, runUrl, context: REVIEW_STATUS_CONTEXT }));
      // Failing this job is what triggers the fix loop for review findings.
      if (result?.verdict !== "approve") process.exitCode = 1;
    } else throw new Error(`unknown kind ${kind}`);
    return;
  }

  if (cmd === "plan") {
    await gh.ensureLabels();
    await syncPlan(gh, readFileSync(env.PLAN_FILE || "PLAN.md", "utf8"));
    return;
  }

  throw new Error(`usage: run.mjs plan | decide | prompt <build|fix|review> | after <build|fix|review>`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
