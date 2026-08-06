/* eslint-disable @next/next/no-html-link-for-pages */
import { AuthPage, ForgotPasswordPage, ProtectedDashboard, ResetPasswordPage } from "./auth";
import {
  ApiReferencePage,
  ContributingPage,
  DashboardPage,
  DocsPage,
  InstallationPage,
  LocalApiPage,
  LocalDevelopmentPage,
  S3SigningPage,
  UsagePage,
} from "./docs";
import { LandingPage } from "./landing";
import { NodeDiscoveryPage } from "./node-discovery";
import { SiteShell } from "./site-shell";

export type HostedRoute =
  | "home" | "docs" | "docs-installation" | "docs-usage" | "docs-dashboard" | "docs-s3-signing"
  | "docs-local-api" | "docs-api" | "docs-local-development" | "docs-contributing"
  | "login" | "register" | "forgot-password" | "reset-password" | "dashboard" | "node-discovery" | "not-found";

export const routeMetadata: Record<HostedRoute, { path: string; title: string; description: string; robots: string }> = {
  home: { path: "/", title: "OpenBucket — your disk, now S3-compatible", description: "Turn a local folder, disk, SSD, or NAS into secure S3-compatible object storage with one daemon and one CLI.", robots: "index, follow" },
  docs: { path: "/docs", title: "Documentation · OpenBucket", description: "Install OpenBucket, run a local storage node, connect S3 clients, and operate the production dashboard.", robots: "index, follow" },
  "docs-installation": { path: "/docs/installation", title: "Installation · OpenBucket", description: "Install the OpenBucket CLI via npm, an installer script, Docker, or from source.", robots: "index, follow" },
  "docs-usage": { path: "/docs/usage", title: "Usage · OpenBucket", description: "Run and operate a node: common commands, renaming, and the interactive console.", robots: "index, follow" },
  "docs-dashboard": { path: "/docs/dashboard", title: "Dashboard · OpenBucket docs", description: "Operate the local dashboard, sign in to the hosted dashboard, and configure admin access.", robots: "index, follow" },
  "docs-s3-signing": { path: "/docs/s3-signing", title: "S3 signing · OpenBucket", description: "AWS Signature Version 4 support, connecting existing S3 clients, and compatibility notes.", robots: "index, follow" },
  "docs-local-api": { path: "/docs/local-api", title: "Local API · OpenBucket", description: "Script against your own node's local management API.", robots: "index, follow" },
  "docs-api": { path: "/docs/api", title: "API reference · OpenBucket", description: "Every local daemon and hosted control-plane endpoint, with JavaScript and Python examples.", robots: "index, follow" },
  "docs-local-development": { path: "/docs/local-development", title: "Local development · OpenBucket", description: "Set up a development environment, repository layout, and common commands for working on OpenBucket itself.", robots: "index, follow" },
  "docs-contributing": { path: "/docs/contributing", title: "Contributing · OpenBucket", description: "How to report defects, propose features, and submit pull requests to OpenBucket.", robots: "index, follow" },
  login: { path: "/login", title: "Sign in · OpenBucket", description: "Sign in to the hosted OpenBucket dashboard.", robots: "noindex, nofollow" },
  register: { path: "/register", title: "Create account · OpenBucket", description: "Create an account for the hosted OpenBucket dashboard.", robots: "noindex, nofollow" },
  "forgot-password": { path: "/forgot-password", title: "Reset your password · OpenBucket", description: "Request a password reset link for your OpenBucket account.", robots: "noindex, nofollow" },
  "reset-password": { path: "/reset-password", title: "Choose a new password · OpenBucket", description: "Set a new password for your OpenBucket account.", robots: "noindex, nofollow" },
  dashboard: { path: "/dashboard", title: "Dashboard · OpenBucket", description: "Connect and operate your authenticated OpenBucket storage node.", robots: "noindex, nofollow" },
  "node-discovery": { path: "/", title: "Node discovery · OpenBucket", description: "Discover the current public S3 connection metadata for an OpenBucket node.", robots: "noindex, follow" },
  "not-found": { path: "/404", title: "Page not found · OpenBucket", description: "The requested OpenBucket page could not be found.", robots: "noindex, nofollow" },
};

