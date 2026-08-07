// Daemon management API client — carried over unchanged from the old app/dashboard.tsx (paths,
// headers, and defensive normalize* coercion all preserved verbatim; see the workstream notes).
import type { Analytics, ApiKey, Bucket, ClientConfig, RequestLog, Status, StorageObject } from "./types";

export const DEFAULT_API = "http://127.0.0.1:7272";
export const API_STORAGE_KEY = "openbucket.apiBase";
export const TOKEN_STORAGE_KEY = "openbucket.adminToken";

export function normalizeApiBase(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) management API URL without credentials, query parameters, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function apiRequestUrl(apiBase: string, path: string): string {
  const base = normalizeApiBase(apiBase);
  return `${base}/${path.replace(/^\/+/, "")}`;
}

export function tokenStorageKey(apiBase: string): string {
  return `${TOKEN_STORAGE_KEY}:${encodeURIComponent(apiBase)}`;
}

export function getInitialConnection(): { apiBase: string; adminToken: string } {
  if (typeof window === "undefined") return { apiBase: DEFAULT_API, adminToken: "" };
  const current = new URL(window.location.href);
  const launchApi = current.searchParams.get("api");
  const launchToken = new URLSearchParams(current.hash.replace(/^#/, "")).get("token") ?? "";
  let apiBase: string | undefined;

  if (launchApi) {
    try {
      apiBase = normalizeApiBase(launchApi);
      window.localStorage.setItem(API_STORAGE_KEY, apiBase);
    } catch { /* Ignore an invalid launch hint. */ }
  }
  if (!apiBase) {
    const saved = window.localStorage.getItem(API_STORAGE_KEY);
    if (saved) {
      try { apiBase = normalizeApiBase(saved); } catch { window.localStorage.removeItem(API_STORAGE_KEY); }
    }
  }
  if (!apiBase && process.env.NEXT_PUBLIC_OPENBUCKET_API_URL) {
    try { apiBase = normalizeApiBase(process.env.NEXT_PUBLIC_OPENBUCKET_API_URL); } catch { /* Fall back locally. */ }
  }
  apiBase ??= window.location.port === "7272" ? window.location.origin : DEFAULT_API;

  if (launchApi || current.hash) {
    current.searchParams.delete("api");
    current.hash = "";
    window.history.replaceState({}, "", current);
  }
  if (launchToken && launchApi) window.sessionStorage.setItem(tokenStorageKey(apiBase), launchToken);
  return { apiBase, adminToken: window.sessionStorage.getItem(tokenStorageKey(apiBase)) ?? "" };
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
export function arrayFrom<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const nested = asRecord(value)[key];
  return Array.isArray(nested) ? (nested as T[]) : [];
}

export function normalizeStatus(payload: unknown): Status {
  const raw = asRecord(payload);
  const storage = asRecord(raw.storage);
  const node = asRecord(raw.node);
  const endpoints = asRecord(raw.endpoints);
  return {
    online: raw.online !== false,
    nodeId: String(raw.nodeId ?? node.id ?? "") || undefined,
    nodeName: String(raw.nodeName ?? node.name ?? "") || undefined,
    version: String(raw.version ?? "") || undefined,
    storageRoot: String(raw.storageRoot ?? storage.root ?? storage.path ?? "") || undefined,
    capacityBytes: asNumber(raw.capacityBytes ?? storage.capacityBytes ?? storage.totalBytes),
    usedBytes: asNumber(raw.usedBytes ?? storage.usedBytes),
    filesystemUsedBytes: asNumber(raw.filesystemUsedBytes ?? storage.filesystemUsedBytes),
    availableBytes: asNumber(raw.availableBytes ?? storage.availableBytes ?? storage.freeBytes),
    bucketCount: asNumber(raw.bucketCount ?? storage.bucketCount),
    objectCount: asNumber(raw.objectCount ?? storage.objectCount),
    requestsToday: asNumber(raw.requestsToday),
    uptimeSeconds: asNumber(raw.uptimeSeconds),
    endpoints: {
      management: String(endpoints.management ?? raw.managementUrl ?? "") || undefined,
      s3: String(endpoints.s3 ?? raw.s3Url ?? "") || undefined,
      public: String(endpoints.public ?? raw.publicBaseUrl ?? "") || undefined,
      files: String(endpoints.files ?? raw.filesUrl ?? "") || undefined,
      dashboard: String(endpoints.dashboard ?? raw.dashboardUrl ?? "") || undefined,
    },
  };
}
export function normalizeBucket(value: unknown): Bucket {
  const raw = asRecord(value);
  return {
    name: String(raw.name ?? ""),
    createdAt: String(raw.createdAt ?? "") || undefined,
    public: Boolean(raw.public ?? raw.isPublic),
    objectCount: asNumber(raw.objectCount ?? raw.objects),
    sizeBytes: asNumber(raw.sizeBytes ?? raw.bytes ?? raw.size),
  };
}
export function normalizeObject(value: unknown): StorageObject {
  const raw = asRecord(value);
  return {
    key: String(raw.key ?? raw.name ?? ""),
    sizeBytes: asNumber(raw.sizeBytes ?? raw.size ?? raw.bytes),
    lastModified: String(raw.lastModified ?? raw.modifiedAt ?? "") || undefined,
    etag: String(raw.etag ?? "") || undefined,
    contentType: String(raw.contentType ?? "") || undefined,
    url: String(raw.url ?? "") || undefined,
  };
}
export function normalizeKey(value: unknown): ApiKey {
  const raw = asRecord(value);
  return {
    id: String(raw.id ?? raw.accessKeyId ?? ""),
    name: String(raw.name ?? "Unnamed key"),
    accessKeyId: String(raw.accessKeyId ?? raw.accessKey ?? ""),
    createdAt: String(raw.createdAt ?? "") || undefined,
    readOnly: Boolean(raw.readOnly),
    bucket: raw.bucket ? String(raw.bucket) : null,
  };
}
export function normalizeLog(value: unknown): RequestLog {
  const raw = asRecord(value);
  return {
    requestId: String(raw.requestId ?? raw.id ?? "") || undefined,
    timestamp: String(raw.timestamp ?? raw.time ?? new Date(0).toISOString()),
    method: String(raw.method ?? "GET").toUpperCase(),
    path: String(raw.path ?? raw.url ?? "/"),
    status: asNumber(raw.status),
    durationMs: asNumber(raw.durationMs ?? raw.duration),
    bytesIn: asNumber(raw.bytesIn),
    bytesOut: asNumber(raw.bytesOut ?? raw.bytes),
    ip: String(raw.ip ?? raw.source ?? "") || undefined,
  };
}
export function normalizeAnalytics(value: unknown): Analytics {
  const raw = asRecord(value);
  const statusCodes = asRecord(raw.statusCodes);
  const errors = Object.entries(statusCodes).reduce((sum, [code, count]) => sum + (Number(code) >= 400 ? asNumber(count) : 0), 0);
  return {
    requests: asNumber(raw.requests ?? raw.totalRequests),
    totalBytesIn: asNumber(raw.totalBytesIn ?? raw.bytesIn),
    totalBytesOut: asNumber(raw.totalBytesOut ?? raw.bytesOut),
    requestsToday: asNumber(raw.requestsToday),
    averageLatencyMs: asNumber(raw.averageLatencyMs ?? raw.avgLatencyMs),
    errors: asNumber(raw.errors, errors),
    methods: Object.fromEntries(Object.entries(asRecord(raw.methods)).map(([key, count]) => [key, asNumber(count)])),
    statusCodes: Object.fromEntries(Object.entries(statusCodes).map(([key, count]) => [key, asNumber(count)])),
  };
}

export { asRecord };
export type NodeApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Builds the bearer-authed fetch wrapper used by every node view (unchanged contract). */
export function makeApiFetch(apiBase: string, adminToken: string): NodeApiFetch {
  return async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-OpenBucket-Client", "dashboard");
    if (adminToken) headers.set("Authorization", `Bearer ${adminToken}`);
    const response = await fetch(apiRequestUrl(apiBase, path), { ...init, headers });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = asRecord(payload).error;
      const message = typeof error === "string" ? error : String(asRecord(error).message ?? asRecord(payload).message ?? `Request failed (${response.status})`);
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };
}

export type { ClientConfig };
