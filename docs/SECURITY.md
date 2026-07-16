# OpenBucket security

OpenBucket is a self-hosted single-node storage service. Security depends on the daemon configuration **and** the operating system, filesystem, network, reverse proxy, backups, and applications around it.

The current v0.1 code is suitable for local development and carefully controlled private deployments. It has not been presented as independently audited or hardened for hostile multi-tenant internet exposure.

## Report a vulnerability

Do not publish exploit details or real credentials in a public issue. The repository ships a [GitHub security policy](../.github/SECURITY.md); after private vulnerability reporting is enabled, use **Security -> Report a vulnerability** in the repository. If that control is not yet visible, contact the maintainer privately instead. Include:

- affected version/commit and platform;
- minimal reproduction;
- expected and observed impact;
- whether secrets or user data were accessed;
- suggested mitigation, if known.

Avoid testing against systems you do not own and redact all state files, tokens, access keys, object paths, and logs from reports.

## Security boundaries

OpenBucket assumes:

- the operator controls the process account and storage root;
- untrusted local users cannot read the root or CLI state directory;
- private listeners are protected by host/network policy;
- the operator supplies TLS and public routing when needed;
- client applications protect S3 credentials and share URLs.

It does not defend object bytes against an attacker who can directly write the selected filesystem. It does not make one disk redundant, encrypt an unencrypted disk, or turn CORS into network authentication.

## Threat model

| Actor/capability | v0.1 protection | Remaining risk |
| --- | --- | --- |
| Remote client without S3 key | Private S3 operations require SigV4; public access is object-read-only | Request flooding/rate abuse; known public object paths are readable |
| Remote client without management token | Every `/v1/*` route requires its bearer value; listener defaults to loopback | No rate limit/lockout; an exposed management surface remains high impact |
| Malicious object key | Validation, root confinement, reserved segments, symlink checks | Direct external filesystem mutation bypasses API validation |
| Stolen S3 credential | Revocation, read-only mode, optional bucket scope | No IP/time policy, automatic expiry, session key, or fine-grained action policy |
| Stolen share URL | Bucket/key/expiry-bound HMAC, maximum seven days | URL is a bearer secret and may appear in browser/proxy history before redaction |
| User able to read storage root | Filesystem ACLs only | Can read object bytes, S3 secrets, share secret, and request logs |
| User able to write storage root | Single daemon lock and path checks for API operations | Can replace data/state or interfere with availability outside the daemon |
| Disk loss/corruption | Atomic state rename and ordinary filesystem behavior | No replication, erasure coding, journal, scrub, or automatic repair |
| Compromised dependency/build | Lockfile, SHA-pinned GitHub Actions, CodeQL/dependency review, and release-time container SBOM/provenance attestations | No independent audit; controls only protect releases produced through the documented workflow |

## Safe deployment baseline

1. Run the process as a dedicated unprivileged OS account.
2. Keep management and S3 listeners on `127.0.0.1` unless a private network or proxy requires otherwise.
3. Set a random `OPENBUCKET_ADMIN_TOKEN` for automation and containers:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

4. Use exact dashboard origins; never use `OPENBUCKET_ALLOWED_ORIGINS=*` on an exposed listener.
5. Put internet-facing S3 behind an authenticated/rate-limited TLS reverse proxy or tunnel you operate. Do not expose management unless independently access-controlled.
6. Protect the storage root, CLI state directory, detached log, and backups with OS ACLs and encryption at rest.
7. Create separate bucket-scoped/read-only credentials for each workload where possible.
8. Back up and restore-test the entire root, including `.openbucket`, while the daemon is stopped or with a consistent filesystem snapshot.
9. Monitor free space, request errors, unexpected keys, and log growth.
10. Keep Node.js, OpenBucket, the container base image, and proxy patched.

## Management authentication

The CLI always supplies an admin token to a daemon it starts. If neither `OPENBUCKET_ADMIN_TOKEN` nor its compatibility alias is present, the CLI generates 32 random bytes encoded as base64url. The token is stored in the CLI `active.json` so subsequent CLI commands can authenticate. CLI-supplied tokens must contain at least 32 UTF-8 bytes.

