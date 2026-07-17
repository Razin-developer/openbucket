import {
  handleHealth,
  handleLogin,
  handleLogout,
  handleRegister,
  handleSession,
} from "../server/auth/service.js";
import { jsonResponse } from "../server/auth/http.js";
import {
  handleAdminOverview,
  handleCreateNode,
  handleDeleteNode,
  handleListNodes,
  handleNodeHeartbeat,
  handleResolveNode,
  handleRevokeNodeToken,
  handleRotateNodeToken,
  handleUpdateNode,
  handleUsage,
} from "../server/control-plane/service.js";

const apiMethods = ["GET", "POST", "PATCH", "DELETE"] as const;

type ApiMethod = (typeof apiMethods)[number];
type ApiRouteId =
  | "admin-overview"
  | "auth-login"
  | "auth-logout"
  | "auth-register"
  | "auth-session"
  | "health"
  | "node"
  | "node-heartbeat"
  | "node-revoke-token"
  | "node-rotate-token"
  | "nodes"
  | "nodes-resolve"
  | "usage";

export type ApiRouteMatch = {
  id: ApiRouteId;
  nodeId?: string;
};

type ApiHandler = (request: Request, route: ApiRouteMatch) => Promise<Response>;
type RouteHandlers = Partial<Record<ApiMethod, ApiHandler>>;

const exactRoutes = new Map<string, ApiRouteId>([
  ["/api/admin/overview", "admin-overview"],
  ["/api/auth/login", "auth-login"],
  ["/api/auth/logout", "auth-logout"],
  ["/api/auth/register", "auth-register"],
  ["/api/auth/session", "auth-session"],
  ["/api/health", "health"],
  ["/api/node/heartbeat", "node-heartbeat"],
  ["/api/nodes", "nodes"],
  ["/api/nodes/resolve", "nodes-resolve"],
  ["/api/usage", "usage"],
]);

const routeHandlers: Record<ApiRouteId, RouteHandlers> = {
  "admin-overview": { GET: (request) => handleAdminOverview(request) },
  "auth-login": { POST: (request) => handleLogin(request) },
  "auth-logout": { POST: (request) => handleLogout(request) },
  "auth-register": { POST: (request) => handleRegister(request) },
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
  "node-rotate-token": {
    POST: (request, route) => handleRotateNodeToken(request, route.nodeId ?? ""),
  },
  nodes: {
    GET: (request) => handleListNodes(request),
    POST: (request) => handleCreateNode(request),
  },
  "nodes-resolve": { GET: (request) => handleResolveNode(request) },
  usage: { GET: (request) => handleUsage(request) },
};

function normalizedPath(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

export function matchApiRoute(pathname: string): ApiRouteMatch | null {
  const path = normalizedPath(pathname);
  const exact = exactRoutes.get(path);
  if (exact) return { id: exact };

  const nodeMatch = path.match(/^\/api\/nodes\/([a-f0-9]{24})(?:\/(rotate-token|revoke-token))?$/);
  if (!nodeMatch) return null;

  const nodeId = nodeMatch[1];
  if (!nodeId) return null;
  if (nodeMatch[2] === "rotate-token") return { id: "node-rotate-token", nodeId };
  if (nodeMatch[2] === "revoke-token") return { id: "node-revoke-token", nodeId };
  return { id: "node", nodeId };
}

function isApiMethod(method: string): method is ApiMethod {
  return apiMethods.some((candidate) => candidate === method);
}

function error(code: string, message: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

export async function dispatchApiRequest(request: Request): Promise<Response> {
  let route: ApiRouteMatch | null;
  try {
    route = matchApiRoute(new URL(request.url).pathname);
  } catch {
    route = null;
  }
  if (!route) return error("NOT_FOUND", "API route not found.", 404);

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
export const POST = dispatchApiRequest;
export const PATCH = dispatchApiRequest;
export const DELETE = dispatchApiRequest;
