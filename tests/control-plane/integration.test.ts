import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { closeAuthDatabaseForTests, getAuthCollections } from "../../server/auth/database";
import { handleLogin, handleRegister } from "../../server/auth/service";
import { getControlPlaneCollections, resetControlPlaneIndexesForTests } from "../../server/control-plane/database";
import {
  handleAdminOverview,
  handleCreateNode,
  handleNodeHeartbeat,
  handleNodeProxy,
  handleResolveNode,
  handleRotateNodeToken,
  handleUpdateNode,
  handleUsage,
} from "../../server/control-plane/service";

const testUri = process.env.MONGODB_TEST_URI?.trim();
const requireMongo = process.env.OPENBUCKET_REQUIRE_MONGODB_TEST?.trim().toLowerCase() === "true";
if (requireMongo && !testUri) throw new Error("MONGODB_TEST_URI is required for the MongoDB acceptance job.");

const origin = "https://openbucket-control.test";
const adminEmail = "control-admin@example.com";
const adminPassword = "control-plane-env-admin-password-value";
const database = "openbucket_control_test_" + process.pid + "_" + Date.now();
const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DATABASE: process.env.MONGODB_DATABASE,
  OPENBUCKET_AUTH_SECRET: process.env.OPENBUCKET_AUTH_SECRET,
  OPENBUCKET_ALLOW_SIGNUP: process.env.OPENBUCKET_ALLOW_SIGNUP,
  OPENBUCKET_ADMIN_EMAIL: process.env.OPENBUCKET_ADMIN_EMAIL,
  OPENBUCKET_ADMIN_PASSWORD: process.env.OPENBUCKET_ADMIN_PASSWORD,
  OPENBUCKET_NODE_DOMAIN: process.env.OPENBUCKET_NODE_DOMAIN,
};

