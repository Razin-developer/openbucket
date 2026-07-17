export const PRODUCTION_SESSION_COOKIE = "__Host-openbucket_session";
export const DEVELOPMENT_SESSION_COOKIE = "openbucket_session";

type ErrorPayload = { error: { code: string; message: string } };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers?: HeadersInit;

  constructor(status: number, code: string, message: string, headers?: HeadersInit) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function jsonResponse(payload: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(payload, { status, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } } satisfies ErrorPayload,
      error.status,
      error.headers,
    );
  }
  const safeErrorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : "UnknownError";
  const safeErrorCode = error && typeof error === "object" && "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
    ? String(error.code).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64)
    : "";
  console.error("OpenBucket authentication request failed.", safeErrorName, safeErrorCode);
  return jsonResponse(
    { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable." } } satisfies ErrorPayload,
    500,
  );
}

export function assertMethod(request: Request, method: string): void {
  if (request.method.toUpperCase() !== method) {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method not allowed.", { Allow: method });
  }
}

export function assertSameOriginPost(request: Request): void {
  assertMethod(request, "POST");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  }

  const origin = request.headers.get("origin");
  if (!origin) throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  let requestOrigin: string;
  let suppliedOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }
  if (origin !== suppliedOrigin || suppliedOrigin !== requestOrigin) {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }
}

export async function readJsonObject(request: Request, maximumBytes = 16 * 1024): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text || "{}");
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  return new URL(request.url).protocol === "https:" || forwarded === "https";
}

function parseCookieHeader(request: Request): Map<string, string> {
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 8192) return new Map();
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export function getSessionToken(request: Request): string | null {
  const cookies = parseCookieHeader(request);
  const production = cookies.get(PRODUCTION_SESSION_COOKIE);
  const development = cookies.get(DEVELOPMENT_SESSION_COOKIE);
  const token = production ?? (!isSecureRequest(request) ? development : undefined);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function sessionCookie(request: Request, token: string, maximumAgeSeconds: number): string {
  const secure = isSecureRequest(request);
  const name = secure ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
  const expires = new Date(Date.now() + maximumAgeSeconds * 1000).toUTCString();
  return `${name}=${token}; Path=/; Max-Age=${maximumAgeSeconds}; Expires=${expires}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookies(): string[] {
  const expired = "Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict";
  return [
    `${PRODUCTION_SESSION_COOKIE}=; ${expired}; Secure`,
    `${DEVELOPMENT_SESSION_COOKIE}=; ${expired}`,
  ];
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
  const candidate = forwarded?.split(",", 1)[0]?.trim();
  if (candidate && candidate.length <= 64 && /^[0-9a-fA-F:.]+$/.test(candidate)) return candidate;
  return "unknown";
}
