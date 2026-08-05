# Changelog

## [0.1.12] - 2026-08-05

### Added

- `openbucket login` now offers an arrow-key choice between "Email & password" (unchanged) and "Continue in browser" (opens the control-plane's login page for convenience), colorized with `chalk`. It also checks for an already-valid saved session first and reports it instead of prompting again.

### Changed

- Docs and README now lead with direct `openbucket <command>` usage instead of `npm run openbucket -- <command>`; the `npm ci`/`npm run build` instructions are scoped to their own "Building from source" sections for contributors, since installed users don't need Node/npm build tooling at all beyond the CLI itself.
- Reduced landing page type sizes and section padding across the board (hero headline 54px → 42px, section headings 40px → 30px) and fixed the install-steps "Copy" button, which had lost its styling in an earlier rewrite and rendered as unstyled text.

## [0.1.11] - 2026-08-05

### Fixed

- The interactive console (`openbucket`) crashed the whole process with an unhandled `CLIInactiveError` when a screen (Buckets, API keys, Logs) tried to load data while no daemon was running. Every screen now shows a "Can't reach the daemon" message with a hint to start one, instead of crashing.
- The console now renders in the terminal's alternate screen buffer (the same mechanism vim/htop/opencode use): it clears and takes over the full terminal on start and restores your previous screen on exit, instead of scrolling inline below the shell prompt.

## [0.1.10] - 2026-08-04

### Added

- A full-screen interactive console: running `openbucket` with no command (or `openbucket ui` explicitly) opens a terminal UI with live daemon status and navigable screens for buckets (list/create/delete/browse objects/share/delete), API keys (list/create/revoke), logs (live tail), tunnel/endpoint state, server status, and effective config/environment. Falls back to `openbucket help` in non-interactive contexts (scripts, CI, piped output).

## [0.1.9] - 2026-08-04

### Changed

- Rebuild the marketing landing page around a real reference layout (gradient hero with product screenshot, logo strip, split intro, "why us" grid, 3-step install, 2x3 feature grid, integration diagram, deployment-options cards, gradient CTA band, 4-column footer).
- Unify the product on a single bucket-mark logo: landing/docs/auth nav, local dashboard sidebar, hosted control-plane sidebar and empty states, replacing three divergent ad hoc marks.

### Fixed

- `scripts/install.sh` and `scripts/install.ps1` no longer hang indefinitely on a slow or broken network path: both now enforce a configurable wall-clock timeout (`--timeout`/`-TimeoutSeconds`, default 120s, or `OPENBUCKET_INSTALL_TIMEOUT`), set `NODE_OPTIONS=--dns-result-order=ipv4first`, and pass `--no-audit --no-fund --fetch-timeout --fetch-retries` to npm so a stalled connection fails fast with an actionable message instead of hanging.

## [0.1.8] - 2026-08-04

### Changed

- Redesign the marketing landing page toward an Apple-inspired system: centered hero, large tracked-negative type, pill CTAs, generous whitespace, and scroll-triggered reveals.
- Restyle the local and hosted dashboards with a Linear-inspired purple accent, flatter card chrome, and lighter shadows.
- Polish the CLI `serve` boot banner with color and clearer alignment.

## [0.1.7] - 2026-07-18

### Fixed

- Verify normalized MongoDB endpoint persistence in the required release integration suite.

## [0.1.6] - 2026-07-18

### Added

- Unify local and hosted live-node views around the same Geist, Lucide-powered node console.

### Fixed

- Normalize endpoint URLs before daemon heartbeats and browser requests, eliminating trailing-slash double-request failures.
- Keep tunnel endpoints out of saved dashboard URLs and CLI output while preserving private one-time console pairing.

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

[Unreleased]: https://github.com/Razin-developer/openbucket/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/Razin-developer/openbucket/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Razin-developer/openbucket/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Razin-developer/openbucket/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Razin-developer/openbucket/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Razin-developer/openbucket/compare/v0.1.2...v0.1.3
[0.1.1]: https://github.com/Razin-developer/openbucket/compare/822e01397c2cd53ec98c33a1bb4343c468834a34...v0.1.1
[0.1.0]: https://www.npmjs.com/package/openbucket/v/0.1.0
