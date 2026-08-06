/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen, Boxes, ChevronDown, Container, ExternalLink, Gauge,
  HardDrive, KeyRound, LayoutDashboard, Rocket, ShieldCheck, Star, Terminal, Workflow,
} from "lucide-react";

const githubUrl = "https://github.com/Razin-developer/openbucket";

type SiteShellProps = {
  children: ReactNode;
  current?: "home" | "docs" | "login" | "register";
  compact?: boolean;
};

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="site-brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#171717" />
      <path d="M8 10.5h16l-1.6 12.2a3 3 0 0 1-3 2.6h-6.8a3 3 0 0 1-3-2.6L8 10.5Z" fill="#fff" />
      <path d="M7 8.5A1.5 1.5 0 0 1 8.5 7h15a1.5 1.5 0 0 1 0 3h-15A1.5 1.5 0 0 1 7 8.5Z" fill="#fff" />
      <path d="M12 15h8M12.7 19h6.6" stroke="#171717" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ inverted = false }: { inverted?: boolean }) {
  return (
    <a className={`site-brand${inverted ? " inverted" : ""}`} href="/" aria-label="OpenBucket home">
      <BrandMark />
      <span>OpenBucket</span>
    </a>
  );
}

type SessionState = "loading" | "authenticated" | "anonymous";

function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("loading");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => { if (!cancelled) setState(response.ok ? "authenticated" : "anonymous"); })
      .catch(() => { if (!cancelled) setState("anonymous"); });
    return () => { cancelled = true; };
  }, []);
  return state;
}

const STAR_CACHE_KEY = "openbucket_gh_stars_v1";
const STAR_CACHE_TTL_MS = 10 * 60 * 1000;

function formatStarCount(count: number): string {
  if (count < 1_000) return String(count);
  const thousands = count / 1_000;
  return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

function useGithubStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = sessionStorage.getItem(STAR_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { count: number; fetchedAt: number };
        if (Date.now() - parsed.fetchedAt < STAR_CACHE_TTL_MS) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- cache read at mount, not a synchronous render loop
          setStars(parsed.count);
          return;
        }
      }
    } catch {
      // Ignore malformed cache entries and fall through to a fresh fetch.
    }
    fetch("https://api.github.com/repos/Razin-developer/openbucket", { headers: { accept: "application/vnd.github+json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { stargazers_count?: number } | null) => {
        if (cancelled || typeof payload?.stargazers_count !== "number") return;
        setStars(payload.stargazers_count);
        try {
          sessionStorage.setItem(STAR_CACHE_KEY, JSON.stringify({ count: payload.stargazers_count, fetchedAt: Date.now() }));
        } catch {
          // Storage may be unavailable (private browsing, quota); the count still renders this visit.
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return stars;
}

function GithubStarBadge() {
  const stars = useGithubStars();
  if (stars === null) return null;
  return (
    <a className="site-star-badge" href={githubUrl} target="_blank" rel="noreferrer" aria-label={`${stars} stars on GitHub`}>
      <Star size={14} aria-hidden="true" />
      {formatStarCount(stars)}
    </a>
  );
}

type NavLink = { href: string; label: string; description: string; icon: typeof Terminal };

const productLinks: NavLink[] = [
  { href: "/#product", label: "Overview", description: "How the daemon, CLI, and dashboard operate one real disk.", icon: HardDrive },
  { href: "/#why", label: "Why OpenBucket", description: "Local-first security and a real operations UI.", icon: ShieldCheck },
  { href: "/#features", label: "Features", description: "S3 compatibility, scoped keys, live analytics, share links.", icon: Gauge },
  { href: "/#connect", label: "Connect anything", description: "CLI, SDKs, and infra-as-code over the standard S3 API.", icon: Boxes },
  { href: "/#deploy", label: "Deployment", description: "Local, Docker/Compose, or the hosted control plane.", icon: Rocket },
];

const resourceLinks: NavLink[] = [
  { href: "/docs", label: "Documentation", description: "Install, run a node, and connect S3 clients.", icon: BookOpen },
  { href: "/docs/api", label: "API reference", description: "Every local and hosted endpoint, with JS and Python examples.", icon: Terminal },
  { href: "/docs#docker", label: "Docker", description: "Run the daemon as a container with persistent volumes.", icon: Container },
  { href: "/docs#production", label: "Production", description: "Treat the storage disk as real infrastructure.", icon: Workflow },
  { href: "/dashboard", label: "Dashboard", description: "Operate buckets, keys, and logs for a live node.", icon: LayoutDashboard },
  { href: `${githubUrl}/releases`, label: "Releases", description: "Changelog and published versions on GitHub.", icon: KeyRound },
];

function NavMenu({ label, links, active }: { label: string; links: NavLink[]; active: boolean }) {
  return (
    <div className="site-nav-item">
      <button type="button" className={`site-nav-trigger${active ? " active" : ""}`}>
        {label} <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div className="site-nav-panel">
        <div className="site-nav-panel-inner">
          {links.map(({ href, label: linkLabel, description, icon: Icon }) => (
            <a className="site-nav-panel-link" href={href} key={href}>
              <span className="site-nav-panel-icon"><Icon size={17} aria-hidden="true" /></span>
              <span>
                <strong>{linkLabel}</strong>
                <small>{description}</small>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteHeader({ current, overlay = false }: { current?: SiteShellProps["current"]; overlay?: boolean }) {
  const session = useSessionState();
  return (
    <header className={`site-header${overlay ? " overlay" : ""}`}>
      <Brand />
      <nav className="site-nav" aria-label="Public navigation">
        <NavMenu label="Product" links={productLinks} active={current === "home"} />
        <NavMenu label="Resources" links={resourceLinks} active={current === "docs"} />
        <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink size={13} aria-hidden="true" /></a>
      </nav>
      <div className="site-header-actions">
        <GithubStarBadge />
        {session === "authenticated" ? (
          <a className="site-button dark small" href="/dashboard">Dashboard</a>
        ) : session === "anonymous" ? (
          <>
            <a className="site-login-link" href="/login">Sign in</a>
            <a className="site-button dark small" href="/login">Get started</a>
          </>
        ) : null}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Brand inverted />
        <p>Your disk. A standard S3 interface. No invented data in between.</p>
      </div>
      <div className="site-footer-links">
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
      </div>
      <p className="site-footer-meta">OpenBucket is open-source software. Object bytes remain on storage you control.</p>
    </footer>
  );
}

export function SiteShell({ children, current, compact = false }: SiteShellProps) {
  return (
    <div className={`site-shell${compact ? " compact" : ""}`}>
      <SiteHeader current={current} />
      {children}
      {!compact ? <SiteFooter /> : null}
    </div>
  );
}

export { githubUrl };
