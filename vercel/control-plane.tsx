import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Dashboard } from "../app/dashboard";
import { Brand } from "./site-shell";
import "./control-plane.css";

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
type CloudView = "overview" | "nodes" | "usage" | "account" | "admin" | "node-console";

type FleetSummary = { nodeCount: number; onlineNodeCount: number; bucketCount: number; objectCount: number;
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
  managementSession: (nodeId: string) => apiRequest<{ managementUrl: string; token: string; expiresIn: number }>(`/api/nodes/${encodeURIComponent(nodeId)}/management-session`, { method: "POST", body: "{}" }),
};
function summarizeFleet(nodes: AccountNode[], usage: UsageSummary): FleetSummary {
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


function formatBytes(value: number | null): string {
  if (value === null) return "Unknown";
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unit;
  return `${scaled >= 100 || unit === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 100_000 ? "compact" : "standard" }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function relativeHeartbeat(value: string | null): string {
  if (!value) return "No heartbeat yet";
  const elapsed = Date.now() - new Date(value).valueOf();
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatDate(value);
  if (elapsed < 60_000) return "Heartbeat just now";
  if (elapsed < 3_600_000) return `Heartbeat ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `Heartbeat ${Math.floor(elapsed / 3_600_000)}h ago`;
  return `Heartbeat ${Math.floor(elapsed / 86_400_000)}d ago`;
}

function CopyValue({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="cp-copy" type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); }}>{copied ? "Copied" : label}</button>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <article className="cp-metric"><p>{label}</p><strong>{value}</strong>{note ? <span>{note}</span> : null}</article>;
}

function StatePanel({ tone = "plain", title, children, action }: { tone?: "plain" | "error"; title: string; children: ReactNode; action?: ReactNode }) {
  return <section className={`cp-state ${tone}`}><span aria-hidden="true">{tone === "error" ? "!" : "OB"}</span><h2>{title}</h2><div>{children}</div>{action}</section>;
}

function NodeStatus({ status }: { status: AccountNode["status"] }) {
  return <span className={`cp-node-status ${status}`}><i aria-hidden="true" />{status[0].toUpperCase() + status.slice(1)}</span>;
}

function EndpointRow({ label, value }: { label: string; value: string | null }) {
  return <div className="cp-endpoint"><span>{label}</span>{value ? <><code>{value}</code><CopyValue value={value} /></> : <em>Not advertised</em>}</div>;
}

function NodeCard({ node, onOpen }: { node: AccountNode; onOpen?: (node: AccountNode) => void }) {
  return (
    <article className="cp-node-card">
      <header><div><NodeStatus status={node.status} /><h3>{node.name}</h3><p>{node.endpoint.futureS3Hostname}</p></div><span className="cp-node-id">{node.id}</span></header>
      <div className="cp-node-facts">
        <div><span>Stored</span><strong>{formatBytes(node.storage.usedBytes)}</strong></div>
        <div><span>Objects</span><strong>{formatCount(node.storage.objectCount)}</strong></div>
        <div><span>Requests</span><strong>{formatCount(node.usage.requests)}</strong></div>
        <div><span>Last seen</span><strong>{relativeHeartbeat(node.lastSeenAt)}</strong></div>
      </div>
      <div className="cp-node-endpoints">
        <EndpointRow label="Public S3" value={node.endpoint.endpoints.s3.url ?? node.endpoint.publicS3Url} />
        <EndpointRow label="Management" value={node.endpoint.endpoints.management.url ?? node.endpoint.managementUrl} />
        <EndpointRow label="Dashboard" value={node.endpoint.dashboardUrl} />
      </div>
      <footer><span>OpenBucket {node.version || "version pending"}</span>{onOpen ? <button type="button" onClick={() => onOpen(node)}>Open node →</button> : <span>Registered {formatDate(node.createdAt)}</span>}</footer>
    </article>
  );
}

