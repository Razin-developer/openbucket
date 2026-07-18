"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type View = "overview" | "buckets" | "keys" | "connections" | "logs";
type EndpointSet = { management?: string; s3?: string; public?: string; files?: string; dashboard?: string };
type Status = {
  online: boolean; nodeId?: string; nodeName?: string; version?: string; storageRoot?: string;
  capacityBytes: number; usedBytes: number; filesystemUsedBytes: number; availableBytes: number; bucketCount: number;
  objectCount: number; requestsToday: number; uptimeSeconds: number; endpoints: EndpointSet;
};
type Bucket = { name: string; createdAt?: string; public: boolean; objectCount: number; sizeBytes: number };
type StorageObject = { key: string; sizeBytes: number; lastModified?: string; etag?: string; contentType?: string; url?: string };
type ApiKey = { id: string; name: string; accessKeyId: string; createdAt?: string; readOnly?: boolean; bucket?: string | null };
type RequestLog = { requestId?: string; timestamp: string; method: string; path: string; status: number; durationMs: number; bytesIn: number; bytesOut: number; ip?: string };
type Analytics = { requests: number; totalBytesIn: number; totalBytesOut: number; requestsToday: number; averageLatencyMs: number; errors: number; methods: Record<string, number>; statusCodes: Record<string, number> };
type ClientConfig = { nodeId?: string; nodeName?: string; managementUrl?: string; s3Url?: string; publicBaseUrl?: string; filesUrl?: string; dashboardUrl?: string; storageRoot?: string };
type LoadState = "loading" | "connected" | "disconnected";
type Toast = { id: number; tone: "success" | "error"; message: string };

const DEFAULT_API = "http://127.0.0.1:7272";
const API_STORAGE_KEY = "openbucket.apiBase";
const TOKEN_STORAGE_KEY = "openbucket.adminToken";

function normalizeApiBase(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) management API URL without credentials, query parameters, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function tokenStorageKey(apiBase: string): string {
  return `${TOKEN_STORAGE_KEY}:${encodeURIComponent(apiBase)}`;
}

function getInitialConnection(): { apiBase: string; adminToken: string } {
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
function arrayFrom<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const nested = asRecord(value)[key];
  return Array.isArray(nested) ? (nested as T[]) : [];
}
function normalizeStatus(payload: unknown): Status {
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
function normalizeBucket(value: unknown): Bucket {
  const raw = asRecord(value);
  return { name: String(raw.name ?? ""), createdAt: String(raw.createdAt ?? "") || undefined, public: Boolean(raw.public ?? raw.isPublic), objectCount: asNumber(raw.objectCount ?? raw.objects), sizeBytes: asNumber(raw.sizeBytes ?? raw.bytes ?? raw.size) };
}
function normalizeObject(value: unknown): StorageObject {
  const raw = asRecord(value);
  return { key: String(raw.key ?? raw.name ?? ""), sizeBytes: asNumber(raw.sizeBytes ?? raw.size ?? raw.bytes), lastModified: String(raw.lastModified ?? raw.modifiedAt ?? "") || undefined, etag: String(raw.etag ?? "") || undefined, contentType: String(raw.contentType ?? "") || undefined, url: String(raw.url ?? "") || undefined };
}
function normalizeKey(value: unknown): ApiKey {
  const raw = asRecord(value);
  return { id: String(raw.id ?? raw.accessKeyId ?? ""), name: String(raw.name ?? "Unnamed key"), accessKeyId: String(raw.accessKeyId ?? raw.accessKey ?? ""), createdAt: String(raw.createdAt ?? "") || undefined, readOnly: Boolean(raw.readOnly), bucket: raw.bucket ? String(raw.bucket) : null };
}
function normalizeLog(value: unknown): RequestLog {
  const raw = asRecord(value);
  return { requestId: String(raw.requestId ?? raw.id ?? "") || undefined, timestamp: String(raw.timestamp ?? raw.time ?? new Date(0).toISOString()), method: String(raw.method ?? "GET").toUpperCase(), path: String(raw.path ?? raw.url ?? "/"), status: asNumber(raw.status), durationMs: asNumber(raw.durationMs ?? raw.duration), bytesIn: asNumber(raw.bytesIn), bytesOut: asNumber(raw.bytesOut ?? raw.bytes), ip: String(raw.ip ?? raw.source ?? "") || undefined };
}
function normalizeAnalytics(value: unknown): Analytics {
  const raw = asRecord(value);
  const statusCodes = asRecord(raw.statusCodes);
  const errors = Object.entries(statusCodes).reduce((sum, [code, count]) => sum + (Number(code) >= 400 ? asNumber(count) : 0), 0);
  return {
    requests: asNumber(raw.requests ?? raw.totalRequests), totalBytesIn: asNumber(raw.totalBytesIn ?? raw.bytesIn), totalBytesOut: asNumber(raw.totalBytesOut ?? raw.bytesOut), requestsToday: asNumber(raw.requestsToday), averageLatencyMs: asNumber(raw.averageLatencyMs ?? raw.avgLatencyMs), errors: asNumber(raw.errors, errors),
    methods: Object.fromEntries(Object.entries(asRecord(raw.methods)).map(([key, count]) => [key, asNumber(count)])),
    statusCodes: Object.fromEntries(Object.entries(statusCodes).map(([key, count]) => [key, asNumber(count)])),
  };
}
function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unit;
  return `${scaled >= 100 || unit === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`;
}
function formatNumber(value: number) { return new Intl.NumberFormat("en", { notation: value >= 100_000 ? "compact" : "standard" }).format(value); }
function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function methodTone(method: string) {
  if (["PUT", "POST"].includes(method)) return "method-write";
  if (method === "DELETE") return "method-delete";
  return "method-read";
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="metric-card"><p className="eyebrow">{label}</p><p className="metric-value">{value}</p>{detail ? <p className="metric-detail">{detail}</p> : null}</article>;
}
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark" aria-hidden="true">OB</div><h3>{title}</h3><p>{body}</p>{action}</div>;
}
function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><p className="eyebrow">OpenBucket</p><h2 id="modal-title">{title}</h2>{description ? <p>{description}</p> : null}</div><button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</section></div>;
}
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="copy-button" type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? "Copied" : label}</button>;
}

