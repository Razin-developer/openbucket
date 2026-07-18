import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { ApiError } from "../../server/auth/http";
import type { NodeDocument } from "../../server/control-plane/database";
import {
  calculateUsageDelta,
  nodeStatus,
  normalizeNodeName,
  toPublicDiscovery,
  validateHeartbeatPayload,
} from "../../server/control-plane/model";

function heartbeat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "heartbeat-0001",
    nodeId: new ObjectId().toHexString(),
    name: "office-node",
    version: "0.1.0",
    online: true,
    startedAt: "2026-01-01T00:00:00.000Z",
    storage: {
      capacityBytes: 1_000,
      usedBytes: 400,
      availableBytes: 600,
      bucketCount: 2,
      objectCount: 10,
    },
    counters: { requests: 8, bytesIn: 100, bytesOut: 200, errors: 1 },
    publicS3Url: "https://office-node.tunnel.example",
    publicDiscoverable: true,
    tunnelMode: "quick",
    managementUrl: "http://127.0.0.1:4880",
    dashboardUrl: "http://localhost:4881",
    ...overrides,
  };
}

function node(overrides: Partial<NodeDocument> = {}): NodeDocument {
  const now = new Date();
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "office-node",
    lifecycle: "active",
    tokenHash: "a".repeat(64),
    credentialVersion: 1,
    tokenCreatedAt: now,
    tokenRevokedAt: null,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    reportedOnline: true,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    version: "0.1.0",
    storage: {
      capacityBytes: 1_000,
      usedBytes: 400,
      availableBytes: 600,
      bucketCount: 2,
      objectCount: 10,
    },
    counters: { requests: 8, bytesIn: 100, bytesOut: 200, errors: 1 },
    usage: { requests: 8, bytesIn: 100, bytesOut: 200, errors: 1 },
    publicS3Url: "https://office-node.tunnel.example/",
    publicDiscoverable: true,
    tunnelMode: "quick",
    managementUrl: "http://127.0.0.1:4880/",
    dashboardUrl: "http://localhost:4881/",
    ...overrides,
  };
}

describe("control-plane input model", () => {
  test("normalizes DNS-safe node names and blocks reserved or ambiguous labels", () => {
    assert.equal(normalizeNodeName("  Office-Node  "), "office-node");
    for (const invalid of ["api", "-office", "office-", "of", "office--node", "office.node"]) {
      assert.throws(
        () => normalizeNodeName(invalid),
        (error: unknown) => error instanceof ApiError && error.code === "INVALID_NODE_NAME",
      );
    }
  });

  test("validates bounded heartbeat metrics and explicit public discovery", () => {
    const parsed = validateHeartbeatPayload(heartbeat());
    assert.equal(parsed.publicDiscoverable, true);
    assert.equal(parsed.publicS3Url, "https://office-node.tunnel.example");
    assert.equal(parsed.managementUrl, "http://127.0.0.1:4880");
    assert.equal(parsed.dashboardUrl, "http://localhost:4881");
    assert.equal(parsed.storage.usedBytes, 400);

    assert.throws(
      () => validateHeartbeatPayload(heartbeat({ unexpected: true })),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_REQUEST",
    );
    assert.throws(
      () => validateHeartbeatPayload(heartbeat({ publicS3Url: "http://example.com" })),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_ENDPOINT",
    );
    assert.throws(
      () => validateHeartbeatPayload(heartbeat({ dashboardUrl: "https://dashboard.example/?token=secret" })),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_ENDPOINT",
    );
    assert.throws(
      () => validateHeartbeatPayload(heartbeat({ publicS3Url: null, publicDiscoverable: true })),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_ENDPOINT",
    );
    assert.throws(
      () => validateHeartbeatPayload(heartbeat({
        storage: { capacityBytes: 100, usedBytes: 101, availableBytes: 0, bucketCount: 0, objectCount: 0 },
      })),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_METRICS",
    );
  });

  test("derives usage deltas from monotonic daemon counters and resets on a new run", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    assert.deepEqual(
      calculateUsageDelta(
        startedAt,
        { requests: 8, bytesIn: 100, bytesOut: 200, errors: 1 },
        startedAt,
        { requests: 10, bytesIn: 140, bytesOut: 260, errors: 2 },
      ),
      { requests: 2, bytesIn: 40, bytesOut: 60, errors: 1 },
    );
    assert.deepEqual(
      calculateUsageDelta(
        startedAt,
        { requests: 8, bytesIn: 100, bytesOut: 200, errors: 1 },
        new Date("2026-01-02T00:00:00.000Z"),
        { requests: 2, bytesIn: 12, bytesOut: 20, errors: 0 },
      ),
      { requests: 2, bytesIn: 12, bytesOut: 20, errors: 0 },
    );
    assert.throws(
      () => calculateUsageDelta(
        new Date("2026-01-02T00:00:00.000Z"),
        { requests: 2, bytesIn: 12, bytesOut: 20, errors: 0 },
        startedAt,
        { requests: 20, bytesIn: 200, bytesOut: 300, errors: 1 },
      ),
      (error: unknown) => error instanceof ApiError && error.code === "STALE_HEARTBEAT",
    );
    assert.throws(
      () => calculateUsageDelta(
        startedAt,
        { requests: 8, bytesIn: 100, bytesOut: 200, errors: 1 },
        startedAt,
        { requests: 7, bytesIn: 100, bytesOut: 200, errors: 1 },
      ),
      (error: unknown) => error instanceof ApiError && error.code === "STALE_HEARTBEAT",
    );
  });

  test("computes presence server-side and redacts private or offline tunnel endpoints", () => {
    const online = node();
    assert.equal(nodeStatus(online, online.lastSeenAt!.getTime() + 10_000), "online");
    const publicView = toPublicDiscovery(online, "https://openbucket.example", online.lastSeenAt!.getTime() + 10_000);
    assert.equal(publicView.s3Endpoint, "https://office-node.tunnel.example/");
    assert.equal(publicView.canonicalPath, "https://openbucket.example/office-node");

    const privateNode = node({ publicDiscoverable: false });
    assert.equal(toPublicDiscovery(privateNode, "https://openbucket.example").s3Endpoint, null);
    const offlineNode = node({ lastSeenAt: new Date(Date.now() - 120_000) });
    assert.equal(toPublicDiscovery(offlineNode, "https://openbucket.example").s3Endpoint, null);
  });
});