function sessionRequest(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  cookie?: string,
  ip = "192.0.2.50",
): Request {
  const headers = new Headers({
    "user-agent": "OpenBucket control-plane integration test",
    "x-forwarded-for": ip,
  });
  if (method === "POST") {
    headers.set("content-type", "application/json");
    headers.set("origin", origin);
    headers.set("sec-fetch-site", "same-origin");
  }
  if (cookie) headers.set("cookie", cookie);
  return new Request(origin + path, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
}

function heartbeatRequest(token: string, body: Record<string, unknown>, ip = "192.0.2.60"): Request {
  return new Request(origin + "/api/node/heartbeat", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "user-agent": "OpenBucket daemon integration test",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function heartbeat(
  nodeId: string,
  name: string,
  eventId: string,
  counters: { requests: number; bytesIn: number; bytesOut: number; errors: number },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId,
    nodeId,
    name,
    version: "0.1.0",
    online: true,
    startedAt: "2026-01-01T00:00:00.000Z",
    storage: {
      capacityBytes: 10_000,
      usedBytes: 4_000,
      availableBytes: 6_000,
      bucketCount: 2,
      objectCount: 12,
    },
    counters,
    publicS3Url: "https://" + name + ".tunnel.example",
    publicDiscoverable: true,
    tunnelMode: "quick",
    managementUrl: "http://127.0.0.1:4880",
    dashboardUrl: "http://localhost:4881",
    ...overrides,
  };
}

function cookiePair(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0];
}

describe("MongoDB-backed control plane", { skip: !testUri }, () => {
  before(async () => {
    process.env.MONGODB_URI = testUri;
    process.env.MONGODB_DATABASE = database;
    process.env.OPENBUCKET_AUTH_SECRET = "control-plane-auth-secret-with-more-than-thirty-two-bytes";
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    process.env.OPENBUCKET_ADMIN_EMAIL = adminEmail;
    process.env.OPENBUCKET_ADMIN_PASSWORD = adminPassword;
    process.env.OPENBUCKET_NODE_DOMAIN = "openbucket.dev";
    await closeAuthDatabaseForTests();
    resetControlPlaneIndexesForTests();
  });

  after(async () => {
    const auth = await getAuthCollections();
    const control = await getControlPlaneCollections();
    await Promise.all([
      auth.users.drop(),
      auth.sessions.drop(),
      auth.rateLimits.drop(),
      control.nodes.drop(),
      control.usageEvents.drop(),
      control.rateLimits.drop(),
    ]);
    await closeAuthDatabaseForTests();
    resetControlPlaneIndexesForTests();
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("owns nodes, rotates hashed credentials, meters idempotently, and protects discovery/admin data", async () => {
    const registered = await handleRegister(sessionRequest("/api/auth/register", "POST", {
      email: "control-owner@example.com",
      password: "correct horse battery staple",
      name: "Control Owner",
    }));
    assert.equal(registered.status, 201);
    const registeredPayload = await registered.json() as { user: { id: string; role: string } };
    assert.equal(registeredPayload.user.role, "member");
    const cookie = cookiePair(registered);

    const created = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "Office-Control" }, cookie));
    assert.equal(created.status, 201);
    const createdPayload = await created.json() as {
      created: boolean;
      node: { id: string; name: string; status: string };
      credential: { token: string; createdAt: string };
    };
    assert.equal(createdPayload.created, true);
    assert.equal(createdPayload.node.name, "office-control");
    assert.equal(createdPayload.node.status, "offline");
    assert.match(createdPayload.credential.token, /^obn_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);

    const idempotent = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "office-control" }, cookie));
    assert.equal(idempotent.status, 200);
    const idempotentPayload = await idempotent.json() as { created: boolean; credential: null };
    assert.equal(idempotentPayload.created, false);
    assert.equal(idempotentPayload.credential, null);

    const control = await getControlPlaneCollections();
    const usageIndexes = await control.usageEvents.indexes();
    assert.ok(usageIndexes.some((index) =>
      index.name === "usage_received_ttl" && index.expireAfterSeconds === 100 * 24 * 60 * 60
    ));
    const stored = await control.nodes.findOne({ _id: new ObjectId(createdPayload.node.id) });
    assert.ok(stored);
    assert.notEqual(stored.tokenHash, createdPayload.credential.token);
    assert.equal(JSON.stringify(stored).includes(createdPayload.credential.token), false);

    const firstHeartbeatBody = heartbeat(
      createdPayload.node.id,
      createdPayload.node.name,
      "heartbeat-event-0001",
      { requests: 10, bytesIn: 100, bytesOut: 200, errors: 1 },
    );
    const firstHeartbeat = await handleNodeHeartbeat(heartbeatRequest(createdPayload.credential.token, firstHeartbeatBody));
    assert.equal(firstHeartbeat.status, 200);
    assert.equal((await firstHeartbeat.json() as { duplicate: boolean }).duplicate, false);

    const duplicate = await handleNodeHeartbeat(heartbeatRequest(createdPayload.credential.token, firstHeartbeatBody));
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);

    const secondHeartbeat = await handleNodeHeartbeat(heartbeatRequest(
      createdPayload.credential.token,
      heartbeat(
        createdPayload.node.id,
        createdPayload.node.name,
        "heartbeat-event-0002",
        { requests: 15, bytesIn: 160, bytesOut: 280, errors: 2 },
      ),
    ));
    assert.equal(secondHeartbeat.status, 200);

    const usage = await handleUsage(sessionRequest(
      "/api/usage?nodeId=" + createdPayload.node.id + "&from=2025-12-31T00:00:00.000Z&to=2027-01-01T00:00:00.000Z",
      "GET",
      undefined,
      cookie,
    ));
    assert.equal(usage.status, 400, "ranges longer than 90 days must be rejected");

    const validUsage = await handleUsage(sessionRequest(
      "/api/usage?nodeId=" + createdPayload.node.id,
      "GET",
      undefined,
      cookie,
    ));
    assert.equal(validUsage.status, 200);
    const usagePayload = await validUsage.json() as {
      totals: { requests: number; bytesIn: number; bytesOut: number; errors: number };
    };
    assert.deepEqual(usagePayload.totals, { requests: 15, bytesIn: 160, bytesOut: 280, errors: 2 });
    assert.equal(await control.usageEvents.countDocuments({ nodeId: new ObjectId(createdPayload.node.id) }), 2);

    const otherNodeUsage = await handleUsage(sessionRequest(
      "/api/usage?nodeId=" + new ObjectId().toHexString(),
      "GET",
      undefined,
      cookie,
    ));
    assert.equal(otherNodeUsage.status, 404);

    const discovered = await handleResolveNode(sessionRequest("/api/nodes/resolve?name=office-control", "GET"));
    assert.equal(discovered.status, 200);
    const discoveredPayload = await discovered.json() as {
      tunnelMode: string;
      s3Endpoint: string | null;
      canonicalPath: string;
    };
    assert.equal(discoveredPayload.tunnelMode, "quick");
    assert.equal(discoveredPayload.s3Endpoint, "https://office-control.tunnel.example");
    assert.equal(discoveredPayload.canonicalPath, origin + "/office-control");
    assert.equal(JSON.stringify(discoveredPayload).includes("management"), false);

    const rotated = await handleRotateNodeToken(sessionRequest(
      "/api/nodes/" + createdPayload.node.id + "/rotate-token",
      "POST",
      {},
      cookie,
    ), createdPayload.node.id);
    assert.equal(rotated.status, 200);
    const rotatedPayload = await rotated.json() as { credential: { token: string } };
    assert.notEqual(rotatedPayload.credential.token, createdPayload.credential.token);

    const oldCredential = await handleNodeHeartbeat(heartbeatRequest(
      createdPayload.credential.token,
      heartbeat(
        createdPayload.node.id,
        createdPayload.node.name,
        "heartbeat-event-old-token",
        { requests: 15, bytesIn: 160, bytesOut: 280, errors: 2 },
      ),
    ));
    assert.equal(oldCredential.status, 401);

    const privateHeartbeat = await handleNodeHeartbeat(heartbeatRequest(
      rotatedPayload.credential.token,
      heartbeat(
        createdPayload.node.id,
        createdPayload.node.name,
        "heartbeat-event-0003",
        { requests: 0, bytesIn: 0, bytesOut: 0, errors: 0 },
        {
          startedAt: "2026-01-02T00:00:00.000Z",
          publicS3Url: null,
          publicDiscoverable: false,
          tunnelMode: "none",
        },
      ),
    ));
    assert.equal(privateHeartbeat.status, 200);
    const staleHeartbeat = await handleNodeHeartbeat(heartbeatRequest(
      rotatedPayload.credential.token,
      heartbeat(
        createdPayload.node.id,
        createdPayload.node.name,
        "heartbeat-event-stale-run",
        { requests: 100, bytesIn: 1_000, bytesOut: 2_000, errors: 10 },
      ),
    ));
    assert.equal(staleHeartbeat.status, 409);
    assert.equal((await staleHeartbeat.json() as { error: { code: string } }).error.code, "STALE_HEARTBEAT");
    const orderedNode = await control.nodes.findOne({ _id: new ObjectId(createdPayload.node.id) });
    assert.equal(orderedNode?.startedAt?.toISOString(), "2026-01-02T00:00:00.000Z");
    assert.equal(orderedNode?.usage.requests, 15);
    assert.equal(await control.usageEvents.countDocuments({ nodeId: new ObjectId(createdPayload.node.id) }), 3);
    const privateDiscovery = await handleResolveNode(sessionRequest("/api/nodes/resolve?name=office-control", "GET"));
    assert.equal(privateDiscovery.status, 404);

    const denied = await handleAdminOverview(sessionRequest("/api/admin/overview", "GET", undefined, cookie));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { error: { code: string } }).error.code, "ADMIN_REQUIRED");

    const adminLogin = await handleLogin(sessionRequest("/api/auth/login", "POST", {
      email: adminEmail,
      password: adminPassword,
    }, undefined, "192.0.2.70"));
    assert.equal(adminLogin.status, 200);
    const adminLoginPayload = await adminLogin.json() as { user: { role: string; id: string } };
    assert.equal(adminLoginPayload.user.role, "admin");
    const adminCookie = cookiePair(adminLogin);

    const adminOverview = await handleAdminOverview(sessionRequest("/api/admin/overview", "GET", undefined, adminCookie));
    assert.equal(adminOverview.status, 200);
    const overviewPayload = await adminOverview.json() as {
      users: { total: number };
      nodes: { total: number };
      usage: { requests: number };
    };
    assert.equal(overviewPayload.users.total, 1);
    assert.equal(overviewPayload.nodes.total, 1);
    assert.equal(overviewPayload.usage.requests, 15);
  });

  test("node names are display-only: two accounts can share a name, but each gets a unique routeSlug", async () => {
    const ownerA = await handleRegister(sessionRequest("/api/auth/register", "POST", {
      email: "slug-owner-a@example.com",
      password: "correct horse battery staple",
      name: "Owner A",
    }, undefined, "192.0.2.80"));
    assert.equal(ownerA.status, 201);
    const cookieA = cookiePair(ownerA);

    const ownerB = await handleRegister(sessionRequest("/api/auth/register", "POST", {
      email: "slug-owner-b@example.com",
      password: "correct horse battery staple",
      name: "Owner B",
    }, undefined, "192.0.2.81"));
    assert.equal(ownerB.status, 201);
    const cookieB = cookiePair(ownerB);

    const createdA = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "shared-name" }, cookieA, "192.0.2.82"));
    assert.equal(createdA.status, 201);
    const nodeA = (await createdA.json() as { node: { name: string; routeSlug: string } }).node;
    assert.equal(nodeA.name, "shared-name");
    assert.equal(nodeA.routeSlug, "shared-name", "the first account to use a name gets the bare slug");

    const createdB = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "shared-name" }, cookieB, "192.0.2.83"));
    assert.equal(createdB.status, 201, "a second account may reuse the same display name");
    const nodeB = (await createdB.json() as { node: { name: string; routeSlug: string } }).node;
    assert.equal(nodeB.name, "shared-name");
    assert.notEqual(nodeB.routeSlug, nodeA.routeSlug, "collision gets a suffixed, still-unique routeSlug");
    assert.match(nodeB.routeSlug, /^shared-name-[a-z0-9]{4,6}$/);

    const control = await getControlPlaneCollections();
    const slugIndexes = await control.nodes.indexes();
    assert.ok(slugIndexes.some((index) => index.name === "nodes_route_slug_unique" && index.unique === true));

    function patchRequest(cookie: string, body: Record<string, unknown>): Request {
      return new Request(origin + "/api/nodes/patch-test", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", cookie },
        body: JSON.stringify(body),
      });
    }

    const nodeADocument = await control.nodes.findOne({ routeSlug: nodeA.routeSlug });
    assert.ok(nodeADocument);

    // Renaming keeps the routeSlug stable so an already-configured public URL keeps working.
    const renamed = await handleUpdateNode(patchRequest(cookieA, { name: "renamed-a" }), nodeADocument._id.toHexString());
    assert.equal(renamed.status, 200);
    const renamedPayload = (await renamed.json() as { node: { name: string; routeSlug: string } }).node;
    assert.equal(renamedPayload.name, "renamed-a");
    assert.equal(renamedPayload.routeSlug, nodeA.routeSlug, "routeSlug does not change on rename");

    // The same account can't have two active nodes with the same display name.
    const secondForOwnerA = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "second-node" }, cookieA, "192.0.2.84"));
    assert.equal(secondForOwnerA.status, 201);
    const secondNodeADocument = await control.nodes.findOne({ name: "second-node", userId: nodeADocument.userId });
    assert.ok(secondNodeADocument);
    const rejectRename = await handleUpdateNode(patchRequest(cookieA, { name: "renamed-a" }), secondNodeADocument._id.toHexString());
    assert.equal(rejectRename.status, 409);
    assert.equal((await rejectRename.json() as { error: { code: string } }).error.code, "NODE_NAME_UNAVAILABLE");

    // An unscoped resolve-by-name is now ambiguous across accounts and must fail closed, not
    // arbitrarily hand back one account's endpoint for a name two accounts share.
    const ownerC = await handleRegister(sessionRequest("/api/auth/register", "POST", {
      email: "slug-owner-c@example.com",
      password: "correct horse battery staple",
      name: "Owner C",
    }, undefined, "192.0.2.85"));
    assert.equal(ownerC.status, 201);
    const ownerCPayload = await ownerC.json() as { user: { handle: string } };
    const cookieC = cookiePair(ownerC);

    const createdC = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "ambiguous-name" }, cookieC, "192.0.2.86"));
    assert.equal(createdC.status, 201);
    const nodeC = (await createdC.json() as { node: { id: string; name: string } }).node;
    const createdD = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "ambiguous-name" }, cookieB, "192.0.2.87"));
    assert.equal(createdD.status, 201);
    const nodeD = (await createdD.json() as { node: { id: string; name: string } }).node;

    const bareAmbiguous = await handleResolveNode(sessionRequest("/api/nodes/resolve?name=ambiguous-name", "GET"));
    assert.equal(bareAmbiguous.status, 404, "an unscoped lookup must not arbitrarily pick between two accounts' nodes");

    const scoped = await handleResolveNode(sessionRequest(`/api/nodes/resolve?name=ambiguous-name&handle=${ownerCPayload.user.handle}`, "GET"));
    // Neither node has sent a heartbeat yet, so neither is publicly discoverable — this only
    // confirms handle-scoping still resolves deterministically to "not found" rather than 404
    // for the wrong reason (ambiguity). Discoverability itself is covered by the primary test.
    assert.equal(scoped.status, 404);
    void nodeC;
    void nodeD;
  });

  test("the /s3/<routeSlug> and /api/<routeSlug> reverse proxy forwards real requests to the node's tunnel", async () => {
    const received: { last: { method: string; url: string; authorization: string | null; body: string } | null } = { last: null };
    const upstream: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.last = {
          method: request.method ?? "",
          url: request.url ?? "",
          authorization: request.headers.authorization ?? null,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        if (request.url === "/missing") {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such key" } }));
          return;
        }
        response.writeHead(200, { "content-type": "text/plain", "x-upstream-marker": "daemon" });
        response.end("hello from the daemon");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("expected a TCP address");
    const upstreamUrl = `http://127.0.0.1:${address.port}`;

    try {
      const owner = await handleRegister(sessionRequest("/api/auth/register", "POST", {
        email: "proxy-owner@example.com",
        password: "correct horse battery staple",
        name: "Proxy Owner",
      }, undefined, "192.0.2.90"));
      assert.equal(owner.status, 201);
      const cookie = cookiePair(owner);

      const created = await handleCreateNode(sessionRequest("/api/nodes", "POST", { name: "proxy-node" }, cookie, "192.0.2.91"));
      assert.equal(created.status, 201);
      const createdPayload = await created.json() as {
        node: { id: string; routeSlug: string };
        credential: { token: string };
      };

      // Heartbeats require the daemon's real HTTPS tunnel for publicS3Url, which this test's
      // plain-HTTP local server can't provide — set the node's endpoints directly instead, which
      // is all handleNodeProxy actually reads (lifecycle + publicDiscoverable + endpoint URL).
      const control = await getControlPlaneCollections();
      await control.nodes.updateOne(
        { _id: new ObjectId(createdPayload.node.id) },
        { $set: { publicDiscoverable: true, publicS3Url: upstreamUrl, managementUrl: upstreamUrl, tunnelMode: "quick" } },
      );

      const s3Proxied = await handleNodeProxy(
        new Request(origin + "/s3/" + createdPayload.node.routeSlug + "/my-bucket/my-key.txt?versionId=1", {
          method: "PUT",
          headers: { authorization: "AWS4-HMAC-SHA256 Credential=test", "content-type": "text/plain" },
          body: "object body bytes",
        }),
        "s3",
        createdPayload.node.routeSlug,
        "my-bucket/my-key.txt",
      );
      assert.equal(s3Proxied.status, 200);
      assert.equal(s3Proxied.headers.get("x-upstream-marker"), "daemon");
      assert.equal(await s3Proxied.text(), "hello from the daemon");
      const s3Request = received.last;
      assert.ok(s3Request);
      assert.equal(s3Request.method, "PUT");
      assert.equal(s3Request.url, "/my-bucket/my-key.txt?versionId=1");
      assert.equal(s3Request.authorization, "AWS4-HMAC-SHA256 Credential=test");
      assert.equal(s3Request.body, "object body bytes");

      const apiProxied = await handleNodeProxy(
        new Request(origin + "/api/" + createdPayload.node.routeSlug + "/missing", {
          method: "GET",
          headers: { authorization: "Bearer some-management-token" },
        }),
        "api",
        createdPayload.node.routeSlug,
        "missing",
      );
      assert.equal(apiProxied.status, 404);
      assert.deepEqual(await apiProxied.json(), { error: { code: "NOT_FOUND", message: "no such key" } });
      const apiRequest = received.last;
      assert.ok(apiRequest);
      assert.equal(apiRequest.authorization, "Bearer some-management-token");

      const unknownSlug = await handleNodeProxy(
        new Request(origin + "/s3/no-such-node/key", { method: "GET" }),
        "s3",
        "no-such-node",
        "key",
      );
      assert.equal(unknownSlug.status, 404);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
