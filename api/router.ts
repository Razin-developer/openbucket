import {
  handleForgotPassword,
  handleGoogleCallback,
  handleGoogleStart,
  handleHealth,
  handleLogin,
  handleLogout,
  handleRegister,
  handleResetPassword,
  handleSession,
} from "../server/auth/service.js";
import { jsonResponse } from "../server/auth/http.js";
import {
  handleAdminOverview,
  handleCreateNode,
  handleDeleteNode,
  handleListNodes,
  handleManagementSession,
  handleNodeHeartbeat,
  handleNodeProxy,
  handleResolveNode,
  handleRevokeNodeToken,
  handleRotateNodeToken,
  handleUpdateNode,
  handleUsage,
} from "../server/control-plane/service.js";
import {
  handleListSupportSubmissions,
  handleSubmitBugReport,
  handleSubmitFeedback,
  handleUpdateSupportStatus,
} from "../server/support/service.js";

const apiMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

type ApiMethod = (typeof apiMethods)[number];
type ApiRouteId =
  | "admin-overview"
  | "admin-support"
  | "admin-support-item"
  | "auth-forgot-password"
  | "auth-google-callback"
  | "auth-google-start"
  | "auth-login"
  | "auth-logout"
  | "auth-register"
  | "auth-reset-password"
  | "auth-session"
  | "bugs"
  | "feedback"
  | "health"
  | "node"
  | "node-heartbeat"
  | "node-management-session"
  | "node-proxy"
  | "node-revoke-token"
  | "node-rotate-token"
  | "nodes"
  | "nodes-resolve"
  | "usage";

export type ApiRouteMatch = {
  id: ApiRouteId;
  nodeId?: string;
  submissionId?: string;
  kind?: "s3" | "api";
  routeSlug?: string;
  subpath?: string;
};

type ApiHandler = (request: Request, route: ApiRouteMatch) => Promise<Response>;
type RouteHandlers = Partial<Record<ApiMethod, ApiHandler>>;

const exactRoutes = new Map<string, ApiRouteId>([
  ["/api/admin/overview", "admin-overview"],
  ["/api/admin/support", "admin-support"],
  ["/api/auth/forgot-password", "auth-forgot-password"],
  ["/api/auth/google/callback", "auth-google-callback"],
  ["/api/auth/google/start", "auth-google-start"],
  ["/api/auth/login", "auth-login"],
  ["/api/auth/logout", "auth-logout"],
  ["/api/auth/register", "auth-register"],
  ["/api/auth/reset-password", "auth-reset-password"],
  ["/api/auth/session", "auth-session"],
  ["/api/bugs", "bugs"],
  ["/api/feedback", "feedback"],
  ["/api/health", "health"],
  ["/api/node/heartbeat", "node-heartbeat"],
  ["/api/nodes", "nodes"],
  ["/api/nodes/resolve", "nodes-resolve"],
  ["/api/usage", "usage"],
]);

const routeHandlers: Record<ApiRouteId, RouteHandlers> = {
  "admin-overview": { GET: (request) => handleAdminOverview(request) },
  "admin-support": { GET: (request) => handleListSupportSubmissions(request) },
  "admin-support-item": {
    PATCH: (request, route) => handleUpdateSupportStatus(request, route.submissionId ?? ""),
  },
  bugs: { POST: (request) => handleSubmitBugReport(request) },
  feedback: { POST: (request) => handleSubmitFeedback(request) },
  "auth-forgot-password": { POST: (request) => handleForgotPassword(request) },
  "auth-google-callback": { GET: (request) => handleGoogleCallback(request) },
  "auth-google-start": { GET: (request) => handleGoogleStart(request) },
  "auth-login": { POST: (request) => handleLogin(request) },
  "auth-logout": { POST: (request) => handleLogout(request) },
  "auth-register": { POST: (request) => handleRegister(request) },
  "auth-reset-password": { POST: (request) => handleResetPassword(request) },
  "auth-session": { GET: (request) => handleSession(request) },
  health: { GET: (request) => handleHealth(request) },
  node: {
    PATCH: (request, route) => handleUpdateNode(request, route.nodeId ?? ""),
    DELETE: (request, route) => handleDeleteNode(request, route.nodeId ?? ""),
  },
  "node-heartbeat": { POST: (request) => handleNodeHeartbeat(request) },
  "node-revoke-token": {
    POST: (request, route) => handleRevokeNodeToken(request, route.nodeId ?? ""),
  },
  "node-management-session": { POST: (request, route) => handleManagementSession(request, route.nodeId ?? "") },
  "node-rotate-token": {
    POST: (request, route) => handleRotateNodeToken(request, route.nodeId ?? ""),
  },
  nodes: {
    GET: (request) => handleListNodes(request),
    POST: (request) => handleCreateNode(request),
  },
  "nodes-resolve": { GET: (request) => handleResolveNode(request) },
  "node-proxy": {}, // dispatched directly in dispatchApiRequest, never looked up through this table
  usage: { GET: (request) => handleUsage(request) },
};