Programmatic `startDaemon()` calls also generate a random management token when `adminToken` is omitted or blank. The effective token is returned as `handle.config.adminToken`; a caller that embeds the daemon must retain it securely if it needs the management API.

`GET /healthz` is unauthenticated by design and reveals health, version, node ID, and uptime. Every `/v1/*` management endpoint requires the bearer token.

Bearer tokens are compared using a timing-safe equality check. The API has no login, token expiry, multiple administrators, role model, lockout, or session audit. Rotate a management token by stopping the daemon, changing the environment, and restarting it.

## Dashboard pairing and CORS

The CLI automatically adds the configured dashboard origin to `allowedOrigins`, plus the equivalent `localhost` or `127.0.0.1` origin. If the embedded dashboard shifts to a free port, its effective origin is also added.

For cross-origin browser calls, the daemon:

- returns CORS headers only for an allowed origin;
- accepts preflight methods `GET, HEAD, PUT, POST, PATCH, DELETE, OPTIONS`;
- accepts the dashboard marker and S3/management headers listed in the implementation;
- rejects a preflight from an unlisted origin.

When a management token exists, every protected management request requires:

```http
Authorization: Bearer <management-token>
```

`X-OpenBucket-Client: dashboard` is an informational client marker and does not bypass bearer authentication. CORS is likewise not authentication: it constrains cooperating browsers, not arbitrary network clients.

To pair the local dashboard without putting a secret in a query parameter, startup auto-open and `openbucket dashboard` use:

- `?api=<management-url>` as a validated connection hint;
- `#token=<management-token>` as a fragment, which browsers do not send to the dashboard HTTP server;
- immediate query/fragment removal by the page;
- API-scoped session storage for the token, never persistent local storage.

This reduces accidental server/proxy logging but does not make a long-lived bearer harmless:

- browser history before cleanup, extensions, malware, debugging tools, screenshots, or dashboard XSS can expose it;
- possession grants every management action;
- there is no token expiry or scoped operator role.

Therefore:

- keep management loopback-only or behind an independently authenticated private access layer;
- never use `*` for remote management;
- use `openbucket dashboard` to open/re-pair an active local node, or enter the explicit token only on a trusted dashboard;
- plan short-lived cryptographic pairing/session tokens before broad remote dashboard support.

The dashboard saves the normalized management URL in local storage. Admin tokens are kept in session storage under a key scoped to that API URL. The page consumes and removes both launch values from the visible URL.

## S3 authentication and authorization

The S3 server verifies AWS Signature Version 4:

- `AWS4-HMAC-SHA256` header authorization;
- presigned query authorization;
- `s3` credential scope with a lowercase region token;
- canonical method, URI, query, signed headers, and payload-hash declaration;
- a 15-minute clock-skew window for header-signed requests;
- a maximum seven-day presigned expiry;
- signed `x-amz-*` operation headers;
- actual SHA-256 of persisted PUT/part bytes when a concrete hash is declared.

`UNSIGNED-PAYLOAD` is accepted. AWS streaming/chunked payload markers are not implemented. Keep clocks synchronized to avoid signature failures.

Credential policy is intentionally small:

- `readOnly` allows only `GET` and `HEAD`;
- `bucket` limits access to one bucket;
- otherwise the key can perform every implemented S3 action on all buckets.

There are no per-prefix policies, deny statements, conditions, source-IP restrictions, temporary credentials, STS, IAM, ACL evaluation, or action-level grants. The server prevents revoking the final S3 key to avoid an unrecoverable node, so rotate by creating a replacement before deleting an old key.

## Secret storage

`<storage-root>/.openbucket/state.json` contains S3 secret access keys and the share-signing secret in plaintext because the daemon must use those values to verify signatures. Secret values are omitted from key-list responses but remain on disk.

`<OPENBUCKET_HOME>/active.json` contains the management token for a CLI-managed daemon. The code requests restrictive file/directory modes on POSIX systems; on Windows and some filesystems, actual access is governed by inherited ACLs.

