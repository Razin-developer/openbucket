import { ObjectId } from "mongodb";
import { getAuthConfig } from "../auth/config.js";
import { createSessionToken, keyedHash } from "../auth/crypto.js";
import { getAuthCollections, getAuthDatabaseContext } from "../auth/database.js";
import {
  ApiError,
  assertMethod,
  assertSameOriginPost,
  errorResponse,
  jsonResponse,
  readJsonObject,
  requestIp,
} from "../auth/http.js";
import { authenticateRequest, type PublicUser } from "../auth/service.js";
import {
  getControlPlaneCollections,
  type ControlPlaneCollections,
  type NodeCounters,
  type NodeDocument,
  type NodeStorage,
  type UsageEventDocument,
} from "./database.js";
import {
  calculateUsageDelta,
  NODE_ONLINE_WINDOW_MS,
  nodeStatus,
  normalizeNodeName,
  toNodeView,
  toPublicDiscovery,
  validateHeartbeatPayload,
} from "./model.js";

const MAX_NODES_PER_USER = 100;
const USER_WRITE_WINDOW_MS = 60 * 60 * 1000;
const USER_WRITE_LIMIT = 60;
const HEARTBEAT_WINDOW_MS = 60 * 1000;
const HEARTBEAT_LIMIT = 180;
const DISCOVERY_WINDOW_MS = 60 * 1000;
const DISCOVERY_LIMIT = 120;
const MAX_USAGE_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const ZERO_COUNTERS: NodeCounters = Object.freeze({ requests: 0, bytesIn: 0, bytesOut: 0, errors: 0 });
const EMPTY_STORAGE: NodeStorage = Object.freeze({
  capacityBytes: null,
  usedBytes: 0,
  availableBytes: null,
  bucketCount: 0,
  objectCount: 0,
});

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown }).code === 11000;
}

function onlyFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_REQUEST", "Request contains unsupported fields.");
  }
}

function objectId(value: string, code = "INVALID_NODE_ID"): ObjectId {
  if (!/^[a-f0-9]{24}$/.test(value)) throw new ApiError(400, code, "Node id is invalid.");
  return new ObjectId(value);
}

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

async function requireUser(request: Request): Promise<PublicUser> {
  const user = await authenticateRequest(request);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  return user;
}

function assertSameOriginJson(request: Request, method: "PATCH" | "DELETE"): void {
  assertMethod(request, method);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  }
  const origin = request.headers.get("origin");
  let expected: string;
  let supplied: string;
  try {
    expected = new URL(request.url).origin;
    supplied = origin ? new URL(origin).origin : "";
  } catch {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }
  if (!origin || origin !== supplied || supplied !== expected) {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }
}

function assertNodeJsonPost(request: Request): void {
  assertMethod(request, "POST");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  }
}

async function consumeRateLimit(
  collections: ControlPlaneCollections,
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const { authSecret } = getAuthConfig();
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const bucketEnd = (bucket + 1) * windowMs;
  const id = scope + ":" + bucket + ":" + keyedHash(authSecret, "control-rate:" + scope, identifier);
  const result = await collections.rateLimits.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        createdAt: new Date(now),
        expiresAt: new Date(bucketEnd + windowMs),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) throw new Error("Unable to update control-plane rate limit.");
  if (result.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucketEnd - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later.", {
      "Retry-After": String(retryAfter),
    });
  }
}

function issueNodeCredential(nodeId: ObjectId): { token: string; tokenHash: string; createdAt: Date } {
  const token = "obn_" + nodeId.toHexString() + "_" + createSessionToken();
  return {
    token,
    tokenHash: keyedHash(getAuthConfig().authSecret, "node-credential", token),
    createdAt: new Date(),
  };
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (header.length > 256 || !header.startsWith("Bearer ")) {
    throw new ApiError(401, "INVALID_NODE_CREDENTIAL", "A valid node credential is required.", {
      "WWW-Authenticate": "Bearer",
    });
  }
  const token = header.slice(7);
  if (!/^obn_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError(401, "INVALID_NODE_CREDENTIAL", "A valid node credential is required.", {
      "WWW-Authenticate": "Bearer",
    });
  }
  return token;
}

