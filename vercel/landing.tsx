/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { SiteFooter, SiteHeader, githubUrl } from "./site-shell";

const npmCommand = "npm install --global openbucket";
const loginCommand = "openbucket login --email you@example.com";
const serveCommand = "openbucket serve /path/to/storage --name home-node";

function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="landing-copy"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    >
      {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
    </button>
  );
}

function ProductDiagram() {
  return (
    <div className="product-diagram" aria-label="A local OpenBucket daemon connects a disk to S3 clients and the dashboard">
      <div className="diagram-node disk-node">
        <span className="diagram-icon disk" aria-hidden="true"><i /><i /><i /></span>
        <div><small>YOUR HARDWARE</small><strong>Folder, SSD or NAS</strong></div>
      </div>
      <span className="diagram-line" aria-hidden="true" />
      <div className="diagram-node daemon-node">
        <span className="bucket-shape" aria-hidden="true" />
        <div><small>ONE DAEMON</small><strong>OpenBucket</strong></div>
      </div>
      <span className="diagram-line" aria-hidden="true" />
      <div className="diagram-targets">
        <div className="diagram-node"><span className="diagram-code" aria-hidden="true">S3</span><div><small>STANDARD API</small><strong>Existing clients</strong></div></div>
        <div className="diagram-node"><span className="diagram-code" aria-hidden="true">UI</span><div><small>CONTROL PLANE</small><strong>Live dashboard</strong></div></div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="site-shell landing-page">
      <section className="landing-reference-hero" aria-labelledby="landing-title">
        <SiteHeader current="home" overlay />
        <img src="/og.png" alt="" aria-hidden="true" />
        <div className="landing-accessible-copy">
          <p>Local storage · cloud interface</p>
          <h1 id="landing-title">OpenBucket</h1>
          <strong>Your disk. Now S3-compatible.</strong>
        </div>
        <div className="landing-hero-actions">
          <a className="site-button dark" href="/login">Open the dashboard</a>
          <a className="site-button light" href="/docs">Read the docs</a>
          <span>Open source · Apache-2.0</span>
        </div>
      </section>

      <main>
        <section className="landing-intro" id="product">
          <p className="section-kicker">LOCAL BY DESIGN</p>
          <div>
            <h2>Cloud-shaped storage.<br />Without moving the disk.</h2>
            <p>OpenBucket turns a directory you choose into an S3-compatible endpoint. The daemon serves real bytes from that disk; the CLI and dashboard operate the same live node.</p>
          </div>
          <div className="landing-principles" aria-label="OpenBucket principles">
            <span><b>01</b> Your filesystem remains the source of truth.</span>
            <span><b>02</b> Standard AWS tools use a custom endpoint.</span>
            <span><b>03</b> Management access stays separately authenticated.</span>
          </div>
        </section>

        <section className="landing-diagram-section">
          <div className="section-heading">
            <p className="section-kicker">ONE SMALL CONTROL PLANE</p>
            <h2>Disk in. S3 out.</h2>
            <p>Keep the storage you already own. Add interfaces your tools already understand.</p>
          </div>
          <ProductDiagram />
        </section>

        <section className="landing-features">
          <article className="feature-card featured">
            <p className="section-kicker">S3 COMPATIBILITY</p>
            <h3>Use familiar clients.</h3>
            <p>Path-style requests, AWS Signature Version 4, presigned URLs, range reads, multipart uploads, and scoped keys work against your endpoint.</p>
            <div className="mini-client-grid" aria-label="Compatible client examples">
              <span>AWS CLI</span><span>Boto3</span><span>JavaScript SDK</span><span>curl</span>
            </div>
          </article>
          <article className="feature-card">
            <span className="feature-number">01</span>
            <h3>One-command daemon</h3>
            <p>Choose a path and start. OpenBucket creates confined bucket namespaces without relocating the rest of your disk.</p>
          </article>
          <article className="feature-card">
            <span className="feature-number">02</span>
            <h3>Real operations UI</h3>
            <p>Inspect capacity, buckets, objects, keys, endpoints, logs, and request analytics from the node that produced them.</p>
          </article>
          <article className="feature-card">
            <span className="feature-number">03</span>
            <h3>Local-first security</h3>
            <p>Loopback listeners are the default. The management API requires a strong bearer token and S3 requests use workload credentials.</p>
          </article>
        </section>

        <section className="landing-quickstart">
          <div className="quickstart-copy">
            <p className="section-kicker">RUN IT IN MINUTES</p>
            <h2>Three commands.<br />Your own endpoint.</h2>
            <p>Install the published CLI on the machine that owns the disk. The local dashboard opens alongside the daemon.</p>
            <a className="site-text-link" href="/docs#installation">All installation methods <ArrowRight size={15} aria-hidden="true" /></a>
          </div>
          <div className="terminal-card" aria-label="OpenBucket installation commands">
            <div className="terminal-title"><span><i /><i /><i /></span><b>openbucket — terminal</b></div>
            <div className="terminal-line"><span>$</span><code>{npmCommand}</code><CopyCommand value={npmCommand} /></div>
            <div className="terminal-output">CLI installed</div>
            <div className="terminal-line"><span>$</span><code>{loginCommand}</code><CopyCommand value={loginCommand} /></div>
            <div className="terminal-output">Account authenticated</div>
            <div className="terminal-line"><span>$</span><code>{serveCommand}</code><CopyCommand value={serveCommand} /></div>
            <div className="terminal-output success"><span><Check size={13} /> Node service running</span><span><Check size={13} /> S3 service available</span><span><Check size={13} /> Local dashboard paired</span></div>
          </div>
        </section>

        <section className="landing-cta">
          <div>
            <p className="section-kicker">READY WHEN YOUR DISK IS</p>
            <h2>Make local storage useful everywhere.</h2>
          </div>
          <div>
            <a className="site-button light" href="/login">Sign in</a>
            <a className="site-button ghost" href={githubUrl}>View source</a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
