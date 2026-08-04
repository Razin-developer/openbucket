/* eslint-disable @next/next/no-html-link-for-pages */
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

const githubUrl = "https://github.com/Razin-developer/openbucket";

type SiteShellProps = {
  children: ReactNode;
  current?: "home" | "docs" | "login" | "register";
  compact?: boolean;
};

export function Brand({ inverted = false }: { inverted?: boolean }) {
  return (
    <a className={`site-brand${inverted ? " inverted" : ""}`} href="/" aria-label="OpenBucket home">
      <span className="site-brand-mark" aria-hidden="true">
        <i />
      </span>
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
