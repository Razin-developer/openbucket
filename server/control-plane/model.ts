import { ApiError } from "../auth/http.js";
import type { NodeCounters, NodeDocument, NodeEndpoint, NodeStorage } from "./database.js";

export const NODE_ONLINE_WINDOW_MS = 90_000;
const MAX_URL_BYTES = 2_048;
const RESERVED_NODE_NAMES = new Set([
  "admin",
  "api",
  "auth",
  "dashboard",
  "docs",
  "health",
  "login",
  "mail",
  "node",
  "nodes",
  "openbucket",
  "register",
  "s3",
  "status",
  "support",
  "usage",
  "www",
]);

export type HeartbeatInput = {
  eventId: string;
  nodeId: string | null;
  name: string | null;
  version: string;
  online: boolean;
  startedAt: Date;
  storage: NodeStorage;
  counters: NodeCounters;
  publicS3Url: string | null;
  publicDiscoverable: boolean;
  tunnelMode: "none" | "quick" | "managed";
  managementUrl: string | null;
  dashboardUrl: string | null;
  endpoints: { s3: NodeEndpoint; management: NodeEndpoint };
};

export type NodeView = {
  id: string;
  name: string;
  status: "online" | "offline" | "revoked";
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  version: string | null;
  startedAt: string | null;
  storage: NodeStorage;
  usage: NodeCounters;
  endpoint: {
    nodePath: string;
    controlPlaneUrl: string;
    publicS3Url: string | null;
    tunnelMode: "none" | "quick" | "managed";
    managementUrl: string | null;
    dashboardUrl: string | null;
    futureS3Hostname: string;
    endpoints: {
      s3: { url: string | null; kind: NodeEndpoint["kind"]; healthy: boolean; updatedAt: string | null };
      management: { url: string | null; kind: NodeEndpoint["kind"]; healthy: boolean; updatedAt: string | null };
    };
  };
};

function onlyFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_REQUEST", "Request contains unsupported fields.");
  }
}

function objectValue(value: unknown, code: string, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, code, message);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "INVALID_METRICS", field + " must be a non-negative safe integer.");
  }
  return value;
}

function optionalText(value: unknown, field: string, pattern: RegExp, maximumBytes: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    !pattern.test(value)
  ) {
    throw new ApiError(400, "INVALID_HEARTBEAT", field + " is invalid.");
  }
  return value;
}

function parseTimestamp(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.length > 64) {
    throw new ApiError(400, "INVALID_HEARTBEAT", field + " must be an ISO timestamp.");
  }
  const timestamp = new Date(value);
  const time = timestamp.getTime();
  if (
    !Number.isFinite(time) ||
    time < Date.UTC(2000, 0, 1) ||
    time > Date.now() + 5 * 60 * 1000
  ) {
    throw new ApiError(400, "INVALID_HEARTBEAT", field + " must be a valid timestamp.");
  }
  return timestamp;
}

function parseUrl(value: unknown, field: string, publicOnly: boolean): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_URL_BYTES) {
    throw new ApiError(400, "INVALID_ENDPOINT", field + " is invalid.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "INVALID_ENDPOINT", field + " is invalid.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "INVALID_ENDPOINT", field + " must not contain credentials, a query, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  const normalized = url.toString().replace(/\/$/, "");
  if (url.protocol === "https:") return normalized;
  const loopback = url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(url.hostname);
  if (!publicOnly && url.protocol === "http:" && loopback) return normalized;
  throw new ApiError(400, "INVALID_ENDPOINT", field + (publicOnly ? " must use HTTPS." : " must use HTTPS or loopback HTTP."));
}

function endpointFromLegacy(url: string | null, kind: "none" | "quick" | "managed", now: Date): NodeEndpoint {
  return {
    url,
    kind: !url ? "none" : kind === "quick" ? "quick" : kind === "managed" ? "named" : "local",
    healthy: Boolean(url),
    updatedAt: url ? now : null,
  };
}

function parseEndpoint(value: unknown, field: string, now: Date): NodeEndpoint | null {
  if (value === undefined) return null;
  const record = objectValue(value, "INVALID_ENDPOINT", field + " is invalid.");
  onlyFields(record, ["url", "kind", "healthy"]);
  const kind = record.kind;
  if (kind !== "local" && kind !== "quick" && kind !== "named" && kind !== "none") {
    throw new ApiError(400, "INVALID_ENDPOINT", field + ".kind is invalid.");
  }
  const url = parseUrl(record.url, field + ".url", kind !== "local");
  if (typeof record.healthy !== "boolean" || (kind === "none") !== (url === null)) {
    throw new ApiError(400, "INVALID_ENDPOINT", field + " is inconsistent.");
  }
  return { url, kind, healthy: record.healthy && Boolean(url), updatedAt: url ? now : null };
}

export function normalizeNodeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_NODE_NAME", "Node name must contain 3-48 lowercase letters, numbers, or hyphens.");
  }
  const name = value.normalize("NFKC").trim().toLowerCase();
  if (
    name.length < 3 ||
    name.length > 48 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(name) ||
    name.includes("--") ||
    RESERVED_NODE_NAMES.has(name)
  ) {
    throw new ApiError(400, "INVALID_NODE_NAME", "Node name must be an available DNS-safe label with 3-48 characters.");
  }
  return name;
}

