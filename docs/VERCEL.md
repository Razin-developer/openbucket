# Hosting the dashboard on Vercel

Vercel hosts the browser dashboard only. The OpenBucket daemon must remain on the machine, server, NAS, or VM that owns the storage disk. A Vercel deployment cannot mount or serve an arbitrary disk from your local computer.

The repository contains a separate static Vite target for Vercel. It reuses the production dashboard component and connects directly from the browser to a management API URL selected at build time or entered in **Connection settings**.

## Current production deployment

The `openbucket` Vercel project is connected directly to the GitHub repository. Vercel creates preview deployments for pull requests and deploys every push to `main` to the production alias:

```text
https://openbucket-eight.vercel.app
```

This Git integration is the only deployment mechanism. Do not add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` to GitHub Actions; a second CLI-based deployment path would create duplicate previews and race the production alias.

Configure non-secret build values for Production and Preview:

```bash
npx vercel@latest env add NEXT_PUBLIC_OPENBUCKET_API_URL production
npx vercel@latest env add NEXT_PUBLIC_OPENBUCKET_API_URL preview
npx vercel@latest env add NEXT_PUBLIC_APP_URL production
npx vercel@latest env add NEXT_PUBLIC_APP_URL preview
npx vercel@latest env add NEXT_PUBLIC_DOCS_URL production
npx vercel@latest env add NEXT_PUBLIC_DOCS_URL preview
```

Recommended initial values:

```dotenv
NEXT_PUBLIC_APP_URL=https://openbucket-eight.vercel.app
NEXT_PUBLIC_DOCS_URL=https://github.com/Razin-developer/openbucket/tree/main/docs
```

`NEXT_PUBLIC_OPENBUCKET_API_URL` is optional. Leave it unset to default each browser to its own local daemon at `http://127.0.0.1:7272`, or set it to a stable HTTPS management origin. Users can always select another endpoint in **Connection settings**.

`NEXT_PUBLIC_APP_URL` is also derivable from Vercel's project production URL, but configuring it explicitly makes canonical, Open Graph, `robots.txt`, and `sitemap.xml` output deterministic. Preview builds intentionally retain the production canonical URL.

The Git-connected build exposes `VERCEL_GIT_COMMIT_SHA`. The static target writes it to `/deployment.json`; this contains only the commit SHA and is safe to expose.

For a fork or replacement Vercel project, authenticate, link the directory, and connect its Git repository once:

```bash
npx vercel@latest login
npx vercel@latest link
npx vercel@latest git connect
```

Validate the static target locally with `npm ci && npm run build:vercel`. Push a reviewed commit to `main` for production; do not manually promote an unrelated local build to the production alias.

## Connect the daemon safely

The browser must be able to reach the configured management origin over HTTPS. Configure the daemon with the exact dashboard origin so CORS can authorize it:

```dotenv
OPENBUCKET_DASHBOARD_URL=https://openbucket-eight.vercel.app
OPENBUCKET_ALLOWED_ORIGINS=https://openbucket-eight.vercel.app
```

Then expose the management listener only through a TLS reverse proxy, named Cloudflare Tunnel, VPN, or comparable access layer. Keep the daemon's bearer authentication enabled. A temporary `openbucket serve ... --tunnel` session can validate the connection, but its URL changes on restart.

Never store `OPENBUCKET_ADMIN_TOKEN`, S3 access keys, or S3 secret keys in `NEXT_PUBLIC_*`, `VITE_*`, or Vercel dashboard build variables. Those values are compiled into browser-visible JavaScript. Enter the management token in the dashboard connection dialog; OpenBucket keeps it in API-scoped browser session storage.

## GitHub Actions production verification

GitHub Actions does not deploy to Vercel. After a push to `main`, `.github/workflows/vercel.yml` polls the production `/deployment.json` until its `commitSha` equals the triggering `GITHUB_SHA`. The check fails if Vercel never promotes that exact source commit, so a skipped or stale deployment cannot appear green.

The default verified URL is `https://openbucket-eight.vercel.app`. If the production alias changes, set the non-secret GitHub repository variable `VERCEL_PRODUCTION_URL` to the new HTTPS origin. No Vercel account token is needed by GitHub.

## Later: `openbucket.dev`

After controlling the domain:

```bash
npx vercel@latest domains add openbucket.dev openbucket
npx vercel@latest domains inspect openbucket.dev
```

Follow the returned DNS verification records, update `NEXT_PUBLIC_APP_URL`, update the GitHub `VERCEL_PRODUCTION_URL` variable, update the daemon's `OPENBUCKET_DASHBOARD_URL`/`OPENBUCKET_ALLOWED_ORIGINS`, and push a production deployment. The source code does not require a domain-specific change.

## Verify a deployment

```bash
npx vercel@latest curl / --deployment https://openbucket-eight.vercel.app
npx vercel@latest logs --environment production --level error --since 5m
curl --fail https://openbucket-eight.vercel.app/deployment.json
curl --fail https://openbucket-eight.vercel.app/robots.txt
curl --fail https://openbucket-eight.vercel.app/sitemap.xml
```

The dashboard should load without example buckets or placeholder metrics. It shows an offline connection state until it reaches a real OpenBucket management API and receives a valid bearer token.
