export type NodeViewId = "overview" | "buckets" | "keys" | "connections" | "logs" | "settings";

/**
 * Builds a node-scoped view path under `basePath` ("" for the standalone local dashboard,
 * "/dashboard/nodes/:name" for the hosted one). Shared by DashboardApp and HostedDashboard so
 * both dashboards use the exact same URL scheme for node views.
 */
export function nodeViewPath(basePath: string, id: NodeViewId, bucket?: string, folderPrefix?: string): string {
  if (id === "overview") return basePath || "/";
  const path = `${basePath}/${id}`;
  if (id !== "buckets" || !bucket) return path;
  const bucketPath = `${path}/${encodeURIComponent(bucket)}`;
  const segments = folderPrefix ? folderPrefix.split("/").filter(Boolean).map(encodeURIComponent) : [];
  return segments.length ? `${bucketPath}/${segments.join("/")}` : bucketPath;
}

/** Inverse of nodeViewPath: which node view is active for a given pathname under basePath. */
export function nodeViewFromPath(basePath: string, pathname: string): NodeViewId {
  const rest = basePath ? pathname.slice(basePath.length) : pathname;
  const segment = rest.replace(/^\/+/, "").split("/")[0] ?? "";
  const ids: NodeViewId[] = ["buckets", "keys", "connections", "logs", "settings"];
  return ids.find((id) => id === segment) ?? "overview";
}

export type AccountViewId = "account-overview" | "nodes" | "usage" | "settings" | "admin" | "support";

/** Hosted-only: account-level view paths, all rooted at /dashboard. */
export function accountViewPath(id: AccountViewId): string {
  return id === "account-overview" ? "/dashboard" : `/dashboard/${id}`;
}

export function accountViewFromPath(pathname: string): AccountViewId {
  const segment = pathname.replace(/^\/dashboard\/?/, "").split("/")[0] ?? "";
  const ids: AccountViewId[] = ["nodes", "usage", "settings", "admin", "support"];
  return ids.find((id) => id === segment) ?? "account-overview";
}

const NODE_NAME_IN_PATH = /^\/dashboard\/nodes\/([a-z0-9][a-z0-9-]{1,47})(?:\/|$)/;

/** Hosted-only: the node name selected by the current URL, if any (e.g. /dashboard/nodes/foo/buckets -> "foo"). */
export function hostedNodeNameFromPath(pathname: string): string | null {
  const match = NODE_NAME_IN_PATH.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

/** Hosted-only: base path for a node's routes, e.g. /dashboard/nodes/foo. */
export function hostedNodeBasePath(nodeName: string): string {
  return `/dashboard/nodes/${encodeURIComponent(nodeName)}`;
}
