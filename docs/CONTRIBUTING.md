# Contributing to OpenBucket

OpenBucket welcomes fixes, compatibility tests, documentation, operations feedback, and carefully scoped features. The project is early: correctness, recoverability, and an honest compatibility contract matter more than surface area.

By intentionally submitting a contribution, you agree it can be included under the repository's Apache License 2.0. Do not contribute code or assets you do not have the right to license.

## Before starting

For a defect, provide:

- OpenBucket version/commit;
- Node.js version, OS, filesystem/mount type, and client version;
- exact operation and endpoint topology (direct or proxy);
- expected and observed behavior;
- stable HTTP/S3 error code and request ID when available;
- a minimal reproduction against disposable data.

For a feature, state:

- user and job;
- proposed command/API/S3 behavior;
- on-disk and migration impact;
- security/trust impact;
- failure/recovery behavior;
- tests and documentation required;
- which existing limitation it resolves.

Do not open a public issue containing credentials, state files, share URLs, private object names, or exploitable vulnerability details. Follow [SECURITY.md](SECURITY.md#report-a-vulnerability).

## Development setup

Requirements:

- Node.js 22.13+;
- npm using the committed lockfile;
- Git;
- free local ports if running the product defaults.

```bash
git clone <repository-url>
cd openbucket
npm ci
npm run build
npm test
```

The repository URL is intentionally not invented here; use the official source location for the release you are contributing to.

## Repository map

```text
app/                     dashboard UI and styling
src/cli/                 CLI parsing, lifecycle, management client
src/dashboard/           embedded production-dashboard server
src/daemon/              management/S3 routers, auth, disk store
tests/cli/               CLI parsing/behavior tests
tests/daemon/            disk, API, SigV4, traversal integration tests
tests/*.test.mjs          rendered-dashboard/server tests
docs/                    product, architecture, API, security, operations
examples/                SDK and management examples
scripts/                 install and local development helpers
Dockerfile               daemon and dashboard build targets
docker-compose.yml       two-service local deployment
```

Generated directories such as `dist`, `.vinext`, `.wrangler`, coverage, temp data, and installed dependencies must not be committed unless a release process explicitly requires an artifact.

## Common commands

```bash
npm run dev                  # dashboard development server
npm run dev:daemon           # foreground source daemon on ./.openbucket-data
npm run openbucket -- help   # run source CLI through tsx

npm run build:web            # vinext production client/server bundle
npm run build:cli            # compile all src/**/*.ts to dist
npm run build                # web first, then CLI; required release shape
npm run type-check           # web + Node TypeScript checks
npm run lint                 # ESLint excluding generated output
npm run test:unit            # compile CLI and run daemon/CLI tests
npm run test:web             # full build + rendered/embedded server tests
npm test                     # unit then web verification
npm pack                     # build and inspect the publishable package
```

Use `npm run build`, not an arbitrary reversed build sequence, when validating packaging. The web and compiled Node outputs intentionally coexist under `dist`.

The helper scripts start a detached development daemon plus a foreground dashboard dev server and stop the daemon on normal exit:

```bash
sh scripts/dev.sh
```

```powershell
& ./scripts/dev.ps1
```

## Test principles

### Use real behavior

Tests should use temporary real directories, ephemeral ports (`0`), actual HTTP requests, and byte comparisons where practical. Avoid replacing the storage/data path with mock responses when the behavior under test is filesystem, HTTP, signing, or persistence.

UI display tests can isolate formatting/normalization, but product claims and end-to-end flows must be backed by live daemon responses.

### Leave the machine clean

- Create test roots under the OS temp directory.
- Register cleanup before assertions that can fail.
- Stop every daemon/server.
- Avoid fixed ports in parallel tests.
- Never use a developer's real OpenBucket root or home state.
- Do not rely on external cloud accounts or network services.

### Match risk with coverage

Changes to these areas require focused regression tests:

| Area | Minimum evidence |
| --- | --- |
| Key/path validation | positive + encoded traversal + platform edge cases; no outside-root write |
| Store/state | first start, restart, atomic failure behavior, lock lifecycle, real bytes |
| SigV4 | accepted canonical request plus tamper, expiry/skew, malformed auth, payload mismatch |
| S3 operation | signed request, XML/headers/body, error case, policy/public interaction |
| Management API | auth/CORS, request validation, persisted effect, structured error |
| CLI | parser/precedence, output or API request, exit code, inactive failure |
| Embedded dashboard | missing build/failure behavior, port behavior, HTTP render, shutdown |
| Dashboard UI | real response normalization, empty/error/loading state, accessible control |
| Packaging | clean build, package contents/bin execution, container target/health where changed |

### Compatibility changes

An S3 compatibility change must update:

- implementation and integration tests;
- [S3_COMPATIBILITY.md](S3_COMPATIBILITY.md);
- management/API docs if control behavior changes;
- client examples if configuration changes;
- release notes/changelog once the project has one.

Do not label an operation “supported” solely because one happy-path request returned 2xx. Include authentication, persistence, headers/XML, restart, error, and relevant policy behavior.

## Code guidelines

- Keep TypeScript strict and Node ESM-compatible.
- Prefer Node built-ins in the daemon core; justify new runtime dependencies by operational/security value.
- Keep routers thin and store/auth behavior independently testable.
- Preserve structured stable error codes; do not leak internal paths/secrets in generic 500 responses.
- Validate before filesystem access and maintain root confinement through every decode/resolve step.
- Stream object data rather than buffering it, except where a documented bounded body is necessary.
- Serialize metadata/log mutations and use crash-aware atomic write patterns.
- Keep management JSON and S3 XML/byte semantics separate.
- Keep dashboard data live; do not ship invented capacity, request, bucket, or object metrics.
- Maintain loopback/private defaults and make exposure explicit.
- Avoid hard-coding `openbucket.dev` infrastructure behavior. Brand/display strings may be OpenBucket; deployment origins must remain configurable.

Format should follow the surrounding code. Run lint and type checks rather than adding a second formatter without a project decision.

## On-disk changes and migrations

`state.json` is currently schema version 1 and there is no migration framework. Any proposed schema change must include, before merge:

- a versioning/migration design;
- forward migration from every supported prior version;
- atomic failure/rollback behavior;
- corrupt/partial state tests;
- backup and downgrade guidance;
- redaction/security review for new fields;
- updated [ARCHITECTURE.md](ARCHITECTURE.md) and [OPERATIONS.md](OPERATIONS.md).

Never silently discard or replace an unrecognized state file. User data and credential continuity take precedence over automatic startup.

## Security checklist for changes

- Does this expand a listen address, origin, proxy, or public route?
- Can a browser/non-browser spoof the new trust signal?
- Is a secret placed in URL, log, UI, environment, state, or error output?
- Are comparisons and token expiries safe?
- Is every decoded path segment validated after decoding?
- Can a symlink/race escape the root?
- Is request/body/concurrency/disk use bounded?
- Does read-only/bucket scope apply to the new operation and every source/destination?
- Are proxy and direct behavior equivalent for SigV4?
- Does backup/restore need the new state?
- Does the change create a remote dependency for local operation?

Update [SECURITY.md](SECURITY.md) whenever a trust boundary, credential, public behavior, or known gap changes.

## Documentation style

- Describe current behavior in present tense and future work as a plan.
- Do not claim that npm packages, domains, tunnels, relays, certificates, signed images, or hosted services exist until they are verifiably released.
- Give commands that operate on disposable example paths and environment-provided secrets.
- Mark destructive commands such as forced bucket deletion.
- State relevant defaults, precedence, response/error behavior, and limitations.
- Keep README quickstart concise; put the full contract in `docs/`.
- Verify links, code fences, JSON/YAML syntax, and environment-variable coverage.

## Pull request scope

Prefer one coherent behavior change. A complete pull request normally contains:

- problem and user impact;
- implementation summary;
- security/on-disk/API compatibility assessment;
- tests and commands run;
- documentation changes;
- screenshots only when visual behavior changed;
- remaining limitations/follow-up work.

Do not bundle unrelated cleanup with a security or storage correctness fix. Avoid generated artifact churn. Preserve user changes in a dirty worktree.

## Commit messages

Use concise imperative subjects that explain the outcome, for example:

```text
Reject symlinked multipart targets
Add ListObjectsV2 delimiter coverage
Document management token rotation
```

If a change is breaking, name the affected CLI/API/on-disk/S3 behavior explicitly in the commit and release notes.

## Release readiness

A release candidate should pass from a clean checkout:

```bash
npm ci
npm run build
npm run type-check
npm run lint
npm test
npm pack --dry-run
```

It should also be manually smoke-tested for:

- package/global bin startup and first credentials;
- foreground and detached stop/restart;
- embedded dashboard and two-service Compose;
- real SDK upload/download and restart persistence;
- backup/restore of a disposable root;
- upgrade from the previous supported version;
- secret redaction in artifacts/logs/support output.

Publishing npm packages, images, checksums, signatures, SBOMs, provenance, domains, or installers is a separate authorized release action. Repository readiness does not imply those external releases have happened.
