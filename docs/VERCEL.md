# Hosting the web application on Vercel

Vercel hosts the public site, documentation, hosted account API, and browser dashboard. The OpenBucket daemon must remain on the machine, server, NAS, or VM that owns the storage disk. A Vercel deployment cannot mount or serve an arbitrary disk from your computer.

The repository contains a Vite target plus Vercel Functions for authentication, node registration, heartbeat/usage ingestion, public discovery, and admin aggregates. MongoDB holds that control-plane metadata. The **Live node** view still connects directly to a daemon management API; object bytes never pass through MongoDB or Vercel.

## Current production deployment

The `openbucket` Vercel project is connected directly to the GitHub repository. Vercel creates preview deployments for pull requests and deploys every push to `main` to the production alias:

```text
https://openbucket-eight.vercel.app
```

This Git integration is the only deployment mechanism. Do not add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` to GitHub Actions; a second CLI-based deployment path would create duplicate previews and race the production alias.

Production routes are:

- `/` - public landing page;
- `/docs` - public product and operations documentation;
- `/login` and `/register` - hosted account authentication;
- `/dashboard` - protected nodes, usage, account, live-daemon, and admin views;
- `/<node-name>` - rate-limited public discovery metadata, never an S3 proxy;
- `/api/auth/*` - registration, login, session, and logout;
- `/api/nodes`, `/api/node/*`, and `/api/usage` - node lifecycle, heartbeat, and metering;
- `/api/admin/overview` - admin-only aggregates;
- `/api/nodes/resolve?name=<node-name>` - public endpoint discovery.

Normal `serve` requires an account and registers the node. Explicit `--offline` development remains standalone but disables registration, usage, discovery, and automatic tunneling.

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
NEXT_PUBLIC_DOCS_URL=https://openbucket-eight.vercel.app/docs
```

`NEXT_PUBLIC_OPENBUCKET_API_URL` is optional. Leave it unset to default each browser to its own local daemon at `http://127.0.0.1:7272`, or set it to a stable HTTPS management origin. Users can always select another endpoint in **Connection settings**.

`NEXT_PUBLIC_APP_URL` is also derivable from Vercel's project production URL, but configuring it explicitly makes canonical, Open Graph, `robots.txt`, and `sitemap.xml` output deterministic. Preview builds intentionally retain the production canonical URL.

The Git-connected build exposes `VERCEL_GIT_COMMIT_SHA`. The web build writes it to `/deployment.json`; this contains only the commit SHA and is safe to expose.

## Hosted account and control-plane variables

Configure these server-only values in Vercel Project Settings or with the CLI. Never prefix them with `NEXT_PUBLIC_` or `VITE_`:

```bash
npx vercel@latest env add MONGODB_URI production --sensitive
npx vercel@latest env add MONGODB_DATABASE production
npx vercel@latest env add OPENBUCKET_AUTH_SECRET production --sensitive
npx vercel@latest env add OPENBUCKET_NODE_DOMAIN production
```

- `MONGODB_URI` is the rotated Atlas connection URI. Treat any URI disclosed in chat, logs, or source as compromised and rotate its database-user password before deployment.
- `MONGODB_DATABASE` defaults to `openbucket_web`.
- `OPENBUCKET_AUTH_SECRET` is required and must contain at least 32 random bytes. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and store only the result in Vercel.
- `OPENBUCKET_NODE_DOMAIN` defaults to `openbucket.dev` and produces future names such as `s3.home-node.openbucket.dev`; it does not provision DNS/TLS/routing.
- `OPENBUCKET_SIGNUP_TOKEN` and `OPENBUCKET_ALLOW_SIGNUP` are short-lived controls managed by the bootstrap helper below.
The first successful registration atomically consumes the bootstrap record before creating the owner, so concurrent requests and immutable older deployment URLs cannot create another account afterward. The raw setup token is never stored. Disable signup, remove the setup token, and redeploy after bootstrap as defense in depth.

Use distinct database users/databases and secrets for Preview and Production. MongoDB stores users, password verifiers, sessions, bootstrap/rate-limit records, node registrations, hashed node credentials, heartbeat/storage summaries, and aggregate usage events. It never stores object bytes, raw node credentials, daemon admin tokens, or S3 credentials.

For a fork or replacement Vercel project, authenticate, link the directory, and connect its Git repository once:

```bash
npx vercel@latest login
npx vercel@latest link
npx vercel@latest git connect
```

After the permanent variables are configured and the project is linked, bootstrap the single owner:

```bash
node scripts/bootstrap-owner.mjs \
  --email owner@example.com \
  --name "Owner" \
  --url https://openbucket-eight.vercel.app
```

The helper:

1. prompts twice for a hidden 12-128 character password;
2. generates a high-entropy one-time token in memory;
3. invokes Vercel with argument arrays and `shell: false`, sending environment values over stdin rather than command arguments;
4. deploys the short registration window and posts registration to the same HTTPS origin; and
5. always sets signup back to false, removes the token, and redeploys—even after an earlier failure.

It never writes the password/token to disk or environment variables and redacts them from surfaced child-process errors. If cleanup reports a failure, immediately verify `OPENBUCKET_ALLOW_SIGNUP=false`, remove `OPENBUCKET_SIGNUP_TOKEN`, and redeploy manually before doing anything else.

Validate the web target locally with `npm ci && npm run build:vercel`. Push a reviewed commit to `main` for production; do not manually promote an unrelated local build to the production alias.

## Connect the daemon safely

Log in once on each node host, then serve a DNS-safe name:

```bash
openbucket login --email owner@example.com
openbucket serve /srv/openbucket --name home-node
```

The prompt is hidden. `OPENBUCKET_CONTROL_PLANE_URL` or `--control-plane-url` selects a custom hosted origin. `serve` registers the node and reports heartbeat/storage/request counters. With no managed public URL it automatically starts an S3-only Quick Tunnel; this is restart-dependent development/preview infrastructure, not an SLA endpoint.

For production, provision a stable TLS route to the S3 listener, then set `OPENBUCKET_PUBLIC_BASE_URL=https://s3.example.com` and run with `--no-tunnel`. The public `/<node-name>` page reports connection metadata but never proxies bytes. `OPENBUCKET_NODE_DOMAIN` only controls the advertised future hostname.

Use `--offline` only for standalone local development; it disables registration, usage, discovery, and the automatic tunnel.

The **Live node** browser must still reach management. Keep its bearer authentication enabled and expose it only through an independently protected HTTPS/private access layer. Never put management/S3 secrets in `NEXT_PUBLIC_*`, `VITE_*`, or Vercel build variables.

Current Chrome versions may show a Local Network Access prompt when the public HTTPS dashboard connects to loopback/private management. The default loopback target works only in browsers honoring the secure-loopback exception; otherwise use a protected HTTPS route.

## GitHub Actions production verification

GitHub Actions does not deploy to Vercel. After a push to `main`, `.github/workflows/vercel.yml` polls the production `/deployment.json` until its `commitSha` equals the triggering `GITHUB_SHA`. The check fails if Vercel never promotes that exact source commit, so a skipped or stale deployment cannot appear green.

The default verified URL is `https://openbucket-eight.vercel.app`. If the production alias changes, set the non-secret GitHub repository variable `VERCEL_PRODUCTION_URL` to the new HTTPS origin. No Vercel account token is needed by GitHub.

## Later: `openbucket.dev`

After controlling the domain:

```bash
npx vercel@latest domains add openbucket.dev openbucket
npx vercel@latest domains inspect openbucket.dev
```

Follow the returned DNS records, update `NEXT_PUBLIC_APP_URL`, GitHub's `VERCEL_PRODUCTION_URL`, `OPENBUCKET_CONTROL_PLANE_URL` on node hosts, and dashboard CORS origins. Set server-only `OPENBUCKET_NODE_DOMAIN=openbucket.dev` for future names, then separately provision each S3 DNS/TLS route.

## Verify a deployment

```bash
curl --fail https://openbucket-eight.vercel.app/
curl --fail https://openbucket-eight.vercel.app/docs
curl --fail https://openbucket-eight.vercel.app/install.sh
curl --fail https://openbucket-eight.vercel.app/install.ps1
curl --fail https://openbucket-eight.vercel.app/deployment.json
curl --fail https://openbucket-eight.vercel.app/robots.txt
curl --fail https://openbucket-eight.vercel.app/sitemap.xml
npx vercel@latest logs --environment production --level error --since 5m
```

- Confirm the installer responses contain shell/PowerShell source rather than the SPA HTML shell.
- Confirm an unauthenticated `/dashboard` visit is routed to login and a valid hosted session can enter it.
- Confirm `/api/auth/session` never returns a password verifier, session token, Mongo URI, or daemon credential.
- Pair the dashboard with a real daemon and verify live buckets/metrics; it must not display seeded or mock storage data.
