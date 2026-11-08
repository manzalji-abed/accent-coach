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
    this.autoMerge = new Set();
    this.labelsCreated = false;
  }

  // ---- helpers the simulator uses to act like humans / git ----
  createIssue({ title, body = "", author = "me", labels = [] }) {
    const n = this.next++;
    this.items.set(n, { number: n, title, body, author, state: "open", labels: new Set(labels), isPr: false, comments: [] });
    return n;
  }
  openPr({ headRef, title = "Agent PR", sameRepo = true }) {
    const n = this.next++;
    this.items.set(n, { number: n, title, body: "", state: "open", labels: new Set(), isPr: true, comments: [], headRef, headSha: `sha-${n}-1`, merged: false, sameRepo, commits: 1 });
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
  async setStatus(sha, { state, context, description }) {
    this.statuses.push({ sha, state, context, description });
  }
  async rerunFailedJobs(runId) {
    this.reruns.push(runId);
  }
  async enableAutoMerge(pr) {
    if (this.autoMergeDisabled) throw new Error("Auto merge is not allowed for this repository");
    this.autoMerge.add(pr);
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
