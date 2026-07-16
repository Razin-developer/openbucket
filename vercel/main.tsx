import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "../app/dashboard";
import "../app/globals.css";

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

function setAbsoluteMetadata() {
  const base = configuredAppUrl();
  const canonical = new URL(base.pathname || "/", base.origin).toString();
  const socialImage = new URL("/og.png", base.origin).toString();
  const canonicalElement = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonicalElement) canonicalElement.href = canonical;
  const openGraphUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (openGraphUrl) openGraphUrl.content = canonical;
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const element = document.querySelector<HTMLMetaElement>(selector);
    if (element) element.content = socialImage;
  }
}

setAbsoluteMetadata();

const root = document.getElementById("root");
if (!root) throw new Error("OpenBucket dashboard root element is missing.");

createRoot(root).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
