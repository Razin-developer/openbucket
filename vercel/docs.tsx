import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, ExternalLink, Info } from "lucide-react";
import { SiteShell, githubUrl } from "./site-shell";

function CodeBlock({ children, label = "Terminal" }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      <div><span>{label}</span><button type="button" onClick={async () => { await navigator.clipboard.writeText(children); setCopied(true); window.setTimeout(() => setCopied(false), 1_400); }}>{copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}</button></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function TabbedCode({ tabs }: { tabs: { label: string; code: string }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="docs-tabbed-code">
      <div className="docs-code-tabs">
        {tabs.map((tab, index) => (
          <button key={tab.label} type="button" className={index === active ? "active" : ""} onClick={() => setActive(index)}>{tab.label}</button>
        ))}
      </div>
      <CodeBlock label={tabs[active]!.label}>{tabs[active]!.code}</CodeBlock>
    </div>
  );
}

function DocSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return <section className="docs-section" id={id}><p className="section-kicker">{eyebrow}</p><h2>{title}</h2>{children}</section>;
}

type Endpoint = {
  id: string;
  method: string;
  path: string;
  title: string;
  auth: string;
  description: string;
  request?: string;
  response: string;
  js: string;
  python: string;
};

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  return (
    <article className="docs-endpoint" id={endpoint.id}>
      <div className="docs-endpoint-head">
        <span className={`docs-method docs-method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
        <code>{endpoint.path}</code>
      </div>
      <h3>{endpoint.title}</h3>
      <p>{endpoint.description}</p>
      <p className="docs-endpoint-auth"><strong>Auth</strong> {endpoint.auth}</p>
      {endpoint.request ? (
        <>
          <p className="docs-endpoint-label">Request body</p>
          <CodeBlock label="JSON">{endpoint.request}</CodeBlock>
        </>
      ) : null}
      <p className="docs-endpoint-label">Response</p>
      <CodeBlock label="JSON">{endpoint.response}</CodeBlock>
      <p className="docs-endpoint-label">Usage</p>
      <TabbedCode tabs={[{ label: "JavaScript", code: endpoint.js }, { label: "Python", code: endpoint.python }]} />
    </article>
  );
}

const guidePages = [
  ["overview", "Overview"],
  ["installation", "Installation"],
  ["first-node", "Run your first node"],
  ["s3-clients", "Connect S3 clients"],
  ["dashboard", "Dashboard"],
  ["docker", "Docker"],
  ["production", "Production"],
] as const;

const apiPages = [
  ["local-management", "Local management API"],
  ["local-s3", "Local S3 API"],
  ["hosted-auth", "Hosted: accounts"],
  ["hosted-nodes", "Hosted: nodes"],
  ["hosted-usage", "Hosted: usage & admin"],
] as const;

function useScrollSpy(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const idsRef = useRef(ids);
  useEffect(() => { idsRef.current = ids; }, [ids]);
  useEffect(() => {
    const elements = idsRef.current.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function DocsShell({
  current,
  tocIds,
  tocLabels,
  children,
}: {
  current: "guide" | "api";
  tocIds: readonly string[];
  tocLabels: Record<string, string>;
  children: ReactNode;
}) {
  const activeToc = useScrollSpy(tocIds);
  return (
    <SiteShell current="docs">
      <main className="docs-layout">
        <aside className="docs-sidebar">
          <p>DOCUMENTATION</p>
          <nav className="docs-page-nav" aria-label="Documentation pages">
            <a href="/docs" className={current === "guide" ? "active" : ""}>Get started</a>
            <a href="/docs/api" className={current === "api" ? "active" : ""}>API reference</a>
          </nav>
          <nav aria-label="Sections on this page">
            {(current === "guide" ? guidePages : apiPages).map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
          </nav>
          <div className="docs-sidebar-callout">
            <strong>Need every detail?</strong>
            <p>The repository includes operations, security, S3 compatibility, and contribution references.</p>
            <a href={`${githubUrl}/tree/main/docs`}>Browse all guides <ExternalLink size={13} /></a>
          </div>
        </aside>

        {children}

        <aside className="docs-toc" aria-label="On this page">
          <p>ON THIS PAGE</p>
          <nav>
            {tocIds.map((id) => (
              <a key={id} href={`#${id}`} className={id === activeToc ? "active" : ""}>{tocLabels[id]}</a>
            ))}
          </nav>
        </aside>
      </main>
    </SiteShell>
  );
}

