import assert from "node:assert/strict";
import test from "node:test";

import { dispatchApiRequest, matchApiRoute } from "../../api/router.js";

test("the consolidated Vercel function preserves every public API route", () => {
  const nodeId = "0123456789abcdef01234567";
  const cases = [
    ["/api/admin/overview", { id: "admin-overview" }],
    ["/api/auth/login", { id: "auth-login" }],
    ["/api/auth/logout", { id: "auth-logout" }],
    ["/api/auth/register", { id: "auth-register" }],
    ["/api/auth/session", { id: "auth-session" }],
    ["/api/health", { id: "health" }],
    ["/api/node/heartbeat", { id: "node-heartbeat" }],
    ["/api/nodes", { id: "nodes" }],
    ["/api/nodes/resolve", { id: "nodes-resolve" }],
    ["/api/usage", { id: "usage" }],
    [`/api/nodes/${nodeId}`, { id: "node", nodeId }],
    [`/api/nodes/${nodeId}/rotate-token`, { id: "node-rotate-token", nodeId }],
    [`/api/nodes/${nodeId}/revoke-token`, { id: "node-revoke-token", nodeId }],
  ] as const;

  for (const [path, expected] of cases) {
    assert.deepEqual(matchApiRoute(path), expected, path);
    assert.deepEqual(matchApiRoute(`${path}/`), expected, `${path}/`);
  }
  // Anything under /api/ that isn't one of the control plane's own known routes above is a node
  // proxy request keyed by routeSlug — RESERVED_NODE_NAMES keeps a real slug from ever colliding
  // with a name already claimed above, so falling through here is intentional, not ambiguous.
  assert.deepEqual(matchApiRoute("/api/nodes/not-an-object-id"), { id: "node-proxy", kind: "api", routeSlug: "nodes", subpath: "not-an-object-id" });
  assert.deepEqual(matchApiRoute("/api/unknown"), { id: "node-proxy", kind: "api", routeSlug: "unknown", subpath: "" });
});

test("openbucket.zydcode.in/s3/<routeSlug> and /api/<routeSlug> resolve to node-proxy requests", () => {
  assert.deepEqual(matchApiRoute("/s3/my-node"), { id: "node-proxy", kind: "s3", routeSlug: "my-node", subpath: "" });
  assert.deepEqual(matchApiRoute("/s3/my-node/bucket/key.txt"), { id: "node-proxy", kind: "s3", routeSlug: "my-node", subpath: "bucket/key.txt" });
  assert.deepEqual(matchApiRoute("/api/my-node/v1/buckets"), { id: "node-proxy", kind: "api", routeSlug: "my-node", subpath: "v1/buckets" });
  assert.equal(matchApiRoute("/s3"), null);
  assert.equal(matchApiRoute("/s3/"), null);
});

test("the consolidated Vercel function returns API-safe 404 and 405 responses", async () => {
  // An empty forwarded path (no route at all, distinct from an unrecognized routeSlug — see the
  // node-proxy fallback test above) is the one case guaranteed to short-circuit before touching
  // the database, so it's safe to assert against in this DB-less unit test.
  const missing = await dispatchApiRequest(
    new Request("https://openbucket.test/api/router?__openbucket_path="),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: { code: "NOT_FOUND", message: "API route not found." },
  });

  const wrongMethod = await dispatchApiRequest(
    new Request("https://openbucket.test/api/router?__openbucket_path=auth%2Flogin"),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assert.deepEqual(await wrongMethod.json(), {
    error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
  });
});

test("health remains available through the consolidated Vercel function", async () => {
  const response = await dispatchApiRequest(
    new Request("https://openbucket.test/api/router?__openbucket_path=health"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "openbucket-web" });
});