First-run S3 credentials are shown in the invoking terminal. In detached mode, the child suppresses the credential from its redirected banner, passes it temporarily through permission-restricted `active.json`, and the parent scrubs that field after printing. Protect `OPENBUCKET_HOME` because a parent crash during this handoff can leave the temporary credential. The detached log still contains paths and operational errors and should remain private, but the current handoff is designed not to append the initial secret there.

The container image sets `OPENBUCKET_SHOW_INITIAL_CREDENTIALS=false` because container stdout/stderr is normally retained. Container operators create a new workload credential through the authenticated dashboard/API or with `docker compose exec`; the new secret is shown once in that operator session. The generated bootstrap key remains protected in node state until a replacement exists and the operator revokes it.

## Quick Tunnel boundary

`--tunnel` starts real `cloudflared` Quick Tunnel subprocesses for S3 and management and, when needed, the local dashboard. Local listeners remain loopback-bound, while the generated `*.trycloudflare.com` origins are internet reachable over HTTPS. OpenBucket validates the generated hostname shape, never invokes a shell, supervises the child processes, and stops them with the daemon.

Quick Tunnel management requests still require the full-control bearer token, passed to the dashboard in a URL fragment and removed immediately. This is suitable for a controlled demo, not a production authorization boundary: anyone who obtains that token can create/delete buckets and objects, issue/revoke S3 keys, read logs, and stop the node. Quick Tunnel URLs are random, not access control. For production, use a named tunnel or proxy with an independent identity/access policy, rate limits, monitoring, and deliberate origin allow-listing.

Recommended controls:

- use a dedicated encrypted volume;
- restrict owner/group ACLs on the root and state directory;
- exclude both from casual desktop search, sync, and support bundles;
- encrypt backups and control their retention;
- create workload keys, then avoid distributing the initial all-bucket key;
- revoke exposed keys immediately after a replacement exists.

## Public buckets

Setting a bucket `public` permits anonymous `GET` and `HEAD` only when the request supplies both bucket and exact object key. Anonymous bucket listing, upload, copy, and deletion remain denied.

Public is not an ACL system. Anyone who guesses or learns an object URL can read it. Object names often leak through shared pages, referrers, proxy logs, or application output. Use private buckets plus share links when access should expire.

## Share links

A share link has this form:

```text
<files-root>/files/<bucket>/<key>?expires=<unix-seconds>&token=<hmac>
```

The HMAC is bound to bucket, key, and expiry and compared in constant time. The management API permits expiry from 1 to 604800 seconds (seven days). `/files` supports `GET`, `HEAD`, and byte ranges.

Security properties and limits:

- it is a bearer URL: forwarding it grants access until expiry;
- revoking a single link before expiry is not supported;
- changing/deleting the object stops useful access; rotating the node share secret invalidates every link but has no supported CLI workflow;
- OpenBucket request logs redact `token`, but browsers, reverse proxies, analytics, and upstream services may log the original URL;
- use `Referrer-Policy` and proxy log redaction at public boundaries.

## Filesystem confinement

OpenBucket validates S3-like bucket names and safe object keys. It rejects:

- `.`/`..`, empty, `.openbucket`, backslash, and NUL key segments;
- invalid percent encoding and unsafe raw URL paths;
- bucket and object paths containing existing symlinks;
- Windows reserved names/characters where applicable;
- resolved paths outside the selected bucket.

The metadata directory must be a real directory, not a symlink. Bucket directories discovered directly under the root must be real safe directories.

These checks reduce traversal risk through the API. Do not allow an untrusted local actor to mutate directories between checks or replace the filesystem underneath the process. Network filesystems with unusual symlink, rename, lock, or cache semantics need workload-specific validation.

## Network and TLS

OpenBucket serves plain HTTP. It does not create certificates, redirect HTTP to HTTPS, validate forwarded client identity, or know whether a public URL is actually routed to it.

For remote S3:

