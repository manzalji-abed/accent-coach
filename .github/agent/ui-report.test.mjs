import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReport, summarize } from "./ui-report.mjs";

const fixture = (statuses) => ({
  stats: { duration: 42_000 },
  suites: [
    {
      file: "talk.spec.ts",
      specs: statuses.map((s, i) => ({
        title: `test ${i}`,
        tests: [{ status: s, results: s === "flaky" ? [{ status: "failed" }, { status: "passed" }] : [{ status: s === "unexpected" ? "failed" : "passed", errors: s === "unexpected" ? [{ message: "\u001b[31mExpected | visible\u001b[0m\nstack" }] : [] }] }],
      })),
    },
  ],
});

describe("UI test report comment", () => {
  it("summarises a green run with the walkthrough GIF", () => {
    const body = buildReport({ summary: summarize(fixture(["expected", "expected", "flaky"])), media: [{ name: "showcase", kind: "gif", url: "https://x/showcase.gif?raw=true" }], reportUrl: "https://r", runUrl: "https://run", sha: "abcdef123" });
    expect(body).toMatch(/^<!-- agent:ui-report -->/);
    expect(body).toContain("✅ UI tests passed (3/3)");
    expect(body).toContain("1 flaky");
    expect(body).toContain('<img src="https://x/showcase.gif?raw=true"');
    expect(body).toContain("[Full report with traces](https://r)");
    expect(body).toContain("`abcdef1`");
  });

  it("lists failures with a clean one-line error and screenshots", () => {
    const body = buildReport({ summary: summarize(fixture(["expected", "unexpected"])), media: [{ name: "fail-1", kind: "png", url: "u.png" }] });
    expect(body).toContain("❌ UI tests failed (1 of 2)");
    expect(body).toContain("| test 1 | Expected \\| visible |"); // ANSI stripped, pipe escaped
    expect(body).toContain("Failure screenshots");
  });

  it("reads this repo's real Playwright output if present", () => {
    let raw;
    try {
      raw = JSON.parse(readFileSync("test-results/results.json", "utf8"));
    } catch {
      return; // e2e not run yet in this checkout
    }
    const s = summarize(raw);
    expect(s.tests.length).toBeGreaterThan(0);
  });
});
