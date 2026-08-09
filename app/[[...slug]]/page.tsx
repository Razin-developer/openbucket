import { DashboardApp } from "../dashboard";

// Optional catch-all: every path (/, /buckets, /buckets/:bucket, /keys, /connections, /logs,
// /settings, ...) resolves to this same entry. DashboardApp's own BrowserRouter/<Routes> decides
// what to render from the URL — this file's only job is to make sure a deep link or a refresh on
// any of those paths doesn't 404 server-side (there was previously no SPA fallback at all).
export default function Home() {
  return <DashboardApp />;
}