export function DocsPage() {
  const tocIds = ["overview", "installation", "first-node", "s3-clients", "dashboard", "docker", "production"];
  const tocLabels = Object.fromEntries(guidePages);
  return (
    <DocsShell current="guide" tocIds={tocIds} tocLabels={tocLabels}>
      <article className="docs-content">
        <header className="docs-hero" id="overview">
          <p className="section-kicker">OPENBUCKET DOCUMENTATION</p>
          <h1>From local folder<br />to S3 endpoint.</h1>
          <p>Install the daemon on the machine that owns your storage, choose a path, then connect standard S3 clients or the live dashboard.</p>
          <div className="docs-requirement"><span aria-hidden="true"><Info size={13} /></span><p><strong>Runtime requirement</strong> Node.js 22.13 or newer. Production releases are tested on Node.js 22 and 24.</p></div>
        </header>

        <DocSection id="installation" eyebrow="01 · INSTALLATION" title="Install the published CLI">
          <p>The npm package contains the CLI, daemon, embedded production dashboard, and management client commands. Install it globally on the storage host.</p>
          <CodeBlock>{"npm install --global openbucket@0.1.1\nopenbucket version"}</CodeBlock>
          <p>Account login and hosted metering require version 0.1.1 or newer. Until that trusted release is published, build this repository; npm 0.1.0 supports the earlier local-only flow.</p>
          <h3>Installer script</h3>
          <p>Download and inspect the script before executing it. It verifies Node and npm, then installs the same published package without using sudo.</p>
          <CodeBlock>{"curl -fsSLO https://openbucket-eight.vercel.app/install.sh\nless install.sh\nOPENBUCKET_INSTALL_VERSION=0.1.1 sh install.sh"}</CodeBlock>
          <h3>Windows PowerShell</h3>
          <CodeBlock label="PowerShell">{"Invoke-WebRequest https://openbucket-eight.vercel.app/install.ps1 -OutFile install.ps1\nGet-Content .\\install.ps1\n.\\install.ps1 -Version 0.1.1"}</CodeBlock>
        </DocSection>

        <DocSection id="first-node" eyebrow="02 · FIRST NODE" title="Serve a directory you control">
          <p>Pass an existing directory, mounted drive, or NAS path. OpenBucket keeps internal metadata beneath that storage root and serves real object bytes from it.</p>
          <CodeBlock>{"mkdir -p /srv/openbucket\nopenbucket login --email you@example.com\nopenbucket serve /srv/openbucket --name home-node"}</CodeBlock>
          <p>The normal flow verifies your account before starting, registers the node, reports storage and aggregate request counters, and advertises its active public endpoint. Use <code>--offline --no-tunnel</code> only for deliberate standalone development.</p>
          <p>The safe defaults bind the management API to <code>127.0.0.1:7272</code>, S3 to <code>127.0.0.1:8333</code>, and the embedded dashboard to <code>localhost:3000</code>. The CLI generates a strong management token when one is not supplied. On start, the banner (and the interactive console&apos;s Server screen) print every endpoint &mdash; local management, local S3, local dashboard, and, when tunneled or hosted-connected, the public S3/management URLs and the hosted dashboard link.</p>
          <p>Renaming later doesn&apos;t require a restart: <code>openbucket rename &lt;new-name&gt;</code> updates the running daemon and, if the node is hosted-connected, the control plane&apos;s registration too.</p>
          <div className="docs-warning"><strong>Keep it local first.</strong><p>Do not bind management to a public interface without a firewall, TLS proxy, independent access policy, and an exact dashboard origin.</p></div>
        </DocSection>

        <DocSection id="s3-clients" eyebrow="03 · S3 CLIENTS" title="Point existing tools at OpenBucket">
          <p>Create a workload key from the dashboard or management API, then use the OpenBucket S3 endpoint as a custom endpoint. Path-style addressing is supported. See the <a href="/docs/api#local-s3">S3 API reference</a> for the full compatibility notes.</p>
          <CodeBlock label="AWS CLI">{"export AWS_ACCESS_KEY_ID=\"<openbucket-access-key>\"\nexport AWS_SECRET_ACCESS_KEY=\"<openbucket-secret-key>\"\naws s3 mb s3://assets --endpoint-url http://127.0.0.1:8333\naws s3 sync ./assets s3://assets --endpoint-url http://127.0.0.1:8333"}</CodeBlock>
          <CodeBlock label="Python · Boto3">{"import boto3\n\ns3 = boto3.client(\n    \"s3\",\n    endpoint_url=\"http://127.0.0.1:8333\",\n    aws_access_key_id=\"<openbucket-access-key>\",\n    aws_secret_access_key=\"<openbucket-secret-key>\",\n    region_name=\"auto\",\n)\ns3.upload_file(\"report.pdf\", \"assets\", \"reports/report.pdf\")"}</CodeBlock>
          <p>See the <a href={`${githubUrl}/blob/main/docs/S3_COMPATIBILITY.md`}>compatibility matrix</a> before depending on an advanced AWS S3 feature.</p>
        </DocSection>

        <DocSection id="dashboard" eyebrow="04 · DASHBOARD" title="Operate the live node">
          <p><code>openbucket serve</code> hosts and opens the packaged dashboard automatically. It receives a one-time pairing fragment, removes it from the address bar, and keeps the management token in API-scoped session storage.</p>
          <h3>Sign in to the hosted dashboard</h3>
          <p>Anyone can <a href="/register">create an account</a> to pair a node with the hosted control plane. Administrator access isn&apos;t stored in the database at all &mdash; set <code>OPENBUCKET_ADMIN_EMAIL</code> and <code>OPENBUCKET_ADMIN_PASSWORD</code> on the deployment, and signing in with that exact email and password opens the admin view.</p>
          <CodeBlock>{"openbucket dashboard"}</CodeBlock>
          <p>The hosted <a href="/dashboard">web dashboard</a> adds an OpenBucket account gate and reads MongoDB-backed node registrations, presence, storage summaries, and aggregate usage. Object bytes, raw node tokens, management credentials, and S3 keys remain on the storage host. Everything the dashboard calls is documented in the <a href="/docs/api#hosted-nodes">hosted API reference</a>.</p>
          <p>Your browser may ask for Local Network Access when this public HTTPS site first contacts a loopback or private daemon. Grant it for OpenBucket; if the browser blocks plain HTTP local requests, expose management through an authenticated HTTPS tunnel or reverse proxy.</p>
        </DocSection>

        <DocSection id="docker" eyebrow="05 · CONTAINERS" title="Run with persistent volumes">
          <p>Until the first container release is published, use the repository&apos;s documented Compose profile. It builds both services from source with persistent volumes. Set a management token containing at least 32 random UTF-8 bytes in <code>.env</code> before startup.</p>
          <CodeBlock label="Docker Compose">{"git clone https://github.com/Razin-developer/openbucket.git\ncd openbucket\ncp .env.example .env\n# Set OPENBUCKET_ADMIN_TOKEN and, for a custom deployment, OPENBUCKET_CONTROL_PLANE_URL.\ndocker compose build daemon\ndocker compose run --rm daemon login --email you@example.com\ndocker compose up --build -d"}</CodeBlock>
          <p>The one-off login writes the account session into the persistent <code>openbucket-state</code> volume. Compose then starts the daemon only after that account can be verified.</p>
        </DocSection>

        <DocSection id="production" eyebrow="06 · PRODUCTION" title="Treat the disk as infrastructure">
          <div className="production-checklist">
            <div><span>01</span><p><strong>Pin versions</strong>Use an exact npm version, container tag, or image digest for unattended hosts.</p></div>
            <div><span>02</span><p><strong>Protect management</strong>Keep it on loopback or behind independent identity-aware access, rate limits, and TLS.</p></div>
            <div><span>03</span><p><strong>Back up data and metadata</strong>Object bytes and the storage root&apos;s <code>.openbucket</code> state are both required for recovery.</p></div>
            <div><span>04</span><p><strong>Monitor the host</strong>Track free space, process health, request errors, and restore drills on representative data.</p></div>
          </div>
          <div className="docs-next-links">
            <a href={`${githubUrl}/blob/main/docs/OPERATIONS.md`}><span>Next</span><strong>Production operations <ArrowRight size={13} /></strong></a>
            <a href={`${githubUrl}/blob/main/docs/SECURITY.md`}><span>Review</span><strong>Security model <ArrowRight size={13} /></strong></a>
          </div>
        </DocSection>
      </article>
    </DocsShell>
  );
}

