import { issueFromBranch } from "../config.mjs";

/**
 * In-memory GitHub with the same methods as ../github.mjs. Records every
 * write so scenarios can assert on comments, labels and statuses.
 */
export class FakeGitHub {
  constructor({ repo = "me/accent-coach", writers = ["me"] } = {}) {
    this.repo = repo;
    this.writers = new Set(writers);
    this.items = new Map(); // issues and PRs share numbers, like GitHub
    this.next = 1;
    this.nextCommentId = 1;
    this.statuses = [];
    this.reruns = [];
    this.apiMerges = []; // PRs merged by the pipeline through the API
    this.mergeRefusal = null; // set to a message to make merges fail, like GitHub would
    this.labelsCreated = false;
  }

  // ---- helpers the simulator uses to act like humans / git ----
  createIssue({ title, body = "", author = "me", labels = [] }) {
    const n = this.next++;
    this.items.set(n, { number: n, title, body, author, state: "open", labels: new Set(labels), isPr: false, comments: [] });
    return n;
  }
  openPr({ headRef, title = "Agent PR", sameRepo = true, files = this.defaultPrFiles ?? ["components/Example.tsx"] }) {
    const n = this.next++;
    this.items.set(n, { number: n, title, body: "", state: "open", labels: new Set(), isPr: true, comments: [], headRef, headSha: `sha-${n}-1`, merged: false, sameRepo, commits: 1, files });
    return n;
  }
  pushCommit(pr) {
    const p = this.items.get(pr);
    p.commits++;
    p.headSha = `sha-${pr}-${p.commits}`;
    return p.headSha;
  }
  humanComment(n, author, body) {
    const c = { id: this.nextCommentId++, author, type: "User", body, createdAt: new Date(Date.now() + this.nextCommentId).toISOString() };
    this.items.get(n).comments.push(c);
    return c;
  }
  close(n, { merged = false } = {}) {
    const it = this.items.get(n);
    it.state = "closed";
    it.merged = merged;
  }
  labels(n) {
    return [...this.items.get(n).labels].sort();
  }
  botComments(n) {
    return this.items.get(n).comments.filter((c) => c.type === "Bot").map((c) => c.body);
  }
  statusFor(sha, context) {
    return this.statuses.filter((s) => s.sha === sha && s.context === context).at(-1)?.state;
  }

  // ---- the GitHub client interface ----
  async getIssue(n) {
    const i = this.items.get(n);
    if (!i) throw new Error(`no issue ${n}`);
    return { number: n, state: i.state, title: i.title, body: i.body, labels: [...i.labels], isPr: i.isPr };
  }
  async getPull(n) {
    const p = this.items.get(n);
    if (!p?.isPr) throw new Error(`no PR ${n}`);
    return { number: n, state: p.state, merged: p.merged, headRef: p.headRef, headSha: p.headSha, labels: [...p.labels], sameRepo: p.sameRepo };
  }
  async findOpenPrForBranch(branch) {
    for (const it of this.items.values()) if (it.isPr && it.state === "open" && it.headRef === branch) return it.number;
    return null;
  }
  async listComments(n) {
    return this.items.get(n).comments.map((c) => ({
      id: c.id,
      author: c.author,
      isBot: c.type === "Bot",
      canWrite: c.type === "Bot" ? false : this.writers.has(c.author),
      body: c.body,
      createdAt: c.createdAt,
    }));
  }
  async canWrite(login) {
    return this.writers.has(login);
  }
  async addLabels(n, labels) {
    labels.forEach((l) => this.items.get(n).labels.add(l));
  }
  async removeLabel(n, label) {
    this.items.get(n).labels.delete(label);
  }
  async createComment(n, body) {
    this.items.get(n).comments.push({ id: this.nextCommentId++, author: "github-actions[bot]", type: "Bot", body, createdAt: new Date(Date.now() + this.nextCommentId).toISOString() });
  }
  async updateComment(id, body) {
    for (const it of this.items.values()) {
      const c = it.comments.find((x) => x.id === id);
      if (c) c.body = body;
    }
  }
  async setStatus(sha, { state, context, description, url }) {
    this.statuses.push({ sha, state, context, description, url });
  }
  async findPrByStatus(context, url) {
    for (const p of this.items.values()) {
      if (!p.isPr || p.state !== "open") continue;
      if (this.statuses.some((s) => s.sha === p.headSha && s.context === context && s.url === url)) return { number: p.number, sha: p.headSha, headRef: p.headRef };
    }
    return null;
  }
  async rerunFailedJobs(runId) {
    this.reruns.push(runId);
  }
  async listPrFiles(pr) {
    return [...(this.items.get(pr).files ?? [])];
  }
  /** Like PUT /pulls/:n/merge. Fires no workflow events: merges made with the Actions token don't. */
  async mergePull(pr, sha) {
    const p = this.items.get(pr);
    if (this.mergeRefusal) throw new Error(`PUT /pulls/${pr}/merge -> 405 {"message":"${this.mergeRefusal}"}`);
    if (p.state !== "open") throw new Error(`PUT /pulls/${pr}/merge -> 405 {"message":"Pull Request is not open"}`);
    if (sha && p.headSha !== sha) throw new Error(`PUT /pulls/${pr}/merge -> 409 {"message":"Head branch was modified. Review and try the merge again."}`);
    this.close(pr, { merged: true });
    this.apiMerges.push(pr);
    const issue = issueFromBranch(p.headRef);
    if (issue && this.items.get(issue)?.state === "open") this.close(issue); // "Closes #N"
  }
  async listOpenIssuesWithLabel(label) {
    return [...this.items.values()]
      .filter((i) => !i.isPr && i.state === "open" && i.labels.has(label))
      .map((i) => ({ number: i.number, title: i.title, labels: [...i.labels] }));
  }
  async listIssueTitles() {
    return [...this.items.values()].filter((i) => !i.isPr).map((i) => i.title);
  }
  async dispatch(type, payload) {
    this.onDispatch?.(type, payload);
  }
  async ensureLabels() {
    this.labelsCreated = true;
  }
}
