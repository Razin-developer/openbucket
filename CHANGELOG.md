# Changelog

## [0.1.19] - 2026-08-07

### Changed

- Removed explicit references to the admin-login environment variable names and mechanism from public docs (README, CHANGELOG, RELEASING, SECURITY, `/docs`); the deployment guide (`docs/VERCEL.md`) still documents them since a self-hoster needs the exact names to configure their own admin account.
- Rewrote both installer scripts (`install.sh`, `install.ps1`) with staged, colored progress output. They now detect a missing/too-old Node.js and attempt to install it automatically before installing the npm package and running `openbucket doctor` to verify the result.

### Fixed

- The docs "on this page" table of contents didn't scroll smoothly and could fail to jump to the right section on a hard reload of a deep link, since the target section may still be mounting in a lazily-loaded route chunk. Added smooth scrolling and a mount-time handler that retries across a few frames instead of assuming the target is already in the DOM.
- Added Previous/Next pagination links to the bottom of every docs page.

## [0.1.18] - 2026-08-07

### Fixed

- **The two biggest images on the landing page were ~1.5MB and ~1MB PNGs, served uncompressed as both the hero screenshot and the social preview image.** Re-encoded as WebP/JPEG at the sizes actually displayed: the inline dashboard screenshot is now a 39KB WebP (from 1.5MB), the hero/CTA background is an 8KB WebP (from 1MB), and the social share image is a 44KB JPEG. This was the direct cause of a 15s+ LCP on throttled mobile in a Lighthouse audit.
- The hero image had no explicit `width`/`height`, so it popped into a reserved-but-wrong-sized box as it loaded, causing layout shift. Now has explicit dimensions, `fetchpriority="high"`, and `decoding="async"`.
- Static assets (`og.jpg`, the new WebP images, favicon) had no real cache lifetime (`max-age=0` from the default header rule). Added a 30-day cache policy for them, matching the existing pattern for `og.png`.
- Three low-contrast text colors (`#9a9aab`, `#b7b7c6`, `#7a7a8a`) on the landing page and footer failed WCAG AA contrast against white; replaced with the existing `--fs-body` design-system color, which passes.
- The "Learn more" links on the six feature cards were identical, non-descriptive anchor text pointing to the same destination — flagged by Lighthouse's accessibility and SEO audits. Added a per-card `aria-label`.
- Three "Get started" buttons had identical text pointing to two different destinations (`/login` vs `/register`); all now point to `/register`, matching the primary conversion intent for a new visitor.
- `llms.txt` didn't exist (returning a page that failed the llms.txt spec's required-H1/links check); added a real one following the spec, listing every documentation page.
- Cloudflare's own auto-injected analytics beacon (`static.cloudflareinsights.com`) was blocked by this site's CSP, logging a console error on every page load. Added it to `script-src` — the beacon is unrelated to the Vercel Speed Insights this project already uses; it's automatically injected by Cloudflare's DNS-level proxy on the custom domain.

### Changed

- Code-split the SPA: previously every route's JavaScript (docs, auth, dashboard, node discovery — including the entire new 9-page docs section and full API reference) shipped in one bundle regardless of which page was requested. The home route now lazy-loads everything except the landing page itself, cutting its initial JS from ~350KB to ~230KB, with docs (55KB) and auth (71KB) only fetched when actually visited.
- Added per-route `<meta name="keywords">` and expanded Open Graph/Twitter Card metadata (image dimensions/type/alt, locale) across every page, driven by the existing dynamic title/description system.
- Added `<link rel="preconnect" href="https://api.github.com">` — the header's live star count was identified as a preconnect candidate worth ~440ms.

### Added

- A "Star OpenBucket on GitHub" button and a Buy Me a Coffee button in the footer. Deliberately the static image-link version only, not the animated script button or floating widget — both pull in extra third-party JavaScript that works directly against the performance goals in this release.

## [0.1.17] - 2026-08-06

### Changed

- **Admin access no longer lives in the database.** `role: "admin"` on a user document is now ignored entirely; admin sessions are granted through server-side environment configuration instead, with no backing MongoDB row at all. The one-time "owner bootstrap" race (first successful `/register` wins admin) is removed.
- **Self-serve registration is open by default.** `/register` no longer requires a one-time setup token; `OPENBUCKET_ALLOW_SIGNUP` now defaults to `true` (set it to `"false"` to close signup). `scripts/bootstrap-owner.mjs` is deprecated — it now prints a warning pointing at the env-based admin instead of trying to manage a signup window.
- Redesigned `/login` and `/register`: removed the decorative left-side image panel in favor of a single centered card, added a "Continue with Google" button, and a "Forgot password?" link.
- `openbucket login`'s "Continue in browser" option was a stub that opened a page and then still asked for your password in the terminal anyway. Replaced it with an honest "Do you already have an account?" choice — "No" opens `/register` in your browser and exits; "Yes" goes straight to the email/password prompt as before.

### Added

