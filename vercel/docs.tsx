import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Coffee, Copy, ExternalLink, Info, Search, Star, X } from "lucide-react";
import { SiteShell, buyMeACoffeeUrl, githubUrl } from "./site-shell";

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

type DocPageDef = { path: string; id: string; label: string; sections: readonly (readonly [string, string])[] };

const docPages: DocPageDef[] = [
  { path: "/docs", id: "overview", label: "Overview", sections: [["overview", "Overview"], ["quickstart", "Quickstart"]] },
  { path: "/docs/installation", id: "installation", label: "Installation", sections: [["npm", "npm (recommended)"], ["installer-script", "Installer script"], ["docker", "Docker"], ["source", "Build from source"]] },
  { path: "/docs/usage", id: "usage", label: "Usage", sections: [["first-node", "Run your first node"], ["daily-commands", "Day-to-day commands"], ["renaming", "Renaming a node"], ["interactive-console", "Interactive console"]] },
  { path: "/docs/dashboard", id: "dashboard", label: "Dashboard", sections: [["local-dashboard", "Local dashboard"], ["hosted-dashboard", "Hosted dashboard"]] },
  { path: "/docs/s3-signing", id: "s3-signing", label: "S3 signing", sections: [["sigv4", "AWS Signature Version 4"], ["clients", "Connect existing clients"], ["compatibility", "Compatibility notes"]] },
  { path: "/docs/local-api", id: "local-api", label: "Local API", sections: [["auth-token", "Finding your management token"], ["quick-examples", "Quick examples"]] },
  { path: "/docs/api", id: "api", label: "API reference", sections: [["local-management", "Local management API"], ["local-s3", "Local S3 API"], ["hosted-auth", "Hosted: accounts"], ["hosted-nodes", "Hosted: nodes"], ["hosted-usage", "Hosted: usage & admin"]] },
  { path: "/docs/local-development", id: "local-development", label: "Local development", sections: [["setup", "Development setup"], ["repo-map", "Repository map"], ["commands", "Common commands"], ["tests", "Test principles"]] },
  { path: "/docs/contributing", id: "contributing", label: "Contributing", sections: [["before-starting", "Before starting"], ["guidelines", "Code guidelines"], ["pr-scope", "Pull request scope"], ["security-checklist", "Security checklist"], ["support", "Support the project"]] },
];

type SearchEntry = { href: string; title: string; page: string };

const searchIndex: SearchEntry[] = docPages.flatMap((page) => [
  { href: page.path, title: page.label, page: page.label },
  ...page.sections.map(([id, label]) => ({ href: `${page.path}#${id}`, title: label, page: page.label })),
]);

