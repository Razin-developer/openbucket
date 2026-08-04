import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const templateRoot = new URL("../", import.meta.url);
const execFileAsync = promisify(execFile);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete OpenBucket dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>OpenBucket — your disk, now S3-compatible<\/title>/i);
  assert.match(html, /<meta name="application-name" content="OpenBucket"\/>/i);
  assert.match(html, /OpenBucket/);
  assert.match(html, /Node console/);
  assert.match(html, /Connect your first disk\./);
  assert.match(html, /Buckets/);
  assert.match(html, /API keys/);
  assert.match(html, /Connections/);
  assert.match(html, /Logs &amp; analytics/);
  assert.match(html, /OPENBUCKET_S3_ENDPOINT/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("removes starter preview code and wires only live daemon data", async () => {
  const [page, layout, dashboard, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Dashboard \/>/);
  assert.match(layout, /app\.openbucket\.dev/);
  assert.match(dashboard, /\/v1\/status/);
  assert.match(dashboard, /\/v1\/buckets/);
  assert.match(dashboard, /\/v1\/analytics/);
  assert.match(dashboard, /\/v1\/logs\?limit=100/);
  assert.match(dashboard, /apiRequestUrl\(apiBase, path\)/);
  assert.match(dashboard, /lucide-react/);
  assert.match(dashboard, /localStorage\.setItem\(API_STORAGE_KEY/);
  assert.match(dashboard, /sessionStorage\.setItem\(tokenStorageKey\(apiBase\)/);
  assert.match(dashboard, /current\.hash = ""/);
  assert.match(dashboard, /const endpoint = "\$\{OPENBUCKET_S3_ENDPOINT\}"/);
  assert.match(dashboard, /NEXT_PUBLIC_DOCS_URL/);
  assert.match(dashboard, /https:\/\/github\.com\/Razin-developer\/openbucket\/tree\/main\/docs/);
  assert.match(dashboard, /\["OpenBucket API", initialConnection\?\.displayUrl/);
  assert.doesNotMatch(dashboard, /sessionStorage\.setItem\(TOKEN_STORAGE_KEY,/);
  assert.doesNotMatch(dashboard, /media.*18,231|datasets.*142|14,281|429 GB/i);
  assert.match(css, /--ink:\s*#171717/);
  assert.match(css, /gradient-develop|radial-gradient/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", import.meta.url)));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});

test("Vercel build emits commit, crawler, sitemap, and icon metadata", async () => {
  const projectRoot = fileURLToPath(templateRoot);
  const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  const commitSha = "0123456789abcdef0123456789abcdef01234567";
  const appUrl = "https://deploy.example.test";

  await execFileAsync(process.execPath, [viteCli, "build", "--config", "vite.vercel.config.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      VERCEL_GIT_COMMIT_SHA: commitSha,
      GITHUB_SHA: "ffffffffffffffffffffffffffffffffffffffff",
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_DOCS_URL: "https://github.com/Razin-developer/openbucket/tree/main/docs",
    },
    windowsHide: true,
  });

  const [deploymentSource, robots, sitemap, index, favicon, workflow] = await Promise.all([
    readFile(new URL("../vercel-dist/deployment.json", import.meta.url), "utf8"),
    readFile(new URL("../vercel-dist/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../vercel-dist/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../vercel-dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../vercel-dist/favicon.svg", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/vercel.yml", import.meta.url), "utf8"),
  ]);
  const deployment = JSON.parse(deploymentSource);
  const [installSh, installPs1, checkedInInstallSh, checkedInInstallPs1, hostedApp, hostedAuth, hostedDocs, siteShell, landing, controlPlane, discovery] = await Promise.all([
    readFile(new URL("../vercel-dist/install.sh", import.meta.url), "utf8"),
    readFile(new URL("../vercel-dist/install.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/install.ps1", import.meta.url), "utf8"),
    readFile(new URL("../vercel/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel/auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel/docs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel/site-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel/landing.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel/control-plane.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel/node-discovery.tsx", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(deployment, { schemaVersion: 1, commitSha });
  assert.equal(robots, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /login\nDisallow: /register\nSitemap: ${appUrl}/sitemap.xml\n`);
  assert.match(sitemap, new RegExp(`<loc>${appUrl}/<\\/loc>`));
  assert.match(sitemap, new RegExp(`<loc>${appUrl}/docs<\\/loc>`));
  assert.doesNotMatch(sitemap, /\/(?:login|register|dashboard)<\/loc>/);
  assert.equal(installSh, checkedInInstallSh);
  assert.equal(installPs1, checkedInInstallPs1);
  for (const route of ["docs", "login", "register", "dashboard"]) assert.match(hostedApp, new RegExp(`normalized === "\\/${route}"`));
  assert.match(hostedAuth, /fetch\("\/api\/auth\/session"/);
  assert.match(hostedAuth, /Owner setup guide/);
  assert.doesNotMatch(hostedAuth, /Create one/);
  assert.match(hostedDocs, /bootstrap:owner/);
  assert.doesNotMatch(siteShell, /href="\/register"/);
  assert.match(hostedAuth, /<HostedControlPlane user=\{state\.user\} \/>/);
  assert.match(hostedApp, /nodeNameForPath/);
  assert.match(hostedApp, /route === "node-discovery"/);
  assert.match(controlPlane, /apiRequest<NodesResponse>\("\/api\/nodes"\)/);
  assert.match(controlPlane, /apiRequest<UsageSummary>\("\/api\/usage"\)/);
  assert.match(controlPlane, /apiRequest<AdminOverview>\("\/api\/admin\/overview"\)/);
  assert.match(controlPlane, /user\.role === "admin"/);
  assert.match(discovery, /new URLSearchParams\(\{ name: nodeName \}\)/);
  assert.match(discovery, /\/api\/nodes\/resolve\?\$\{query\}/);
  assert.match(discovery, /does not proxy S3 requests/);
  assert.doesNotMatch(controlPlane, /mock|fixture|fake data/i);
  assert.match(landing, /src="\/og\.png"/);
  assert.match(index, new RegExp(`<link rel="canonical" href="${appUrl}"`));
  assert.match(index, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
  assert.match(favicon, /^<svg\b/);
  assert.match(workflow, /deployment\.json/);
  assert.match(workflow, /GITHUB_SHA/);
  assert.match(workflow, /VERCEL_PRODUCTION_URL/);
  assert.doesNotMatch(workflow, /secrets\.VERCEL_|vercel (?:build|deploy)/);
});
