// Hosted account-level API client — relocated verbatim from vercel/control-plane.tsx (Workstream C).
// Same endpoints, same 401 -> /login redirect behavior, same error-shape handling.

export type AccountRole = "admin" | "member";
export type AccountUser = { id: string; email: string; name: string | null; handle: string; role: AccountRole };

type NodeStorage = {
  capacityBytes: number | null;
  usedBytes: number;
  availableBytes: number | null;
  bucketCount: number;
  objectCount: number;
};

export type AccountNode = {
  id: string;
  name: string;
  status: "online" | "offline" | "revoked";
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  version: string | null;
  startedAt: string | null;
  storage: NodeStorage;
  usage: { requests: number; bytesIn: number; bytesOut: number; errors: number };
  endpoint: {
    nodePath: string;
    controlPlaneUrl: string;
    publicS3Url: string | null;
    managementUrl: string | null;
    dashboardUrl: string | null;
    futureS3Hostname: string;
    endpoints: {
      s3: { url: string | null; kind: "local" | "quick" | "named" | "none"; healthy: boolean; updatedAt: string | null };
      management: { url: string | null; kind: "local" | "quick" | "named" | "none"; healthy: boolean; updatedAt: string | null };
    };
  };
};

export type UsageSummary = {
  from: string; to: string; interval: "hour" | "day";
  totals: { requests: number; bytesIn: number; bytesOut: number; errors: number };
  series: Array<{ start: string; requests: number; bytesIn: number; bytesOut: number; errors: number }>;
  nodes: Array<{ nodeId: string; name: string; requests: number; bytesIn: number; bytesOut: number; errors: number }>;
};

export type AdminOverview = {
  generatedAt: string;
  users: { total: number; active: number; disabled: number };
  nodes: { total: number; online: number; offline: number; revoked: number };
  storage: { capacityBytes: number; usedBytes: number; availableBytes: number; bucketCount: number; objectCount: number };
  usage: { from: string; to: string; requests: number; bytesIn: number; bytesOut: number; errors: number };
};

type NodesResponse = { nodes: AccountNode[] };
type CreateNodeRequest = { name: string };
type CreateNodeResponse = { created: boolean; node: AccountNode; credential: { token: string; createdAt: string } | null };
type ApiErrorBody = { error?: { code?: string; message?: string } };

export type SupportSubmission = {
  id: string;
  kind: "feedback" | "bug";
  status: "new" | "reviewed" | "resolved";
  message: string;
  title: string | null;
  stepsToReproduce: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  email: string | null;
  name: string | null;
  path: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SupportListResponse = { submissions: SupportSubmission[]; newCount: number; totalCount: number };

export type FleetSummary = {
  nodeCount: number; onlineNodeCount: number; bucketCount: number; objectCount: number;
  storedBytes: number; capacityBytes: number; requestCount: number; bytesIn: number; bytesOut: number;
  lastSeenAt: string | null;
};

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({})) as T & ApiErrorBody;
  if (response.status === 401) {
    window.location.replace("/login?next=%2Fdashboard");
    throw new Error("Your session expired.");
  }
  if (!response.ok) throw new Error(payload.error?.message || `Request failed with status ${response.status}.`);
  return payload;
}

export const controlPlaneApi = {
  listNodes: () => apiRequest<NodesResponse>("/api/nodes"),
  createNode: (input: CreateNodeRequest) => apiRequest<CreateNodeResponse>("/api/nodes", { method: "POST", body: JSON.stringify(input) }),
  usage: () => apiRequest<UsageSummary>("/api/usage"),
  adminOverview: () => apiRequest<AdminOverview>("/api/admin/overview"),
  listSupport: (kind?: "feedback" | "bug", status?: "new" | "reviewed" | "resolved") => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    const query = params.toString();
    return apiRequest<SupportListResponse>(`/api/admin/support${query ? `?${query}` : ""}`);
  },
  updateSupportStatus: (id: string, status: "new" | "reviewed" | "resolved") =>
    apiRequest<{ submission: SupportSubmission }>(`/api/admin/support/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  managementSession: (nodeId: string) => apiRequest<{ managementUrl: string; token: string; expiresIn: number }>(`/api/nodes/${encodeURIComponent(nodeId)}/management-session`, { method: "POST", body: "{}" }),
};

export function summarizeFleet(nodes: AccountNode[], usage: UsageSummary): FleetSummary {
  const seen = nodes.map((node) => node.lastSeenAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return {
    nodeCount: nodes.length,
    onlineNodeCount: nodes.filter((node) => node.status === "online").length,
    bucketCount: nodes.reduce((sum, node) => sum + node.storage.bucketCount, 0),
    objectCount: nodes.reduce((sum, node) => sum + node.storage.objectCount, 0),
    storedBytes: nodes.reduce((sum, node) => sum + node.storage.usedBytes, 0),
    capacityBytes: nodes.reduce((sum, node) => sum + (node.storage.capacityBytes ?? 0), 0),
    requestCount: usage.totals.requests,
    bytesIn: usage.totals.bytesIn,
    bytesOut: usage.totals.bytesOut,
    lastSeenAt: seen,
  };
}

export function nodeApiUrl(node: AccountNode): string {
  return new URL(node.endpoint.nodePath, node.endpoint.controlPlaneUrl).toString();
}
