# OpenBucket

**Your disk, now S3-compatible.** OpenBucket turns a local folder, disk, SSD, or mounted NAS path into object storage with a small Node.js daemon, an Ollama-style CLI, and a browser dashboard.

OpenBucket writes real object bytes to the directory you choose. There is no fake dataset and no required hosted control plane. Existing S3 clients connect to the local S3 endpoint; the CLI and dashboard use a separate management API.

> OpenBucket is currently a single-node, self-hosted v0.1 product. It is useful for development, homelabs, local backup targets, and trusted private networks. Read [Security](#security) and [Current limitations](#current-limitations) before exposing it outside a machine you control.

## What is included

- A foreground or detached daemon with independent management (`7272`) and S3 (`8333`) listeners.
- Real disk-backed buckets and objects, safe path validation, a per-root single-writer lock, and persistent node state.
- AWS Signature Version 4 header authentication and presigned-query authentication.
- Path-style bucket/object CRUD, ranges, copy, basic ListObjectsV2 pagination, and multipart upload.
- Read-only and bucket-scoped S3 access keys, anonymous reads for explicitly public buckets, and expiring share links.
- A responsive dashboard for status, buckets, uploads/downloads, keys, connections, logs, and analytics.
- Opt-in supervised Cloudflare Quick Tunnels that make the S3 API, authenticated management API, and local dashboard reachable over temporary HTTPS URLs for development/demo use.
- A management REST API, request logs, health checks, Docker targets, Compose, examples, tests, and operations documentation.

The desktop application is intentionally deferred. See [the product plan](docs/PRODUCT_PLAN.md).

## 60-second local quickstart

Requirements: Node.js 22.13 or newer and npm. `--tunnel` additionally requires an installed `cloudflared` executable.

From this repository:

```bash
npm ci
npm run build
npm run openbucket -- serve ./openbucket-data --detach --no-open
npm run openbucket -- dashboard
npm run openbucket -- bucket create photos
npm run openbucket -- status
```

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

## Public HTTPS demo in one command

After [installing `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), run:

```bash
openbucket serve /path/to/storage --tunnel --detach
```

OpenBucket starts and supervises separate temporary HTTPS tunnels for S3 and management. When the configured dashboard is local, it also tunnels the dashboard; when it is already an HTTPS deployment, that URL is paired with the tunneled management API. The banner prints the usable public endpoints, and `openbucket stop` terminates the daemon and every supervised tunnel.

Quick Tunnel URLs change on restart and Cloudflare documents them as development/testing infrastructure with no uptime guarantee, a 200 in-flight request limit, and no SSE support. The remote management URL still requires the random bearer token, but possession of that token grants full node control. Use a named tunnel/reverse proxy with an independent access policy for production.

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
npm install --global ./openbucket-0.1.0.tgz
```

### From npm

Once a release has been published to the npm registry:

```bash
npm install --global openbucket
openbucket serve /path/to/storage
```

The repository is npm-package-ready, but this README does not imply that a registry release or the `openbucket.dev` hosted URLs already exist.

### Installer scripts

The installers are thin, auditable npm wrappers. They never add a service or change firewall rules.

```bash
curl -fsSL https://openbucket.dev/install.sh | sh
```

```powershell
irm https://openbucket.dev/install.ps1 | iex
```

Until those URLs are published, run the checked-in scripts directly:

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

## Docker Compose

Compose starts two real services: the daemon and the production dashboard.

```bash
cp .env.example .env
# Replace OPENBUCKET_ADMIN_TOKEN in .env with a random value.
docker compose up --build
```

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

For a zero-account development/demo endpoint, use `--tunnel` as described above. For a stable production hostname, configure a named tunnel or reverse proxy you operate, then advertise its real origins:

```dotenv
OPENBUCKET_PUBLIC_BASE_URL=https://storage.example.com
OPENBUCKET_DASHBOARD_URL=https://console.example.com
NEXT_PUBLIC_OPENBUCKET_API_URL=https://api.example.com
NEXT_PUBLIC_APP_URL=https://console.example.com
```

Outside `--tunnel` mode, `OPENBUCKET_PUBLIC_BASE_URL` changes advertised/share URLs only. It does **not** create DNS, TLS, a Cloudflare account, or a managed relay. Route the stable public origin to `http://127.0.0.1:8333`. Avoid exposing the management listener; if you must, require its bearer token and an independent network access policy.

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
| `OPENBUCKET_TUNNEL` | `false` | Set `quick`/`true` to supervise temporary Cloudflare HTTPS tunnels (same as `--tunnel`). |
| `OPENBUCKET_CLOUDFLARED_PATH` | `cloudflared` | Executable path used by Quick Tunnel mode. |
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
| `NEXT_PUBLIC_DOCS_URL` | `https://openbucket.dev/docs` | Dashboard documentation link. |

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

The safe default is loopback-only operation. OpenBucket has no built-in TLS, encryption at rest, rate limiting, multi-user RBAC, immutable audit log, or hosted identity layer.

Important facts:

- S3 secrets and the share-signing secret are stored in `<root>/.openbucket/state.json`; protect and encrypt the underlying filesystem and backups.
- CLI-managed daemons always have a management token. The CLI passes it to an automatically opened dashboard in a URL fragment; the page removes it and keeps it in API-scoped session storage. Every protected management request still requires the bearer token.
- Public buckets allow anonymous `GET`/`HEAD` of known object paths only. Listings and writes still require S3 authentication.
- Share URLs are bearer secrets and can live for at most seven days.
- TLS and public routing belong at a reverse proxy/tunnel you operate.

Read [docs/SECURITY.md](docs/SECURITY.md) before any non-local deployment and report vulnerabilities privately rather than opening a public exploit issue.

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
npm run type-check
npm run lint
npm test
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
- The dashboard is deployable independently, but `openbucket.dev` ownership/custom domains, npm publication, signing, release automation, stable named-tunnel provisioning, and a managed relay require operator/release infrastructure outside this source tree.
- The desktop application is planned after the daemon/CLI/web foundation, not included in v0.1.

## Roadmap

Priorities are durability and compatibility before expansion:

1. State migrations, crash recovery, log rotation, multipart housekeeping, integrity scan, and backup/restore verification.
2. S3 metadata, conditional operations, delimiter/common-prefix listing, multipart list/resume, broader SDK conformance.
3. TLS/proxy deployment profiles, stronger dashboard authentication, rate limits, quotas, and security audit.
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
- [End-to-end demo](docs/DEMO.md)
- [Contributing](docs/CONTRIBUTING.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