function Onboarding({ user }: { user: AccountUser }) {
  const loginCommand = `openbucket login --email ${user.email}`;
  const serveCommand = "openbucket serve /path/to/storage --name my-node --tunnel";
  return (
    <section className="cp-onboarding">
      <div className="cp-onboarding-copy"><p className="cp-eyebrow">CONNECT A REAL NODE</p><h2>Login once. Serve the disk.</h2><p>The CLI securely prompts for your password, registers the node, and sends real heartbeats and usage to this account. Object bytes remain on the storage host.</p><a href="/docs#first-node">Read the node guide →</a></div>
      <div className="cp-command-stack">
        <div><span><b>01</b> Authenticate this machine</span><div><code>{loginCommand}</code><CopyValue value={loginCommand} /></div></div>
        <div><span><b>02</b> Start and register the node</span><div><code>{serveCommand}</code><CopyValue value={serveCommand} /></div></div>
        <p>For an internet-reachable production endpoint, replace the development Quick Tunnel with a named TLS tunnel or reverse proxy and independent access controls.</p>
      </div>
    </section>
  );
}

function Overview({ user, nodes, usage, onView, onOpen }: { user: AccountUser; nodes: AccountNode[]; usage: UsageSummary; onView: (view: CloudView) => void; onOpen: (node: AccountNode) => void }) {
  const name = user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0];
  const summary = summarizeFleet(nodes, usage);
  return <>
    <header className="cp-page-heading"><div><p className="cp-eyebrow">ACCOUNT CONTROL PLANE</p><h1>Welcome, {name}.</h1><p>Your registered nodes and their last reported storage state.</p></div><button className="cp-primary" type="button" onClick={() => onView("node-console")}>Open live node console</button></header>
    <section className="cp-metrics" aria-label="Account usage summary">
      <Metric label="Nodes" value={formatCount(summary.nodeCount)} note={`${summary.onlineNodeCount} online`} />
      <Metric label="Stored" value={formatBytes(summary.storedBytes)} note={`${formatBytes(summary.capacityBytes)} reported capacity`} />
      <Metric label="Objects" value={formatCount(summary.objectCount)} note={`${formatCount(summary.bucketCount)} buckets`} />
      <Metric label="Requests" value={formatCount(summary.requestCount)} note={`${formatBytes(summary.bytesIn + summary.bytesOut)} transferred`} />
    </section>
    {nodes.length === 0 ? <Onboarding user={user} /> : <section className="cp-section"><div className="cp-section-head"><div><p className="cp-eyebrow">NODE FLEET</p><h2>Storage hosts</h2></div><button type="button" onClick={() => onView("nodes")}>View all nodes →</button></div><div className="cp-node-grid">{nodes.slice(0, 2).map((node) => <NodeCard node={node} key={node.id} onOpen={onOpen} />)}</div></section>}
    {nodes.length > 0 ? <Onboarding user={user} /> : null}
  </>;
}

function NodesView({ user, nodes, onOpen }: { user: AccountUser; nodes: AccountNode[]; onOpen: (node: AccountNode) => void }) {
  return <><header className="cp-page-heading"><div><p className="cp-eyebrow">REGISTERED STORAGE</p><h1>Nodes</h1><p>Every value below comes from a node heartbeat stored by the account API.</p></div></header>{nodes.length ? <div className="cp-node-grid full">{nodes.map((node) => <NodeCard node={node} key={node.id} onOpen={onOpen} />)}</div> : <StatePanel title="No nodes registered"><p>Authenticate the CLI and start a storage node. It will appear after its first successful registration.</p><Onboarding user={user} /></StatePanel>}</>;
}