function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the field when the modal opens, not a render-loop update
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return searchIndex.slice(0, 8);
    return searchIndex.filter((entry) => entry.title.toLowerCase().includes(trimmed) || entry.page.toLowerCase().includes(trimmed)).slice(0, 12);
  }, [query]);

  return (
    <>
      <button type="button" className="docs-search-trigger" onClick={() => setOpen(true)}>
        <Search size={14} aria-hidden="true" />
        <span>Search docs</span>
        <kbd>{typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open ? (
        <div className="docs-search-overlay" onClick={() => setOpen(false)}>
          <div className="docs-search-modal" role="dialog" aria-modal="true" aria-label="Search documentation" onClick={(event) => event.stopPropagation()}>
            <div className="docs-search-input">
              <Search size={16} aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search documentation…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" aria-label="Close search" onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
            <div className="docs-search-results">
              {results.length === 0 ? (
                <p className="docs-search-empty">No matches for &quot;{query}&quot;.</p>
              ) : (
                results.map((entry) => (
                  <a key={entry.href} href={entry.href} className="docs-search-result">
                    <span className="docs-search-result-title">{entry.title}</span>
                    <span className="docs-search-result-page">{entry.page}</span>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

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

function useHashScroll(pageId: string) {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    // The target section may still be mounting (lazily-loaded route chunk, or React
    // hasn't committed yet), so poll across a few animation frames instead of assuming
    // it's already in the DOM the instant this effect runs.
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const target = document.getElementById(hash);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 20) window.requestAnimationFrame(tryScroll);
    };
    tryScroll();
    return () => { cancelled = true; };
  }, [pageId]);
}

function DocsPagination({ current }: { current: string }) {
  const index = docPages.findIndex((entry) => entry.id === current);
  if (index === -1) return null;
  const prev = index > 0 ? docPages[index - 1] : null;
  const next = index < docPages.length - 1 ? docPages[index + 1] : null;
  return (
    <nav className="docs-pagination" aria-label="Documentation pages navigation">
      {prev ? (
        <a className="docs-pagination-link prev" href={prev.path}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span><small>Previous</small><strong>{prev.label}</strong></span>
        </a>
      ) : <span />}
      {next ? (
        <a className="docs-pagination-link next" href={next.path}>
          <span><small>Next</small><strong>{next.label}</strong></span>
          <ArrowRight size={15} aria-hidden="true" />
        </a>
      ) : <span />}
    </nav>
  );
}

function DocsShell({ current, children }: { current: string; children: ReactNode }) {
  const page = docPages.find((entry) => entry.id === current) ?? docPages[0]!;
  const tocIds = page.sections.map(([id]) => id);
  const tocLabels = Object.fromEntries(page.sections);
  const activeToc = useScrollSpy(tocIds);
  useHashScroll(current);
  return (
    <SiteShell current="docs">
      <main className="docs-layout">
        <aside className="docs-sidebar">
          <p>DOCUMENTATION</p>
          <DocsSearch />
          <nav className="docs-page-nav" aria-label="Documentation pages">
            {docPages.map((entry) => (
              <a key={entry.path} href={entry.path} className={entry.id === current ? "active" : ""}>{entry.label}</a>
            ))}
          </nav>
          <div className="docs-sidebar-callout">
            <strong>Need every detail?</strong>
            <p>The repository includes operations, security, S3 compatibility, and contribution references.</p>
            <a href={`${githubUrl}/tree/main/docs`}>Browse all guides <ExternalLink size={13} /></a>
          </div>
        </aside>

        <div className="docs-main-column">
          {children}
          <DocsPagination current={current} />
        </div>

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
  return (
    <DocsShell current="overview">
      <article className="docs-content">
        <header className="docs-hero" id="overview">
          <p className="section-kicker">OPENBUCKET DOCUMENTATION</p>
          <h1>From local folder<br />to S3 endpoint.</h1>
          <p>Install the daemon on the machine that owns your storage, choose a path, then connect standard S3 clients or the live dashboard.</p>
          <div className="docs-requirement"><span aria-hidden="true"><Info size={13} /></span><p><strong>Runtime requirement</strong> Node.js 22.13 or newer. Production releases are tested on Node.js 22 and 24.</p></div>
        </header>

        <DocSection id="quickstart" eyebrow="QUICKSTART" title="Three commands to a live endpoint">
          <CodeBlock>{"npm install --global openbucket@latest\nopenbucket login --email you@example.com\nopenbucket serve /srv/openbucket --name home-node"}</CodeBlock>
          <p>That&apos;s a working S3-compatible endpoint on <code>127.0.0.1:8333</code>, a management API on <code>127.0.0.1:7272</code>, and a dashboard on <code>localhost:3000</code> &mdash; each printed in full when the daemon starts.</p>
          <div className="docs-next-links">
            <a href="/docs/installation"><span>Next</span><strong>Installation <ArrowRight size={13} /></strong></a>
            <a href="/docs/usage"><span>Then</span><strong>Usage <ArrowRight size={13} /></strong></a>
          </div>
        </DocSection>
      </article>
    </DocsShell>
  );
}

export function InstallationPage() {
  return (
    <DocsShell current="installation">
      <article className="docs-content">
        <header className="docs-hero" id="npm">
          <p className="section-kicker">INSTALLATION</p>
          <h1>Install OpenBucket.</h1>
          <p>The npm package contains the CLI, daemon, embedded production dashboard, and management client commands. Requires Node.js 22.13 or newer.</p>
          <CodeBlock>{"npm install --global openbucket@latest\nopenbucket version"}</CodeBlock>
          <p>Pin an exact version instead of <code>@latest</code> for unattended production hosts &mdash; <a href={`${githubUrl}/releases`}>browse releases</a> to pick one.</p>
        </header>

        <DocSection id="installer-script" eyebrow="ALTERNATIVE" title="Installer script">
          <p>Download and inspect the script before executing it. It verifies Node and npm, then installs the same published package without using sudo.</p>
          <CodeBlock>{"curl -fsSLO https://openbucket.zydcode.in/install.sh\nless install.sh\nsh install.sh"}</CodeBlock>
          <h3>Windows PowerShell</h3>
          <CodeBlock label="PowerShell">{"Invoke-WebRequest https://openbucket.zydcode.in/install.ps1 -OutFile install.ps1\nGet-Content .\\install.ps1\n.\\install.ps1"}</CodeBlock>
        </DocSection>

        <DocSection id="docker" eyebrow="CONTAINERS" title="Run with persistent volumes">
          <p>Use the repository&apos;s documented Compose profile. It builds both services from source with persistent volumes. Set a management token containing at least 32 random UTF-8 bytes in <code>.env</code> before startup.</p>
          <CodeBlock label="Docker Compose">{"git clone https://github.com/Razin-developer/openbucket.git\ncd openbucket\ncp .env.example .env\n# Set OPENBUCKET_ADMIN_TOKEN and, for a custom deployment, OPENBUCKET_CONTROL_PLANE_URL.\ndocker compose build daemon\ndocker compose run --rm daemon login --email you@example.com\ndocker compose up --build -d"}</CodeBlock>
          <p>The one-off login writes the account session into the persistent <code>openbucket-state</code> volume. Compose then starts the daemon only after that account can be verified.</p>
        </DocSection>

        <DocSection id="source" eyebrow="CONTRIBUTORS" title="Build from source">
          <p>Only needed if you&apos;re working on OpenBucket itself &mdash; installed users don&apos;t need this. See <a href="/docs/local-development">Local development</a> for the full setup.</p>
          <CodeBlock>{"git clone https://github.com/Razin-developer/openbucket.git\ncd openbucket\nnpm ci\nnpm run build\nnpm test"}</CodeBlock>
        </DocSection>
      </article>
    </DocsShell>
  );
}

export function UsagePage() {
  return (
    <DocsShell current="usage">
      <article className="docs-content">
        <header className="docs-hero" id="first-node">
          <p className="section-kicker">USAGE</p>
          <h1>Run and operate a node.</h1>
          <p>Pass an existing directory, mounted drive, or NAS path. OpenBucket keeps internal metadata beneath that storage root and serves real object bytes from it.</p>
          <CodeBlock>{"mkdir -p /srv/openbucket\nopenbucket login --email you@example.com\nopenbucket serve /srv/openbucket --name home-node"}</CodeBlock>
          <p>The normal flow verifies your account before starting, registers the node, reports storage and aggregate request counters, and advertises its active public endpoint. Use <code>--offline --no-tunnel</code> only for deliberate standalone development.</p>
          <p>The safe defaults bind the management API to <code>127.0.0.1:7272</code>, S3 to <code>127.0.0.1:8333</code>, and the embedded dashboard to <code>localhost:3000</code>. The CLI generates a strong management token when one is not supplied.</p>
          <div className="docs-warning"><strong>Keep it local first.</strong><p>Do not bind management to a public interface without a firewall, TLS proxy, independent access policy, and an exact dashboard origin.</p></div>
        </header>

        <DocSection id="daily-commands" eyebrow="DAY TO DAY" title="Common commands">
          <CodeBlock>{"openbucket status               # daemon + storage summary\nopenbucket bucket create photos --public\nopenbucket key create --name ci-pipeline\nopenbucket logs --follow\nopenbucket share photos vacation.jpg --expires 1h\nopenbucket stop"}</CodeBlock>
          <p>Every command has a hosted equivalent in the <a href="/docs/api">API reference</a> if you&apos;d rather script against the local management API directly.</p>
        </DocSection>

        <DocSection id="renaming" eyebrow="NODE IDENTITY" title="Renaming a node">
          <p>Renaming doesn&apos;t require a restart or losing history:</p>
          <CodeBlock>{"openbucket rename new-node-name"}</CodeBlock>
          <p>This updates the running daemon immediately and, if the node is hosted-connected (signed in with a saved credential), also updates the control plane&apos;s registration &mdash; heartbeat and usage history stay attached since the hosted side keys nodes by a stable id, not by name.</p>
        </DocSection>

        <DocSection id="interactive-console" eyebrow="TUI · BETA" title="The interactive console (beta)">
          <p>Run <code>openbucket</code> with no arguments (or <code>openbucket ui</code> explicitly) to open a full-screen terminal UI: buckets, keys, logs, tunnel state, server start/stop/rename, an Account screen for hosted sign-in, and effective config &mdash; no flags to memorize. It falls back to <code>openbucket help</code> when output isn&apos;t an interactive terminal (scripts, CI, piped output).</p>
          <div className="docs-warning"><strong>This is a beta screen.</strong><p>Every command is also available as a plain, scriptable flag (see the sections above) if you&apos;d rather not depend on it yet.</p></div>
          <CodeBlock>{"openbucket"}</CodeBlock>
        </DocSection>
      </article>
    </DocsShell>
  );
}

export function DashboardPage() {
  return (
    <DocsShell current="dashboard">
      <article className="docs-content">
        <header className="docs-hero" id="local-dashboard">
          <p className="section-kicker">DASHBOARD</p>
          <h1>Operate the live node.</h1>
          <p><code>openbucket serve</code> hosts and opens the packaged dashboard automatically. It receives a one-time pairing fragment, removes it from the address bar, and keeps the management token in API-scoped session storage.</p>
          <CodeBlock>{"openbucket dashboard"}</CodeBlock>
          <p>Your browser may ask for Local Network Access when this public HTTPS site first contacts a loopback or private daemon. Grant it for OpenBucket; if the browser blocks plain HTTP local requests, expose management through an authenticated HTTPS tunnel or reverse proxy.</p>
        </header>

        <DocSection id="hosted-dashboard" eyebrow="HOSTED" title="Sign in to the hosted dashboard">
          <p>Anyone can <a href="/register">create an account</a> to pair a node with the hosted control plane. The hosted <a href="/dashboard">web dashboard</a> reads MongoDB-backed node registrations, presence, storage summaries, and aggregate usage. Object bytes, raw node tokens, management credentials, and S3 keys remain on the storage host. Everything it calls is documented in the <a href="/docs/api#hosted-nodes">hosted API reference</a>.</p>
        </DocSection>

      </article>
    </DocsShell>
  );
}

export function S3SigningPage() {
  return (
    <DocsShell current="s3-signing">
      <article className="docs-content">
        <header className="docs-hero" id="sigv4">
          <p className="section-kicker">S3 SIGNING</p>
          <h1>AWS Signature Version 4.</h1>
          <p>The local S3 API (default <code>http://127.0.0.1:8333</code>) verifies every request with real SigV4 &mdash; header authorization and presigned-query authorization both work, against a 15-minute clock-skew tolerance. Presigned URLs expire after at most 7 days.</p>
        </header>

        <DocSection id="clients" eyebrow="EXISTING TOOLS" title="Connect existing clients">
          <p>Create a workload key from the dashboard or management API, then use the OpenBucket S3 endpoint as a custom endpoint. Path-style addressing is supported.</p>
          <CodeBlock label="AWS CLI">{"export AWS_ACCESS_KEY_ID=\"<openbucket-access-key>\"\nexport AWS_SECRET_ACCESS_KEY=\"<openbucket-secret-key>\"\naws s3 mb s3://assets --endpoint-url http://127.0.0.1:8333\naws s3 sync ./assets s3://assets --endpoint-url http://127.0.0.1:8333"}</CodeBlock>
          <CodeBlock label="Python · Boto3">{"import boto3\n\ns3 = boto3.client(\n    \"s3\",\n    endpoint_url=\"http://127.0.0.1:8333\",\n    aws_access_key_id=\"<openbucket-access-key>\",\n    aws_secret_access_key=\"<openbucket-secret-key>\",\n    region_name=\"auto\",\n)\ns3.upload_file(\"report.pdf\", \"assets\", \"reports/report.pdf\")"}</CodeBlock>
        </DocSection>

        <DocSection id="compatibility" eyebrow="LIMITS" title="Compatibility notes">
          <p><strong>Supported</strong>: SigV4 header and presigned-query authorization, path-style bucket/object CRUD, byte ranges, object copy, ListObjectsV2 pagination, and multipart upload.</p>
          <p><strong>Not supported</strong>: SigV2/STS, virtual-hosted addressing, batch <code>DeleteObjects</code>, <code>ListParts</code>/<code>ListMultipartUploads</code>/<code>UploadPartCopy</code>, conditional headers, custom object metadata/tags, and server-side encryption.</p>
          <p>See the <a href={`${githubUrl}/blob/main/docs/S3_COMPATIBILITY.md`}>full compatibility matrix</a> before depending on an advanced AWS S3 feature.</p>
        </DocSection>
      </article>
    </DocsShell>
  );
}

export function LocalApiPage() {
  return (
    <DocsShell current="local-api">
      <article className="docs-content">
        <header className="docs-hero" id="auth-token">
          <p className="section-kicker">LOCAL API</p>
          <h1>Script against your own node.</h1>
          <p>The local daemon exposes a management API (default <code>http://127.0.0.1:7272</code>) for everything the CLI and dashboard do &mdash; buckets, objects, keys, share links, logs, status, and renaming. Every route except <code>GET /healthz</code> requires the management bearer token generated when you ran <code>openbucket serve</code>.</p>
          <CodeBlock>{"openbucket config   # prints the effective management token and endpoints"}</CodeBlock>
        </header>

        <DocSection id="quick-examples" eyebrow="EXAMPLES" title="Quick examples">
          <TabbedCode tabs={[
            { label: "JavaScript", code: "const token = process.env.OPENBUCKET_TOKEN;\n\nconst status = await fetch(\"http://127.0.0.1:7272/v1/status\", {\n  headers: { authorization: `Bearer ${token}` },\n}).then((r) => r.json());\n\nawait fetch(\"http://127.0.0.1:7272/v1/buckets\", {\n  method: \"POST\",\n  headers: { authorization: `Bearer ${token}`, \"content-type\": \"application/json\" },\n  body: JSON.stringify({ name: \"assets\", public: false }),\n});" },
            { label: "Python", code: "import os, requests\n\ntoken = os.environ[\"OPENBUCKET_TOKEN\"]\nheaders = {\"Authorization\": f\"Bearer {token}\"}\n\nstatus = requests.get(\"http://127.0.0.1:7272/v1/status\", headers=headers).json()\n\nrequests.post(\n    \"http://127.0.0.1:7272/v1/buckets\",\n    headers=headers,\n    json={\"name\": \"assets\", \"public\": False},\n)" },
          ]} />
          <p>Every endpoint, exact request/response shapes, and more examples live in the <a href="/docs/api#local-management">full API reference</a>.</p>
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
  return (
    <DocsShell current="api">
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
            description: "Checks the server-configured admin credentials first \u2014 a match returns role: \"admin\" with no database row \u2014 then falls back to the normal account lookup.",
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
          <p><code>name</code> is a display label, not a unique identifier &mdash; two accounts can each register a node called <code>home-node</code>, the way two Vercel accounts can each have a project named the same thing. Every node also gets a <code>routeSlug</code>: it starts as the normalized name and only gets a short random suffix appended on collision, and it never changes even if the node is renamed. A publicly discoverable node is reachable at <code>openbucket.zydcode.in/s3/&lt;routeSlug&gt;</code> and <code>/api/&lt;routeSlug&gt;</code> &mdash; these reverse-proxy real S3 and management traffic straight to the node&apos;s own tunnel; the daemon on the other end still does its own SigV4 or bearer-token verification exactly as it would for a direct connection.</p>
          <EndpointCard endpoint={{
            id: "api-nodes-list", method: "GET", path: "/api/nodes", title: "List your nodes", auth: "Session cookie.",
            description: "Up to 100 nodes, newest first.",
            response: "{ \"nodes\": [ { \"id\", \"name\", \"routeSlug\", \"status\": \"online\"|\"offline\"|\"revoked\", \"storage\", \"usage\", \"endpoint\": { \"publicS3ProxyUrl\", \"publicApiProxyUrl\", ... } } ] }",
            js: "const { nodes } = await fetch(\"/api/nodes\", { credentials: \"same-origin\" }).then((r) => r.json());",
            python: "nodes = session.get(\"https://your-openbucket-domain/api/nodes\").json()[\"nodes\"]",
          }} />
          <EndpointCard endpoint={{
            id: "api-nodes-create", method: "POST", path: "/api/nodes", title: "Register a node", auth: "Session cookie.",
            description: "Idempotent by name for your own account \u2014 calling it again with a name you already own returns created: false without a new credential. A name already used by a different account is fine; the new node gets a distinct routeSlug. This is what \"openbucket serve\" calls on first connect.",
            request: "{ \"name\": \"home-node\" }",
            response: "{ \"created\": true, \"node\": { \"routeSlug\": \"home-node\", ... }, \"credential\": { \"token\": \"obn_...\", \"managementSecret\": \"...\", \"createdAt\": \"...\" } }",
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
            id: "api-admin", method: "GET", path: "/api/admin/overview?from=&to=&interval=", title: "Admin overview", auth: "Session cookie, role must be \"admin\" (the server-configured admin account).",
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

export function LocalDevelopmentPage() {
  return (
    <DocsShell current="local-development">
      <article className="docs-content">
        <header className="docs-hero" id="setup">
          <p className="section-kicker">LOCAL DEVELOPMENT</p>
          <h1>Working on OpenBucket itself.</h1>
          <p>Requires Node.js 22.13+, npm using the committed lockfile, and Git. Free the default local ports (7272, 8333, 3000) if you plan to run the product defaults.</p>
          <CodeBlock>{"git clone https://github.com/Razin-developer/openbucket.git\ncd openbucket\nnpm ci\nnpm run build\nnpm test"}</CodeBlock>
        </header>

        <DocSection id="repo-map" eyebrow="LAYOUT" title="Repository map">
          <CodeBlock label="Directories">{"app/                     dashboard UI and styling\nsrc/cli/                 CLI parsing, lifecycle, management client\nsrc/dashboard/           embedded production-dashboard server\nsrc/daemon/              management/S3 routers, auth, disk store\ntests/cli/               CLI parsing/behavior tests\ntests/daemon/            disk, API, SigV4, traversal integration tests\ntests/*.test.mjs          rendered-dashboard/server tests\ndocs/                    product, architecture, API, security, operations\nexamples/                SDK and management examples\npython/                  typed Python management client and integration tests\nvercel/                  hosted marketing site + dashboard\n.github/workflows/       CI, security, release, container, and Vercel automation\nscripts/                 install and local development helpers"}</CodeBlock>
          <p>Generated directories such as <code>dist</code>, <code>.vinext</code>, <code>.wrangler</code>, coverage, and temp data must not be committed.</p>
        </DocSection>

        <DocSection id="commands" eyebrow="SCRIPTS" title="Common commands">
          <CodeBlock>{"npm run dev                  # dashboard development server\nnpm run dev:daemon           # foreground source daemon on ./.openbucket-data\nnpm run openbucket -- help   # run source CLI through tsx\n\nnpm run build                # web then CLI; required release shape\nnpm run type-check           # web + Node TypeScript checks\nnpm run lint                 # ESLint excluding generated output\nnpm run test:unit            # compile CLI and run daemon/CLI tests\nnpm test                     # unit then web verification\nnpm run release:check        # complete Node/Vercel release gate"}</CodeBlock>
          <p>Use <code>npm run build</code>, not an arbitrary reversed build sequence, when validating packaging &mdash; the web and compiled Node outputs intentionally coexist under <code>dist</code>.</p>
        </DocSection>

        <DocSection id="tests" eyebrow="PRINCIPLES" title="Test principles">
          <p><strong>Use real behavior.</strong> Tests use temporary real directories, ephemeral ports, actual HTTP requests, and byte comparisons where practical &mdash; avoid mocking the storage/data path when the behavior under test is filesystem, HTTP, signing, or persistence.</p>
          <p><strong>Leave the machine clean.</strong> Create test roots under the OS temp directory, register cleanup before assertions that can fail, stop every daemon/server, and never touch a developer&apos;s real OpenBucket root or home state.</p>
          <p><strong>Match risk with coverage.</strong> Key/path validation, store/state persistence, SigV4, and management API changes all need focused regression tests, not just a happy-path check. See the <a href={`${githubUrl}/blob/main/docs/CONTRIBUTING.md`}>full test-coverage table</a> for area-by-area minimums.</p>
        </DocSection>
      </article>
    </DocsShell>
  );
}

export function ContributingPage() {
  return (
    <DocsShell current="contributing">
      <article className="docs-content">
        <header className="docs-hero" id="before-starting">
          <p className="section-kicker">CONTRIBUTING</p>
          <h1>Fixes, tests, and<br />carefully scoped features.</h1>
          <p>The project is early: correctness, recoverability, and an honest S3 compatibility contract matter more than surface area. By submitting a contribution, you agree it can be included under the repository&apos;s Apache-2.0 license.</p>
          <h3>Reporting a defect</h3>
          <p>Include the OpenBucket version/commit, Node.js version, OS and filesystem/mount type, exact operation and endpoint topology, expected vs. observed behavior, the stable error code and request id if available, and a minimal reproduction against disposable data.</p>
          <h3>Proposing a feature</h3>
          <p>State the user and job, the proposed command/API/S3 behavior, on-disk and migration impact, security/trust impact, failure/recovery behavior, and which existing limitation it resolves.</p>
          <div className="docs-warning"><strong>Never file a public issue containing credentials, state files, share URLs, or exploitable vulnerability details.</strong><p>Follow the <a href={`${githubUrl}/blob/main/docs/SECURITY.md`}>security reporting process</a> instead.</p></div>
        </header>

        <DocSection id="guidelines" eyebrow="CODE STYLE" title="Code guidelines">
          <ul className="docs-checklist">
            <li>Keep TypeScript strict and Node ESM-compatible.</li>
            <li>Prefer Node built-ins in the daemon core; justify new runtime dependencies by operational/security value.</li>
            <li>Keep routers thin and store/auth behavior independently testable.</li>
            <li>Preserve structured stable error codes; never leak internal paths/secrets in generic 500 responses.</li>
            <li>Validate before filesystem access and maintain root confinement through every decode/resolve step.</li>
            <li>Stream object data rather than buffering it, except where a documented bounded body is necessary.</li>
            <li>Keep dashboard data live &mdash; never ship invented capacity, request, bucket, or object metrics.</li>
            <li>Maintain loopback/private defaults and make exposure explicit.</li>
          </ul>
        </DocSection>

        <DocSection id="pr-scope" eyebrow="PULL REQUESTS" title="Pull request scope">
          <p>Prefer one coherent behavior change. A complete pull request normally states the problem and user impact, an implementation summary, a security/on-disk/API compatibility assessment, tests and commands run, and documentation changes. Don&apos;t bundle unrelated cleanup with a security or storage correctness fix.</p>
          <CodeBlock label="Commit style">{"Reject symlinked multipart targets\nAdd ListObjectsV2 delimiter coverage\nDocument management token rotation"}</CodeBlock>
        </DocSection>

        <DocSection id="security-checklist" eyebrow="BEFORE YOU SUBMIT" title="Security checklist for changes">
          <ul className="docs-checklist">
            <li>Does this expand a listen address, origin, proxy, or public route?</li>
            <li>Can a browser or non-browser client spoof the new trust signal?</li>
            <li>Is a secret placed in a URL, log, UI, environment, state, or error output?</li>
            <li>Are comparisons and token expiries constant-time and bounded?</li>
            <li>Is every decoded path segment validated after decoding, and can a symlink/race escape the root?</li>
            <li>Does read-only/bucket scope apply to the new operation and every source/destination?</li>
          </ul>
          <div className="docs-next-links">
            <a href={`${githubUrl}/blob/main/docs/CONTRIBUTING.md`}><span>Full guide</span><strong>CONTRIBUTING.md <ArrowRight size={13} /></strong></a>
            <a href={`${githubUrl}/blob/main/docs/SECURITY.md`}><span>Related</span><strong>Security model <ArrowRight size={13} /></strong></a>
          </div>
        </DocSection>

        <DocSection id="support" eyebrow="SUPPORT" title="Support the project">
          <p>Code, tests, and bug reports are the highest-value contribution. If OpenBucket is already useful to you and you&apos;d rather back it directly, both of these help.</p>
          <div className="docs-support-actions">
            <a className="site-button dark small" href={githubUrl} target="_blank" rel="noreferrer">
              <Star size={15} aria-hidden="true" /> Star on GitHub
            </a>
            <a className="site-button light small" href={buyMeACoffeeUrl} target="_blank" rel="noreferrer">
              <Coffee size={15} aria-hidden="true" /> Buy me a coffee
            </a>
          </div>
        </DocSection>
      </article>
    </DocsShell>
  );
}
