/* eslint-disable @next/next/no-html-link-for-pages */
import { AuthPage, ProtectedDashboard } from "./auth";
import { DocsPage } from "./docs";
import { LandingPage } from "./landing";
import { SiteShell } from "./site-shell";

export type HostedRoute = "home" | "docs" | "login" | "register" | "dashboard" | "not-found";

export const routeMetadata: Record<HostedRoute, { path: string; title: string; description: string; robots: string }> = {
  home: {
    path: "/",
    title: "OpenBucket — your disk, now S3-compatible",
    description: "Turn a local folder, disk, SSD, or NAS into secure S3-compatible object storage with one daemon and one CLI.",
    robots: "index, follow",
  },
  docs: {
    path: "/docs",
    title: "Documentation · OpenBucket",
    description: "Install OpenBucket, run a local storage node, connect S3 clients, and operate the production dashboard.",
    robots: "index, follow",
  },
  login: {
    path: "/login",
    title: "Sign in · OpenBucket",
    description: "Sign in to the hosted OpenBucket dashboard.",
    robots: "noindex, nofollow",
  },
  register: {
    path: "/register",
    title: "Create account · OpenBucket",
    description: "Create an account for the hosted OpenBucket dashboard.",
    robots: "noindex, nofollow",
  },
  dashboard: {
    path: "/dashboard",
    title: "Dashboard · OpenBucket",
    description: "Connect and operate your authenticated OpenBucket storage node.",
    robots: "noindex, nofollow",
  },
  "not-found": {
    path: "/404",
    title: "Page not found · OpenBucket",
    description: "The requested OpenBucket page could not be found.",
    robots: "noindex, nofollow",
  },
};

export function routeForPath(pathname: string): HostedRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/") return "home";
  if (normalized === "/docs") return "docs";
  if (normalized === "/login") return "login";
  if (normalized === "/register") return "register";
  if (normalized === "/dashboard") return "dashboard";
  return "not-found";
}

function NotFoundPage() {
  return (
    <SiteShell>
      <main className="not-found-page">
        <p className="section-kicker">404 · NO SUCH KEY</p>
        <h1>Nothing lives at this path.</h1>
        <p>The page may have moved, or the address may be incomplete.</p>
        <div><a className="site-button dark" href="/">Return home</a><a className="site-button light" href="/docs">Open the docs</a></div>
      </main>
    </SiteShell>
  );
}

export function HostedApp({ route }: { route: HostedRoute }) {
  if (route === "home") return <LandingPage />;
  if (route === "docs") return <DocsPage />;
  if (route === "login") return <AuthPage mode="login" />;
  if (route === "register") return <AuthPage mode="register" />;
  if (route === "dashboard") return <ProtectedDashboard />;
  return <NotFoundPage />;
}