- terminate TLS at a current reverse proxy/tunnel;
- preserve the original `Host`, request path, query, method, and signed headers exactly—SigV4 depends on them;
- do not rewrite signed query parameters;
- set upload/body/time limits appropriate to the workload;
- apply connection/rate limits and abuse monitoring;
- restrict the upstream listener to the proxy or loopback;
- verify large uploads, ranges, copy, and multipart through the proxy.

Avoid proxying management publicly. If required, use a separate hostname, private access policy/VPN/mTLS, bearer token, and exact CORS origins.

`OPENBUCKET_PUBLIC_BASE_URL` only changes advertised/public and share-link roots. Cloudflare Tunnel and other proxies are external products/configuration and are not provisioned or operated by this repository.

## Logging and privacy

Request logs include timestamp, method, path, status, duration, transfer counts, remote address, user agent, service, request ID, and authenticated access-key ID. Query values named `token` and `X-Amz-Signature` are redacted case-insensitively by the daemon logger.

Logs may still reveal:

- bucket names and object keys;
- IP addresses and user-agent versions;
- access key IDs;
- traffic timing, size, and error patterns;
- paths and operational errors from the separate detached process log.

Logs are not signed, immutable, access-controlled by the daemon, or automatically rotated. Apply filesystem permissions, retention, redaction, and shipping policy appropriate to the data.

## Data protection and durability

OpenBucket provides no encryption-at-rest layer. It inherits encryption, snapshots, permissions, integrity, and redundancy from the underlying storage. It does not replicate objects or metadata.

State and object bytes must be backed up together. A live file-by-file copy can capture inconsistent state and object sets. Stop the daemon or take an atomic filesystem/storage snapshot, then verify restore on another path. Exclude a live `daemon.lock` from portable backups or ensure it has been removed by a clean stop.

MD5 ETags are useful change indicators but are not a cryptographic integrity guarantee. There is no background scrub or immutable content ledger.

## Denial of service and resource limits

Current protections are limited:

- management JSON bodies are capped at 1 MiB;
- multipart completion XML is capped at 2 MiB;
- multipart part numbers are 1-10000;
- list responses cap `max-keys` at 1000;
- management log reads cap at 1000 records;
- share and presigned expiries cap at seven days.

There is no total object-size quota, bucket quota, per-key concurrency control, request rate limit, connection limit policy, global upload budget, multipart garbage collector, or bounded log retention. A client with write access can exhaust disk. Enforce limits at the proxy/OS/storage layer and monitor capacity.

## Containers

The supplied daemon image runs as the unprivileged `node` user, marks `/data` and `/state` as volumes, and Compose uses `no-new-privileges`. The dashboard is a separate service. Compose binds host ports to `127.0.0.1` by default.

Before deployment:

- set the intentionally empty `.env.example` admin token to at least 32 random bytes;
- confirm host volume ownership permits UID/GID used in the image;
- pin and scan the built image in your registry;
- avoid mounting the Docker socket or broad host paths;
- protect Compose `.env`, which contains the management token;
- do not assume a container volume is a backup.

## Known security gaps

- No independent security audit. The release workflow creates container SBOMs and provenance attestations, but the first public release has not yet been produced or independently verified.
- A long-lived, full-control management bearer is handed to the browser for the session; no short-lived pairing or operator RBAC exists.
- Plaintext secrets in node/CLI state and one-time foreground/operator output.
- No built-in origin TLS, authentication rate limiting, IP policy, or management RBAC; Quick Tunnel TLS terminates at the provider edge and is explicitly a development mode.
- No short-lived S3 credentials or fine-grained IAM/prefix policy.
- No encrypted object layer, KMS/HSM integration, or key rotation workflow.
- No immutable audit log, log rotation, quota, or abuse controls.
- No direct artifact signatures beyond registry/GitHub OIDC provenance attestations, and no reproducible-build guarantee across independent builders.
- No per-link revocation.
- No protection from a malicious actor with storage-root write access.

These are roadmap inputs, not hidden guarantees. See [PRODUCT_PLAN.md](PRODUCT_PLAN.md).