const reservedNodeNames = new Set(["admin", "api", "auth", "dashboard", "docs", "forgot-password", "health", "login", "mail", "node", "nodes", "openbucket", "register", "reset-password", "s3", "status", "support", "usage", "www"]);

export function nodeNameForPath(pathname: string): string | null {
  let name: string;
  try { name = decodeURIComponent(pathname.replace(/^\/+|\/+$/g, "")); } catch { return null; }
  if (name.length < 3 || name.length > 48 || name.includes("/") || name.includes("--") ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(name) || reservedNodeNames.has(name)) return null;
  return name;
}

export function nodePathForPath(pathname: string): { handle: string; nodeName: string } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2) return null;
  const [handle, nodeName] = parts;
  if (!handle || !nodeName || !/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(handle) || reservedNodeNames.has(handle)) return null;
  return nodeNameForPath(nodeName) ? { handle, nodeName } : null;
}

export function routeForPath(pathname: string): HostedRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/") return "home";
  if (normalized === "/docs") return "docs";
  if (normalized === "/docs/installation") return "docs-installation";
  if (normalized === "/docs/usage") return "docs-usage";
  if (normalized === "/docs/dashboard") return "docs-dashboard";
  if (normalized === "/docs/s3-signing") return "docs-s3-signing";
  if (normalized === "/docs/local-api") return "docs-local-api";
  if (normalized === "/docs/api") return "docs-api";
  if (normalized === "/docs/local-development") return "docs-local-development";
  if (normalized === "/docs/contributing") return "docs-contributing";
  if (normalized === "/login") return "login";
  if (normalized === "/register") return "register";
  if (normalized === "/forgot-password") return "forgot-password";
  if (normalized === "/reset-password") return "reset-password";
  if (normalized === "/dashboard" || /^\/dashboard\/nodes\/[a-z0-9][a-z0-9-]{1,47}$/.test(normalized)) return "dashboard";
  if (nodePathForPath(pathname)) return "node-discovery";
  if (nodeNameForPath(pathname)) return "node-discovery";
  return "not-found";
}

function NotFoundPage() {
  return <SiteShell><main className="not-found-page"><p className="section-kicker">404 · NO SUCH KEY</p><h1>Nothing lives at this path.</h1><p>The page may have moved, or the address may be incomplete.</p><div><a className="site-button dark" href="/">Return home</a><a className="site-button light" href="/docs">Open the docs</a></div></main></SiteShell>;
}

export function HostedApp({ route }: { route: HostedRoute }) {
  if (route === "home") return <LandingPage />;
  if (route === "docs") return <DocsPage />;
  if (route === "docs-installation") return <InstallationPage />;
  if (route === "docs-usage") return <UsagePage />;
  if (route === "docs-dashboard") return <DashboardPage />;
  if (route === "docs-s3-signing") return <S3SigningPage />;
  if (route === "docs-local-api") return <LocalApiPage />;
  if (route === "docs-api") return <ApiReferencePage />;
  if (route === "docs-local-development") return <LocalDevelopmentPage />;
  if (route === "docs-contributing") return <ContributingPage />;
  if (route === "login") return <AuthPage mode="login" />;
  if (route === "register") return <AuthPage mode="register" />;
  if (route === "forgot-password") return <ForgotPasswordPage />;
  if (route === "reset-password") return <ResetPasswordPage />;
  if (route === "dashboard") return <ProtectedDashboard />;
  if (route === "node-discovery") {
    const nodePath = nodePathForPath(window.location.pathname);
    return <NodeDiscoveryPage nodeName={nodePath?.nodeName ?? nodeNameForPath(window.location.pathname) ?? ""} handle={nodePath?.handle} />;
  }
  return <NotFoundPage />;
}