async function authenticateNode(request: Request): Promise<{ node: NodeDocument; tokenHash: string }> {
  const token = bearerToken(request);
  const nodeId = objectId(token.slice(4, 28), "INVALID_NODE_CREDENTIAL");
  const tokenHash = keyedHash(getAuthConfig().authSecret, "node-credential", token);
  const { nodes } = await getControlPlaneCollections();
  const node = await nodes.findOne({ _id: nodeId, lifecycle: "active", tokenHash });
  if (!node) {
    throw new ApiError(401, "INVALID_NODE_CREDENTIAL", "A valid node credential is required.", {
      "WWW-Authenticate": "Bearer",
    });
  }
  return { node, tokenHash };
}

function initialNode(userId: ObjectId, name: string, credential: ReturnType<typeof issueNodeCredential>): NodeDocument {
  const now = credential.createdAt;
  return {
    _id: objectId(credential.token.slice(4, 28)),
    userId,
    name,
    lifecycle: "active",
    tokenHash: credential.tokenHash,
    credentialVersion: 1,
    tokenCreatedAt: now,
    tokenRevokedAt: null,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: null,
    reportedOnline: false,
    startedAt: null,
    version: null,
    storage: { ...EMPTY_STORAGE },
    counters: { ...ZERO_COUNTERS },
    usage: { ...ZERO_COUNTERS },
    publicS3Url: null,
    tunnelMode: "none",
    publicDiscoverable: false,
    managementUrl: null,
    dashboardUrl: null,
  };
}

async function ownedNode(userId: ObjectId, id: string): Promise<NodeDocument> {
  const { nodes } = await getControlPlaneCollections();
  const node = await nodes.findOne({ _id: objectId(id), userId, lifecycle: { $ne: "deleted" } });
  if (!node) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
  return node;
}