export function Dashboard({ initialConnection }: { initialConnection?: { apiBase: string; token: string; displayUrl?: string } } = {}) {
  const [activeView, setActiveView] = useState<View>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [adminToken, setAdminToken] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [lastError, setLastError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>(() => normalizeAnalytics({}));
  const [clientConfig, setClientConfig] = useState<ClientConfig>({});
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [objectPrefix, setObjectPrefix] = useState("");
  const [logFilter, setLogFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [createBucketOpen, setCreateBucketOpen] = useState(false);
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<Record<string, string> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const connectionGeneration = useRef(0);

  const clearNodeState = useCallback(() => {
    setStatus(null);
    setBuckets([]);
    setKeys([]);
    setLogs([]);
    setAnalytics(normalizeAnalytics({}));
    setClientConfig({});
    setSelectedBucket(null);
    setObjects([]);
    setObjectPrefix("");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const initial = initialConnection ?? getInitialConnection();
      connectionGeneration.current += 1;
      setApiBase(initial.apiBase);
      setAdminToken("token" in initial ? initial.token : initial.adminToken);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialConnection]);
  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3600);
  }, []);
  const apiFetch = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json"); headers.set("X-OpenBucket-Client", "dashboard");
    if (adminToken) headers.set("Authorization", `Bearer ${adminToken}`);
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = asRecord(payload).error;
      const message = typeof error === "string" ? error : String(asRecord(error).message ?? asRecord(payload).message ?? `Request failed (${response.status})`);
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }, [adminToken, apiBase]);
  const refresh = useCallback(async (quiet = false) => {
    const generation = connectionGeneration.current;
    if (!quiet) setLoadState("loading");
    try {
      const [statusPayload, bucketPayload, keyPayload, logPayload, analyticsPayload, configPayload] = await Promise.all([
        apiFetch<unknown>("/v1/status"), apiFetch<unknown>("/v1/buckets"), apiFetch<unknown>("/v1/keys"), apiFetch<unknown>("/v1/logs?limit=100"), apiFetch<unknown>("/v1/analytics"), apiFetch<ClientConfig>("/v1/config/client"),
      ]);
      if (generation !== connectionGeneration.current) return;
      setStatus(normalizeStatus(statusPayload)); setBuckets(arrayFrom<unknown>(bucketPayload, "buckets").map(normalizeBucket)); setKeys(arrayFrom<unknown>(keyPayload, "keys").map(normalizeKey)); setLogs(arrayFrom<unknown>(logPayload, "logs").map(normalizeLog)); setAnalytics(normalizeAnalytics(analyticsPayload)); setClientConfig(configPayload ?? {});
      setLoadState("connected"); setLastError(""); setLastUpdated(new Date());
    } catch (error) {
      if (generation !== connectionGeneration.current) return;
      setLoadState("disconnected"); setLastError(error instanceof Error ? error.message : "Unable to reach the OpenBucket daemon"); clearNodeState();
    }
  }, [apiFetch, clearNodeState]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(true), 10_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);
  const loadObjects = useCallback(async (bucket: string, prefix = "") => {
    const generation = connectionGeneration.current;
    setBusy("objects");
    try { const payload = await apiFetch<unknown>(`/v1/buckets/${encodeURIComponent(bucket)}/objects?prefix=${encodeURIComponent(prefix)}`); if (generation !== connectionGeneration.current) return; setObjects(arrayFrom<unknown>(payload, "objects").map(normalizeObject)); setSelectedBucket(bucket); setObjectPrefix(prefix); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not load objects", "error"); }
    finally { setBusy(""); }
  }, [apiFetch, notify]);
  const saveConnection = (nextApi: string, nextToken: string) => {
    let normalized: string;
    try { normalized = normalizeApiBase(nextApi.trim() || DEFAULT_API); }
    catch (error) { notify(error instanceof Error ? error.message : "Invalid management API URL", "error"); return; }
    window.localStorage.setItem(API_STORAGE_KEY, normalized);
    const storageKey = tokenStorageKey(normalized);
    if (nextToken.trim()) window.sessionStorage.setItem(storageKey, nextToken.trim()); else window.sessionStorage.removeItem(storageKey);
    connectionGeneration.current += 1; clearNodeState(); setLoadState("loading"); setLastUpdated(null);
    setApiBase(normalized); setAdminToken(nextToken.trim()); setConnectionOpen(false);
  };

  const capacityPercent = status?.capacityBytes ? Math.min(100, (status.filesystemUsedBytes / status.capacityBytes) * 100) : 0;
  const endpoint = "${OPENBUCKET_S3_ENDPOINT}";
  const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/Razin-developer/openbucket/tree/main/docs";
  const accessKey = keys[0]?.accessKeyId ?? "YOUR_ACCESS_KEY";
  const navItems: Array<{ id: View; label: string; glyph: string }> = [
    { id: "overview", label: "Overview", glyph: "⌂" }, { id: "buckets", label: "Buckets", glyph: "□" }, { id: "keys", label: "API keys", glyph: "⌁" }, { id: "connections", label: "Connections", glyph: "↔" }, { id: "logs", label: "Logs & analytics", glyph: "≡" },
  ];
  const visibleLogs = useMemo(() => logs.filter((log) => logFilter === "all" || (logFilter === "errors" ? log.status >= 400 : log.method === logFilter)), [logFilter, logs]);

  const renderOverview = () => <>
    <section className="overview-hero">
      <div className="hero-copy"><p className="eyebrow">Local storage node</p><div className="hero-status-row"><span className={`status-dot ${loadState === "connected" ? "online" : "offline"}`} aria-hidden="true" /><span>{loadState === "connected" ? "Online" : loadState === "loading" ? "Connecting" : "Offline"}</span></div><h1>{status?.nodeName || "Connect your first disk."}</h1><p className="hero-lead">{status?.storageRoot ? `${status.storageRoot} is serving real objects through an S3-compatible endpoint.` : "Run one command to turn a folder, SSD, USB drive, or NAS mount into object storage."}</p><div className="hero-actions"><button className="button primary" type="button" onClick={() => setActiveView(status ? "buckets" : "connections")}>{status ? "Manage buckets" : "Connect daemon"}</button><button className="button secondary" type="button" onClick={() => setActiveView("connections")}>View endpoints</button></div></div>
      <div className="capacity-panel"><div className="capacity-ring" style={{ "--capacity": `${capacityPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{capacityPercent.toFixed(capacityPercent >= 10 ? 0 : 1)}%</strong><span>disk used</span></div></div><dl><div><dt>Managed</dt><dd>{formatBytes(status?.usedBytes ?? 0)}</dd></div><div><dt>Available</dt><dd>{formatBytes(status?.availableBytes ?? 0)}</dd></div><div><dt>Capacity</dt><dd>{formatBytes(status?.capacityBytes ?? 0)}</dd></div></dl></div>
    </section>
    {loadState === "disconnected" ? <section className="connection-alert" role="alert"><div><p className="eyebrow">Daemon not reachable</p><h2>Your files stay untouched until you connect.</h2><p>{lastError}. Start a node, then refresh this page.</p></div><div className="command-row"><code>openbucket serve D:\OpenBucket</code><CopyButton value="openbucket serve D:\OpenBucket" /></div><div className="alert-actions"><button className="button primary compact" type="button" onClick={() => void refresh()}>Try again</button><button className="button secondary compact" type="button" onClick={() => setConnectionOpen(true)}>Change API URL</button></div></section> : null}
    <section className="metrics-grid" aria-label="Node metrics"><MetricCard label="Buckets" value={formatNumber(status?.bucketCount ?? 0)} detail="Mapped to real directories" /><MetricCard label="Objects" value={formatNumber(status?.objectCount ?? 0)} detail={formatBytes(status?.usedBytes ?? 0)} /><MetricCard label="Requests today" value={formatNumber(status?.requestsToday ?? 0)} detail={`${formatNumber(analytics.requests)} all time`} /><MetricCard label="Uptime" value={formatDuration(status?.uptimeSeconds ?? 0)} detail={status?.version ? `OpenBucket ${status.version}` : "Daemon not connected"} /></section>
    <section className="split-grid"><article className="panel"><div className="panel-head"><div><p className="eyebrow">S3 endpoint</p><h2>Ready for existing tools.</h2></div><span className={`status-badge ${status ? "success" : "neutral"}`}>{status ? "Active" : "Waiting"}</span></div><div className="endpoint-box"><code>{endpoint}</code><CopyButton value={endpoint} /></div><p className="panel-note">Path-style requests work with AWS SDKs, Boto3, the AWS CLI, backup tools, and frameworks.</p></article><article className="panel quickstart-panel"><div className="panel-head"><div><p className="eyebrow">Quick start</p><h2>Upload from any app.</h2></div></div><pre><code>{`aws s3 cp ./photo.png s3://assets/photo.png \\\n  --endpoint-url ${endpoint}`}</code></pre><button className="text-button" type="button" onClick={() => setActiveView("connections")}>Open all integration examples →</button></article></section>
  </>;

  const createBucket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy("create-bucket");
    try { await apiFetch("/v1/buckets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(form.get("name") ?? ""), public: form.get("public") === "on" }) }); setCreateBucketOpen(false); notify("Bucket created"); await refresh(true); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not create bucket", "error"); }
    finally { setBusy(""); }
  };
  const deleteBucket = async (bucket: Bucket) => {
    if (!window.confirm(`Delete bucket “${bucket.name}”? The daemon refuses non-empty bucket deletion.`)) return;
    try { await apiFetch(`/v1/buckets/${encodeURIComponent(bucket.name)}`, { method: "DELETE" }); if (selectedBucket === bucket.name) setSelectedBucket(null); notify("Bucket deleted"); await refresh(true); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not delete bucket", "error"); }
  };
  const uploadObject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file || !selectedBucket) return;
    const key = objectPrefix ? `${objectPrefix.replace(/\/$/, "")}/${file.name}` : file.name; setBusy("upload");
    try { await apiFetch(`/v1/buckets/${encodeURIComponent(selectedBucket)}/objects/${key.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers: file.type ? { "Content-Type": file.type } : {}, body: file }); notify(`${file.name} uploaded`); await loadObjects(selectedBucket, objectPrefix); await refresh(true); }
    catch (error) { notify(error instanceof Error ? error.message : "Upload failed", "error"); }
    finally { setBusy(""); event.target.value = ""; }
  };
  const downloadObject = async (object: StorageObject) => {
    if (!selectedBucket) return;
    try { const headers = new Headers({ "X-OpenBucket-Client": "dashboard" }); if (adminToken) headers.set("Authorization", `Bearer ${adminToken}`); const path = object.key.split("/").map(encodeURIComponent).join("/"); const response = await fetch(`${apiBase}/v1/buckets/${encodeURIComponent(selectedBucket)}/objects/${path}`, { headers }); if (!response.ok) throw new Error(`Download failed (${response.status})`); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = object.key.split("/").at(-1) || object.key; anchor.click(); URL.revokeObjectURL(url); }
    catch (error) { notify(error instanceof Error ? error.message : "Download failed", "error"); }
  };
  const deleteObject = async (object: StorageObject) => {
    if (!selectedBucket || !window.confirm(`Delete “${object.key}”? This cannot be undone.`)) return;
    try { const path = object.key.split("/").map(encodeURIComponent).join("/"); await apiFetch(`/v1/buckets/${encodeURIComponent(selectedBucket)}/objects/${path}`, { method: "DELETE" }); notify("Object deleted"); await loadObjects(selectedBucket, objectPrefix); await refresh(true); }
    catch (error) { notify(error instanceof Error ? error.message : "Delete failed", "error"); }
  };
  const shareObject = async (object: StorageObject) => {
    if (!selectedBucket) return;
    try { const result = await apiFetch<Record<string, string>>(`/v1/buckets/${encodeURIComponent(selectedBucket)}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: object.key, expiresIn: 3600 }) }); const url = result.url ?? result.shareUrl; if (!url) throw new Error("The daemon did not return a share URL"); await navigator.clipboard.writeText(url); notify("One-hour share link copied"); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not create share link", "error"); }
  };

  const renderBuckets = () => <section><div className="page-heading"><div><p className="eyebrow">Object storage</p><h1>Buckets</h1><p>Each bucket is a confined directory inside your selected storage root.</p></div><button className="button primary compact" type="button" onClick={() => setCreateBucketOpen(true)} disabled={loadState !== "connected"}>Create bucket</button></div>
    {!selectedBucket ? buckets.length ? <div className="table-card"><table><thead><tr><th>Name</th><th>Objects</th><th>Size</th><th>Access</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{buckets.map((bucket) => <tr key={bucket.name}><td><button className="bucket-link" type="button" onClick={() => void loadObjects(bucket.name)}><span className="bucket-glyph">□</span>{bucket.name}</button></td><td>{formatNumber(bucket.objectCount)}</td><td>{formatBytes(bucket.sizeBytes)}</td><td><span className={`status-badge ${bucket.public ? "info" : "neutral"}`}>{bucket.public ? "Public" : "Private"}</span></td><td>{formatDate(bucket.createdAt)}</td><td className="row-actions"><button className="text-button danger" type="button" onClick={() => void deleteBucket(bucket)}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyState title="No buckets yet." body="Create a bucket to map a safe namespace inside this storage root." action={<button className="button primary compact" type="button" onClick={() => setCreateBucketOpen(true)} disabled={loadState !== "connected"}>Create your first bucket</button>} /> :
    <div className="object-browser"><div className="browser-toolbar"><div><button className="back-button" type="button" onClick={() => { setSelectedBucket(null); setObjects([]); }}>← All buckets</button><h2>{selectedBucket}</h2><p>{objects.length} visible object{objects.length === 1 ? "" : "s"}</p></div><div className="toolbar-actions"><label className={`button primary compact upload-button ${busy === "upload" ? "disabled" : ""}`}>{busy === "upload" ? "Uploading…" : "Upload file"}<input type="file" onChange={(event) => void uploadObject(event)} disabled={busy === "upload"} /></label><button className="button secondary compact" type="button" onClick={() => void loadObjects(selectedBucket, objectPrefix)}>Refresh</button></div></div><div className="prefix-bar"><label htmlFor="prefix">Prefix</label><input id="prefix" value={objectPrefix} onChange={(event) => setObjectPrefix(event.target.value)} placeholder="photos/2026" onKeyDown={(event) => event.key === "Enter" && void loadObjects(selectedBucket, objectPrefix)} /><button type="button" onClick={() => void loadObjects(selectedBucket, objectPrefix)}>Apply</button></div>{busy === "objects" ? <div className="loading-rows" aria-label="Loading objects"><i /><i /><i /></div> : objects.length ? <div className="table-card flush"><table><thead><tr><th>Object key</th><th>Size</th><th>Modified</th><th>ETag</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{objects.map((object) => <tr key={object.key}><td className="object-key">{object.key}</td><td>{formatBytes(object.sizeBytes)}</td><td>{formatDate(object.lastModified)}</td><td><code className="etag">{object.etag?.replaceAll('"', "").slice(0, 14) || "—"}</code></td><td><div className="inline-actions"><button type="button" onClick={() => void downloadObject(object)}>Download</button><button type="button" onClick={() => void shareObject(object)}>Share</button><button className="danger" type="button" onClick={() => void deleteObject(object)}>Delete</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="This bucket is empty." body="Upload a file here or send a PutObject request to the S3 endpoint." />}</div>}
  </section>;

  const createKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy("create-key");
    try { const result = await apiFetch<Record<string, unknown>>("/v1/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(form.get("name") || "API key"), readOnly: form.get("readOnly") === "on", bucket: String(form.get("bucket") || "") || undefined }) }); setCreateKeyOpen(false); setRevealedKey(asRecord(result.key ?? result) as Record<string, string>); await refresh(true); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not create key", "error"); }
    finally { setBusy(""); }
  };
  const revokeKey = async (key: ApiKey) => {
    if (!window.confirm(`Revoke “${key.name}”? Applications using it will stop working immediately.`)) return;
    try { await apiFetch(`/v1/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" }); notify("API key revoked"); await refresh(true); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not revoke key", "error"); }
  };
  const renderKeys = () => <section><div className="page-heading"><div><p className="eyebrow">Credentials</p><h1>API keys</h1><p>Issue independent S3 credentials and revoke them without restarting the node.</p></div><button className="button primary compact" type="button" onClick={() => setCreateKeyOpen(true)} disabled={loadState !== "connected"}>Create API key</button></div><div className="security-note"><span aria-hidden="true">⌁</span><div><strong>Secrets are shown once.</strong><p>OpenBucket stores what it needs to verify S3 signatures. Keep the storage root and its <code>.openbucket</code> metadata private.</p></div></div>{keys.length ? <div className="table-card"><table><thead><tr><th>Name</th><th>Access key</th><th>Scope</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td className="strong-cell">{key.name}</td><td><div className="inline-code"><code>{key.accessKeyId}</code><CopyButton value={key.accessKeyId} /></div></td><td>{key.bucket ? `${key.bucket} · ` : "All buckets · "}{key.readOnly ? "Read only" : "Read/write"}</td><td>{formatDate(key.createdAt)}</td><td className="row-actions"><button className="text-button danger" type="button" onClick={() => void revokeKey(key)}>Revoke</button></td></tr>)}</tbody></table></div> : <EmptyState title="No API keys available." body="Create credentials for your first S3 client. The initial key is printed by the daemon on first run." />}</section>;

  const snippets = useMemo(() => ({
    javascript: `import { S3Client } from "@aws-sdk/client-s3";\n\nconst s3 = new S3Client({\n  endpoint: "${endpoint}",\n  region: "auto",\n  forcePathStyle: true,\n  credentials: {\n    accessKeyId: process.env.OPENBUCKET_ACCESS_KEY,\n    secretAccessKey: process.env.OPENBUCKET_SECRET_KEY,\n  },\n});`,
    python: `import os\nimport boto3\n\ns3 = boto3.client(\n    "s3",\n    endpoint_url="${endpoint}",\n    region_name="auto",\n    aws_access_key_id=os.environ["OPENBUCKET_ACCESS_KEY"],\n    aws_secret_access_key=os.environ["OPENBUCKET_SECRET_KEY"],\n)`,
    aws: `AWS_ACCESS_KEY_ID=${accessKey} aws s3 ls \\\n  --endpoint-url ${endpoint}`,
    curl: `curl -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \\\n  ${apiBase}/v1/status`,
  }), [accessKey, apiBase, endpoint]);
  const [snippetTab, setSnippetTab] = useState<keyof typeof snippets>("javascript");
  const renderConnections = () => <section><div className="page-heading"><div><p className="eyebrow">Developer setup</p><h1>Connections</h1><p>Use standard S3 clients. Change the endpoint, keep the ecosystem.</p></div><button className="button secondary compact" type="button" onClick={() => setConnectionOpen(true)}>Dashboard connection</button></div><div className="endpoint-grid">{[
      ["OpenBucket API", initialConnection?.displayUrl ?? (typeof window === "undefined" ? "OpenBucket" : window.location.origin), "Use this OpenBucket URL to manage the node."], ["S3 service", loadState === "connected" ? "Available" : "Not connected", "Provide OPENBUCKET_S3_ENDPOINT to your workload."], ["File sharing", loadState === "connected" ? "Available" : "Not connected", "Create expiring links from the Buckets page."],
    ].map(([label, value, note]) => <article className="endpoint-card" key={label}><p className="eyebrow">{label}</p><div className="endpoint-value"><code>{value}</code>{label === "OpenBucket API" ? <CopyButton value={value} /> : null}</div><p>{note}</p></article>)}</div><article className="code-panel"><div className="code-panel-head"><div><p className="eyebrow">Copy, paste, connect</p><h2>Client configuration</h2></div><CopyButton value={snippets[snippetTab]} label="Copy snippet" /></div><div className="tabs" role="tablist" aria-label="Client examples">{(["javascript", "python", "aws", "curl"] as const).map((tab) => <button key={tab} role="tab" aria-selected={snippetTab === tab} type="button" onClick={() => setSnippetTab(tab)}>{tab === "aws" ? "AWS CLI" : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div><pre><code>{snippets[snippetTab]}</code></pre></article><article className="env-panel"><div><p className="eyebrow">Environment</p><h2>Everything is configurable.</h2><p>Keep workload endpoints in your deployment environment, not in source code or the dashboard.</p></div><div className="env-list"><code>OPENBUCKET_S3_ENDPOINT=https://your-s3-endpoint</code><code>OPENBUCKET_API_URL=https://your-openbucket-api</code></div></article></section>;

  const renderLogs = () => <section><div className="page-heading"><div><p className="eyebrow">Observability</p><h1>Logs & analytics</h1><p>Every figure is computed from requests handled by this node.</p></div><button className="button secondary compact" type="button" onClick={() => void refresh()}>Refresh</button></div><div className="metrics-grid compact-grid"><MetricCard label="Total requests" value={formatNumber(analytics.requests)} detail={`${formatNumber(analytics.requestsToday)} today`} /><MetricCard label="Uploaded" value={formatBytes(analytics.totalBytesIn)} detail="Request body bytes" /><MetricCard label="Downloaded" value={formatBytes(analytics.totalBytesOut)} detail="Response body bytes" /><MetricCard label="Errors" value={formatNumber(analytics.errors)} detail={analytics.requests ? `${((analytics.errors / analytics.requests) * 100).toFixed(2)}% error rate` : "No requests yet"} /></div><div className="logs-toolbar"><div className="filter-pills" role="group" aria-label="Filter request logs">{["all", "GET", "PUT", "POST", "DELETE", "errors"].map((filter) => <button key={filter} className={logFilter === filter ? "active" : ""} type="button" onClick={() => setLogFilter(filter)}>{filter === "all" ? "All requests" : filter === "errors" ? "Errors" : filter}</button>)}</div><span>{visibleLogs.length} shown</span></div>{visibleLogs.length ? <div className="table-card logs-table"><table><thead><tr><th>Time</th><th>Method</th><th>Request</th><th>Status</th><th>Transfer</th><th>Duration</th></tr></thead><tbody>{visibleLogs.map((log, index) => <tr key={log.requestId ?? `${log.timestamp}-${index}`}><td>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td><span className={`method ${methodTone(log.method)}`}>{log.method}</span></td><td className="log-path"><code>{log.path}</code>{log.ip ? <small>{log.ip}</small> : null}</td><td><span className={`status-code ${log.status >= 400 ? "bad" : "good"}`}>{log.status || "—"}</span></td><td>{formatBytes(log.bytesOut || log.bytesIn)}</td><td>{log.durationMs.toFixed(log.durationMs < 10 ? 1 : 0)} ms</td></tr>)}</tbody></table></div> : <EmptyState title="No matching requests." body="Use the S3 endpoint or upload an object from the Buckets page; handled requests will appear here." />}</section>;

  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}><div className="brand-row"><div className="brand-mark" aria-hidden="true">OB</div><div><strong>OpenBucket</strong><span>Local control plane</span></div><button className="mobile-close" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>×</button></div><nav aria-label="Main navigation">{navItems.map((item) => <button key={item.id} className={activeView === item.id ? "active" : ""} type="button" onClick={() => { setActiveView(item.id); setMobileNavOpen(false); }}><span aria-hidden="true">{item.glyph}</span>{item.label}</button>)}</nav><div className="sidebar-node"><div className="node-state"><span className={`status-dot ${loadState === "connected" ? "online" : "offline"}`} /><span>{loadState === "connected" ? "Daemon online" : "Daemon offline"}</span></div><strong>{status?.nodeName ?? "No node connected"}</strong><small>{status?.storageRoot ?? apiBase}</small><button type="button" onClick={() => setConnectionOpen(true)}>Connection settings</button></div></aside>{mobileNavOpen ? <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}<div className="workspace"><header className="topbar"><button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>☰</button><div className="breadcrumbs"><span>OpenBucket</span><b>/</b><strong>{navItems.find((item) => item.id === activeView)?.label}</strong></div><div className="topbar-actions"><span className="last-updated">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not connected"}</span><button className="icon-button" type="button" aria-label="Refresh data" onClick={() => void refresh()}>↻</button><a className="docs-link" href={docsUrl} target="_blank" rel="noreferrer">Docs ↗</a></div></header><main id="main-content" className="main-content">{activeView === "overview" ? renderOverview() : null}{activeView === "buckets" ? renderBuckets() : null}{activeView === "keys" ? renderKeys() : null}{activeView === "connections" ? renderConnections() : null}{activeView === "logs" ? renderLogs() : null}</main></div>
    {createBucketOpen ? <Modal title="Create a bucket" description="Bucket names use S3-compatible lowercase naming rules." onClose={() => setCreateBucketOpen(false)}><form className="form-stack" onSubmit={(event) => void createBucket(event)}><label><span>Bucket name</span><input name="name" required minLength={3} maxLength={63} pattern="[a-z0-9][a-z0-9.-]*[a-z0-9]" placeholder="project-assets" autoFocus /></label><label className="check-row"><input name="public" type="checkbox" /><span><strong>Allow anonymous downloads</strong><small>Uploads and management still require credentials.</small></span></label><div className="modal-actions"><button className="button secondary compact" type="button" onClick={() => setCreateBucketOpen(false)}>Cancel</button><button className="button primary compact" type="submit" disabled={busy === "create-bucket"}>{busy === "create-bucket" ? "Creating…" : "Create bucket"}</button></div></form></Modal> : null}
    {createKeyOpen ? <Modal title="Create an API key" description="The secret is available once, immediately after creation." onClose={() => setCreateKeyOpen(false)}><form className="form-stack" onSubmit={(event) => void createKey(event)}><label><span>Key name</span><input name="name" required placeholder="production-backups" autoFocus /></label><label><span>Bucket scope</span><select name="bucket"><option value="">All buckets</option>{buckets.map((bucket) => <option key={bucket.name} value={bucket.name}>{bucket.name}</option>)}</select></label><label className="check-row"><input name="readOnly" type="checkbox" /><span><strong>Read-only access</strong><small>Allow listing and downloading, but block writes and deletes.</small></span></label><div className="modal-actions"><button className="button secondary compact" type="button" onClick={() => setCreateKeyOpen(false)}>Cancel</button><button className="button primary compact" type="submit" disabled={busy === "create-key"}>{busy === "create-key" ? "Creating…" : "Create key"}</button></div></form></Modal> : null}
    {revealedKey ? <Modal title="Save this secret now" description="OpenBucket will not display this secret again." onClose={() => setRevealedKey(null)}><div className="secret-grid">{[["Access key", revealedKey.accessKeyId ?? revealedKey.accessKey ?? ""], ["Secret key", revealedKey.secretAccessKey ?? revealedKey.secretKey ?? ""]].map(([label, value]) => <div key={label}><span>{label}</span><code>{value}</code><CopyButton value={value} /></div>)}</div><div className="modal-actions"><button className="button primary compact" type="button" onClick={() => setRevealedKey(null)}>I saved the secret</button></div></Modal> : null}
    {connectionOpen ? <ConnectionModal apiBase={apiBase} adminToken={adminToken} onSave={saveConnection} onClose={() => setConnectionOpen(false)} /> : null}<div className="toast-region" aria-live="polite">{toasts.map((toast) => <div className={`toast ${toast.tone}`} key={toast.id}><span>{toast.tone === "success" ? "✓" : "!"}</span>{toast.message}</div>)}</div></div>;
}

function ConnectionModal({ apiBase, adminToken, onSave, onClose }: { apiBase: string; adminToken: string; onSave: (api: string, token: string) => void; onClose: () => void }) {
  const [api, setApi] = useState(apiBase); const [token, setToken] = useState(adminToken);
  return <Modal title="Dashboard connection" description="Point this browser at a local or remotely exposed management API." onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(api, token); }}><label><span>Management API URL</span><input type="url" value={api} onChange={(event) => setApi(event.target.value)} required placeholder="http://127.0.0.1:7272" autoFocus /></label><label><span>Admin token <small>(session only)</small></span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="Required for CLI-managed daemons" /></label><p className="form-help">The URL is saved on this device. A token is isolated to that API URL and kept only in this browser tab session.</p><div className="modal-actions"><button className="button secondary compact" type="button" onClick={onClose}>Cancel</button><button className="button primary compact" type="submit">Save and connect</button></div></form></Modal>;
}
