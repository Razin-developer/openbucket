import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { closeAuthDatabaseForTests, getAuthCollections } from "../../server/auth/database";
import { handleRegister } from "../../server/auth/service";
import { getControlPlaneCollections, resetControlPlaneIndexesForTests } from "../../server/control-plane/database";
import {
  handleAdminOverview,
  handleCreateNode,
  handleNodeHeartbeat,
  handleResolveNode,
  handleRotateNodeToken,
  handleUsage,
} from "../../server/control-plane/service";

const testUri = process.env.MONGODB_TEST_URI?.trim();
const requireMongo = process.env.OPENBUCKET_REQUIRE_MONGODB_TEST?.trim().toLowerCase() === "true";
if (requireMongo && !testUri) throw new Error("MONGODB_TEST_URI is required for the MongoDB acceptance job.");

const origin = "https://openbucket-control.test";
const signupToken = "control-plane-owner-bootstrap-token-more-than-thirty-two-bytes";
const database = "openbucket_control_test_" + process.pid + "_" + Date.now();
const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DATABASE: process.env.MONGODB_DATABASE,
  OPENBUCKET_AUTH_SECRET: process.env.OPENBUCKET_AUTH_SECRET,
  OPENBUCKET_SIGNUP_TOKEN: process.env.OPENBUCKET_SIGNUP_TOKEN,
  OPENBUCKET_ALLOW_SIGNUP: process.env.OPENBUCKET_ALLOW_SIGNUP,
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
    process.env.OPENBUCKET_SIGNUP_TOKEN = signupToken;
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
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
      auth.authControls.drop(),
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
      signupToken,
    }));
    assert.equal(registered.status, 201);
    const registeredPayload = await registered.json() as { user: { id: string; role: string } };
    assert.equal(registeredPayload.user.role, "admin");
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

    const adminOverview = await handleAdminOverview(sessionRequest("/api/admin/overview", "GET", undefined, cookie));
    assert.equal(adminOverview.status, 200);
    const overviewPayload = await adminOverview.json() as {
      users: { total: number };
      nodes: { total: number };
      usage: { requests: number };
    };
    assert.equal(overviewPayload.users.total, 1);
    assert.equal(overviewPayload.nodes.total, 1);
    assert.equal(overviewPayload.usage.requests, 15);

    const { users } = await getAuthCollections();
    await users.updateOne({ _id: new ObjectId(registeredPayload.user.id) }, { $set: { role: "member" } });
    const denied = await handleAdminOverview(sessionRequest("/api/admin/overview", "GET", undefined, cookie));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { error: { code: string } }).error.code, "ADMIN_REQUIRED");
  });
});
