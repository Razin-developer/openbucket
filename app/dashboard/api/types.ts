// Shared types for the unified dashboard shell (Workstream C).
// Node-scoped types mirror the daemon management API's loosely-typed responses;
// account-scoped types mirror the hosted control-plane API (see account-api.ts).

export type EndpointSet = { management?: string; s3?: string; public?: string; files?: string; dashboard?: string };

export type Status = {
  online: boolean;
  nodeId?: string;
  nodeName?: string;
  version?: string;
  storageRoot?: string;
  capacityBytes: number;
  usedBytes: number;
  filesystemUsedBytes: number;
  availableBytes: number;
  bucketCount: number;
  objectCount: number;
  requestsToday: number;
  uptimeSeconds: number;
  endpoints: EndpointSet;
};

export type Bucket = { name: string; createdAt?: string; public: boolean; objectCount: number; sizeBytes: number };

export type StorageObject = {
  key: string;
  sizeBytes: number;
  lastModified?: string;
  etag?: string;
  contentType?: string;
  url?: string;
};

export type ApiKey = {
  id: string;
  name: string;
  accessKeyId: string;
  createdAt?: string;
  readOnly?: boolean;
  bucket?: string | null;
};

export type RequestLog = {
  requestId?: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  bytesIn: number;
  bytesOut: number;
  ip?: string;
};

export type Analytics = {
  requests: number;
  totalBytesIn: number;
  totalBytesOut: number;
  requestsToday: number;
  averageLatencyMs: number;
  errors: number;
  methods: Record<string, number>;
  statusCodes: Record<string, number>;
};

export type ClientConfig = {
  nodeId?: string;
  nodeName?: string;
  managementUrl?: string;
  s3Url?: string;
  publicBaseUrl?: string;
  filesUrl?: string;
  dashboardUrl?: string;
  storageRoot?: string;
};

export type LoadState = "loading" | "connected" | "disconnected";
export type Toast = { id: number; tone: "success" | "error"; message: string };

export type NodeConnection = { apiBase: string; adminToken: string };

/** Discriminated union describing which "mode" the shared shell is currently rendering. */
export type NodeContext =
  | { mode: "standalone"; connection: NodeConnection }
  | { mode: "hosted-embedded"; nodeId: string; connection: { apiBase: string; token: string } | null }
  | { mode: "hosted-none" };

export type NavItemId = string;
export type NavItem = { id: NavItemId; label: string; icon: import("lucide-react").LucideIcon };
export type NavSection = { id: "account" | "node"; label?: string; items: NavItem[] };
