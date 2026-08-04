/* eslint-disable @next/next/no-html-link-for-pages */
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

const githubUrl = "https://github.com/Razin-developer/openbucket";

type SiteShellProps = {
  children: ReactNode;
  current?: "home" | "docs" | "login" | "register";
  compact?: boolean;
};

export function BrandMark({ size = 27 }: { size?: number }) {
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

export function SiteHeader({ current, overlay = false }: { current?: SiteShellProps["current"]; overlay?: boolean }) {
  return (
    <header className={`site-header${overlay ? " overlay" : ""}`}>
      <Brand />
      <nav className="site-nav" aria-label="Public navigation">
        <a className={current === "home" ? "active" : ""} href="/#product">Product</a>
        <a className={current === "docs" ? "active" : ""} href="/docs">Docs</a>
        <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink size={13} aria-hidden="true" /></a>
      </nav>
      <div className="site-header-actions">
        <a className="site-login-link" href="/login">Sign in</a>
        <a className="site-button dark small" href="/dashboard">Open dashboard</a>
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
