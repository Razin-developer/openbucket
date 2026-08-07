import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const vercelRoot = path.join(projectRoot, "vercel");
const defaultAppUrl = "https://openbucket.zydcode.in";

const publicUrlNames = [
  "NEXT_PUBLIC_OPENBUCKET_API_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_DOCS_URL",
] as const;

function validatedPublicUrl(name: (typeof publicUrlNames)[number], raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an HTTP(S) URL without embedded credentials.`);
  }
  if (name !== "NEXT_PUBLIC_DOCS_URL" && (parsed.search || parsed.hash)) {
    throw new Error(`${name} must not include query parameters or a fragment.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export default defineConfig(({ mode }) => {
  // loadEnv reads local .env variants, while process.env supplies values configured
  // in Vercel. Only this explicit public allowlist is emitted into browser code.
  const fileEnv = loadEnv(mode, projectRoot, "");
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const inferredAppUrl = vercelProductionUrl ? `https://${vercelProductionUrl}` : undefined;
  const publicEnv = Object.fromEntries(
    publicUrlNames.map((name) => [
      name,
      validatedPublicUrl(
        name,
        process.env[name] ?? fileEnv[name] ?? (name === "NEXT_PUBLIC_APP_URL" ? inferredAppUrl : undefined),
      ),
    ]),
  ) as Record<(typeof publicUrlNames)[number], string | undefined>;

  const canonicalUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? defaultAppUrl;
  const canonicalRoot = `${canonicalUrl.replace(/\/+$/, "")}/`;
  const sitemapUrl = new URL("sitemap.xml", canonicalRoot).toString();
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "unknown";
  const buildLastmod = new Date().toISOString();
  type SitemapEntry = { slug: string; changefreq: string; priority: string };
  const sitemapEntries: SitemapEntry[] = [
    { slug: "", changefreq: "weekly", priority: "1.0" },
    { slug: "docs", changefreq: "weekly", priority: "0.8" },
    { slug: "docs/installation", changefreq: "monthly", priority: "0.7" },
    { slug: "docs/usage", changefreq: "monthly", priority: "0.7" },
    { slug: "docs/dashboard", changefreq: "monthly", priority: "0.6" },
    { slug: "docs/s3-signing", changefreq: "monthly", priority: "0.6" },
    { slug: "docs/local-api", changefreq: "monthly", priority: "0.6" },
    { slug: "docs/api", changefreq: "monthly", priority: "0.7" },
    { slug: "docs/local-development", changefreq: "monthly", priority: "0.5" },
    { slug: "docs/contributing", changefreq: "monthly", priority: "0.5" },
    { slug: "faq", changefreq: "monthly", priority: "0.6" },
    { slug: "feedback", changefreq: "yearly", priority: "0.3" },
    { slug: "report-bug", changefreq: "yearly", priority: "0.3" },
    { slug: "privacy", changefreq: "yearly", priority: "0.2" },
    { slug: "terms", changefreq: "yearly", priority: "0.2" },
  ];

  return {
    root: vercelRoot,
    publicDir: path.join(projectRoot, "public"),
    envDir: projectRoot,
    plugins: [
      react(),
      {
        name: "openbucket-vercel-metadata",
        transformIndexHtml(html) {
          return html.replaceAll(defaultAppUrl, canonicalUrl);
        },
        async generateBundle() {
          const [installSh, installPs1] = await Promise.all([
            readFile(path.join(projectRoot, "scripts", "install.sh"), "utf8"),
            readFile(path.join(projectRoot, "scripts", "install.ps1"), "utf8"),
          ]);
          this.emitFile({
            type: "asset",
            fileName: "deployment.json",
            source: `${JSON.stringify({ schemaVersion: 1, commitSha }, null, 2)}\n`,
          });
          this.emitFile({
            type: "asset",
            fileName: "robots.txt",
            source: `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /login\nDisallow: /register\nDisallow: /forgot-password\nDisallow: /reset-password\nSitemap: ${sitemapUrl}\n`,
          });
          const sitemapUrls = sitemapEntries.map((entry) => {
            const loc = xmlEscape(new URL(entry.slug, canonicalRoot).toString());
            return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${buildLastmod}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`;
          });
          this.emitFile({
            type: "asset",
            fileName: "sitemap.xml",
            source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.join("\n")}\n</urlset>\n`,
          });
          this.emitFile({ type: "asset", fileName: "install.sh", source: installSh });
          this.emitFile({ type: "asset", fileName: "install.ps1", source: installPs1 });
        },
      },
    ],
    define: Object.fromEntries(
      publicUrlNames.map((name) => [
        `process.env.${name}`,
        publicEnv[name] === undefined ? "undefined" : JSON.stringify(publicEnv[name]),
      ]),
    ),
    build: {
      outDir: path.join(projectRoot, "vercel-dist"),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
    },
  };
});
