import { LABELS, LABEL_COLORS } from "./config.mjs";

/**
 * Minimal GitHub REST client for the pipeline. The simulator implements the
 * same methods in memory (sim/fake-github.mjs), so everything built on top of
 * this interface is exercised by the scenario tests.
 */
export class GitHub {
  constructor({ token, repo, api = "https://api.github.com" }) {
    if (!token) throw new Error("GITHUB_TOKEN is not set");
    this.token = token;
    this.repo = repo;
    this.api = api;
  }

  async req(method, path, body, { allow404 = false } = {}) {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async getIssue(n) {
    const i = await this.req("GET", `/repos/${this.repo}/issues/${n}`);
    return { number: i.number, state: i.state, title: i.title, body: i.body ?? "", labels: i.labels.map((l) => l.name), isPr: Boolean(i.pull_request) };
  }

  async getPull(n) {
    const p = await this.req("GET", `/repos/${this.repo}/pulls/${n}`);
    return {
      number: p.number,
      state: p.state,
      merged: Boolean(p.merged),
      headRef: p.head.ref,
      headSha: p.head.sha,
      labels: p.labels.map((l) => l.name),
      sameRepo: p.head.repo?.full_name === this.repo,
    };
  }

  async findOpenPrForBranch(branch) {
    const owner = this.repo.split("/")[0];
    const list = await this.req("GET", `/repos/${this.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    return list[0]?.number ?? null;
  }

  async listComments(n) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.req("GET", `/repos/${this.repo}/issues/${n}/comments?per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out.map((c) => ({
      id: c.id,
      author: c.user.login,
      isBot: c.user.type === "Bot" || c.user.login.endsWith("[bot]"),
      canWrite: ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.author_association),
      body: c.body ?? "",
      createdAt: c.created_at,
    }));
  }

  async canWrite(login) {
    const r = await this.req("GET", `/repos/${this.repo}/collaborators/${encodeURIComponent(login)}/permission`, null, { allow404: true });
    return ["admin", "maintain", "write"].includes(r?.permission) || r?.user?.permissions?.push === true;
  }

  addLabels(n, labels) {
    return this.req("POST", `/repos/${this.repo}/issues/${n}/labels`, { labels });
  }
  removeLabel(n, label) {
    return this.req("DELETE", `/repos/${this.repo}/issues/${n}/labels/${encodeURIComponent(label)}`, null, { allow404: true });
  }
  createComment(n, body) {
    return this.req("POST", `/repos/${this.repo}/issues/${n}/comments`, { body });
  }
  updateComment(id, body) {
    return this.req("PATCH", `/repos/${this.repo}/issues/comments/${id}`, { body });
  }
  setStatus(sha, { state, context, description, url }) {
    return this.req("POST", `/repos/${this.repo}/statuses/${sha}`, { state, context, description, target_url: url });
  }
  rerunFailedJobs(runId) {
    return this.req("POST", `/repos/${this.repo}/actions/runs/${runId}/rerun-failed-jobs`);
  }

  /** The open PR whose head commit has a status `context` linking to `targetUrl`. */
  async findPrByStatus(context, targetUrl) {
    const prs = await this.req("GET", `/repos/${this.repo}/pulls?state=open&per_page=100`);
    for (const p of prs) {
      const statuses = await this.req("GET", `/repos/${this.repo}/commits/${p.head.sha}/statuses?per_page=100`);
      if (statuses.some((s) => s.context === context && s.target_url === targetUrl)) return { number: p.number, sha: p.head.sha, headRef: p.head.ref };
    }
    return null;
  }

  /** Squash-merges only if the head is still `sha`, so an unreviewed commit can never slip in. */
  mergePull(prNumber, sha) {
    return this.req("PUT", `/repos/${this.repo}/pulls/${prNumber}/merge`, { merge_method: "squash", sha });
  }

  async listOpenIssuesWithLabel(label) {
    const list = await this.req("GET", `/repos/${this.repo}/issues?state=open&labels=${encodeURIComponent(label)}&sort=created&direction=asc&per_page=100`);
    return list.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name) }));
  }
  async listIssueTitles() {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.req("GET", `/repos/${this.repo}/issues?state=all&per_page=100&page=${page}`);
      out.push(...batch.filter((i) => !i.pull_request).map((i) => i.title));
      if (batch.length < 100) break;
    }
    return out;
  }
  async createIssue({ title, body, labels }) {
    const i = await this.req("POST", `/repos/${this.repo}/issues`, { title, body, labels });
    return i.number;
  }
  /** GITHUB_TOKEN can't trigger workflows with labels, but repository_dispatch is allowed. */
  dispatch(type, payload) {
    return this.req("POST", `/repos/${this.repo}/dispatches`, { event_type: type, client_payload: payload });
  }

  async ensureLabels() {
    for (const [name, [color, description]] of Object.entries(LABEL_COLORS)) {
      const exists = await this.req("GET", `/repos/${this.repo}/labels/${encodeURIComponent(name)}`, null, { allow404: true });
      if (!exists) await this.req("POST", `/repos/${this.repo}/labels`, { name, color, description });
    }
  }
}

/** Executes the ops produced by effects.mjs against a client (real or fake). */
export async function execOps(gh, ops, log = console.log) {
  for (const o of ops) {
    log(`  ${o.op} ${o.target ?? o.pr ?? o.sha ?? ""} ${o.labels ? o.labels.join(",") : ""}`.trimEnd());
    switch (o.op) {
      case "addLabels":
        if (o.labels.length) await gh.addLabels(o.target, o.labels);
        break;
      case "removeLabels": {
        const current = (await gh.getIssue(o.target)).labels;
        for (const l of o.labels) if (current.includes(l)) await gh.removeLabel(o.target, l);
        break;
      }
      case "comment":
        await gh.createComment(o.target, o.body);
        break;
      case "upsertComment": {
        const mine = (await gh.listComments(o.target)).find((c) => c.isBot && c.body.startsWith(o.marker));
        if (mine) await gh.updateComment(mine.id, o.body);
        else await gh.createComment(o.target, o.body);
        break;
      }
      case "setStatus":
        await gh.setStatus(o.sha, o);
        break;
      case "merge": {
        let error = null;
        try {
          await gh.mergePull(o.pr, o.sha);
        } catch (e) {
          // Conflicts, a newer commit, or branch rules. Leave it to the human and say why.
          const msg = String(e.message);
          error = (msg.match(/"message":"([^"]+)"/)?.[1] ?? msg.replace(/^\w+ \S+ -> /, "")).slice(0, 160);
        }
        if (error === null) await execOps(gh, o.then ?? [], log);
        else await execOps(gh, (o.otherwise ?? []).map((x) => (x.body ? { ...x, body: x.body.replace("{error}", error) } : x)), log);
        break;
      }
      case "startNextQueued": {
        const [next] = await gh.listOpenIssuesWithLabel(LABELS.queued);
        if (next) await gh.dispatch("agent-start", { issue: next.number });
        break;
      }
      case "rerunFailed":
        if (o.runId) await gh.rerunFailedJobs(o.runId);
        break;
      default:
        throw new Error(`unknown op ${o.op}`);
    }
  }
}
