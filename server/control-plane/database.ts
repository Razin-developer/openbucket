import { ObjectId, type Collection, type Db } from "mongodb";
import { getAuthDatabaseContext } from "../auth/database.js";

export const USAGE_EVENT_RETENTION_SECONDS = 100 * 24 * 60 * 60;

export type NodeLifecycle = "active" | "revoked" | "deleted";

export type NodeStorage = {
  capacityBytes: number | null;
  usedBytes: number;
  availableBytes: number | null;
  bucketCount: number;
  objectCount: number;
};

export type NodeCounters = {
  requests: number;
  bytesIn: number;
  bytesOut: number;
  errors: number;
};

export type NodeEndpoint = {
  url: string | null;
  kind: "local" | "quick" | "named" | "none";
  healthy: boolean;
  updatedAt: Date | null;
};

export type NodeDocument = {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  /**
   * The unique, URL-safe identifier used for public routing (openbucket.zydcode.in/api/<routeSlug>,
   * /s3/<routeSlug>). `name` is a non-unique display label a user can reuse across accounts (like a
   * Vercel project name); `routeSlug` starts as the normalized name and gets a short random suffix
   * appended only on collision. It never changes once a node is created, even if the node is renamed,
   * so a public URL a client has already configured keeps working.
   */
  routeSlug: string;
  lifecycle: NodeLifecycle;
  tokenHash: string | null;
  credentialVersion: number;
  tokenCreatedAt: Date | null;
  tokenRevokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  reportedOnline: boolean;
  startedAt: Date | null;
  version: string | null;
  storage: NodeStorage;
  counters: NodeCounters;
  usage: NodeCounters;
  publicS3Url: string | null;
  tunnelMode: "none" | "quick" | "managed";
  publicDiscoverable: boolean;
  managementUrl: string | null;
  dashboardUrl: string | null;
  /** Public endpoints only. Loopback listeners and secrets never leave the host. */
  endpoints?: { s3: NodeEndpoint; management: NodeEndpoint };
};

export type UsageEventDocument = {
  _id: ObjectId;
  eventId: string;
  nodeId: ObjectId;
  userId: ObjectId;
  credentialVersion: number;
  receivedAt: Date;
  startedAt: Date;
  counters: NodeCounters;
  delta: NodeCounters;
};

export type ControlPlaneRateLimitDocument = {
  _id: string;
  count: number;
  createdAt: Date;
  expiresAt: Date;
};

export type ControlPlaneCollections = {
  nodes: Collection<NodeDocument>;
  usageEvents: Collection<UsageEventDocument>;
  rateLimits: Collection<ControlPlaneRateLimitDocument>;
};

type ControlPlaneIndexState = {
  indexPromises: Map<string, Promise<void>>;
};

const globalControlPlane = globalThis as typeof globalThis & {
  __openbucketControlPlane?: ControlPlaneIndexState;
};
const indexState = globalControlPlane.__openbucketControlPlane ?? { indexPromises: new Map<string, Promise<void>>() };
globalControlPlane.__openbucketControlPlane = indexState;

async function ensureControlPlaneIndexes(database: Db): Promise<void> {
  const key = database.databaseName;
  let pending = indexState.indexPromises.get(key);
  if (!pending) {
    pending = Promise.all([
      // `name` is no longer globally unique (multiple accounts may register the same display
      // name, like a Vercel project name) — this index exists for lookup speed, not uniqueness.
      // A pre-existing `nodes_name_unique` unique index from before this change is dropped first
      // since MongoDB errors on redefining an existing index name with different options.
      database.collection<NodeDocument>("nodes").dropIndex("nodes_name_unique").catch(() => undefined),
      database.collection<NodeDocument>("nodes").createIndex(
        { name: 1 },
        { name: "nodes_name_lookup" },
      ),
      // Sparse so legacy documents without a `routeSlug` yet (before the backfill migration runs,
      // see scripts/backfill-route-slug.mjs) don't collide with each other on a shared `null`.
      database.collection<NodeDocument>("nodes").createIndex(
        { routeSlug: 1 },
        { name: "nodes_route_slug_unique", unique: true, sparse: true },
      ),
      database.collection<NodeDocument>("nodes").createIndex(
        { userId: 1, name: 1 },
        { name: "nodes_user_name" },
      ),
      database.collection<NodeDocument>("nodes").createIndex(
        { userId: 1, createdAt: -1 },
        { name: "nodes_user_created" },
      ),
      database.collection<NodeDocument>("nodes").createIndex(
        { lastSeenAt: -1, lifecycle: 1 },
        { name: "nodes_presence" },
      ),
      database.collection<UsageEventDocument>("usage_events").createIndex(
        { nodeId: 1, eventId: 1 },
        { name: "usage_node_event_unique", unique: true },
      ),
      database.collection<UsageEventDocument>("usage_events").createIndex(
        { userId: 1, receivedAt: 1 },
        { name: "usage_user_received" },
      ),
      database.collection<UsageEventDocument>("usage_events").createIndex(
        { nodeId: 1, receivedAt: 1 },
        { name: "usage_node_received" },
      ),
      database.collection<UsageEventDocument>("usage_events").createIndex(
        { receivedAt: 1 },
        { name: "usage_received_ttl", expireAfterSeconds: USAGE_EVENT_RETENTION_SECONDS },
      ),
      database.collection<ControlPlaneRateLimitDocument>("control_plane_rate_limits").createIndex(
        { expiresAt: 1 },
        { name: "control_plane_rate_limits_expiry_ttl", expireAfterSeconds: 0 },
      ),
    ]).then(() => undefined);
    indexState.indexPromises.set(key, pending);
    pending.catch(() => indexState.indexPromises.delete(key));
  }
  await pending;
}

export async function getControlPlaneCollections(): Promise<ControlPlaneCollections> {
  const { database } = await getAuthDatabaseContext();
  await ensureControlPlaneIndexes(database);
  return {
    nodes: database.collection<NodeDocument>("nodes"),
    usageEvents: database.collection<UsageEventDocument>("usage_events"),
    rateLimits: database.collection<ControlPlaneRateLimitDocument>("control_plane_rate_limits"),
  };
}

export function resetControlPlaneIndexesForTests(): void {
  indexState.indexPromises.clear();
}
