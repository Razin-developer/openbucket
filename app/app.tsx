/* eslint-disable @next/next/no-html-link-for-pages */
import { lazy, Suspense } from "react";
import { LandingPage } from "./landing";
import { SiteShell } from "./site-shell";

// Only the home route's code (this file, landing.tsx, site-shell.tsx) needs to be in the initial
// bundle — everything else is a distinct route a first-time visitor to "/" never executes, so it's
// split into its own chunk and fetched on demand instead of shipping unconditionally.
const AuthPage = lazy(() => import("./auth").then((m) => ({ default: m.AuthPage })));
const ForgotPasswordPage = lazy(() => import("./auth").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./auth").then((m) => ({ default: m.ResetPasswordPage })));
const ProtectedDashboard = lazy(() => import("./auth").then((m) => ({ default: m.ProtectedDashboard })));
const DocsPage = lazy(() => import("./docs").then((m) => ({ default: m.DocsPage })));
const InstallationPage = lazy(() => import("./docs").then((m) => ({ default: m.InstallationPage })));
const UsagePage = lazy(() => import("./docs").then((m) => ({ default: m.UsagePage })));
const DashboardPage = lazy(() => import("./docs").then((m) => ({ default: m.DashboardPage })));
const S3SigningPage = lazy(() => import("./docs").then((m) => ({ default: m.S3SigningPage })));
const LocalApiPage = lazy(() => import("./docs").then((m) => ({ default: m.LocalApiPage })));
const ApiReferencePage = lazy(() => import("./docs").then((m) => ({ default: m.ApiReferencePage })));
const LocalDevelopmentPage = lazy(() => import("./docs").then((m) => ({ default: m.LocalDevelopmentPage })));
const ContributingPage = lazy(() => import("./docs").then((m) => ({ default: m.ContributingPage })));
const NodeDiscoveryPage = lazy(() => import("./node-discovery").then((m) => ({ default: m.NodeDiscoveryPage })));
const FeedbackPage = lazy(() => import("./support-pages").then((m) => ({ default: m.FeedbackPage })));
const BugReportPage = lazy(() => import("./support-pages").then((m) => ({ default: m.BugReportPage })));
const FaqPage = lazy(() => import("./support-pages").then((m) => ({ default: m.FaqPage })));
const PrivacyPolicyPage = lazy(() => import("./support-pages").then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage = lazy(() => import("./support-pages").then((m) => ({ default: m.TermsPage })));
const HelpPage = lazy(() => import("./help").then((m) => ({ default: m.HelpPage })));

export type HostedRoute =
  | "home" | "docs" | "docs-installation" | "docs-usage" | "docs-dashboard" | "docs-s3-signing"
  | "docs-local-api" | "docs-api" | "docs-local-development" | "docs-contributing"
  | "login" | "register" | "forgot-password" | "reset-password" | "dashboard" | "node-discovery"
  | "feedback" | "report-bug" | "faq" | "help" | "privacy" | "terms" | "not-found";

export const routeMetadata: Record<HostedRoute, { path: string; title: string; description: string; keywords: string; robots: string }> = {
  home: {
    path: "/", title: "OpenBucket — your disk, now S3-compatible",
    description: "Turn a local folder, disk, SSD, or NAS into secure S3-compatible object storage with one daemon and one CLI.",
    keywords: "OpenBucket, S3 compatible storage, self hosted S3, local S3 server, object storage, open source S3, self hosted object storage, S3 API server, homelab storage, NAS S3, MinIO alternative, self hosted cloud storage, on premise object storage, disk to S3, open source object storage, boto3 local server, AWS SDK local endpoint, Docker S3 server, S3 for developers, S3 dashboard, S3 CLI",
    robots: "index, follow",
  },
  docs: {
    path: "/docs", title: "Documentation · OpenBucket",
    description: "Install OpenBucket, run a local storage node, connect S3 clients, and operate the production dashboard.",
    keywords: "OpenBucket documentation, OpenBucket quickstart, S3 server setup, self hosted object storage guide, OpenBucket getting started",
    robots: "index, follow",
  },
  "docs-installation": {
    path: "/docs/installation", title: "Installation · OpenBucket",
    description: "Install the OpenBucket CLI via npm, an installer script, Docker, or from source.",
    keywords: "install OpenBucket, npm install openbucket, OpenBucket Docker, OpenBucket installer script, OpenBucket Windows, OpenBucket Linux, OpenBucket macOS, self hosted S3 install",
    robots: "index, follow",
  },
  "docs-usage": {
    path: "/docs/usage", title: "Usage · OpenBucket",
    description: "Run and operate a node: common commands, renaming, and the interactive console.",
    keywords: "OpenBucket CLI commands, OpenBucket usage, OpenBucket TUI, OpenBucket interactive console, rename S3 node, S3 bucket CLI commands",
    robots: "index, follow",
  },
  "docs-dashboard": {
    path: "/docs/dashboard", title: "Dashboard · OpenBucket docs",
    description: "Operate the local dashboard, sign in to the hosted dashboard, and configure admin access.",
    keywords: "OpenBucket dashboard, S3 storage dashboard, self hosted storage UI, OpenBucket admin, S3 bucket manager UI",
    robots: "index, follow",
  },
  "docs-s3-signing": {
    path: "/docs/s3-signing", title: "S3 signing · OpenBucket",
    description: "AWS Signature Version 4 support, connecting existing S3 clients, and compatibility notes.",
    keywords: "AWS Signature Version 4, SigV4, S3 presigned URL, S3 compatibility, S3 authentication, boto3 endpoint url, AWS CLI custom endpoint",
    robots: "index, follow",
  },
  "docs-local-api": {
    path: "/docs/local-api", title: "Local API · OpenBucket",
    description: "Script against your own node's local management API.",
    keywords: "OpenBucket management API, S3 server API, local storage API, S3 bucket API, object storage REST API",
    robots: "index, follow",
  },
  "docs-api": {
    path: "/docs/api", title: "API reference · OpenBucket",
    description: "Every local daemon and hosted control-plane endpoint, with JavaScript and Python examples.",
    keywords: "OpenBucket API reference, S3 API endpoints, OpenBucket REST API, S3 server API docs, object storage API reference, Python S3 client, JavaScript S3 client",
    robots: "index, follow",
  },
  "docs-local-development": {
    path: "/docs/local-development", title: "Local development · OpenBucket",
    description: "Set up a development environment, repository layout, and common commands for working on OpenBucket itself.",
    keywords: "OpenBucket development setup, contribute to OpenBucket, OpenBucket source code, build OpenBucket from source",
    robots: "index, follow",
  },
  "docs-contributing": {
    path: "/docs/contributing", title: "Contributing · OpenBucket",
    description: "How to report defects, propose features, and submit pull requests to OpenBucket.",
    keywords: "contribute to OpenBucket, OpenBucket pull requests, open source contribution guide, OpenBucket GitHub",
    robots: "index, follow",
  },
  login: {
    path: "/login", title: "Sign in · OpenBucket",
    description: "Sign in to the hosted OpenBucket dashboard.",
    keywords: "OpenBucket sign in, OpenBucket login",
    robots: "noindex, nofollow",
  },
  register: {
    path: "/register", title: "Create account · OpenBucket",
    description: "Create an account for the hosted OpenBucket dashboard.",
    keywords: "OpenBucket sign up, create OpenBucket account",
    robots: "noindex, nofollow",
  },
  "forgot-password": {
    path: "/forgot-password", title: "Reset your password · OpenBucket",
    description: "Request a password reset link for your OpenBucket account.",
    keywords: "OpenBucket forgot password, OpenBucket password reset",
    robots: "noindex, nofollow",
  },
  "reset-password": {
    path: "/reset-password", title: "Choose a new password · OpenBucket",
    description: "Set a new password for your OpenBucket account.",
    keywords: "OpenBucket reset password",
    robots: "noindex, nofollow",
  },
  dashboard: {
    path: "/dashboard", title: "Dashboard · OpenBucket",
    description: "Connect and operate your authenticated OpenBucket storage node.",
    keywords: "OpenBucket dashboard",
    robots: "noindex, nofollow",
  },
  "node-discovery": {
    path: "/", title: "Node discovery · OpenBucket",
    description: "Discover the current public S3 connection metadata for an OpenBucket node.",
    keywords: "OpenBucket node discovery, S3 endpoint discovery",
    robots: "noindex, follow",
  },
  feedback: {
    path: "/feedback", title: "Feedback · OpenBucket",
    description: "Send feedback and feature ideas straight to the people building OpenBucket.",
    keywords: "OpenBucket feedback, feature request, contact OpenBucket",
    robots: "index, follow",
  },
  "report-bug": {
    path: "/report-bug", title: "Report a bug · OpenBucket",
    description: "Report a defect in the OpenBucket daemon, CLI, or dashboard.",
    keywords: "OpenBucket bug report, report an issue, OpenBucket support",
    robots: "index, follow",
  },
  faq: {
    path: "/faq", title: "FAQ · OpenBucket",
    description: "Frequently asked questions about OpenBucket, self-hosted S3-compatible storage.",
    keywords: "OpenBucket FAQ, OpenBucket questions, self hosted S3 FAQ",
    robots: "index, follow",
  },
  help: {
    path: "/help", title: "Help & contact · OpenBucket",
    description: "Get help from a real person, or browse the FAQ for answers to common OpenBucket questions.",
    keywords: "OpenBucket help, contact OpenBucket, OpenBucket support request",
    robots: "index, follow",
  },
  privacy: {
    path: "/privacy", title: "Privacy policy · OpenBucket",
    description: "What OpenBucket's hosted dashboard collects, and what it never sees.",
    keywords: "OpenBucket privacy policy",
    robots: "index, follow",
  },
  terms: {
    path: "/terms", title: "Terms of service · OpenBucket",
    description: "Terms for using OpenBucket's open-source software and hosted dashboard.",
    keywords: "OpenBucket terms of service",
    robots: "index, follow",
  },
  "not-found": {
    path: "/404", title: "Page not found · OpenBucket",
    description: "The requested OpenBucket page could not be found.",
    keywords: "",
    robots: "noindex, nofollow",
  },
};

const reservedNodeNames = new Set(["admin", "api", "auth", "dashboard", "docs", "faq", "feedback", "forgot-password", "health", "help", "login", "mail", "node", "nodes", "openbucket", "privacy", "register", "report-bug", "reset-password", "s3", "status", "support", "terms", "usage", "www"]);

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
  if (normalized === "/feedback") return "feedback";
  if (normalized === "/report-bug") return "report-bug";
  if (normalized === "/faq") return "faq";
  if (normalized === "/help") return "help";
  if (normalized === "/privacy") return "privacy";
  if (normalized === "/terms") return "terms";
  if (nodePathForPath(pathname)) return "node-discovery";
  if (nodeNameForPath(pathname)) return "node-discovery";
  return "not-found";
}

function NotFoundPage() {
  return <SiteShell><main className="not-found-page"><p className="section-kicker">404 · NO SUCH KEY</p><h1>Nothing lives at this path.</h1><p>The page may have moved, or the address may be incomplete.</p><div><a className="site-button dark" href="/">Return home</a><a className="site-button light" href="/docs">Open the docs</a></div></main></SiteShell>;
}

function RoutedPage({ route }: { route: HostedRoute }) {
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
  if (route === "feedback") return <FeedbackPage />;
  if (route === "report-bug") return <BugReportPage />;
  if (route === "faq") return <FaqPage />;
  if (route === "help") return <HelpPage />;
  if (route === "privacy") return <PrivacyPolicyPage />;
  if (route === "terms") return <TermsPage />;
  return <NotFoundPage />;
}

export function HostedApp({ route }: { route: HostedRoute }) {
  // The home route (LandingPage) isn't lazy, so this Suspense boundary only ever actually
  // suspends for the other, code-split routes.
  return (
    <Suspense fallback={null}>
      <RoutedPage route={route} />
    </Suspense>
  );
}
