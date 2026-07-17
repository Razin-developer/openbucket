import { useState, type ReactNode } from "react";
import { SiteShell, githubUrl } from "./site-shell";

function CodeBlock({ children, label = "Terminal" }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      <div><span>{label}</span><button type="button" onClick={async () => { await navigator.clipboard.writeText(children); setCopied(true); window.setTimeout(() => setCopied(false), 1_400); }}>{copied ? "Copied" : "Copy"}</button></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function DocSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return <section className="docs-section" id={id}><p className="section-kicker">{eyebrow}</p><h2>{title}</h2>{children}</section>;
}

const navItems = [
  ["overview", "Overview"],
  ["installation", "Installation"],
  ["first-node", "Run your first node"],
  ["s3-clients", "Connect S3 clients"],
  ["dashboard", "Dashboard"],
  ["docker", "Docker"],
  ["production", "Production"],
] as const;

export function DocsPage() {
  return (
    <SiteShell current="docs">
      <main className="docs-layout">
        <aside className="docs-sidebar">
          <p>GET STARTED</p>
          <nav aria-label="Documentation sections">
            {navItems.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}
          </nav>
          <div className="docs-sidebar-callout">
            <strong>Need every detail?</strong>
            <p>The repository includes API, operations, security, S3 compatibility, and contribution references.</p>
            <a href={`${githubUrl}/tree/main/docs`}>Browse all guides ↗</a>
          </div>
        </aside>

        <article className="docs-content">
          <header className="docs-hero" id="overview">
            <p className="section-kicker">OPENBUCKET DOCUMENTATION</p>
            <h1>From local folder<br />to S3 endpoint.</h1>
            <p>Install the daemon on the machine that owns your storage, choose a path, then connect standard S3 clients or the live dashboard.</p>
            <div className="docs-requirement"><span aria-hidden="true">i</span><p><strong>Runtime requirement</strong> Node.js 22.13 or newer. Production releases are tested on Node.js 22 and 24.</p></div>
          </header>

          <DocSection id="installation" eyebrow="01 · INSTALLATION" title="Install the published CLI">
            <p>The npm package contains the CLI, daemon, embedded production dashboard, and management client commands. Install it globally on the storage host.</p>
            <CodeBlock>{"npm install --global openbucket@0.1.0\nopenbucket version"}</CodeBlock>
            <h3>Installer script</h3>
            <p>Download and inspect the script before executing it. It verifies Node and npm, then installs the same published package without using sudo.</p>
            <CodeBlock>{"curl -fsSLO https://openbucket-eight.vercel.app/install.sh\nless install.sh\nOPENBUCKET_INSTALL_VERSION=0.1.0 sh install.sh"}</CodeBlock>
            <h3>Windows PowerShell</h3>
            <CodeBlock label="PowerShell">{"Invoke-WebRequest https://openbucket-eight.vercel.app/install.ps1 -OutFile install.ps1\nGet-Content .\\install.ps1\n.\\install.ps1 -Version 0.1.0"}</CodeBlock>
          </DocSection>

          <DocSection id="first-node" eyebrow="02 · FIRST NODE" title="Serve a directory you control">
            <p>Pass an existing directory, mounted drive, or NAS path. OpenBucket keeps internal metadata beneath that storage root and serves real object bytes from it.</p>
            <CodeBlock>{"mkdir -p /srv/openbucket\nopenbucket serve /srv/openbucket"}</CodeBlock>
            <p>The safe defaults bind the management API to <code>127.0.0.1:7272</code>, S3 to <code>127.0.0.1:8333</code>, and the embedded dashboard to <code>localhost:3000</code>. The CLI generates a strong management token when one is not supplied.</p>
            <div className="docs-warning"><strong>Keep it local first.</strong><p>Do not bind management to a public interface without a firewall, TLS proxy, independent access policy, and an exact dashboard origin.</p></div>
          </DocSection>

          <DocSection id="s3-clients" eyebrow="03 · S3 CLIENTS" title="Point existing tools at OpenBucket">
            <p>Create a workload key from the dashboard or management API, then use the OpenBucket S3 endpoint as a custom endpoint. Path-style addressing is supported.</p>
            <CodeBlock label="AWS CLI">{"export AWS_ACCESS_KEY_ID=\"<openbucket-access-key>\"\nexport AWS_SECRET_ACCESS_KEY=\"<openbucket-secret-key>\"\naws s3 mb s3://assets --endpoint-url http://127.0.0.1:8333\naws s3 sync ./assets s3://assets --endpoint-url http://127.0.0.1:8333"}</CodeBlock>
            <CodeBlock label="Python · Boto3">{"import boto3\n\ns3 = boto3.client(\n    \"s3\",\n    endpoint_url=\"http://127.0.0.1:8333\",\n    aws_access_key_id=\"<openbucket-access-key>\",\n    aws_secret_access_key=\"<openbucket-secret-key>\",\n    region_name=\"auto\",\n)\ns3.upload_file(\"report.pdf\", \"assets\", \"reports/report.pdf\")"}</CodeBlock>
            <p>See the <a href={`${githubUrl}/blob/main/docs/S3_COMPATIBILITY.md`}>compatibility matrix</a> before depending on an advanced AWS S3 feature.</p>
          </DocSection>

          <DocSection id="dashboard" eyebrow="04 · DASHBOARD" title="Operate the live node">
            <p><code>openbucket serve</code> hosts and opens the packaged dashboard automatically. It receives a one-time pairing fragment, removes it from the address bar, and keeps the management token in API-scoped session storage.</p>
            <CodeBlock>{"openbucket dashboard"}</CodeBlock>
            <p>The hosted <a href="/dashboard">web dashboard</a> adds an OpenBucket account gate. After sign-in, the browser still connects directly to your daemon. Signing in does not upload object bytes, node state, or management credentials to the website database.</p>
            <p>Your browser may ask for Local Network Access when this public HTTPS site first contacts a loopback or private daemon. Grant it for OpenBucket; if the browser blocks plain HTTP local requests, expose management through an authenticated HTTPS tunnel or reverse proxy.</p>
          </DocSection>

          <DocSection id="docker" eyebrow="05 · CONTAINERS" title="Run with persistent volumes">
            <p>Until the first container release is published, use the repository&apos;s documented Compose profile. It builds both services from source with persistent volumes. Set a management token containing at least 32 random UTF-8 bytes in <code>.env</code> before startup.</p>
            <CodeBlock label="Docker Compose">{"git clone https://github.com/Razin-developer/openbucket.git\ncd openbucket\ncp .env.example .env\n# Set OPENBUCKET_ADMIN_TOKEN in .env, then:\ndocker compose up --build -d"}</CodeBlock>
          </DocSection>

          <DocSection id="production" eyebrow="06 · PRODUCTION" title="Treat the disk as infrastructure">
            <div className="production-checklist">
              <div><span>01</span><p><strong>Pin versions</strong>Use an exact npm version, container tag, or image digest for unattended hosts.</p></div>
              <div><span>02</span><p><strong>Protect management</strong>Keep it on loopback or behind independent identity-aware access, rate limits, and TLS.</p></div>
              <div><span>03</span><p><strong>Back up data and metadata</strong>Object bytes and the storage root&apos;s <code>.openbucket</code> state are both required for recovery.</p></div>
              <div><span>04</span><p><strong>Monitor the host</strong>Track free space, process health, request errors, and restore drills on representative data.</p></div>
            </div>
            <div className="docs-next-links">
              <a href={`${githubUrl}/blob/main/docs/OPERATIONS.md`}><span>Next</span><strong>Production operations →</strong></a>
              <a href={`${githubUrl}/blob/main/docs/SECURITY.md`}><span>Review</span><strong>Security model →</strong></a>
            </div>
          </DocSection>
        </article>
      </main>
    </SiteShell>
  );
}
