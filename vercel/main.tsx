import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import { HostedApp, routeForPath, routeMetadata } from "./app";
import "./site.css";

function configuredAppUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed;
    } catch {
      // The build validates this value; keep the deployed origin as a runtime fallback.
    }
  }
  return new URL(window.location.origin);
}

function setMetaContent(selector: string, value: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) element.content = value;
}

function setAbsoluteMetadata(route: ReturnType<typeof routeForPath>) {
  const base = configuredAppUrl();
  const metadata = routeMetadata[route];
  const canonical = new URL(metadata.path, `${base.origin}/`).toString();
  const socialImage = new URL("/og.png", base.origin).toString();
  document.title = metadata.title;
  document.documentElement.dataset.route = route;
  const canonicalElement = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonicalElement) canonicalElement.href = canonical;
  setMetaContent('meta[name="description"]', metadata.description);
  setMetaContent('meta[name="robots"]', metadata.robots);
  setMetaContent('meta[property="og:url"]', canonical);
  setMetaContent('meta[property="og:title"]', metadata.title);
  setMetaContent('meta[property="og:description"]', metadata.description);
  setMetaContent('meta[name="twitter:title"]', metadata.title);
  setMetaContent('meta[name="twitter:description"]', metadata.description);
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    setMetaContent(selector, socialImage);
  }
}

const route = routeForPath(window.location.pathname);
setAbsoluteMetadata(route);

const root = document.getElementById("root");
if (!root) throw new Error("OpenBucket web root element is missing.");

createRoot(root).render(
  <StrictMode>
    <HostedApp route={route} />
  </StrictMode>,
);