function normalizedPath(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

function proxyMatch(path: string, kind: "s3" | "api"): ApiRouteMatch | null {
  const parts = path.split("/");
  const routeSlug = parts[2];
  if (!routeSlug) return null;
  return { id: "node-proxy", kind, routeSlug, subpath: parts.slice(3).join("/") };
}

export function matchApiRoute(pathname: string): ApiRouteMatch | null {
  const path = normalizedPath(pathname);

  // Nothing else lives under /s3/ — every request there is a node proxy request, keyed by the
  // node's unique routeSlug (openbucket.zydcode.in/s3/<routeSlug>/...).
  if (path === "/s3" || path.startsWith("/s3/")) return proxyMatch(path, "s3");

  const exact = exactRoutes.get(path);
  if (exact) return { id: exact };

  const nodeMatch = path.match(/^\/api\/nodes\/([a-f0-9]{24})(?:\/(rotate-token|revoke-token|management-session))?$/);
  if (nodeMatch) {
    const nodeId = nodeMatch[1];
    if (!nodeId) return null;
    if (nodeMatch[2] === "rotate-token") return { id: "node-rotate-token", nodeId };
    if (nodeMatch[2] === "revoke-token") return { id: "node-revoke-token", nodeId };
    if (nodeMatch[2] === "management-session") return { id: "node-management-session", nodeId };
    return { id: "node", nodeId };
  }

  const supportMatch = path.match(/^\/api\/admin\/support\/([a-f0-9]{24})$/);
  if (supportMatch) {
    const submissionId = supportMatch[1];
    if (!submissionId) return null;
    return { id: "admin-support-item", submissionId };
  }

  // Anything under /api/ that isn't one of the control plane's own known routes above is treated
  // as a node proxy request (openbucket.zydcode.in/api/<routeSlug>/...). RESERVED_NODE_NAMES
  // (server/control-plane/model.ts) keeps a real routeSlug from ever colliding with a name used
  // above (auth, admin, nodes, node, health, usage, ...), so there's no ambiguity between the two.
  if (path === "/api" || path.startsWith("/api/")) return proxyMatch(path, "api");

  return null;
}

function isApiMethod(method: string): method is ApiMethod {
  return apiMethods.some((candidate) => candidate === method);
}

function error(code: string, message: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function routedPath(request: Request): string {
  const url = new URL(request.url);
  const forwardedPath = url.searchParams.get("__openbucket_path");
  if (forwardedPath === null) return url.pathname;
  const prefix = url.searchParams.get("__openbucket_kind") === "s3" ? "/s3" : "/api";
  const normalized = forwardedPath.replace(/^\/+|\/+$/g, "");
  return normalized ? `${prefix}/${normalized}` : prefix;
}

export async function dispatchApiRequest(request: Request): Promise<Response> {
  let route: ApiRouteMatch | null;
  try {
    route = matchApiRoute(routedPath(request));
  } catch {
    route = null;
  }
  if (!route) return error("NOT_FOUND", "API route not found.", 404);

  if (route.id === "node-proxy") {
    return handleNodeProxy(request, route.kind ?? "api", route.routeSlug ?? "", route.subpath ?? "");
  }

  const method = request.method.toUpperCase();
  const handlers = routeHandlers[route.id];
  const handler = isApiMethod(method) ? handlers[method] : undefined;
  if (!handler) {
    const allow = apiMethods.filter((candidate) => Boolean(handlers[candidate])).join(", ");
    return error("METHOD_NOT_ALLOWED", "Method not allowed.", 405, { Allow: allow });
  }
  return handler(request, route);
}

export const GET = dispatchApiRequest;
export const HEAD = dispatchApiRequest;
export const POST = dispatchApiRequest;
export const PUT = dispatchApiRequest;
export const PATCH = dispatchApiRequest;
export const DELETE = dispatchApiRequest;