export async function handleListNodes(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    const user = await requireUser(request);
    const { nodes } = await getControlPlaneCollections();
    const documents = await nodes.find(
      { userId: objectId(user.id), lifecycle: { $ne: "deleted" } },
      { sort: { createdAt: -1 }, limit: MAX_NODES_PER_USER },
    ).toArray();
    const origin = requestOrigin(request);
    const now = Date.now();
    return jsonResponse({ nodes: documents.map((node) => toNodeView(node, origin, now)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCreateNode(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const user = await requireUser(request);
    const body = await readJsonObject(request);
    onlyFields(body, ["name"]);
    const name = normalizeNodeName(body.name);
    const userId = objectId(user.id);
    const collections = await getControlPlaneCollections();
    await consumeRateLimit(collections, "user-write", user.id, USER_WRITE_LIMIT, USER_WRITE_WINDOW_MS);

    const existing = await collections.nodes.findOne({ name });
    if (existing) {
      if (existing.userId.equals(userId) && existing.lifecycle !== "deleted") {
        return jsonResponse({
          created: false,
          node: toNodeView(existing, requestOrigin(request)),
          credential: null,
        });
      }
      throw new ApiError(409, "NODE_NAME_UNAVAILABLE", "Node name is unavailable.");
    }

    const count = await collections.nodes.countDocuments({ userId, lifecycle: { $ne: "deleted" } }, { limit: MAX_NODES_PER_USER });
    if (count >= MAX_NODES_PER_USER) {
      throw new ApiError(409, "NODE_LIMIT_REACHED", "This account has reached its node limit.");
    }

    const id = new ObjectId();
    const credential = issueNodeCredential(id);
    const node = initialNode(userId, name, credential);
    try {
      await collections.nodes.insertOne(node);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await collections.nodes.findOne({ name });
      if (raced && raced.userId.equals(userId) && raced.lifecycle !== "deleted") {
        return jsonResponse({
          created: false,
          node: toNodeView(raced, requestOrigin(request)),
          credential: null,
        });
      }
      throw new ApiError(409, "NODE_NAME_UNAVAILABLE", "Node name is unavailable.");
    }

    return jsonResponse({
      created: true,
      node: toNodeView(node, requestOrigin(request)),
      credential: { token: credential.token, createdAt: credential.createdAt.toISOString() },
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleUpdateNode(request: Request, nodeId: string): Promise<Response> {
  try {
    assertSameOriginJson(request, "PATCH");
    const user = await requireUser(request);
    await consumeRateLimit(await getControlPlaneCollections(), "user-write", user.id, USER_WRITE_LIMIT, USER_WRITE_WINDOW_MS);
    const body = await readJsonObject(request);
    onlyFields(body, ["name"]);
    const name = normalizeNodeName(body.name);
    const userId = objectId(user.id);
    const current = await ownedNode(userId, nodeId);
    if (current.name === name) return jsonResponse({ node: toNodeView(current, requestOrigin(request)) });

    const { nodes } = await getControlPlaneCollections();
    try {
      const updated = await nodes.findOneAndUpdate(
        { _id: current._id, userId, lifecycle: { $ne: "deleted" } },
        { $set: { name, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!updated) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
      return jsonResponse({ node: toNodeView(updated, requestOrigin(request)) });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ApiError(409, "NODE_NAME_UNAVAILABLE", "Node name is unavailable.");
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleDeleteNode(request: Request, nodeId: string): Promise<Response> {
  try {
    assertSameOriginJson(request, "DELETE");
    const user = await requireUser(request);
    await consumeRateLimit(await getControlPlaneCollections(), "user-write", user.id, USER_WRITE_LIMIT, USER_WRITE_WINDOW_MS);
    const body = await readJsonObject(request);
    onlyFields(body, []);
    const userId = objectId(user.id);
    const node = await ownedNode(userId, nodeId);
    const { nodes } = await getControlPlaneCollections();
    await nodes.updateOne(
      { _id: node._id, userId, lifecycle: { $ne: "deleted" } },
      {
        $set: {
          lifecycle: "deleted",
          tokenHash: null,
          tokenRevokedAt: new Date(),
          reportedOnline: false,
          publicDiscoverable: false,
          publicS3Url: null,
          managementUrl: null,
          tunnelMode: "none",
          dashboardUrl: null,
          updatedAt: new Date(),
        },
      },
    );
    return jsonResponse({ deleted: true, id: node._id.toHexString() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleRotateNodeToken(request: Request, nodeId: string): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const user = await requireUser(request);
    const body = await readJsonObject(request);
    await consumeRateLimit(await getControlPlaneCollections(), "user-write", user.id, USER_WRITE_LIMIT, USER_WRITE_WINDOW_MS);
    onlyFields(body, []);
    const userId = objectId(user.id);
    const current = await ownedNode(userId, nodeId);
    const credential = issueNodeCredential(current._id);
    const { nodes } = await getControlPlaneCollections();
    const updated = await nodes.findOneAndUpdate(
      { _id: current._id, userId, lifecycle: { $ne: "deleted" } },
      {
        $set: {
          lifecycle: "active",
          tokenHash: credential.tokenHash,
          tokenCreatedAt: credential.createdAt,
          tokenRevokedAt: null,
          reportedOnline: false,
          updatedAt: credential.createdAt,
        },
        $inc: { credentialVersion: 1 },
      },
      { returnDocument: "after" },
    );
    if (!updated) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
    return jsonResponse({
      node: toNodeView(updated, requestOrigin(request)),
      credential: { token: credential.token, createdAt: credential.createdAt.toISOString() },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleRevokeNodeToken(request: Request, nodeId: string): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const user = await requireUser(request);
    const body = await readJsonObject(request);
    await consumeRateLimit(await getControlPlaneCollections(), "user-write", user.id, USER_WRITE_LIMIT, USER_WRITE_WINDOW_MS);
    onlyFields(body, []);
    const userId = objectId(user.id);
    const current = await ownedNode(userId, nodeId);
    const { nodes } = await getControlPlaneCollections();
    const now = new Date();
    const updated = await nodes.findOneAndUpdate(
      { _id: current._id, userId, lifecycle: { $ne: "deleted" } },
      {
        $set: {
          lifecycle: "revoked",
          tokenHash: null,
          tokenRevokedAt: now,
          reportedOnline: false,
          publicDiscoverable: false,
          tunnelMode: "none",
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
    return jsonResponse({ node: toNodeView(updated, requestOrigin(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleNodeHeartbeat(request: Request): Promise<Response> {
  try {
    assertNodeJsonPost(request);
    const authenticated = await authenticateNode(request);
    const body = await readJsonObject(request);
    const heartbeat = validateHeartbeatPayload(body);
    if (heartbeat.nodeId && heartbeat.nodeId !== authenticated.node._id.toHexString()) {
      throw new ApiError(403, "NODE_ID_MISMATCH", "Heartbeat nodeId does not match its credential.");
    }
    if (heartbeat.name && heartbeat.name !== authenticated.node.name) {
      throw new ApiError(403, "NODE_NAME_MISMATCH", "Heartbeat name does not match its credential.");
    }

    const collections = await getControlPlaneCollections();
    await consumeRateLimit(
      collections,
      "heartbeat",
      authenticated.node._id.toHexString(),
      HEARTBEAT_LIMIT,
      HEARTBEAT_WINDOW_MS,
    );

    const receivedAt = new Date();
    const { client, database } = await getAuthDatabaseContext();
    const session = client.startSession();
    let duplicate = false;
    let updatedNode: NodeDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const nodes = database.collection<NodeDocument>("nodes");
        const usageEvents = database.collection<UsageEventDocument>("usage_events");
        const fresh = await nodes.findOne(
          {
            _id: authenticated.node._id,
            lifecycle: "active",
            tokenHash: authenticated.tokenHash,
          },
          { session },
        );
        if (!fresh) throw new ApiError(401, "INVALID_NODE_CREDENTIAL", "A valid node credential is required.");

        const existing = await usageEvents.findOne(
          { nodeId: fresh._id, eventId: heartbeat.eventId },
          { session, projection: { _id: 1 } },
        );
        if (existing) {
          duplicate = true;
          updatedNode = fresh;
          return;
        }

        const delta = calculateUsageDelta(fresh.startedAt, fresh.counters, heartbeat.startedAt, heartbeat.counters);
        await usageEvents.insertOne({
          _id: new ObjectId(),
          eventId: heartbeat.eventId,
          nodeId: fresh._id,
          userId: fresh.userId,
          credentialVersion: fresh.credentialVersion,
          receivedAt,
          startedAt: heartbeat.startedAt,
          counters: heartbeat.counters,
          delta,
        }, { session });

        updatedNode = await nodes.findOneAndUpdate(
          {
            _id: fresh._id,
            lifecycle: "active",
            tokenHash: authenticated.tokenHash,
          },
          {
            $set: {
              lastSeenAt: receivedAt,
              reportedOnline: heartbeat.online,
              startedAt: heartbeat.startedAt,
              version: heartbeat.version,
              storage: heartbeat.storage,
              counters: heartbeat.counters,
              publicS3Url: heartbeat.publicS3Url,
              publicDiscoverable: heartbeat.publicDiscoverable,
              tunnelMode: heartbeat.tunnelMode,
              managementUrl: heartbeat.managementUrl,
              dashboardUrl: heartbeat.dashboardUrl,
              updatedAt: receivedAt,
            },
            $inc: {
              "usage.requests": delta.requests,
              "usage.bytesIn": delta.bytesIn,
              "usage.bytesOut": delta.bytesOut,
              "usage.errors": delta.errors,
            },
          },
          { session, returnDocument: "after" },
        );
        if (!updatedNode) throw new ApiError(409, "NODE_CHANGED", "Node credential changed during heartbeat.");
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        duplicate = true;
        updatedNode = await collections.nodes.findOne({ _id: authenticated.node._id });
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }
    if (!updatedNode) throw new Error("Heartbeat transaction did not return a node.");

    return jsonResponse({
      accepted: true,
      duplicate,
      receivedAt: receivedAt.toISOString(),
      node: {
        id: updatedNode._id.toHexString(),
        name: updatedNode.name,
        status: nodeStatus(updatedNode),
        lastSeenAt: updatedNode.lastSeenAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type UsageRange = { from: Date; to: Date; interval: "hour" | "day"; nodeId: ObjectId | null };

function usageRange(request: Request): UsageRange {
  const url = new URL(request.url);
  const now = Date.now();
  const to = url.searchParams.has("to") ? new Date(url.searchParams.get("to") ?? "") : new Date(now);
  const from = url.searchParams.has("from")
    ? new Date(url.searchParams.get("from") ?? "")
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const intervalValue = url.searchParams.get("interval") ?? "day";
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > MAX_USAGE_RANGE_MS
  ) {
    throw new ApiError(400, "INVALID_USAGE_RANGE", "Usage range must be valid and no longer than 90 days.");
  }
  if (intervalValue !== "hour" && intervalValue !== "day") {
    throw new ApiError(400, "INVALID_USAGE_INTERVAL", "Usage interval must be hour or day.");
  }
  const nodeValue = url.searchParams.get("nodeId");
  return {
    from,
    to,
    interval: intervalValue,
    nodeId: nodeValue ? objectId(nodeValue) : null,
  };
}

type UsageAggregate = { requests: number; bytesIn: number; bytesOut: number; errors: number };

function normalizedAggregate(value?: Partial<UsageAggregate>): UsageAggregate {
  return {
    requests: value?.requests ?? 0,
    bytesIn: value?.bytesIn ?? 0,
    bytesOut: value?.bytesOut ?? 0,
    errors: value?.errors ?? 0,
  };
}

const usageGroup = {
  _id: null,
  requests: { $sum: "$delta.requests" },
  bytesIn: { $sum: "$delta.bytesIn" },
  bytesOut: { $sum: "$delta.bytesOut" },
  errors: { $sum: "$delta.errors" },
} as const;

export async function handleUsage(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    const user = await requireUser(request);
    const range = usageRange(request);
    const userId = objectId(user.id);
    const collections = await getControlPlaneCollections();
    if (range.nodeId) {
      const exists = await collections.nodes.findOne(
        { _id: range.nodeId, userId, lifecycle: { $ne: "deleted" } },
        { projection: { _id: 1 } },
      );
      if (!exists) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
    }

    const match = {
      userId,
      receivedAt: { $gte: range.from, $lt: range.to },
      ...(range.nodeId ? { nodeId: range.nodeId } : {}),
    };
    const [totalRows, seriesRows, nodeRows, names] = await Promise.all([
      collections.usageEvents.aggregate<UsageAggregate>([
        { $match: match },
        { $group: usageGroup },
        { $project: { _id: 0 } },
      ]).toArray(),
      collections.usageEvents.aggregate<UsageAggregate & { start: Date }>([
        { $match: match },
        {
          $group: {
            ...usageGroup,
            _id: { $dateTrunc: { date: "$receivedAt", unit: range.interval, timezone: "UTC" } },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, start: "$_id", requests: 1, bytesIn: 1, bytesOut: 1, errors: 1 } },
      ]).toArray(),
      collections.usageEvents.aggregate<UsageAggregate & { _id: ObjectId }>([
        { $match: match },
        { $group: { ...usageGroup, _id: "$nodeId" } },
      ]).toArray(),
      collections.nodes.find({ userId, lifecycle: { $ne: "deleted" } }, { projection: { name: 1 } }).toArray(),
    ]);
    const nodeNames = new Map(names.map((node) => [node._id.toHexString(), node.name]));

    return jsonResponse({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      interval: range.interval,
      totals: normalizedAggregate(totalRows[0]),
      series: seriesRows.map((row) => ({
        start: row.start.toISOString(),
        ...normalizedAggregate(row),
      })),
      nodes: nodeRows.map((row) => ({
        nodeId: row._id.toHexString(),
        name: nodeNames.get(row._id.toHexString()) ?? "deleted-node",
        ...normalizedAggregate(row),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAdminOverview(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    const user = await requireUser(request);
    if (user.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access required.");
    const range = usageRange(request);
    const { users } = await getAuthCollections();
    const collections = await getControlPlaneCollections();
    const onlineSince = new Date(Date.now() - NODE_ONLINE_WINDOW_MS);
    const usageMatch = { receivedAt: { $gte: range.from, $lt: range.to } };

    const [totalUsers, activeUsers, disabledUsers, totalNodes, onlineNodes, revokedNodes, storageRows, usageRows] = await Promise.all([
      users.countDocuments(),
      users.countDocuments({ status: "active" }),
      users.countDocuments({ status: "disabled" }),
      collections.nodes.countDocuments({ lifecycle: { $ne: "deleted" } }),
      collections.nodes.countDocuments({
        lifecycle: "active",
        reportedOnline: true,
        lastSeenAt: { $gte: onlineSince },
      }),
      collections.nodes.countDocuments({ lifecycle: "revoked" }),
      collections.nodes.aggregate<{
        capacityBytes: number;
        usedBytes: number;
        availableBytes: number;
        bucketCount: number;
        objectCount: number;
      }>([
        { $match: { lifecycle: { $ne: "deleted" } } },
        {
          $group: {
            _id: null,
            capacityBytes: { $sum: { $ifNull: ["$storage.capacityBytes", 0] } },
            usedBytes: { $sum: "$storage.usedBytes" },
            availableBytes: { $sum: { $ifNull: ["$storage.availableBytes", 0] } },
            bucketCount: { $sum: "$storage.bucketCount" },
            objectCount: { $sum: "$storage.objectCount" },
          },
        },
        { $project: { _id: 0 } },
      ]).toArray(),
      collections.usageEvents.aggregate<UsageAggregate>([
        { $match: usageMatch },
        { $group: usageGroup },
        { $project: { _id: 0 } },
      ]).toArray(),
    ]);
    const storage = storageRows[0] ?? {
      capacityBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      bucketCount: 0,
      objectCount: 0,
    };

    return jsonResponse({
      generatedAt: new Date().toISOString(),
      users: { total: totalUsers, active: activeUsers, disabled: disabledUsers },
      nodes: {
        total: totalNodes,
        online: onlineNodes,
        offline: Math.max(0, totalNodes - onlineNodes - revokedNodes),
        revoked: revokedNodes,
      },
      storage,
      usage: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        ...normalizedAggregate(usageRows[0]),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleResolveNode(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    const url = new URL(request.url);
    const name = normalizeNodeName(url.searchParams.get("name"));
    const collections = await getControlPlaneCollections();
    await consumeRateLimit(collections, "discovery", requestIp(request), DISCOVERY_LIMIT, DISCOVERY_WINDOW_MS);
    const node = await collections.nodes.findOne({
      name,
      lifecycle: "active",
      publicDiscoverable: true,
      publicS3Url: { $ne: null },
      tunnelMode: { $in: ["quick", "managed"] },
    });
    if (!node) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
    return jsonResponse(toPublicDiscovery(node, requestOrigin(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
