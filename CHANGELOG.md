# Changelog

## [0.1.5] - 2026-07-18

### Fixed

- Make hosted live-node routing pass the production React lint gate while remounting a console safely when its selected node changes.
- Remove the remaining transient management address from the local dashboard UI and its status example.

## [0.1.4] - 2026-07-18

- Repair hosted live-node authentication by binding short-lived console capabilities to the hosted node identity.
- Upgrade existing node credentials automatically when the hosted-console secret is absent.
- Prompt interactively for a node name and show OpenBucket node URLs instead of connector transport URLs.

## [0.1.3] - 2026-07-18

- Add secure per-node hosted console connections and persisted S3/management tunnel state.
- Add public user/node discovery routes and owner-only node console routing.
- Add interactive tunnel status, setup guidance, and connector update commands.
- Correct the browser-route regression test for handle-aware public node discovery.

All notable changes to OpenBucket are documented here. Published artifacts follow Semantic Versioning.

## [Unreleased]

## [0.1.1] - 2026-07-17

### Added

- Branded public landing and documentation routes for the Vercel application.
- CLI `login`, `logout`, and `whoami` commands with account-gated production `serve`.
- MongoDB-backed account nodes, heartbeat/storage state, idempotent usage metering, and admin-only aggregates.
- Public `/<node-name>` discovery metadata and future `s3.<node>.openbucket.dev` naming.
- S3-only automatic Cloudflare Quick Tunnel mode for authenticated development/preview nodes.
- Real-data hosted dashboard views for registered nodes, usage, account identity, and administrators.
- A guarded one-command owner bootstrap helper that opens and closes the Vercel registration window.
- Version-pinnable POSIX and PowerShell installer assets on the current Vercel domain.

### Security

- Owner creation, its initial session, and the consumed bootstrap claim commit in one MongoDB transaction.
- Node credentials are returned once, HMAC-hashed in MongoDB, scoped to heartbeat reporting, and rotatable/revocable.
- Stale or regressing daemon runs are rejected so usage totals cannot be inflated by alternating heartbeats.
- Account-connected tunnels expose S3 only; management and S3 credentials remain on the node.

## [0.1.0] - 2026-07-16

`openbucket@0.1.0` was published manually to npm from commit `822e01397c2cd53ec98c33a1bb4343c468834a34`. It predates the configured npm trusted publisher and therefore has no trusted-publishing provenance attestation. PyPI, GHCR, and GitHub release artifacts were not published for this version; the first unified trusted release is planned as `0.1.1`.

### Added

- Real-disk OpenBucket daemon with management and S3-compatible APIs.
- Ollama-style CLI, detached lifecycle, dashboard pairing, scoped keys, share links, logs, and analytics.
- Local, Docker, Compose, Cloudflare Quick Tunnel, Sites, and Vercel dashboard deployment targets.
- Live dashboard without mock storage data.
- npm, PyPI, GHCR, GitHub release, CI, security scanning, and trusted-publishing automation.
- Typed Python management client packaged separately as `openbucket-client`.

[Unreleased]: https://github.com/Razin-developer/openbucket/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/Razin-developer/openbucket/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Razin-developer/openbucket/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Razin-developer/openbucket/compare/v0.1.2...v0.1.3
[0.1.1]: https://github.com/Razin-developer/openbucket/compare/822e01397c2cd53ec98c33a1bb4343c468834a34...v0.1.1
[0.1.0]: https://www.npmjs.com/package/openbucket/v/0.1.0
