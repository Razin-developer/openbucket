/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Boxes, Check, Copy, Database, FileKey2, Gauge,
  HardDrive, KeyRound, Lock, Server, ShieldCheck, Terminal, Workflow,
} from "lucide-react";
import { SiteHeader, githubUrl } from "./site-shell";

function useParallax<T extends HTMLElement>(factor = 0.25) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = window.scrollY * factor;
      node.style.transform = `translate3d(0, ${offset}px, 0)`;
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [factor]);
  return ref;
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

const npmCommand = "npm install --global openbucket";
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

const clients = ["AWS CLI", "Boto3", "JavaScript SDK", "curl", "Terraform", "rclone"];

const fixCards = [
  { icon: Terminal, title: "One-command daemon", body: "Choose a path and start. OpenBucket creates confined bucket namespaces without relocating the rest of your disk." },
  { icon: Gauge, title: "Real operations UI", body: "Inspect capacity, buckets, objects, keys, endpoints, logs, and request analytics from the node that produced them." },
  { icon: Lock, title: "Local-first security", body: "Loopback listeners are the default. The management API requires a strong bearer token and S3 requests use workload credentials." },
];

const featureCards = [
  { icon: Database, title: "S3 compatibility", body: "Path-style requests, SigV4, presigned URLs, range reads, and multipart uploads work against your endpoint." },
  { icon: Gauge, title: "Live analytics", body: "Request counts, transfer totals, and error rates computed from the requests this node actually served." },
  { icon: KeyRound, title: "Scoped API keys", body: "Issue independent, revocable credentials per application, optionally read-only or bucket-scoped." },
  { icon: ShieldCheck, title: "Signature verification", body: "Every request is checked against AWS Signature Version 4 before it touches the filesystem." },
  { icon: FileKey2, title: "Expiring share links", body: "Generate a time-boxed, signed URL for a single object without handing out standing credentials." },
  { icon: Workflow, title: "Detached lifecycle", body: "Run in the foreground for development, or detach the daemon and manage it with the CLI." },
];

const deployOptions = [
  { title: "Local", body: "Run the daemon on your own machine with the CLI. No account required for offline development.", items: ["openbucket serve <path>", "Local dashboard on 127.0.0.1", "Full S3 + management API"] },
  { title: "Docker / Compose", body: "Ship the same daemon as a container alongside the services that use it.", items: ["Official daemon + dashboard images", "docker-compose.yml included", "Same CLI, same S3 surface"], featured: true },
  { title: "Hosted dashboard", body: "Pair a local node with the hosted control plane for remote visibility and a Quick Tunnel.", items: ["Account-gated production serve", "S3-only Cloudflare Quick Tunnel", "Usage metering per node"] },
];

const integrationNodes = [
  { icon: Terminal, label: "CLI" },
  { icon: Boxes, label: "SDKs" },
  { icon: HardDrive, label: "OpenBucket", hub: true },
  { icon: Server, label: "Infra as code" },
  { icon: Database, label: "Apps" },
];