function UsageView({ usage, nodes }: { usage: UsageSummary; nodes: AccountNode[] }) {
  const summary = summarizeFleet(nodes, usage);
  const usedPercent = summary.capacityBytes > 0 ? Math.min(100, summary.storedBytes / summary.capacityBytes * 100) : 0;
  return <><header className="cp-page-heading"><div><p className="cp-eyebrow">ACCOUNT TOTALS</p><h1>Usage</h1><p>Real request totals from {formatDate(usage.from)} through {formatDate(usage.to)}.</p></div></header><section className="cp-usage-layout"><article className="cp-capacity-card"><div className="cp-capacity-ring" style={{ "--cp-capacity": `${usedPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{usedPercent.toFixed(usedPercent >= 10 ? 0 : 1)}%</strong><span>reported used</span></div></div><dl><div><dt>Stored</dt><dd>{formatBytes(summary.storedBytes)}</dd></div><div><dt>Capacity</dt><dd>{formatBytes(summary.capacityBytes)}</dd></div><div><dt>Last heartbeat</dt><dd>{formatDate(summary.lastSeenAt)}</dd></div></dl></article><div className="cp-usage-grid"><Metric label="Buckets" value={formatCount(summary.bucketCount)} /><Metric label="Objects" value={formatCount(summary.objectCount)} /><Metric label="Uploaded" value={formatBytes(usage.totals.bytesIn)} /><Metric label="Downloaded" value={formatBytes(usage.totals.bytesOut)} /><Metric label="Requests" value={formatCount(usage.totals.requests)} note={`${formatCount(usage.totals.errors)} errors`} /><Metric label="Online nodes" value={formatCount(summary.onlineNodeCount)} note={`${summary.nodeCount} registered`} /></div></section><section className="cp-series"><h2>Requests over time</h2>{usage.series.length ? <div className="cp-series-table" role="table" aria-label="Request usage by interval">{usage.series.map((point) => <div role="row" key={point.start}><time role="cell" dateTime={point.start}>{formatDate(point.start)}</time><span role="cell">{formatCount(point.requests)} requests</span><span role="cell">{formatBytes(point.bytesIn + point.bytesOut)}</span><span role="cell">{formatCount(point.errors)} errors</span></div>)}</div> : <p>No requests were recorded in this interval.</p>}</section></>;
}

function AccountView({ user }: { user: AccountUser }) {
  return <><header className="cp-page-heading"><div><p className="cp-eyebrow">AUTHENTICATED PROFILE</p><h1>Account</h1><p>Your identity is read from the current secure server session.</p></div></header><section className="cp-profile-card"><span className="cp-profile-avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span><div><span>Name</span><strong>{user.name || "Not set"}</strong></div><div><span>Email</span><strong>{user.email}</strong></div><div><span>Role</span><strong className="cp-role">{user.role}</strong></div><div><span>User ID</span><code>{user.id}</code></div></section><section className="cp-account-note"><p className="cp-eyebrow">SEPARATE SECURITY BOUNDARIES</p><h2>Account login is not a daemon token.</h2><p>This session controls account records and node reporting. The live node console still asks for that daemon&apos;s management URL and bearer token, and keeps the token only in browser session storage.</p></section></>;
}

function AdminView({ overview }: { overview: AdminOverview }) {
  return <><header className="cp-page-heading"><div><p className="cp-eyebrow">AUTHORIZED ADMINISTRATION</p><h1>System overview</h1><p>Global totals returned by the admin-only API.</p></div><span className="cp-generated">Generated {formatDate(overview.generatedAt)}</span></header><section className="cp-metrics admin"><Metric label="Users" value={formatCount(overview.users.total)} note={`${overview.users.active} active · ${overview.users.disabled} disabled`} /><Metric label="Nodes" value={formatCount(overview.nodes.total)} note={`${overview.nodes.online} online · ${overview.nodes.revoked} revoked`} /><Metric label="Stored" value={formatBytes(overview.storage.usedBytes)} note={`${formatBytes(overview.storage.capacityBytes)} capacity`} /><Metric label="Objects" value={formatCount(overview.storage.objectCount)} note={`${formatCount(overview.storage.bucketCount)} buckets`} /><Metric label="Requests" value={formatCount(overview.usage.requests)} note={`${formatCount(overview.usage.errors)} errors`} /></section><section className="cp-admin-note"><strong>Read-only overview</strong><p>This page deliberately exposes aggregate operational state only. Account credentials, node bearer tokens, daemon management tokens, and S3 secrets are never returned here.</p></section></>;
}

function LiveNodeConsole({ user, node, onBack, onLogout }: { user: AccountUser; node: AccountNode | null; onBack: () => void; onLogout: () => void }) {
  const [connection, setConnection] = useState<{ apiBase: string; token: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!node) return;
    void controlPlaneApi.managementSession(node.id).then((value) => setConnection({ apiBase: value.managementUrl, token: value.token })).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Node management is unavailable."));
  }, [node]);
  return <div className="cp-live-console">{node && connection ? <Dashboard initialConnection={connection} /> : <main className="cp-loading"><p>{error || `Connecting securely to ${node?.name ?? "your node"}…`}</p></main>}<aside className="cp-live-dock" aria-label="Hosted account controls"><button type="button" onClick={onBack}>← Account dashboard</button><span>{user.email}</span><button type="button" onClick={onLogout}>Sign out</button></aside></div>;
}

export function HostedControlPlane({ user }: { user: AccountUser }) {
  const [view, setView] = useState<CloudView>("overview");
  const [nodes, setNodes] = useState<AccountNode[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [admin, setAdmin] = useState<AdminOverview | null>(null);
  const [selectedNode, setSelectedNode] = useState<AccountNode | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    setError("");
    try {
      const [nodePayload, usagePayload] = await Promise.all([controlPlaneApi.listNodes(), controlPlaneApi.usage()]);
      setNodes(nodePayload.nodes);
      setUsage(usagePayload);
      if (user.role === "admin") {
        const adminPayload = await controlPlaneApi.adminOverview();
        setAdmin(adminPayload);
      } else {
        setAdmin(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account data could not be loaded.");
    } finally {
      setRefreshing(false);
    }
  }, [user.role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }); }
    finally { window.location.assign("/"); }
  }, []);

  const navigation = useMemo(() => [
    ["overview", "Overview", "⌂"], ["nodes", "Nodes", "◇"], ["usage", "Usage", "↗"], ["node-console", "Live node", "⌁"], ["account", "Account", "○"],
    ...(user.role === "admin" ? [["admin", "Admin", "A"]] : []),
  ] as Array<[CloudView, string, string]>, [user.role]);

  const openNode = (node: AccountNode) => { setSelectedNode(node); window.history.pushState({}, "", `/dashboard/nodes/${encodeURIComponent(node.name)}`); setView("node-console"); };
  if (view === "node-console") return <LiveNodeConsole user={user} node={selectedNode ?? nodes?.[0] ?? null} onBack={() => { window.history.pushState({}, "", "/dashboard"); setView("overview"); }} onLogout={() => void logout()} />;

  return <div className="cp-shell">
    <a className="cp-skip" href="#cloud-main">Skip to content</a>
    <aside className="cp-sidebar"><Brand /><div className="cp-workspace-label"><span>Cloud workspace</span><strong>{user.name || user.email}</strong></div><nav aria-label="Account dashboard">{navigation.map(([id, label, glyph]) => <button className={view === id ? "active" : ""} type="button" key={id} onClick={() => setView(id)}><span aria-hidden="true">{glyph}</span>{label}</button>)}</nav><div className="cp-sidebar-foot"><a href="/docs">Documentation ↗</a><a href="https://github.com/Razin-developer/openbucket">GitHub ↗</a></div></aside>
    <div className="cp-workspace"><header className="cp-topbar"><div><span className={`cp-cloud-status ${error ? "error" : "healthy"}`}><i />{error ? "Account API issue" : "Account API connected"}</span></div><div className="cp-top-actions"><button type="button" disabled={refreshing} onClick={() => void load(true)} aria-label="Refresh account data">{refreshing ? "Refreshing…" : "Refresh"}</button><button className="cp-account-button" type="button" onClick={() => setView("account")}><span>{(user.name || user.email)[0].toUpperCase()}</span><b>{user.name || user.email}</b><small>{user.role}</small></button></div></header><main id="cloud-main" className="cp-main">
      {error ? <StatePanel tone="error" title="Account data unavailable" action={<button className="cp-primary" type="button" onClick={() => void load(true)}>Try again</button>}><p>{error}</p></StatePanel> : null}
      {!error && (!nodes || !usage) ? <div className="cp-loading" aria-live="polite"><span /><span /><span /><p>Loading account data…</p></div> : null}
      {!error && nodes && usage && view === "overview" ? <Overview user={user} nodes={nodes} usage={usage} onView={setView} onOpen={openNode} /> : null}
      {!error && nodes && usage && view === "nodes" ? <NodesView user={user} nodes={nodes} onOpen={openNode} /> : null}
      {!error && nodes && usage && view === "usage" ? <UsageView usage={usage} nodes={nodes} /> : null}
      {!error && view === "account" ? <AccountView user={user} /> : null}
      {!error && view === "admin" && user.role === "admin" && admin ? <AdminView overview={admin} /> : null}
      {!error && view === "admin" && user.role === "admin" && !admin ? <div className="cp-loading" aria-live="polite"><span /><span /><span /><p>Loading authorized overview…</p></div> : null}
    </main></div>
    <button className="cp-mobile-signout" type="button" onClick={() => void logout()}>Sign out</button>
  </div>;
}
