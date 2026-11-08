import http from "node:http";
import { FakeGitHub } from "./fake-github.mjs";

/**
 * Serves FakeGitHub over HTTP in GitHub's REST shapes, so run.mjs and the real
 * GitHub client can be exercised end to end without touching github.com.
 */
export function startMockApi(fake = new FakeGitHub()) {
  const issueJson = (i) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    state: i.state,
    labels: [...i.labels].map((name) => ({ name })),
    ...(i.isPr ? { pull_request: {} } : {}),
  });
  const commentJson = (c) => ({
    id: c.id,
    body: c.body,
    created_at: c.createdAt,
    user: { login: c.author, type: c.type },
    author_association: c.type === "Bot" ? "NONE" : fake.writers.has(c.author) ? "OWNER" : "NONE",
  });
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : null;
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(`/repos/${fake.repo}`, "");
    calls.push(`${req.method} ${p}`);
    const send = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };
    if (req.headers.authorization !== "Bearer test-token") return send(401, { message: "Bad credentials" });
    let m;
    try {
      if (req.method === "GET" && (m = p.match(/^\/issues\/(\d+)$/))) return send(200, issueJson(fake.items.get(+m[1])));
      if (req.method === "GET" && (m = p.match(/^\/pulls\/(\d+)$/))) {
        const pr = fake.items.get(+m[1]);
        return send(200, { number: pr.number, node_id: `PR_${pr.number}`, state: pr.state, merged: pr.merged, labels: [...pr.labels].map((name) => ({ name })), head: { ref: pr.headRef, sha: pr.headSha, repo: { full_name: pr.sameRepo ? fake.repo : "someone/fork" } } });
      }
      if (req.method === "GET" && p === "/pulls") {
        const head = url.searchParams.get("head");
        if (!head) return send(200, [...fake.items.values()].filter((it) => it.isPr && it.state === "open").map((it) => ({ number: it.number, head: { ref: it.headRef, sha: it.headSha } })));
        const n = await fake.findOpenPrForBranch(head.split(":")[1]);
        return send(200, n ? [{ number: n }] : []);
      }
      if (req.method === "GET" && (m = p.match(/^\/commits\/([^/]+)\/statuses$/))) {
        return send(200, fake.statuses.filter((s) => s.sha === m[1]).reverse().map((s) => ({ context: s.context, state: s.state, target_url: s.url })));
      }
      if (req.method === "PUT" && (m = p.match(/^\/pulls\/(\d+)\/merge$/))) {
        try {
          await fake.mergePull(+m[1], data.sha);
          return send(200, { merged: true });
        } catch (e) {
          return send(+(e.message.match(/-> (\d+)/)?.[1] ?? 405), { message: e.message.match(/"message":"([^"]+)"/)?.[1] ?? e.message });
        }
      }
      if (req.method === "GET" && p === "/issues") {
        const label = url.searchParams.get("labels");
        return send(200, [...fake.items.values()].filter((it) => it.state === "open" && (!label || it.labels.has(label))).map(issueJson));
      }
      if (req.method === "GET" && (m = p.match(/^\/issues\/(\d+)\/comments$/))) {
        const page = +(url.searchParams.get("page") ?? 1);
        return send(200, page === 1 ? fake.items.get(+m[1]).comments.map(commentJson) : []);
      }
      if (req.method === "GET" && (m = p.match(/^\/collaborators\/([^/]+)\/permission$/))) {
        return fake.writers.has(decodeURIComponent(m[1])) ? send(200, { permission: "admin" }) : send(404, { message: "Not Found" });
      }
      if (req.method === "POST" && (m = p.match(/^\/issues\/(\d+)\/labels$/))) return send(200, await fake.addLabels(+m[1], data.labels));
      if (req.method === "DELETE" && (m = p.match(/^\/issues\/(\d+)\/labels\/(.+)$/))) return send(200, await fake.removeLabel(+m[1], decodeURIComponent(m[2])));
      if (req.method === "POST" && (m = p.match(/^\/issues\/(\d+)\/comments$/))) return send(201, await fake.createComment(+m[1], data.body));
      if (req.method === "PATCH" && (m = p.match(/^\/issues\/comments\/(\d+)$/))) return send(200, await fake.updateComment(+m[1], data.body));
      if (req.method === "GET" && p.startsWith("/labels/")) return fake.labelsCreated ? send(200, {}) : send(404, {});
      if (req.method === "POST" && p === "/labels") return send(201, {});
      if (req.method === "POST" && (m = p.match(/^\/statuses\/(.+)$/))) return send(201, await fake.setStatus(m[1], { ...data, url: data.target_url }));
      if (req.method === "POST" && p === "/dispatches") return send(204, await fake.dispatch(data.event_type, data.client_payload));
      return send(404, { message: `mock has no route for ${req.method} ${p}` });
    } catch (e) {
      return send(500, { message: e.message });
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ fake, calls, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
