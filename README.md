# OpenBucket

**Your disk, now S3-compatible.** OpenBucket turns a local folder, disk, SSD, or mounted NAS path into object storage with a small Node.js daemon, an Ollama-style CLI, and a browser dashboard.

OpenBucket writes real object bytes to the directory you choose. The normal production flow uses the hosted control plane for account login, node registration, heartbeat state, and aggregate usage; object bytes and S3/management credentials stay on the node. A deliberate `--offline` mode keeps standalone local development possible without an account.

> OpenBucket is currently a single-node, self-hosted v0.1 product. It is useful for development, homelabs, local backup targets, and trusted private networks. Read [Security](#security) and [Current limitations](#current-limitations) before exposing it outside a machine you control.

The Node daemon and CLI are published as [`openbucket@0.1.4`](https://www.npmjs.com/package/openbucket/v/0.1.4), and the web application is live at [openbucket-eight.vercel.app](https://openbucket-eight.vercel.app). Release `0.1.4` is the current unified trusted release for npm, PyPI, GitHub Container Registry, and GitHub Releases; see [Releasing](docs/RELEASING.md).

## What is included

- A foreground or detached daemon with independent management (`7272`) and S3 (`8333`) listeners.
- Real disk-backed buckets and objects, safe path validation, a per-root single-writer lock, and persistent node state.
- AWS Signature Version 4 header authentication and presigned-query authentication.
- Path-style bucket/object CRUD, ranges, copy, basic ListObjectsV2 pagination, and multipart upload.
- Read-only and bucket-scoped S3 access keys, anonymous reads for explicitly public buckets, and expiring share links.
- A responsive dashboard for status, buckets, uploads/downloads, keys, connections, logs, and analytics.
- Account-connected node registration, usage/heartbeat reporting, and an automatic S3-only Cloudflare Quick Tunnel when no managed public URL is configured; Quick Tunnels are development/preview infrastructure, not production routing.
- A management REST API, request logs, health checks, Docker targets, Compose, examples, tests, and operations documentation.
- A typed `openbucket-client` Python management SDK and console client.
- A production Vercel dashboard target plus CI, security scanning, trusted publishing, SBOM/provenance-attested containers, and release workflows.

The desktop application is intentionally deferred. See [the product plan](docs/PRODUCT_PLAN.md).

## 60-second local quickstart

Requirements: Node.js 22.13 or newer and npm. The normal account-connected flow also requires `cloudflared` unless you configure a managed public URL or explicitly disable tunneling.

From this repository, log in with the hidden password prompt, then register and serve a DNS-safe node name:

```bash
npm ci
npm run build
npm run openbucket -- login --email you@example.com
npm run openbucket -- serve ./openbucket-data --name home-node --detach --no-open
npm run openbucket -- dashboard
npm run openbucket -- bucket create photos
npm run openbucket -- status
```

`serve` registers the node, stores its node credential in the permission-restricted CLI home, reports heartbeat/storage/request counters, and starts supervised S3 and management Quick Tunnels when no managed public route exists. The account dashboard receives only the public endpoint metadata; daemon and S3 secrets never leave the storage host. Quick Tunnel URLs change on restart and are suitable only for development or preview.

For standalone local development with no hosted login, metering, discovery, or tunnel:

```bash
npm run openbucket -- serve ./openbucket-data --name dev-node --offline --detach --no-open
```

`--offline` (or `OPENBUCKET_OFFLINE=true`) is an explicit local-development escape hatch, not the recommended production mode.

The first start prints an initial S3 access key and secret. Save them in a password manager; later key listings omit secrets. During detached first start, the credential passes briefly through the permission-restricted CLI active-state file until the parent prints and scrubs it. The daemon is now serving:

- Management API: `http://127.0.0.1:7272`
- S3 API: `http://127.0.0.1:8333`
- Files/share endpoint: `http://127.0.0.1:8333/files/...`
- Dashboard: `http://localhost:3000` (or the next free local port)

`openbucket dashboard` opens the built dashboard with a one-time pairing fragment containing the management token; the page removes it from the address bar and keeps the token in API-scoped session storage. A built source/package artifact is served by the daemon automatically. The CLI allow-lists the effective dashboard origin (and its `localhost`/`127.0.0.1` equivalent) for CORS.

When finished:

```bash
npm run openbucket -- stop
```

## Temporary public HTTPS

After [installing `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), an authenticated `serve` automatically opens an S3-only Quick Tunnel when no managed public base URL is configured. `--tunnel` requests the same mode explicitly:

```bash
openbucket login --email you@example.com
openbucket serve /path/to/storage --name demo-node --tunnel --detach
```

For an account-connected node, the supervised S3 and management tunnels are recorded in MongoDB through the node heartbeat. The hosted console receives a short-lived node-scoped capability, never the daemon's long-lived bearer token. The local dashboard remains loopback-only and is automatically paired by `openbucket dashboard`. The banner prints the usable endpoints, and `openbucket stop` terminates the daemon and supervised tunnels.

Quick Tunnel URLs change on restart and Cloudflare documents them as development/testing infrastructure with no uptime guarantee, a 200 in-flight request limit, and no SSE support. Account-connected mode tunnels only S3. An offline explicit-tunnel demo may also expose management, which still requires the full-control bearer token. Use a named tunnel/reverse proxy with an independent access policy for production.

## Install the CLI

### From this source checkout

```bash
npm ci
npm run build
npm link
openbucket version
```

`npm link` installs the local package globally. To test the exact npm artifact without linking:

```bash
npm pack
npm install --global ./openbucket-0.1.4.tgz
```

### From npm

Install the current release from npm:

```bash
npm install --global openbucket@0.1.4
openbucket version
openbucket login --email you@example.com
openbucket serve /path/to/storage --name my-node
```

The password prompt is hidden. Use `OPENBUCKET_CONTROL_PLANE_URL` or `--control-plane-url` when the hosted API is not the default deployment.

Use the explicit version in unattended production and review [all installation methods](docs/INSTALLATION.md). The Python client, GHCR images, and GitHub release assets are not published yet; those begin with the next unified release.

### Installer scripts

The installers are thin, auditable npm wrappers served by the current Vercel deployment. They never add a service, open ports, or change firewall rules. Download and review a script before running it in production:

```bash
curl -fsSLo openbucket-install.sh https://openbucket-eight.vercel.app/install.sh
OPENBUCKET_INSTALL_VERSION=0.1.4 sh ./openbucket-install.sh
```

```powershell
Invoke-WebRequest https://openbucket-eight.vercel.app/install.ps1 -OutFile openbucket-install.ps1
& ./openbucket-install.ps1 -Version 0.1.4
```

From a source checkout, the same installers are available directly:

```bash
sh scripts/install.sh
```

```powershell
& ./scripts/install.ps1
```

Set `OPENBUCKET_NPM_PACKAGE` or pass `--package`/`-Package` to install a tarball, local path, scoped package, or a specific registry version.

## CLI reference

Run `openbucket help` or `openbucket help <command>` for built-in usage.

| Command | Purpose |
| --- | --- |
| `openbucket serve [directory]` | Start in the foreground; `start` is an alias. |
| `openbucket serve DIR --detach` | Start a background daemon and wait for health. |
| `openbucket stop` | Ask the active daemon to stop. |
| `openbucket status [--json]` | Print node, disk, object, and endpoint status. |
| `openbucket dashboard` | Securely open or re-pair the active daemon's dashboard. |
| `openbucket logs [--follow] [--limit N]` | Read the newest 1-1000 request logs; optionally poll. |
| `openbucket doctor [directory]` | Check Node, storage permissions, daemon health, S3 reachability, or port availability. |
| `openbucket buckets` | List buckets (`list` is an alias). |
| `openbucket bucket create NAME [--public]` | Create a private or anonymously readable bucket. |
| `openbucket bucket delete NAME [--force]` | Delete an empty bucket, or recursively delete it with `--force`. |
| `openbucket objects BUCKET [--prefix P]` | List objects through the management API. |
| `openbucket keys` | List access keys without secrets. |
| `openbucket key create [--name N] [--read-only] [--bucket B]` | Issue an S3 key; its secret is shown once. |
| `openbucket key revoke ID` | Revoke a key. The final key cannot be revoked. |
| `openbucket share BUCKET KEY [--expires 1h]` | Create a `1s`-`7d` browser-friendly share link. |
| `openbucket config` | Print the daemon's client endpoints and node configuration. |
| `openbucket version` | Print the package version. |

Serve options:

```text
openbucket serve <directory>
  [--name NAME]
  [--management-port PORT]
  [--s3-port PORT]
  [--host HOST]
  [--public-url URL]
  [--dashboard-url URL]
  [--detach]
  [--tunnel]
  [--no-open]
  [--no-credentials]
```

`--no-credentials` suppresses display of the one-time bootstrap secret; it does not disable S3 authentication. The defaults bind both APIs to `127.0.0.1`. `--host 0.0.0.0` exposes both listeners on every interface; do that only with appropriate authentication, firewalling, and TLS termination.

Exit codes are `0` success, `1` runtime failure, `2` usage error, `3` inactive/unreachable daemon, `4` management API error, and `5` a blocking `doctor` failure.

## Use an S3 client

OpenBucket uses path-style endpoints. Set `forcePathStyle: true` (or the equivalent) and provide the credentials printed at first start or created with `openbucket key create`.

### JavaScript (AWS SDK v3)

```bash
cd examples/javascript
npm install
OPENBUCKET_ACCESS_KEY='...' OPENBUCKET_SECRET_KEY='...' \
  node upload.mjs ../sample.txt photos sample.txt
```

The complete example is in [examples/javascript](examples/javascript).

### Python (boto3)

```bash
python -m pip install -r examples/python/requirements.txt
OPENBUCKET_ACCESS_KEY='...' OPENBUCKET_SECRET_KEY='...' \
  python examples/python/upload.py ./sample.txt photos sample.txt
```

### AWS CLI

```bash
AWS_ACCESS_KEY_ID="$OPENBUCKET_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$OPENBUCKET_SECRET_KEY" \
AWS_DEFAULT_REGION=auto \
aws --endpoint-url http://127.0.0.1:8333 s3 cp ./sample.txt s3://photos/sample.txt
```

Then verify real bytes on disk at `./openbucket-data/photos/sample.txt`.

### Python management SDK

The optional `openbucket-client` package controls the management API; it does not install the Node daemon. It is not on PyPI yet, so install it from this checkout until the first unified release:

```bash
python -m pip install ./python
openbucket-client --url http://127.0.0.1:7272 --token "$OPENBUCKET_ADMIN_TOKEN" status
```

Use `boto3` for object data and `openbucket-client` for status, buckets, keys, shares, logs, and analytics. The typed library and CLI are documented in [python/README.md](python/README.md).

## Management API examples

The CLI generates a random management token when one is not configured and keeps it in its permission-restricted active state file. For automation, set `OPENBUCKET_ADMIN_TOKEN` before starting the daemon and send it as a bearer token:

```bash
export OPENBUCKET_ADMIN_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
openbucket serve ./openbucket-data --detach --no-open

curl -fsS http://127.0.0.1:7272/v1/status \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN"

curl -fsS http://127.0.0.1:7272/v1/buckets \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"project-assets","public":false}'
```

Reusable PowerShell and POSIX examples live in [examples/curl](examples/curl). The complete contract is in [docs/API.md](docs/API.md).

## Dashboard

The dashboard is a real client of the daemon. It loads status, capacity, buckets, objects, access keys, logs, analytics, and endpoints from the management API; writes use the same API. A normal built `openbucket serve` hosts it at a local dashboard URL and stops it with the daemon.

```bash
npm run dev
# independent production build and server
npm run build
npm start
```

Configure its defaults at build time:

```dotenv
NEXT_PUBLIC_OPENBUCKET_API_URL=http://127.0.0.1:7272
NEXT_PUBLIC_APP_URL=https://app.openbucket.dev
```

Set `OPENBUCKET_SERVE_DASHBOARD=false` when an independent server owns the dashboard port. Run `openbucket dashboard` whenever the active local page needs to be opened or re-paired. Users can also override the management URL and enter a token in the connection modal. The URL is saved in local storage; the admin token is kept in API-scoped session storage only.

If the dashboard and daemon have different origins, set `OPENBUCKET_DASHBOARD_URL` on the daemon or add exact comma-separated origins with `OPENBUCKET_ALLOWED_ORIGINS`. CORS permits the browser connection; every protected management call still needs the bearer token. See [Dashboard pairing and CORS](docs/SECURITY.md#dashboard-pairing-and-cors).

### Vercel

`npm run build:vercel` validates the Vercel application in `vercel-dist`. The Git-connected project deploys pull-request previews and promotes `main` to [openbucket-eight.vercel.app](https://openbucket-eight.vercel.app):

- `/` is the public product landing page;
- `/docs` is the public documentation page;
- `/login` and `/register` establish a hosted web session;
  Registration is a one-time owner bootstrap protected by an independent setup token and an atomic MongoDB claim;
- `/dashboard` requires that hosted session and shows registered nodes, heartbeat/storage state, metered usage, and an admin-only aggregate overview; its **Live node** console still connects directly to a daemon management API;
- `/<node-name>` is a public, rate-limited discovery document for a discoverable node's current S3 endpoint. It is metadata only: Vercel does not proxy or redirect S3 object traffic.

MongoDB stores hosted users, password verifiers, sessions, bootstrap/rate-limit records, node registrations, hashed node credentials, latest heartbeat/storage summaries, and aggregate usage events. Object bytes remain on the daemon's disk; raw node credentials, daemon management tokens, and S3 credentials are never persisted to MongoDB. The local dashboard can still be used in explicit `--offline` development mode.
The bootstrap record is retained after success and the raw setup token is never stored, so older immutable deployment URLs cannot register another owner.

After the permanent MongoDB/auth variables are configured and the Vercel project is linked, create the first owner with the guarded helper:

```bash
node scripts/bootstrap-owner.mjs --email owner@example.com --name "Owner" --url https://openbucket-eight.vercel.app
```

It prompts twice without echo, sends the temporary token to Vercel over stdin, deploys the registration window, registers against the same origin, and then disables signup, removes the token, and redeploys even when registration fails.

GitHub Actions verifies the exact production commit without storing Vercel credentials. Later domain changes require only environment and DNS updates. Follow [the Vercel deployment guide](docs/VERCEL.md) for server-only authentication variables, CORS, production verification, and the later `openbucket.dev` cutover.

## Docker Compose

Compose starts two real services: the daemon and the production dashboard.

```bash
cp .env.example .env
# Replace OPENBUCKET_ADMIN_TOKEN in .env with a random value.
# Keep OPENBUCKET_TUNNEL=false: the standard image has no cloudflared.
docker compose build daemon
docker compose run --rm daemon login --email owner@example.com
docker compose up --build -d
```

The one-off login mounts the declared `openbucket-state` volume at `/state`, so the account session and later node credential survive removal of that temporary container. Do not use an anonymous `/state` volume. Configure `OPENBUCKET_PUBLIC_BASE_URL` only after a managed S3 route exists; Quick Tunnel needs a deliberately extended image containing `cloudflared` and remains development-only.

Open `http://localhost:3000` and enter the same `OPENBUCKET_ADMIN_TOKEN` from `.env` in Connection settings. The dashboard service does not receive that secret as a build argument or container environment variable.

The container profile suppresses the bootstrap S3 secret from persistent container logs. Create a workload credential in the dashboard's **Access keys** view, or reveal a newly created key once in your current terminal:

```bash
docker compose exec daemon node dist/cli/main.js key create --name first-workload
```

PowerShell token generation:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
docker compose up --build
```

Defaults:

- Dashboard: `http://localhost:3000`
- Management: `http://127.0.0.1:7272`
- S3: `http://127.0.0.1:8333`
- Object data: named volume `openbucket-data`
- CLI state/logs: named volume `openbucket-state`

Use a host directory instead of the named data volume:

```bash
OPENBUCKET_STORAGE_MOUNT=./openbucket-data docker compose up --build
```

On Windows, put a forward-slash absolute path in `.env`, for example `OPENBUCKET_STORAGE_MOUNT=C:/OpenBucket/data`.

The host-side bind address defaults to `127.0.0.1`. Set `OPENBUCKET_DOCKER_BIND_HOST=0.0.0.0` only after reviewing the security controls. Container health checks cover `/healthz` and the dashboard HTTP server.

## Public access and `openbucket.dev` URLs

For development, account-connected `serve` automatically selects a Quick Tunnel when no public URL is configured. That endpoint is temporary. For a stable production hostname, configure a named tunnel or reverse proxy you operate and advertise its real S3 origin:

```dotenv
OPENBUCKET_PUBLIC_BASE_URL=https://s3.example.com
OPENBUCKET_DASHBOARD_URL=https://console.example.com
NEXT_PUBLIC_OPENBUCKET_API_URL=https://api.example.com
NEXT_PUBLIC_APP_URL=https://console.example.com
```

Then start with `--no-tunnel` (the public base URL also disables the automatic Quick Tunnel):

```bash
openbucket serve /srv/openbucket --name home-node --no-tunnel
```

`OPENBUCKET_PUBLIC_BASE_URL` changes advertised/share URLs and marks the heartbeat route as managed. It does **not** create DNS, TLS, a Cloudflare account, or a relay. Route the stable public origin to `http://127.0.0.1:8333`. The server-only `OPENBUCKET_NODE_DOMAIN` controls future discovery hostnames such as `s3.home-node.openbucket.dev`; it does not provision those routes. Avoid exposing the management listener; if you must, require its bearer token and an independent network access policy.

See [Operations](docs/OPERATIONS.md#reverse-proxy-or-cloudflare-tunnel).

## Configuration

Flags take precedence over environment variables. Specific variables take precedence over compatibility aliases. The CLI reads its process environment; it does not load `.env` by itself. Docker Compose reads `.env` for interpolation, and the dashboard build reads `NEXT_PUBLIC_*` values.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENBUCKET_STORAGE_ROOT` | required unless directory argument is supplied | Disk root containing bucket directories and `.openbucket`. |
| `OPENBUCKET_NODE_NAME` / `OPENBUCKET_NAME` | storage basename | Display name (`NODE_NAME` wins). |
| `OPENBUCKET_HOST` | `127.0.0.1` | Shared listen host fallback. |
| `OPENBUCKET_MANAGEMENT_HOST` | shared host | Management listen host. |
| `OPENBUCKET_S3_HOST` | shared host | S3 listen host. |
| `OPENBUCKET_MANAGEMENT_PORT` | `7272` | Management port; `0` selects an ephemeral port. |
| `OPENBUCKET_S3_PORT` | `8333` | S3 port; `0` selects an ephemeral port. |
| `OPENBUCKET_PUBLIC_BASE_URL` / `OPENBUCKET_PUBLIC_URL` | S3 URL | Advertised public root and share-link root (`PUBLIC_BASE_URL` wins). |
| `OPENBUCKET_DASHBOARD_URL` | `http://localhost:3000` | Printed dashboard URL and exact allowed CORS origin. |
| `OPENBUCKET_SERVE_DASHBOARD` | `true` | Serve the built dashboard in the daemon for a local HTTP dashboard URL; disable for a separate server. |
| `OPENBUCKET_SHOW_INITIAL_CREDENTIALS` | `true` (`false` in container image) | Print the first-run S3 secret once; disable anywhere stdout/stderr is retained. |
| `OPENBUCKET_TUNNEL` | automatic | Authenticated serve uses a Quick Tunnel when no managed public URL exists; set `false`/`--no-tunnel` to disable it. |
| `OPENBUCKET_CLOUDFLARED_PATH` | `cloudflared` | Executable path used by Quick Tunnel mode. |
| `OPENBUCKET_CONTROL_PLANE_URL` | hosted production origin | Account login, node registration, heartbeat, and usage API origin. |
| `OPENBUCKET_OFFLINE` | `false` | Local-development escape hatch that disables hosted login requirements, registration, metering, and discovery. |
| `OPENBUCKET_ALLOWED_ORIGINS` | dashboard origin | Extra exact origins, comma-separated. Never use `*` on an exposed management API. |
| `OPENBUCKET_ADMIN_TOKEN` / `OPENBUCKET_TOKEN` | random per CLI start | Management bearer token, at least 32 UTF-8 bytes when supplied (`ADMIN_TOKEN` wins). |
| `OPENBUCKET_DETACH` | `false` | Start detached (`true/false`, `1/0`, `yes/no`, `on/off`). |
| `OPENBUCKET_OPEN_DASHBOARD` | `true` | Open the configured dashboard on start. |
| `OPENBUCKET_HOME` / `OPENBUCKET_STATE_DIR` | `~/.openbucket` | CLI active-state directory (`HOME` wins; relative paths resolve under the user home). |
| `OPENBUCKET_LOG_FILE` | `$OPENBUCKET_HOME/daemon.log` | Detached process stdout/stderr log; a relative override resolves from the working directory. |
| `OPENBUCKET_MANAGEMENT_URL` | active daemon URL | Remote management URL used by non-serve CLI commands. |
| `OPENBUCKET_START_TIMEOUT_MS` | `15000` (`60000` with Quick Tunnel) | Detached startup health deadline. |
| `OPENBUCKET_VERSION` | package version | CLI version override, intended for packaging/tests. |
| `NEXT_PUBLIC_OPENBUCKET_API_URL` | `http://127.0.0.1:7272` | Dashboard's initial management URL. |
| `NEXT_PUBLIC_APP_URL` | `https://app.openbucket.dev` | Dashboard metadata origin fallback; a valid request forwarded-host/host takes precedence. |
| `NEXT_PUBLIC_DOCS_URL` | `https://github.com/Razin-developer/openbucket/tree/main/docs` | Dashboard documentation link. |

Legacy aliases remain available for compatibility but may be removed after a deprecation cycle. The annotated [`.env.example`](.env.example) includes application, client-example, and Compose-only values.

## On-disk layout

```text
<storage-root>/
├── .openbucket/
│   ├── state.json          node identity, buckets, S3 secrets, share secret
│   ├── requests.jsonl      append-only request log
│   ├── daemon.lock         live single-writer lock
│   ├── tmp/                in-progress object uploads
│   └── multipart/          in-progress multipart uploads
├── bucket-a/
│   └── path/to/object.bin  the real object bytes
└── bucket-b/
```

OpenBucket can discover safe, S3-valid directories already present directly under the root as private buckets. It never treats `.openbucket` as a bucket. Object keys are safe relative paths; symlinks and traversal/reserved segments are rejected.

## Security

The safe daemon default is loopback-only operation. The daemon has no built-in TLS, encryption at rest, request rate limiting, multi-user RBAC, or immutable audit log. The optional hosted site adds a MongoDB-backed owner-account gate and authentication rate limits, but it does not replace the daemon's separate management token or S3 credentials.

Important facts:

- S3 secrets and the share-signing secret are stored in `<root>/.openbucket/state.json`; protect and encrypt the underlying filesystem and backups.
- CLI-managed daemons always have a management token. The CLI passes it to an automatically opened dashboard in a URL fragment; the page removes it and keeps it in API-scoped session storage. Every protected management request still requires the bearer token.
- Public buckets allow anonymous `GET`/`HEAD` of known object paths only. Listings and writes still require S3 authentication.
- Share URLs are bearer secrets and can live for at most seven days.
- TLS and public routing belong at a reverse proxy/tunnel you operate.

Read [docs/SECURITY.md](docs/SECURITY.md) before any non-local deployment. Report vulnerabilities through the repository's [private security-reporting policy](.github/SECURITY.md), never through a public exploit issue.

## Supported S3 surface

| Area | Status |
| --- | --- |
| SigV4 headers and presigned query URLs | Supported |
| Path-style `ListBuckets`, create/head/delete bucket | Supported |
| `GetBucketLocation` | Supported (empty location constraint) |
| `ListObjectsV2` prefix, max keys, start-after, continuation | Basic support |
| `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` | Supported |
| Single byte ranges | Supported |
| `CopyObject` | Supported for complete objects |
| Multipart initiate/upload/complete/abort | Supported; list-parts/uploads and upload-part-copy are not |
| Virtual-hosted buckets, ACL/policy APIs, versioning, lifecycle, tagging | Not supported |
| Object metadata/content-type persistence, conditional requests | Not supported |
| SSE/KMS, replication, events, Object Lock, Select | Not supported |
| AWS streaming/chunked SigV4 payload format | Not supported |

The authoritative matrix and behavioral notes are in [docs/S3_COMPATIBILITY.md](docs/S3_COMPATIBILITY.md).

## Development and verification

```bash
npm ci
npm run dev                 # dashboard development server
npm run dev:daemon          # foreground daemon on ./.openbucket-data
npm run openbucket -- help  # source CLI through tsx

npm run build
npm run build:vercel
npm run type-check
npm run lint
npm test
npm run release:check
```

Cross-platform two-process development helpers are available:

```bash
sh scripts/dev.sh
```

```powershell
& ./scripts/dev.ps1
```

Tests use temporary directories and ephemeral ports for real management/S3 I/O. See [CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Current limitations

- One daemon process and one writer per storage root; no cluster, replication, consensus, or automatic failover.
- The entire metadata catalog and all S3 secrets live in one local JSON state file.
- Request and detached daemon logs do not rotate automatically.
- No file watching: direct disk changes are discovered for top-level buckets and reflected when objects are listed, but there is no event/indexing service.
- S3 compatibility is deliberately partial; test each client/workload against the matrix.
- Object content type and custom S3 metadata are not persisted; downloads are `application/octet-stream`.
- No quotas, lifecycle cleanup, checksummed background scrub, garbage collection UI, or multipart resume/list APIs.
- npm `openbucket@0.1.0` and the `openbucket-eight.vercel.app` web deployment are live. PyPI, GHCR, GitHub release assets, `openbucket.dev` ownership/DNS, stable named-tunnel provisioning, and a managed relay still require their documented owner-controlled release or infrastructure steps.
- The desktop application is planned after the daemon/CLI/web foundation, not included in v0.1.

## Roadmap

Priorities are durability and compatibility before expansion:

1. State migrations, crash recovery, log rotation, multipart housekeeping, integrity scan, and backup/restore verification.
2. S3 metadata, conditional operations, delimiter/common-prefix listing, multipart list/resume, broader SDK conformance.
3. TLS/proxy deployment profiles, optional MFA and multi-user hosted roles, daemon request limits, quotas, and security audit.
4. Remote node registry/relay as an optional separate service, metrics export, notifications, and multi-node replication research.
5. Signed desktop application only after the headless product is stable.

See [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) for acceptance criteria, sequencing, metrics, risks, and business/open-source strategy.

## Documentation

- [Product plan](docs/PRODUCT_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Management API](docs/API.md)
- [S3 compatibility](docs/S3_COMPATIBILITY.md)
- [Security](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
- [Installation](docs/INSTALLATION.md)
- [Vercel deployment](docs/VERCEL.md)
- [Release process](docs/RELEASING.md)
- [End-to-end demo](docs/DEMO.md)
- [Contributing](docs/CONTRIBUTING.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