const localManagementEndpoints: Endpoint[] = [
  {
    id: "local-status", method: "GET", path: "/v1/status", title: "Node status",
    auth: "Bearer management token (Authorization: Bearer <token>), unless the daemon was started without one.",
    description: "Live storage, uptime, and endpoint summary for the running node.",
    response: "{\n  \"online\": true,\n  \"nodeId\": \"...\",\n  \"nodeName\": \"home-node\",\n  \"version\": \"0.1.17\",\n  \"storageRoot\": \"/srv/openbucket\",\n  \"capacityBytes\": 0, \"usedBytes\": 0, \"availableBytes\": 0,\n  \"bucketCount\": 2, \"objectCount\": 41,\n  \"uptimeSeconds\": 3600,\n  \"endpoints\": { \"management\": \"...\", \"s3\": \"...\", \"public\": \"...\", \"files\": \"...\", \"dashboard\": \"...\" },\n  \"node\": { \"id\": \"...\", \"name\": \"home-node\", \"createdAt\": \"...\", \"uptimeSeconds\": 3600 },\n  \"storage\": { \"root\": \"...\", \"buckets\": 2, \"objects\": 41, \"bytes\": 0, \"managedBytes\": 0, \"totalBytes\": 0, \"freeBytes\": 0 }\n}",
    js: "const status = await fetch(\"http://127.0.0.1:7272/v1/status\", {\n  headers: { authorization: `Bearer ${managementToken}` },\n}).then((r) => r.json());",
    python: "import requests\n\nstatus = requests.get(\n    \"http://127.0.0.1:7272/v1/status\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n).json()",
  },
  {
    id: "local-node-rename", method: "PATCH", path: "/v1/node", title: "Rename the node",
    auth: "Bearer management token.",
    description: "Renames the running node in place \u2014 persisted immediately, no restart required. Also used by \"openbucket rename\".",
    request: "{ \"name\": \"new-node-name\" }",
    response: "{ \"nodeId\": \"...\", \"nodeName\": \"new-node-name\" }",
    js: "await fetch(\"http://127.0.0.1:7272/v1/node\", {\n  method: \"PATCH\",\n  headers: { authorization: `Bearer ${managementToken}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify({ name: \"new-node-name\" }),\n});",
    python: "requests.patch(\n    \"http://127.0.0.1:7272/v1/node\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n    json={\"name\": \"new-node-name\"},\n)",
  },
  {
    id: "local-buckets", method: "GET", path: "/v1/buckets", title: "List buckets",
    auth: "Bearer management token.",
    description: "Every bucket on this node with object counts and sizes.",
    response: "{ \"buckets\": [ { \"name\": \"assets\", \"createdAt\": \"...\", \"public\": false, \"objects\": 12, \"bytes\": 483920 } ] }",
    js: "const { buckets } = await fetch(\"http://127.0.0.1:7272/v1/buckets\", {\n  headers: { authorization: `Bearer ${managementToken}` },\n}).then((r) => r.json());",
    python: "buckets = requests.get(\n    \"http://127.0.0.1:7272/v1/buckets\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n).json()[\"buckets\"]",
  },
  {
    id: "local-bucket-create", method: "POST", path: "/v1/buckets", title: "Create a bucket",
    auth: "Bearer management token.",
    description: "Creates a bucket, optionally allowing anonymous public reads.",
    request: "{ \"name\": \"assets\", \"public\": false }",
    response: "{ \"bucket\": { \"name\": \"assets\", \"createdAt\": \"...\", \"public\": false, \"objects\": 0, \"bytes\": 0 } }",
    js: "await fetch(\"http://127.0.0.1:7272/v1/buckets\", {\n  method: \"POST\",\n  headers: { authorization: `Bearer ${managementToken}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify({ name: \"assets\", public: false }),\n});",
    python: "requests.post(\n    \"http://127.0.0.1:7272/v1/buckets\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n    json={\"name\": \"assets\", \"public\": False},\n)",
  },
  {
    id: "local-bucket-delete", method: "DELETE", path: "/v1/buckets/:bucket", title: "Delete a bucket",
    auth: "Bearer management token.",
    description: "Deletes an empty bucket. Add ?force=true to delete a bucket that still has objects.",
    response: "{ \"deleted\": true, \"bucket\": \"assets\" }",
    js: "await fetch(\"http://127.0.0.1:7272/v1/buckets/assets?force=true\", {\n  method: \"DELETE\",\n  headers: { authorization: `Bearer ${managementToken}` },\n});",
    python: "requests.delete(\n    \"http://127.0.0.1:7272/v1/buckets/assets\",\n    params={\"force\": \"true\"},\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n)",
  },
  {
    id: "local-bucket-visibility", method: "PATCH", path: "/v1/buckets/:bucket", title: "Change bucket visibility",
    auth: "Bearer management token.",
    description: "Toggles anonymous public reads for a bucket.",
    request: "{ \"public\": true }",
    response: "{ \"bucket\": { \"name\": \"assets\", \"public\": true, ... } }",
    js: "await fetch(\"http://127.0.0.1:7272/v1/buckets/assets\", {\n  method: \"PATCH\",\n  headers: { authorization: `Bearer ${managementToken}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify({ public: true }),\n});",
    python: "requests.patch(\n    \"http://127.0.0.1:7272/v1/buckets/assets\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n    json={\"public\": True},\n)",
  },
  {
    id: "local-objects", method: "GET", path: "/v1/buckets/:bucket/objects", title: "List objects",
    auth: "Bearer management token.",
    description: "Lists objects in a bucket, optionally filtered by ?prefix=.",
    response: "{ \"bucket\": \"assets\", \"prefix\": \"\", \"objects\": [ { \"key\": \"reports/report.pdf\", \"size\": 48213, \"lastModified\": \"...\", \"etag\": \"...\" } ] }",
    js: "const { objects } = await fetch(\"http://127.0.0.1:7272/v1/buckets/assets/objects\", {\n  headers: { authorization: `Bearer ${managementToken}` },\n}).then((r) => r.json());",
    python: "objects = requests.get(\n    \"http://127.0.0.1:7272/v1/buckets/assets/objects\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n).json()[\"objects\"]",
  },
  {
    id: "local-object-upload", method: "PUT", path: "/v1/buckets/:bucket/objects/:key", title: "Upload an object",
    auth: "Bearer management token.",
    description: "Uploads raw bytes as the request body. For S3-native uploads (multipart, presigned URLs), use the S3 API instead.",
    response: "{ \"object\": { \"key\": \"reports/report.pdf\", \"size\": 48213, \"lastModified\": \"...\", \"etag\": \"...\" } }",
    js: "const bytes = await file.arrayBuffer();\nawait fetch(\"http://127.0.0.1:7272/v1/buckets/assets/objects/reports/report.pdf\", {\n  method: \"PUT\",\n  headers: { authorization: `Bearer ${managementToken}`, \"content-type\": \"application/octet-stream\" },\n  body: bytes,\n});",
    python: "with open(\"report.pdf\", \"rb\") as f:\n    requests.put(\n        \"http://127.0.0.1:7272/v1/buckets/assets/objects/reports/report.pdf\",\n        headers={\"Authorization\": f\"Bearer {management_token}\"},\n        data=f,\n    )",
  },
  {
    id: "local-keys", method: "POST", path: "/v1/keys", title: "Create an S3 access key",
    auth: "Bearer management token.",
    description: "Issues a new S3 access key/secret pair. The secret is returned only once, at creation.",
    request: "{ \"name\": \"ci-pipeline\", \"readOnly\": false, \"bucket\": null }",
    response: "{ \"key\": { \"id\": \"...\", \"name\": \"ci-pipeline\", \"accessKeyId\": \"...\", \"secretAccessKey\": \"...\", \"readOnly\": false, \"bucket\": null, \"createdAt\": \"...\" } }",
    js: "const { key } = await fetch(\"http://127.0.0.1:7272/v1/keys\", {\n  method: \"POST\",\n  headers: { authorization: `Bearer ${managementToken}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify({ name: \"ci-pipeline\", readOnly: false }),\n}).then((r) => r.json());\n// key.secretAccessKey is shown only this once \u2014 store it now.",
    python: "key = requests.post(\n    \"http://127.0.0.1:7272/v1/keys\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n    json={\"name\": \"ci-pipeline\", \"readOnly\": False},\n).json()[\"key\"]\n# key[\"secretAccessKey\"] is shown only this once \u2014 store it now.",
  },
  {
    id: "local-share", method: "POST", path: "/v1/buckets/:bucket/share", title: "Create a share link",
    auth: "Bearer management token.",
    description: "Issues a signed, time-boxed URL for a single object \u2014 no standing S3 credentials required to fetch it.",
    request: "{ \"key\": \"reports/report.pdf\", \"expiresIn\": 3600 }",
    response: "{ \"url\": \"http://127.0.0.1:8333/files/assets/reports/report.pdf?expires=...&token=...\", \"expiresAt\": \"...\", \"bucket\": \"assets\", \"key\": \"reports/report.pdf\" }",
    js: "const { url } = await fetch(\"http://127.0.0.1:7272/v1/buckets/assets/share\", {\n  method: \"POST\",\n  headers: { authorization: `Bearer ${managementToken}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify({ key: \"reports/report.pdf\", expiresIn: 3600 }),\n}).then((r) => r.json());",
    python: "share = requests.post(\n    \"http://127.0.0.1:7272/v1/buckets/assets/share\",\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n    json={\"key\": \"reports/report.pdf\", \"expiresIn\": 3600},\n).json()",
  },
  {
    id: "local-logs", method: "GET", path: "/v1/logs", title: "Recent request logs",
    auth: "Bearer management token.",
    description: "Tails recent management/S3/files requests. Accepts ?limit= (default 100).",
    response: "{ \"logs\": [ { \"timestamp\": \"...\", \"method\": \"GET\", \"path\": \"/v1/buckets\", \"status\": 200, \"durationMs\": 4, \"service\": \"management\" } ] }",
    js: "const { logs } = await fetch(\"http://127.0.0.1:7272/v1/logs?limit=50\", {\n  headers: { authorization: `Bearer ${managementToken}` },\n}).then((r) => r.json());",
    python: "logs = requests.get(\n    \"http://127.0.0.1:7272/v1/logs\",\n    params={\"limit\": 50},\n    headers={\"Authorization\": f\"Bearer {management_token}\"},\n).json()[\"logs\"]",
  },
];

