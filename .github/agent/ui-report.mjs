#!/usr/bin/env node
/**
 * Builds the single "UI tests" comment for a PR (and its linked issue) from
 * Playwright's JSON results plus the GIFs/screenshots the workflow published
 * to the test-media branch.
 *
 *   node .github/agent/ui-report.mjs <results.json> <media-dir> <public-base-url> [report-url]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { MARK, issueFromBranch } from "./config.mjs";
import { GitHub, execOps } from "./github.mjs";

export function summarize(results) {
  const tests = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.at(-1);
        const firstError = (last?.errors?.[0]?.message ?? last?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0];
        tests.push({ title: spec.title, file: spec.file ?? file, status: t.status, outcome: last?.status, retries: (t.results?.length ?? 1) - 1, error: firstError, ms: last?.duration ?? 0 });
      }
    }
    for (const s of suite.suites ?? []) walk(s, s.file ?? file);
  };
  for (const s of results.suites ?? []) walk(s, s.file);
  const failed = tests.filter((t) => t.status === "unexpected");
  const flaky = tests.filter((t) => t.status === "flaky");
  const passed = tests.filter((t) => t.status === "expected");
  const skipped = tests.filter((t) => t.status === "skipped");
  return { tests, failed, flaky, passed, skipped, seconds: Math.round((results.stats?.duration ?? 0) / 1000) };
}

/** media: [{ name, url, kind: "gif" | "png" }] where name matches a test folder. */
export function buildReport({ summary, media = [], reportUrl, runUrl, sha }) {
  const { failed, flaky, passed, skipped, seconds } = summary;
  const ok = failed.length === 0;
  const head = ok ? `### ✅ UI tests passed (${passed.length + flaky.length}/${summary.tests.length - skipped.length})` : `### ❌ UI tests failed (${failed.length} of ${summary.tests.length - skipped.length})`;
  const lines = [MARK.uiReport, head, ""];
  lines.push(`${seconds}s on mobile Chrome${sha ? ` · \`${sha.slice(0, 7)}\`` : ""}${flaky.length ? ` · ${flaky.length} flaky (passed on retry)` : ""}`);
  if (failed.length) {
    lines.push("", "| Test | Error |", "|---|---|");
    for (const t of failed) lines.push(`| ${t.title.replace(/\|/g, "\\|")} | ${t.error.replace(/\|/g, "\\|").slice(0, 140) || "see report"} |`);
  }
  const gifs = media.filter((m) => m.kind === "gif");
  const shots = media.filter((m) => m.kind === "png");
  if (gifs.length) {
    lines.push("", ok ? "**Walkthrough**" : "**Recordings**", "");
    lines.push(gifs.map((g) => `<img src="${g.url}" width="260" alt="${g.name}">`).join(" "));
  }
  if (shots.length) {
    lines.push("", "**Failure screenshots**", "");
    lines.push(shots.map((s) => `<img src="${s.url}" width="200" alt="${s.name}">`).join(" "));
  }
  const links = [reportUrl && `[Full report with traces](${reportUrl})`, runUrl && `[Run](${runUrl})`].filter(Boolean);
  if (links.length) lines.push("", links.join(" · "));
  return lines.join("\n");
}

function listMedia(dir, baseUrl) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(gif|png)$/.test(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.(gif|png)$/, ""), kind: f.endsWith(".gif") ? "gif" : "png", url: `${baseUrl}/${f}?raw=true` }));
}

async function main() {
  const [resultsPath, mediaDir, baseUrl, reportUrl] = process.argv.slice(2);
  const env = process.env;
  const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : { suites: [], stats: {} };
  const body = buildReport({ summary: summarize(results), media: listMedia(mediaDir, baseUrl), reportUrl, runUrl: env.RUN_URL, sha: env.HEAD_SHA });
  const gh = new GitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, api: env.GITHUB_API_URL || undefined });
  const pr = Number(env.PR_NUMBER);
  const ops = [{ op: "upsertComment", target: pr, marker: MARK.uiReport, body }];
  const issue = issueFromBranch(env.HEAD_REF);
  if (issue) ops.push({ op: "upsertComment", target: issue, marker: MARK.uiReport, body });
  await execOps(gh, ops);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
