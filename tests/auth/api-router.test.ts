import assert from "node:assert/strict";
import test from "node:test";

import { dispatchApiRequest, matchApiRoute } from "../../api/[...path].js";

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
  assert.equal(matchApiRoute("/api/nodes/not-an-object-id"), null);
  assert.equal(matchApiRoute("/api/unknown"), null);
});

test("the consolidated Vercel function returns API-safe 404 and 405 responses", async () => {
  const missing = await dispatchApiRequest(new Request("https://openbucket.test/api/unknown"));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: { code: "NOT_FOUND", message: "API route not found." },
  });

  const wrongMethod = await dispatchApiRequest(new Request("https://openbucket.test/api/auth/login"));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assert.deepEqual(await wrongMethod.json(), {
    error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
  });
});

test("health remains available through the consolidated Vercel function", async () => {
  const response = await dispatchApiRequest(new Request("https://openbucket.test/api/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "openbucket-web" });
});