- Forgot/reset password: `/forgot-password` and `/reset-password` pages, backed by new `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` routes. Reset tokens are single-use, HMAC-hashed at rest, expire in 30 minutes, and resetting a password signs out every other session for that account. The forgot-password response is identical whether or not the account exists, to avoid leaking which emails are registered. Requires `OPENBUCKET_SMTP_HOST`/`_PORT`/`_USER`/`_PASS`/`_FROM` to actually send email; without them the request still succeeds but logs that SMTP isn't configured.
- Optional Google sign-in via a hand-rolled OAuth 2.0 authorization-code + PKCE flow (`GET /api/auth/google/start`, `GET /api/auth/google/callback`) — no framework dependency, since this is a Vite SPA with a custom Vercel Functions router, not Next.js. Configured through `OPENBUCKET_GOOGLE_CLIENT_ID`/`OPENBUCKET_GOOGLE_CLIENT_SECRET`; the button only renders once both are set. Google accounts auto-link to an existing password account with the same verified email.
- The interactive console (`openbucket`) now has an **Account** screen: sign in or out of the hosted dashboard without leaving the TUI, using the same session file the `login`/`logout`/`whoami` commands read.

### Fixed

- `mongodb`-only fields (`role`, `authControls`) are removed from the auth schema; `sessions.userId` is now nullable to represent the environment-configured admin's session, which has no user document to point at.

## [0.1.16] - 2026-08-05

### Fixed

- Fixed a real mobile layout bug on the landing page: the "Connect Anything" integration diagram (`.fs-node-row`) was a non-wrapping flex row of five fixed-width icon nodes that didn't fit inside a phone-width viewport, forcing the entire page ~77px wider than the screen and leaving blank space on the right of every section. On small screens the row now wraps, the connecting line is hidden, and the icon nodes shrink to fit.

### Added

- `/dashboard` (including the admin view, which renders inside the same gate) now requires a viewport at least 900px wide. Below that, it shows a "larger screen is required" message instead of loading the control plane — the session/account fetch is skipped entirely on small screens rather than loading data nobody can use. The public landing and docs pages remain fully available on mobile.
- The site header's "Product" and "Docs" links are now hover/focus-triggered mega-menus: "Product" links to the landing page's own sections (Overview, Why OpenBucket, Features, Connect anything, Deployment — new anchors added to those sections), and a new "Resources" menu links to documentation sections (Installation, Docker, Production), the dashboard, and GitHub Releases. Built with plain CSS `:hover`/`:focus-within`, matching this project's existing hand-written-CSS convention rather than introducing a component library.

## [0.1.15] - 2026-08-05

### Removed

- Dropped the `ink-spinner` dependency — added earlier alongside `ink` for the interactive console but never actually imported anywhere.
- Removed two stray empty local directories (`tmpbf2zkl9l`, `tsx-razin`) left over from earlier tooling; never tracked in git.

### Audit notes

Went through the tracked source tree (136 files) and dependency list looking for dead code, orphaned files, and accidentally-committed build artifacts. The repo was already lean: no committed `node_modules`/`.venv`/build output, no orphaned source files, no duplicate/unused example or doc files. The one file that looked like it might be stray — `.openai/hosting.json` — is actually required by `scripts/verify-release.mjs`'s release checklist and was left in place.

## [0.1.14] - 2026-08-05

### Added

- Vercel Speed Insights wired into the hosted app (`<SpeedInsights />` from `@vercel/speed-insights/react`, mounted alongside the app root — this is a Vite SPA, not Next.js, so the `/react` entry point is used rather than `/next`).
- Landing page animations: staggered scroll-reveal for card grids and list items (was previously dead code — the `.reveal` class was never actually applied to any section), a hero entrance sequence (badge → headline → body → CTAs → screenshot cascade in on load), a subtle scroll parallax on the hero product screenshot, an SVG "plotter" line-draw animation for the "Connect Anything" diagram (the connecting line draws itself in via `stroke-dashoffset` when scrolled into view), and card hover-lift transitions. All respect `prefers-reduced-motion`.
- The header nav is now session-aware: shows "Sign in" + "Get started" when signed out, or a single "Dashboard" button when a valid session exists (checks `/api/auth/session` on mount), instead of always showing both regardless of auth state.

### Changed

- Scaled up the header to match the rest of the landing page: 64px → 84px tall, brand mark 27px → 32px, nav links 13px → 15px.

### Fixed

- Fixed a real, unrelated CI regression this round introduced: `@vercel/speed-insights` declares `next` as an optional peer dependency, which resolved to this repo's already-pinned `next` canary build and pulled its vulnerable transitive `postcss`/`sharp` versions into the *production* dependency audit (previously excluded since `next` was only ever a devDependency). Added `postcss`/`sharp` to `package.json` `overrides` to pin safe versions repo-wide without touching the existing `next` pin `vinext` depends on.

## [0.1.13] - 2026-08-05

### Added

- The interactive console can now start a node without leaving the TUI: when no daemon is running, the home screen leads with "Start a node" and jumps straight into a form for the storage directory and node name.
- Text fields for filesystem paths (server start directory, object upload) now support Tab-based autocomplete: press Tab to list and cycle through matching folders (or files, when uploading) in the current directory, the same way a shell completes paths.
- The Buckets → object browser can now upload a local file into the bucket (`u`), using the same Tab-autocomplete path field.

### Changed

- Scaled up the entire landing page, not just type: buttons (40px → 50px tall, 13px → 16px label), section container widths (1200px → 1360px), card padding (~28px → 36px), icon sizes throughout, and grid gaps, alongside larger headings (hero 68px, section headings 38-44px) and section padding.
- Redesigned the "Connect Anything" icon row as an actual hub-and-spoke diagram with a connecting line and labels (CLI, SDKs, OpenBucket, Infra as code, Apps) instead of a bare row of unlabeled icons.
- Confirmed Vercel's GitHub integration is deploying automatically on every commit to main (production is verified to serve the exact latest commit SHA after each merge).

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
