# Changelog

All notable changes to OpenBucket are documented here. Published artifacts follow Semantic Versioning.

## [Unreleased]

### Added

- Branded public landing and documentation routes for the Vercel application.
- MongoDB-backed hosted account sessions protecting `/dashboard`, without changing the account-free local dashboard.
- Version-pinnable POSIX and PowerShell installer assets on the current Vercel domain.

## [0.1.0] - 2026-07-16

`openbucket@0.1.0` was published manually to npm from commit `822e01397c2cd53ec98c33a1bb4343c468834a34`. It predates the configured npm trusted publisher and therefore has no trusted-publishing provenance attestation. PyPI, GHCR, and GitHub release artifacts were not published for this version; the first unified trusted release is planned as `0.1.1`.

### Added

- Real-disk OpenBucket daemon with management and S3-compatible APIs.
- Ollama-style CLI, detached lifecycle, dashboard pairing, scoped keys, share links, logs, and analytics.
- Local, Docker, Compose, Cloudflare Quick Tunnel, Sites, and Vercel dashboard deployment targets.
- Live dashboard without mock storage data.
- npm, PyPI, GHCR, GitHub release, CI, security scanning, and trusted-publishing automation.
- Typed Python management client packaged separately as `openbucket-client`.

[Unreleased]: https://github.com/Razin-developer/openbucket/compare/822e01397c2cd53ec98c33a1bb4343c468834a34...HEAD
[0.1.0]: https://www.npmjs.com/package/openbucket/v/0.1.0
