# Hosting the web application on Vercel

Vercel hosts the public site, documentation, hosted account API, and browser dashboard. The OpenBucket daemon must remain on the machine, server, NAS, or VM that owns the storage disk. A Vercel deployment cannot mount or serve an arbitrary disk from your computer.

The repository contains a Vite target plus Vercel Functions for account authentication. The dashboard still connects directly from the browser to a management API URL selected at build time or entered in **Connection settings**; bucket bytes never pass through MongoDB or the hosted account API.

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
- `/dashboard` - hosted-session-protected dashboard;
- `/api/auth/*` - server-only registration, login, session, and logout functions.

The npm/local dashboard remains account-free. `openbucket dashboard` pairs a browser directly with the local daemon and does not require MongoDB or Vercel.

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

## Hosted authentication variables

Configure these server-only values in Vercel Project Settings or with the CLI. Never prefix them with `NEXT_PUBLIC_` or `VITE_`:

```bash
npx vercel@latest env add MONGODB_URI production
npx vercel@latest env add MONGODB_DATABASE production
npx vercel@latest env add OPENBUCKET_AUTH_SECRET production
npx vercel@latest env add OPENBUCKET_SIGNUP_TOKEN production
npx vercel@latest env add OPENBUCKET_ALLOW_SIGNUP production
```

- `MONGODB_URI` is the rotated Atlas connection URI. Treat any URI disclosed in chat, logs, or source as compromised and rotate its database-user password before deployment.
- `MONGODB_DATABASE` defaults to `openbucket_web`.
- `OPENBUCKET_AUTH_SECRET` is required and must contain at least 32 random bytes. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and store only the result in Vercel.
- `OPENBUCKET_SIGNUP_TOKEN` is required when signup is enabled, must contain at least 32 random bytes, and must differ from the auth secret.
- `OPENBUCKET_ALLOW_SIGNUP` defaults to `false`. Set it to `true` only for the intentional registration window, create the owner account, then set it back to `false` and redeploy.
The first successful registration atomically consumes the bootstrap record before creating the owner, so concurrent requests and immutable older deployment URLs cannot create another account afterward. The raw setup token is never stored. Disable signup, remove the setup token, and redeploy after bootstrap as defense in depth.

Use distinct database users/databases and secrets for Preview and Production. Vercel environment changes apply to new deployments, so redeploy after adding or rotating a value. MongoDB stores hosted users, password verifiers, opaque sessions, and rate-limit records only. It never stores object bytes, daemon admin tokens, or S3 credentials.

For a fork or replacement Vercel project, authenticate, link the directory, and connect its Git repository once:

```bash
npx vercel@latest login
npx vercel@latest link
npx vercel@latest git connect
```

Validate the web target locally with `npm ci && npm run build:vercel`. Push a reviewed commit to `main` for production; do not manually promote an unrelated local build to the production alias.

## Connect the daemon safely

The browser must be able to reach the configured management origin over HTTPS. Configure the daemon with the exact dashboard origin so CORS can authorize it:

```dotenv
OPENBUCKET_DASHBOARD_URL=https://openbucket-eight.vercel.app
OPENBUCKET_ALLOWED_ORIGINS=https://openbucket-eight.vercel.app
```

Then expose the management listener only through a TLS reverse proxy, named Cloudflare Tunnel, VPN, or comparable access layer. Keep the daemon's bearer authentication enabled. A temporary `openbucket serve ... --tunnel` session can validate the connection, but its URL changes on restart.

Current Chrome versions show a Local Network Access permission prompt when the public HTTPS dashboard first connects to a loopback or private-network daemon; grant it for this site. The default `http://127.0.0.1:7272` loopback target works in browsers that follow the secure-loopback exception. For Safari, a private hostname, or a browser that blocks plain-HTTP local requests, use the documented HTTPS reverse proxy/tunnel instead.

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