export function validateHeartbeatPayload(body: Record<string, unknown>): HeartbeatInput {
  onlyFields(body, [
    "eventId",
    "nodeId",
    "name",
    "version",
    "online",
    "startedAt",
    "storage",
    "counters",
    "publicS3Url",
    "publicDiscoverable",
    "tunnelMode",
    "managementUrl",
    "dashboardUrl",
    "endpoints",
  ]);

  const eventId = optionalText(body.eventId, "eventId", /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, 128);
  const version = optionalText(body.version, "version", /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/, 64);
  if (!eventId || !version || typeof body.online !== "boolean") {
    throw new ApiError(400, "INVALID_HEARTBEAT", "eventId, version, startedAt, and online are required.");
  }
  const nodeId = optionalText(body.nodeId, "nodeId", /^[a-f0-9]{24}$/, 24);
  const name = body.name === undefined || body.name === null ? null : normalizeNodeName(body.name);

  const storageObject = objectValue(body.storage, "INVALID_METRICS", "storage metrics are required.");
  onlyFields(storageObject, ["capacityBytes", "usedBytes", "availableBytes", "bucketCount", "objectCount"]);
  const storage: NodeStorage = {
    capacityBytes: nonNegativeInteger(storageObject.capacityBytes, "capacityBytes", true),
    usedBytes: nonNegativeInteger(storageObject.usedBytes, "usedBytes") as number,
    availableBytes: nonNegativeInteger(storageObject.availableBytes, "availableBytes", true),
    bucketCount: nonNegativeInteger(storageObject.bucketCount, "bucketCount") as number,
    objectCount: nonNegativeInteger(storageObject.objectCount, "objectCount") as number,
  };
  if (storage.capacityBytes !== null && storage.usedBytes > storage.capacityBytes) {
    throw new ApiError(400, "INVALID_METRICS", "usedBytes cannot exceed capacityBytes.");
  }
  if (
    storage.capacityBytes !== null &&
    storage.availableBytes !== null &&
    storage.availableBytes > storage.capacityBytes
  ) {
    throw new ApiError(400, "INVALID_METRICS", "availableBytes cannot exceed capacityBytes.");
  }

  const countersObject = objectValue(body.counters, "INVALID_METRICS", "counter metrics are required.");
  onlyFields(countersObject, ["requests", "bytesIn", "bytesOut", "errors"]);
  const counters: NodeCounters = {
    requests: nonNegativeInteger(countersObject.requests, "requests") as number,
    bytesIn: nonNegativeInteger(countersObject.bytesIn, "bytesIn") as number,
    bytesOut: nonNegativeInteger(countersObject.bytesOut, "bytesOut") as number,
    errors: nonNegativeInteger(countersObject.errors, "errors") as number,
  };

  const publicS3Url = parseUrl(body.publicS3Url, "publicS3Url", true);
  const publicDiscoverable = body.publicDiscoverable === undefined ? false : body.publicDiscoverable;
  if (typeof publicDiscoverable !== "boolean") {
    throw new ApiError(400, "INVALID_ENDPOINT", "publicDiscoverable must be a boolean.");
  }
  const tunnelMode = body.tunnelMode === undefined ? "none" : body.tunnelMode;
  if (tunnelMode !== "none" && tunnelMode !== "quick" && tunnelMode !== "managed") {
    throw new ApiError(400, "INVALID_ENDPOINT", "tunnelMode must be none, quick, or managed.");
  }
  if (publicDiscoverable && (!publicS3Url || tunnelMode === "none")) {
    throw new ApiError(400, "INVALID_ENDPOINT", "A discoverable node requires a public tunnel.");
  }

  const now = new Date();
  const legacyS3 = endpointFromLegacy(publicS3Url, tunnelMode, now);
  const legacyManagement = endpointFromLegacy(
    parseUrl(body.managementUrl, "managementUrl", false),
    "none",
    now,
  );
  const endpointObject = body.endpoints === undefined
    ? null
    : objectValue(body.endpoints, "INVALID_ENDPOINT", "endpoints is invalid.");
  if (endpointObject) onlyFields(endpointObject, ["s3", "management"]);
  const s3 = parseEndpoint(endpointObject?.s3, "endpoints.s3", now) ?? legacyS3;
  const management = parseEndpoint(endpointObject?.management, "endpoints.management", now) ?? legacyManagement;
  return {
    eventId,
    nodeId,
    name,
    version,
    online: body.online,
    startedAt: parseTimestamp(body.startedAt, "startedAt"),
    storage,
    counters,
    publicS3Url,
    publicDiscoverable,
    tunnelMode,
    managementUrl: management.url,
    dashboardUrl: parseUrl(body.dashboardUrl, "dashboardUrl", false),
    endpoints: { s3, management },
  };
}

