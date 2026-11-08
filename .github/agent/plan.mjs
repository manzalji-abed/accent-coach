import { LABELS, MARK } from "./config.mjs";

/**
 * PLAN.md -> issues. Each unchecked top-level item ("- [ ] Title") becomes an
 * issue; indented lines under it become the issue body. Items are queued and
 * run one at a time: the next starts when the previous PR merges.
 *
 *   - [ ] Add a dark mode toggle in Settings
 *     Follow the system setting by default.
 *   - [x] Done items are skipped
 */
export function parsePlan(markdown) {
  const items = [];
  let current = null;
  // Items inside <!-- comments --> are examples, not work.
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const m = line.match(/^[-*] \[( |x|X)\] (.+?)\s*$/);
    if (m) {
      current = { title: m[2].replace(/\s*\(#\d+\)\s*$/, "").trim(), done: m[1] !== " ", details: [] };
      items.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.details.push(line.trim());
    } else if (line.trim() === "" || /^#/.test(line)) {
      current = line.trim() === "" ? current : null;
    }
  }
  return items.filter((i) => i.title).map((i) => ({ title: i.title, done: i.done, body: i.details.join("\n") }));
}

/** Creates issues for new plan items and starts the first one if nothing is running. */
export async function syncPlan(gh, markdown, log = console.log) {
  const existing = new Set((await gh.listIssueTitles()).map((t) => t.trim().toLowerCase()));
  const created = [];
  for (const item of parsePlan(markdown)) {
    if (item.done || existing.has(item.title.toLowerCase())) continue;
    const n = await gh.createIssue({ title: item.title, body: `${item.body || "From PLAN.md."}\n\n${MARK.plan}`, labels: [LABELS.queued] });
    created.push(n);
    log(`created #${n}: ${item.title}`);
  }
  const active = [LABELS.working, LABELS.inReview, LABELS.needsInput, LABELS.blocked];
  const busy = [];
  for (const l of active) busy.push(...(await gh.listOpenIssuesWithLabel(l)));
  const [next] = await gh.listOpenIssuesWithLabel(LABELS.queued);
  if (!busy.some((i) => i.labels.includes(LABELS.trigger)) && next) {
    await gh.dispatch("agent-start", { issue: next.number });
    log(`started #${next.number}`);
  }
  return created;
}