function IntegrationNodes() {
  return (
    <div className="fs-node-row" aria-label="S3 clients and tools connecting to one OpenBucket node">
      <svg className="fs-node-svg" viewBox="0 0 400 4" preserveAspectRatio="none" aria-hidden="true">
        <line className="fs-plotter-line" x1="0" y1="2" x2="400" y2="2" />
      </svg>
      {integrationNodes.map(({ icon: Icon, label, hub }) => (
        <div className="fs-node-item" key={label}>
          <span className={`fs-node${hub ? " fs-hub" : ""}`}><Icon size={hub ? 32 : 24} aria-hidden="true" /></span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

export function LandingPage() {
  const heroShotRef = useParallax<HTMLDivElement>(-0.08);
  const splitRef = useReveal<HTMLElement>();
  const fixRef = useReveal<HTMLElement>();
  const stepsRef = useReveal<HTMLElement>();
  const featuresRef = useReveal<HTMLElement>();
  const integrationRef = useReveal<HTMLElement>();
  const deployRef = useReveal<HTMLElement>();
  const ctaRef = useReveal<HTMLDivElement>();

  return (
    <div className="site-shell landing-page">
      <div className="fs-hero">
        <SiteHeader current="home" overlay />
        <div className="fs-hero-inner">
          <span className="fs-badge">Local storage · cloud interface</span>
          <h1>Your disk. Now S3-compatible.</h1>
          <p>OpenBucket turns any folder, SSD, or NAS into a real S3-compatible endpoint — and gives you a live dashboard to operate it.</p>
          <div className="fs-hero-actions">
            <a className="site-button dark" href="/login">Get started</a>
            <a className="site-button light" href="/docs">Read the docs</a>
          </div>
        </div>
        <div className="fs-hero-shot">
          <div ref={heroShotRef}>
            <img src="/og.png" alt="The OpenBucket dashboard showing buckets, capacity, and live request analytics" />
          </div>
        </div>
      </div>

      <main>
        <section className="fs-logo-strip" aria-label="Compatible clients">
          <p>Speaks the S3 API your tools already use</p>
          <div className="fs-logo-row">
            {clients.map((client) => <span key={client}>{client}</span>)}
          </div>
        </section>

        <section className="fs-split reveal" id="product" ref={splitRef}>
          <div>
            <p className="section-kicker">LOCAL BY DESIGN</p>
            <h2>Cloud-shaped storage. Without moving the disk.</h2>
            <p>The daemon serves real bytes from a directory you choose. The CLI and dashboard operate that same live node — nothing is simulated.</p>
            <ul className="fs-split-list">
              <li><Check size={19} aria-hidden="true" /> Your filesystem remains the source of truth.</li>
              <li><Check size={19} aria-hidden="true" /> Standard AWS tools point at a custom endpoint.</li>
              <li><Check size={19} aria-hidden="true" /> Management access stays separately authenticated.</li>
            </ul>
          </div>
          <div className="fs-diamond" aria-hidden="true">
            <div className="fs-diamond-shape" />
            <div className="fs-diamond-stats">
              <span className="fs-stat-pill"><Database size={16} /> S3-compatible API</span>
              <span className="fs-stat-pill"><Lock size={16} /> Bearer-token admin</span>
              <span className="fs-stat-pill"><HardDrive size={16} /> Your disk, your bytes</span>
            </div>
          </div>
        </section>

        <section className="fs-section soft reveal" id="why" ref={fixRef}>
          <div className="fs-section-head">
            <p className="fs-kicker">Why OpenBucket</p>
            <h2>Built to fix that</h2>
            <p className="fs-lead">Object storage shouldn&apos;t mean renting a bucket you can&apos;t see. OpenBucket keeps the data local and gives it a standard interface.</p>
          </div>
          <div className="fs-fix-grid">
            <article className="fs-fix-card fs-visual">
              <strong>Disk in. S3 out.</strong>
              <span>One daemon, one storage root, a standard API on the other side.</span>
            </article>
            {fixCards.map(({ icon: Icon, title, body }) => (
              <article className="fs-fix-card" key={title}>
                <span className="fs-fix-icon"><Icon size={21} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fs-steps-card reveal" ref={stepsRef}>
          <div className="fs-steps-inner">
            <ol className="fs-steps-list">
              <li className="fs-step"><span>1</span><div><strong>Install the CLI</strong><p>{npmCommand} <CopyCommand value={npmCommand} /></p></div></li>
              <li className="fs-step"><span>2</span><div><strong>Point it at a folder</strong><p>{serveCommand} <CopyCommand value={serveCommand} /></p></div></li>
              <li className="fs-step"><span>3</span><div><strong>Connect any S3 client</strong><p>The dashboard opens alongside the daemon automatically.</p></div></li>
            </ol>
            <div>
              <a className="site-button dark" href="/docs#installation">All installation methods <ArrowRight size={15} aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section className="fs-section reveal" id="features" ref={featuresRef}>
          <div className="fs-section-head">
            <p className="fs-kicker">Features</p>
            <h2>Features that set OpenBucket apart</h2>
            <p className="fs-lead">Everything a self-hosted S3 endpoint needs, none of the parts that only make sense for a multi-tenant cloud.</p>
          </div>
          <div className="fs-features-grid">
            {featureCards.map(({ icon: Icon, title, body }) => (
              <article className="fs-feature-card" key={title}>
                <span className="fs-fix-icon"><Icon size={21} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{body}</p>
                <a href="/docs">Learn more <ArrowRight size={13} aria-hidden="true" /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="fs-integration reveal" id="connect" ref={integrationRef}>
          <div>
            <p className="section-kicker">CONNECT ANYTHING</p>
            <h2>One node, every S3 tool</h2>
            <p className="fs-lead" style={{ margin: "14px 0 0", textAlign: "left" }}>Terminals, SDKs, and infrastructure-as-code tools all talk to the same daemon over the standard S3 API — no vendor lock-in, no proprietary client.</p>
            <IntegrationNodes />
          </div>
          <blockquote className="fs-quote">
            <p>“The daemon serves real bytes from that disk; the CLI and dashboard operate the same live node.”</p>
            <footer>From the OpenBucket design principles</footer>
          </blockquote>
        </section>

        <section className="fs-section soft reveal" id="deploy" ref={deployRef}>
          <div className="fs-section-head">
            <p className="fs-kicker">Deployment</p>
            <h2>Run it wherever your disk is</h2>
            <p className="fs-lead">OpenBucket is Apache-2.0 and free to self-host. Pick the deployment shape that matches where your storage lives.</p>
          </div>
          <div className="fs-deploy-grid">
            {deployOptions.map((option) => (
              <article className={`fs-deploy-card${option.featured ? " fs-featured" : ""}`} key={option.title}>
                <h3>{option.title}</h3>
                <p>{option.body}</p>
                <ul className="fs-deploy-list">
                  {option.items.map((item) => <li key={item}><Check size={14} aria-hidden="true" /> {item}</li>)}
                </ul>
                <a className={`site-button ${option.featured ? "light" : "dark"} small`} href="/docs">Read the docs</a>
              </article>
            ))}
          </div>
        </section>
      </main>

      <div className="fs-cta-band reveal" ref={ctaRef}>
        <p className="section-kicker">READY WHEN YOUR DISK IS</p>
        <h2>Make local storage useful everywhere.</h2>
        <div className="fs-section-actions">
          <a className="site-button dark" href="/login">Get started</a>
          <a className="site-button ghost" href={githubUrl}>View source</a>
        </div>
      </div>

      <footer className="fs-footer">
        <div className="fs-footer-top">
          <div>
            <a className="site-brand" href="/" aria-label="OpenBucket home">
              <svg className="site-brand-mark" width={27} height={27} viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#171717" /><path d="M8 10.5h16l-1.6 12.2a3 3 0 0 1-3 2.6h-6.8a3 3 0 0 1-3-2.6L8 10.5Z" fill="#fff" /><path d="M7 8.5A1.5 1.5 0 0 1 8.5 7h15a1.5 1.5 0 0 1 0 3h-15A1.5 1.5 0 0 1 7 8.5Z" fill="#fff" /><path d="M12 15h8M12.7 19h6.6" stroke="#171717" strokeWidth="2" strokeLinecap="round" /></svg>
              <span>OpenBucket</span>
            </a>
            <p>Your disk. A standard S3 interface. No invented data in between.</p>
          </div>
          <div>
            <strong>Product</strong>
            <a href="/docs">Documentation</a>
            <a href="/dashboard">Dashboard</a>
            <a href={`${githubUrl}/releases`}>Releases</a>
          </div>
          <div>
            <strong>Project</strong>
            <a href={githubUrl}>Source</a>
            <a href={`${githubUrl}/issues`}>Issues</a>
            <a href={`${githubUrl}/blob/main/LICENSE`}>Apache-2.0</a>
          </div>
          <div>
            <strong>Get started</strong>
            <a href="/login">Sign in</a>
            <a href="/docs#installation">Installation</a>
            <a href={githubUrl}>Star on GitHub</a>
          </div>
        </div>
        <div className="fs-footer-bottom">
          <span>OpenBucket is open-source software. Object bytes remain on storage you control.</span>
          <span>Apache-2.0</span>
        </div>
      </footer>
    </div>
  );
}