export function calculateUsageDelta(
  previousStartedAt: Date | null,
  previous: NodeCounters,
  incomingStartedAt: Date,
  incoming: NodeCounters,
): NodeCounters {
  if (!previousStartedAt) return { ...incoming };
  const previousRun = previousStartedAt.getTime();
  const incomingRun = incomingStartedAt.getTime();
  if (incomingRun < previousRun) {
    throw new ApiError(409, "STALE_HEARTBEAT", "Heartbeat belongs to an older daemon run.");
  }
  if (incomingRun > previousRun) return { ...incoming };
  if (
    incoming.requests < previous.requests ||
    incoming.bytesIn < previous.bytesIn ||
    incoming.bytesOut < previous.bytesOut ||
    incoming.errors < previous.errors
  ) {
    throw new ApiError(409, "STALE_HEARTBEAT", "Heartbeat counters moved backwards for this daemon run.");
  }
  return {
    requests: incoming.requests - previous.requests,
    bytesIn: incoming.bytesIn - previous.bytesIn,
    bytesOut: incoming.bytesOut - previous.bytesOut,
    errors: incoming.errors - previous.errors,
  };
}

function configuredNodeDomain(): string {
  const configured = process.env.OPENBUCKET_NODE_DOMAIN?.trim().toLowerCase() || "openbucket.dev";
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(configured)
    ? configured
    : "openbucket.dev";
}

export function nodeStatus(node: NodeDocument, now = Date.now()): "online" | "offline" | "revoked" {
  if (node.lifecycle === "revoked") return "revoked";
  const online = node.lifecycle === "active" &&
    node.reportedOnline &&
    node.lastSeenAt !== null &&
    now - node.lastSeenAt.getTime() <= NODE_ONLINE_WINDOW_MS;
  return online ? "online" : "offline";
}

export function toNodeView(node: NodeDocument, requestOrigin: string, now = Date.now()): NodeView {
  const endpoints = node.endpoints ?? {
    s3: endpointFromLegacy(node.publicS3Url, node.tunnelMode, new Date(node.updatedAt)),
    management: endpointFromLegacy(node.managementUrl, "none", new Date(node.updatedAt)),
  };
  return {
    id: node._id.toHexString(),
    name: node.name,
    status: nodeStatus(node, now),
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
    version: node.version,
    startedAt: node.startedAt?.toISOString() ?? null,
    storage: node.storage,
    usage: node.usage,
    endpoint: {
      nodePath: "/" + node.name,
      controlPlaneUrl: requestOrigin + "/api/node/heartbeat",
      publicS3Url: node.publicS3Url,
      tunnelMode: node.tunnelMode,
      managementUrl: node.managementUrl,
      dashboardUrl: node.dashboardUrl,
      futureS3Hostname: "s3." + node.name + "." + configuredNodeDomain(),
      endpoints: {
        s3: { ...endpoints.s3, updatedAt: endpoints.s3.updatedAt?.toISOString() ?? null },
        management: { ...endpoints.management, updatedAt: endpoints.management.updatedAt?.toISOString() ?? null },
      },
    },
  };
}

export function toPublicDiscovery(node: NodeDocument, requestOrigin: string, now = Date.now(), handle?: string): {
  nodeName: string;
  online: boolean;
  tunnelMode: "quick" | "managed" | "unavailable";
  s3Endpoint: string | null;
  canonicalPath: string;
  futureHostname: string;
} {
  const endpoints = node.endpoints ?? {
    s3: endpointFromLegacy(node.publicS3Url, node.tunnelMode, new Date(node.updatedAt)),
    management: endpointFromLegacy(node.managementUrl, "none", new Date(node.updatedAt)),
  };
  const configuredPublic = node.publicDiscoverable && Boolean(endpoints.s3.url) && endpoints.s3.kind !== "none";
  const online = nodeStatus(node, now) === "online";
  const isPublic = configuredPublic && online;
  return {
    nodeName: node.name,
    online,
    tunnelMode: configuredPublic && node.tunnelMode !== "none" ? node.tunnelMode : "unavailable",
    s3Endpoint: isPublic ? endpoints.s3.url : null,
    canonicalPath: requestOrigin + "/" + (handle ? `${handle}/` : "") + node.name,
    futureHostname: "s3." + node.name + "." + configuredNodeDomain(),
  };
}