export function ApiReferencePage() {
  const tocIds = ["local-management", "local-s3", "hosted-auth", "hosted-nodes", "hosted-usage"];
  const tocLabels = Object.fromEntries(apiPages);
  return (
    <DocsShell current="api" tocIds={tocIds} tocLabels={tocLabels}>
      <article className="docs-content">
        <header className="docs-hero" id="local-management">
          <p className="section-kicker">API REFERENCE</p>
          <h1>Every endpoint,<br />local and hosted.</h1>
          <p>OpenBucket has two independent API surfaces: the <strong>local daemon</strong> running on your storage host (management + S3), and the <strong>hosted control plane</strong> that this dashboard talks to (accounts, node registration, usage). Neither ever sees your object bytes.</p>
        </header>

        <DocSection id="local-management" eyebrow="LOCAL DAEMON" title="Management API">
          <p>Runs on the storage host, default <code>http://127.0.0.1:7272</code>. Every route except <code>GET /healthz</code> requires the management bearer token generated (or supplied) when you ran <code>openbucket serve</code> &mdash; find it with <code>openbucket config</code> or the interactive console&apos;s Config screen. Errors use <code>{"{ error: { code, message } }"}</code> with a matching HTTP status.</p>
          {localManagementEndpoints.map((endpoint) => <EndpointCard endpoint={endpoint} key={endpoint.id} />)}
        </DocSection>

        <DocSection id="local-s3" eyebrow="LOCAL DAEMON" title="S3 API">
          <p>Runs on the storage host, default <code>http://127.0.0.1:8333</code>. This is a real, standards-compliant S3-compatible API &mdash; use any existing S3 SDK (Boto3, the AWS SDK for JavaScript, <code>aws-cli</code>, rclone, Terraform&apos;s S3 backend) by pointing it at this endpoint with path-style addressing.</p>
          <p><strong>Supported</strong>: AWS Signature Version 4 (header and presigned-query authorization), path-style bucket/object CRUD, byte ranges, object copy, ListObjectsV2 pagination, and multipart upload.</p>
          <p><strong>Not supported</strong>: SigV2/STS, virtual-hosted addressing, batch <code>DeleteObjects</code>, <code>ListParts</code>/<code>ListMultipartUploads</code>/<code>UploadPartCopy</code>, conditional headers, custom object metadata/tags, and server-side encryption. Presigned URLs expire after at most 7 days; request signatures tolerate a 15-minute clock skew.</p>
          <CodeBlock label="AWS CLI">{"aws s3 cp report.pdf s3://assets/reports/report.pdf --endpoint-url http://127.0.0.1:8333\naws s3 presign s3://assets/reports/report.pdf --endpoint-url http://127.0.0.1:8333 --expires-in 3600"}</CodeBlock>
          <TabbedCode tabs={[
            { label: "JavaScript", code: "import { S3Client, PutObjectCommand } from \"@aws-sdk/client-s3\";\n\nconst s3 = new S3Client({\n  endpoint: \"http://127.0.0.1:8333\",\n  region: \"auto\",\n  forcePathStyle: true,\n  credentials: { accessKeyId, secretAccessKey },\n});\nawait s3.send(new PutObjectCommand({ Bucket: \"assets\", Key: \"reports/report.pdf\", Body: bytes }));" },
            { label: "Python", code: "import boto3\n\ns3 = boto3.client(\n    \"s3\",\n    endpoint_url=\"http://127.0.0.1:8333\",\n    aws_access_key_id=access_key_id,\n    aws_secret_access_key=secret_access_key,\n    region_name=\"auto\",\n)\ns3.upload_file(\"report.pdf\", \"assets\", \"reports/report.pdf\")\nurl = s3.generate_presigned_url(\"get_object\", Params={\"Bucket\": \"assets\", \"Key\": \"reports/report.pdf\"}, ExpiresIn=3600)" },
          ]} />
          <p>Full method-by-method notes live in the <a href={`${githubUrl}/blob/main/docs/S3_COMPATIBILITY.md`}>S3 compatibility matrix</a>. Object share links (<code>/files/&lt;bucket&gt;/&lt;key&gt;?expires&amp;token</code>, created via the management API&apos;s <a href="#local-share">share endpoint</a>) are a separate, simpler mechanism from SigV4 presigned URLs &mdash; use them when the recipient has no S3 client at all.</p>
        </DocSection>

        <DocSection id="hosted-auth" eyebrow="HOSTED CONTROL PLANE" title="Accounts">
          <p>Session-cookie authenticated (<code>__Host-openbucket_session</code>, <code>HttpOnly</code>). Same-origin JSON POSTs only &mdash; the dashboard&apos;s own fetch calls already send <code>credentials: &quot;same-origin&quot;</code>; a Python client authenticating against your own deployment should use a <code>requests.Session()</code> to carry the cookie across calls.</p>
          <EndpointCard endpoint={{
            id: "api-register", method: "POST", path: "/api/auth/register", title: "Create an account", auth: "None (rate-limited).",
            description: "Self-serve registration, open by default.",
            request: "{ \"email\": \"you@example.com\", \"password\": \"at least 12 characters\", \"name\": \"optional\" }",
            response: "{ \"user\": { \"id\", \"email\", \"name\", \"handle\", \"role\": \"member\" } }  // + Set-Cookie",
            js: "const res = await fetch(\"/api/auth/register\", {\n  method: \"POST\",\n  credentials: \"same-origin\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ email, password }),\n});",
            python: "session = requests.Session()\nres = session.post(\n    \"https://your-openbucket-domain/api/auth/register\",\n    json={\"email\": email, \"password\": password},\n)  # session now carries the auth cookie",
          }} />
          <EndpointCard endpoint={{
            id: "api-login", method: "POST", path: "/api/auth/login", title: "Sign in", auth: "None (rate-limited: 20/15min per IP, 8/15min per email).",
            description: "Checks OPENBUCKET_ADMIN_EMAIL/PASSWORD first \u2014 a match returns role: \"admin\" with no database row \u2014 then falls back to the normal account lookup.",
            request: "{ \"email\": \"you@example.com\", \"password\": \"...\" }",
            response: "{ \"user\": { \"id\", \"email\", \"name\", \"handle\", \"role\" } }  // + Set-Cookie",
            js: "await fetch(\"/api/auth/login\", {\n  method: \"POST\",\n  credentials: \"same-origin\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ email, password }),\n});",
            python: "session.post(\"https://your-openbucket-domain/api/auth/login\", json={\"email\": email, \"password\": password})",
          }} />
          <EndpointCard endpoint={{
            id: "api-session", method: "GET", path: "/api/auth/session", title: "Current user", auth: "Session cookie.",
            description: "401 UNAUTHENTICATED if not signed in.",
            response: "{ \"user\": { \"id\", \"email\", \"name\", \"handle\", \"role\" } }",
            js: "const { user } = await fetch(\"/api/auth/session\", { credentials: \"same-origin\" }).then((r) => r.json());",
            python: "user = session.get(\"https://your-openbucket-domain/api/auth/session\").json()[\"user\"]",
          }} />
          <EndpointCard endpoint={{
            id: "api-forgot", method: "POST", path: "/api/auth/forgot-password", title: "Request a password reset", auth: "None (rate-limited).",
            description: "Always returns the same response whether or not the account exists, so it can\u2019t be used to enumerate emails. Sends a 30-minute single-use link over SMTP.",
            request: "{ \"email\": \"you@example.com\" }",
            response: "{ \"ok\": true, \"message\": \"If an account exists for that email, a reset link is on its way.\" }",
            js: "await fetch(\"/api/auth/forgot-password\", {\n  method: \"POST\", credentials: \"same-origin\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ email }),\n});",
            python: "session.post(\"https://your-openbucket-domain/api/auth/forgot-password\", json={\"email\": email})",
          }} />
          <EndpointCard endpoint={{
            id: "api-reset", method: "POST", path: "/api/auth/reset-password", title: "Complete a password reset", auth: "None (single-use token from the email link).",
            description: "Signs out every other session for the account once the password changes.",
            request: "{ \"token\": \"...\", \"password\": \"a new password, 12+ characters\" }",
            response: "{ \"ok\": true }",
            js: "await fetch(\"/api/auth/reset-password\", {\n  method: \"POST\", credentials: \"same-origin\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ token, password }),\n});",
            python: "session.post(\"https://your-openbucket-domain/api/auth/reset-password\", json={\"token\": token, \"password\": password})",
          }} />
          <EndpointCard endpoint={{
            id: "api-logout", method: "POST", path: "/api/auth/logout", title: "Sign out", auth: "Session cookie.",
            description: "Clears the session server-side and both cookie variants.",
            response: "{ \"ok\": true }",
            js: "await fetch(\"/api/auth/logout\", { method: \"POST\", credentials: \"same-origin\" });",
            python: "session.post(\"https://your-openbucket-domain/api/auth/logout\")",
          }} />
        </DocSection>

        <DocSection id="hosted-nodes" eyebrow="HOSTED CONTROL PLANE" title="Nodes">
          <p>Managing a node&apos;s registration requires the owning user&apos;s session cookie. The daemon itself never calls these &mdash; it only sends heartbeats using its own node bearer token.</p>
          <EndpointCard endpoint={{
            id: "api-nodes-list", method: "GET", path: "/api/nodes", title: "List your nodes", auth: "Session cookie.",
            description: "Up to 100 nodes, newest first.",
            response: "{ \"nodes\": [ { \"id\", \"name\", \"status\": \"online\"|\"offline\"|\"revoked\", \"storage\", \"usage\", \"endpoint\": { ... } } ] }",
            js: "const { nodes } = await fetch(\"/api/nodes\", { credentials: \"same-origin\" }).then((r) => r.json());",
            python: "nodes = session.get(\"https://your-openbucket-domain/api/nodes\").json()[\"nodes\"]",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-create", method: "POST", path: "/api/nodes", title: "Register a node", auth: "Session cookie.",
            description: "Idempotent by name \u2014 calling it again with the same name you already own returns created: false without a new credential. This is what \"openbucket serve\" calls on first connect.",
            request: "{ \"name\": \"home-node\" }",
            response: "{ \"created\": true, \"node\": { ... }, \"credential\": { \"token\": \"obn_...\", \"managementSecret\": \"...\", \"createdAt\": \"...\" } }",
            js: "const { credential } = await fetch(\"/api/nodes\", {\n  method: \"POST\", credentials: \"same-origin\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ name: \"home-node\" }),\n}).then((r) => r.json());\n// credential.token is shown only this once.",
            python: "node = session.post(\"https://your-openbucket-domain/api/nodes\", json={\"name\": \"home-node\"}).json()\n# node[\"credential\"][\"token\"] is shown only this once.",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-rename", method: "PATCH", path: "/api/nodes/:nodeId", title: "Rename a node", auth: "Session cookie, must own the node.",
            description: "Keyed by the node's stable database id, not its name \u2014 renaming doesn't lose heartbeat/usage history. This is what \"openbucket rename\" calls when the node is hosted-connected.",
            request: "{ \"name\": \"new-name\" }",
            response: "{ \"node\": { \"id\", \"name\": \"new-name\", ... } }",
            js: "await fetch(`/api/nodes/${nodeId}`, {\n  method: \"PATCH\", credentials: \"same-origin\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ name: \"new-name\" }),\n});",
            python: "session.patch(f\"https://your-openbucket-domain/api/nodes/{node_id}\", json={\"name\": \"new-name\"})",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-delete", method: "DELETE", path: "/api/nodes/:nodeId", title: "Remove a node", auth: "Session cookie, must own the node.",
            description: "Soft-deletes the registration (lifecycle \u2192 \"deleted\"); does not touch the daemon or its data.",
            response: "{ \"deleted\": true, \"id\": \"...\" }",
            js: "await fetch(`/api/nodes/${nodeId}`, { method: \"DELETE\", credentials: \"same-origin\" });",
            python: "session.delete(f\"https://your-openbucket-domain/api/nodes/{node_id}\")",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-rotate", method: "POST", path: "/api/nodes/:nodeId/rotate-token", title: "Rotate a node's credential", auth: "Session cookie, must own the node.",
            description: "Issues a new bearer token and invalidates the old one immediately.",
            response: "{ \"node\": { ... }, \"credential\": { \"token\": \"obn_...\", \"managementSecret\": \"...\", \"createdAt\": \"...\" } }",
            js: "const { credential } = await fetch(`/api/nodes/${nodeId}/rotate-token`, {\n  method: \"POST\", credentials: \"same-origin\",\n}).then((r) => r.json());",
            python: "session.post(f\"https://your-openbucket-domain/api/nodes/{node_id}/rotate-token\").json()[\"credential\"]",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-resolve", method: "GET", path: "/api/nodes/resolve?name=", title: "Public node discovery", auth: "None (IP rate-limited, 120/min).",
            description: "Metadata only \u2014 the S3 endpoint URL and online status for a publicly discoverable node. Vercel never proxies the actual object traffic.",
            response: "{ \"nodeName\", \"online\", \"tunnelMode\", \"s3Endpoint\", \"canonicalPath\", \"futureHostname\" }",
            js: "const info = await fetch(\"/api/nodes/resolve?name=home-node\").then((r) => r.json());",
            python: "info = requests.get(\"https://your-openbucket-domain/api/nodes/resolve\", params={\"name\": \"home-node\"}).json()",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-heartbeat", method: "POST", path: "/api/node/heartbeat", title: "Node heartbeat", auth: "Node bearer token (Authorization: Bearer obn_...), not a session.",
            description: "Sent by the daemon itself every few seconds while hosted-connected \u2014 not something you'd normally call directly.",
            request: "{ \"eventId\", \"version\", \"online\", \"startedAt\", \"storage\": {...}, \"counters\": {...}, \"publicS3Url\", \"tunnelMode\" }",
            response: "{ \"accepted\": true, \"duplicate\": false, \"receivedAt\", \"node\": { \"id\", \"name\", \"status\", \"lastSeenAt\" } }",
            js: "// Sent internally by \"openbucket serve\" \u2014 shown for completeness.\nawait fetch(\"/api/node/heartbeat\", {\n  method: \"POST\",\n  headers: { authorization: `Bearer ${nodeToken}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify(heartbeatPayload),\n});",
            python: "requests.post(\n    \"https://your-openbucket-domain/api/node/heartbeat\",\n    headers={\"Authorization\": f\"Bearer {node_token}\"},\n    json=heartbeat_payload,\n)",
          }} />
        </DocSection>

        <DocSection id="hosted-usage" eyebrow="HOSTED CONTROL PLANE" title="Usage & admin">
          <EndpointCard endpoint={{
            id: "api-usage", method: "GET", path: "/api/usage?from=&to=&interval=&nodeId=", title: "Aggregate usage", auth: "Session cookie.",
            description: "Requests/bytes/errors over time, across all your nodes or one. Max range is 90 days.",
            response: "{ \"from\", \"to\", \"interval\", \"totals\": {...}, \"series\": [ {\"start\", ...} ], \"nodes\": [ {\"nodeId\",\"name\",...} ] }",
            js: "const usage = await fetch(\"/api/usage?interval=day\", { credentials: \"same-origin\" }).then((r) => r.json());",
            python: "usage = session.get(\"https://your-openbucket-domain/api/usage\", params={\"interval\": \"day\"}).json()",
          }} />
          <EndpointCard endpoint={{
            id: "api-admin", method: "GET", path: "/api/admin/overview?from=&to=&interval=", title: "Admin overview", auth: "Session cookie, role must be \"admin\" (the OPENBUCKET_ADMIN_EMAIL/PASSWORD account).",
            description: "Account, node, storage, and usage totals across every user. 403 ADMIN_REQUIRED otherwise.",
            response: "{ \"generatedAt\", \"users\": {\"total\",\"active\",\"disabled\"}, \"nodes\": {\"total\",\"online\",\"offline\",\"revoked\"}, \"storage\": {...}, \"usage\": {...} }",
            js: "const overview = await fetch(\"/api/admin/overview\", { credentials: \"same-origin\" }).then((r) => r.json());",
            python: "overview = session.get(\"https://your-openbucket-domain/api/admin/overview\").json()",
          }} />
          <EndpointCard endpoint={{
            id: "api-health", method: "GET", path: "/api/health", title: "Health check", auth: "None.",
            description: "Liveness probe for the hosted deployment itself.",
            response: "{ \"ok\": true, \"service\": \"openbucket-web\" }",
            js: "await fetch(\"/api/health\").then((r) => r.json());",
            python: "requests.get(\"https://your-openbucket-domain/api/health\").json()",
          }} />
        </DocSection>
      </article>
    </DocsShell>
  );
}
