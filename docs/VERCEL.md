# Hosting the dashboard on Vercel

Vercel hosts the browser dashboard only. The OpenBucket daemon must remain on the machine, server, NAS, or VM that owns the storage disk. A Vercel deployment cannot mount or serve an arbitrary disk from your local computer.

The repository contains a separate static Vite target for Vercel. It reuses the production dashboard component and connects directly from the browser to a management API URL selected at build time or entered in **Connection settings**.

## Initial `vercel.app` deployment

Install or invoke the current CLI, authenticate, and link this folder:

```bash
npx vercel@latest login
npx vercel@latest link
```

Choose the project name `openbucket` if it is available. Vercel automatically assigns a production hostname based on the project name, such as `openbucket.vercel.app`; names are allocated first-come-first-served, so the actual hostname can include a suffix.

Configure non-secret build values for Production and Preview:

```bash
npx vercel@latest env add NEXT_PUBLIC_OPENBUCKET_API_URL production
npx vercel@latest env add NEXT_PUBLIC_OPENBUCKET_API_URL preview
npx vercel@latest env add NEXT_PUBLIC_DOCS_URL production
npx vercel@latest env add NEXT_PUBLIC_DOCS_URL preview
```

Recommended initial values:

```dotenv
NEXT_PUBLIC_OPENBUCKET_API_URL=https://your-management-origin.example
NEXT_PUBLIC_DOCS_URL=https://github.com/Razin-developer/openbucket/tree/main/docs
```

`NEXT_PUBLIC_APP_URL` is optional on Vercel. The build derives it from Vercel's project production URL when it is not explicitly configured; preview builds therefore keep the production URL as their canonical URL. Set it when you want a different fixed canonical hostname:

```dotenv
NEXT_PUBLIC_APP_URL=https://openbucket.vercel.app
```

Deploy production. Vercel installs the locked dependencies and runs the `buildCommand` from `vercel.json` remotely:

```bash
npx vercel@latest deploy --prod
```

To validate the static target locally before that upload, run `npm ci && npm run build:vercel`. To reproduce the prebuilt path used by GitHub Actions instead, run:

```bash
npx vercel@latest pull --yes --environment=production
npx vercel@latest build --prod
npx vercel@latest deploy --prebuilt --prod
```

The generated `*.vercel.app` URL is the production URL until a custom domain is added.

## Connect the daemon safely

The browser must be able to reach the configured management origin over HTTPS. Configure the daemon with the exact dashboard origin so CORS can authorize it:

```dotenv
OPENBUCKET_DASHBOARD_URL=https://openbucket.vercel.app
OPENBUCKET_ALLOWED_ORIGINS=https://openbucket.vercel.app
```

Then expose the management listener only through a TLS reverse proxy, named Cloudflare Tunnel, VPN, or comparable access layer. Keep the daemon's bearer authentication enabled. A temporary `openbucket serve ... --tunnel` session can validate the connection, but its URL changes on restart.

Never store `OPENBUCKET_ADMIN_TOKEN`, S3 access keys, or S3 secret keys in `NEXT_PUBLIC_*`, `VITE_*`, or Vercel dashboard build variables. Those values are compiled into browser-visible JavaScript. Enter the management token in the dashboard connection dialog; OpenBucket keeps it in API-scoped browser session storage.

## GitHub Actions deployment

The Vercel workflow uses prebuilt deployments and requires these GitHub repository secrets:

| Secret | Source |
| --- | --- |
| `VERCEL_TOKEN` | Vercel account settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` |

The workflow creates previews for pull requests and promotes `main` to production. Keep `.vercel/project.json` untracked; the IDs belong in GitHub secrets, not source control.

If the repository is connected directly in the Vercel dashboard, Vercel can also build every pull request without the explicit workflow. Use one deployment mechanism to avoid duplicate previews.

## Later: `openbucket.dev`

After controlling the domain:

```bash
npx vercel@latest domains add openbucket.dev openbucket
npx vercel@latest domains inspect openbucket.dev
```

Follow the returned DNS verification records, update `NEXT_PUBLIC_APP_URL`, update the daemon's `OPENBUCKET_DASHBOARD_URL`/`OPENBUCKET_ALLOWED_ORIGINS`, and redeploy. The source code does not require a domain-specific change.

## Verify a deployment

```bash
npx vercel@latest curl / --deployment https://your-project.vercel.app
npx vercel@latest logs --environment production --level error --since 5m
```

The dashboard should load without example buckets or placeholder metrics. It shows an offline connection state until it reaches a real OpenBucket management API and receives a valid bearer token.
