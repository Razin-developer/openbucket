# Release process

OpenBucket releases the Node daemon/CLI, Python management client, daemon container, dashboard container, and GitHub release assets from one `vMAJOR.MINOR.PATCH` tag.

## One-time repository setup

Create or push this repository as:

```text
https://github.com/Razin-developer/openbucket
```

The npm trusted publisher checks `package.json.repository.url`; update that field and every workflow publisher setting before using a different owner or repository name.

Protect `main`, require the CI and security checks, require pull-request review, block force pushes, and restrict creation of `v*` tags. Create GitHub environments named `npm`, `pypi`, and `production`. Add required reviewers to registry environments where appropriate; Vercel previews are managed by its direct Git integration rather than a GitHub deployment environment.

## npm trusted publishing

`openbucket@0.1.0` was published manually on July 16, 2026 from commit `822e01397c2cd53ec98c33a1bb4343c468834a34`. It is immutable and has no trusted-publishing provenance attestation. The npm trusted publisher was configured afterward, so it applies only to future versions.

For `0.1.2` and later, confirm the package's **Trusted Publisher** settings use:

- provider: GitHub Actions;
- organization/user: `Razin-developer`;
- repository: `openbucket`;
- workflow filename: `release.yml`;
- environment: `npm`;
- allowed action: `npm publish`.

Keep the workflow's `id-token: write` permission and do not create an `NPM_TOKEN`. An OIDC-capable npm CLI publishes with short-lived credentials and automatically creates provenance for a public repository/package. The workflow uses Node.js 24 and npm 12.0.1.

Never reuse a published tag: registries reject immutable versions. The next unified tag must have synchronized package versions.

## PyPI trusted publishing

The Python distribution is `openbucket-client`; its import package is `openbucket`. The project does not yet exist on PyPI.

1. Sign in to PyPI and open **Your account > Publishing**.
2. Under **Add a new pending publisher**, choose GitHub Actions.
3. Set PyPI project name to `openbucket-client`, owner to `Razin-developer`, repository to `openbucket`, workflow name to `release.yml`, and environment name to `pypi`.
4. Confirm the GitHub repository has an environment named `pypi`; add a required reviewer and tag deployment protection when the account plan supports them.
5. Keep the publish job's `id-token: write` permission and do not add a PyPI password or API token.
6. Publish through the protected `v0.1.2` tag workflow. On first successful use, PyPI creates the project and converts the pending publisher into a normal trusted publisher.

A pending publisher does not reserve the project name. Configure it immediately before the release, verify every field exactly, and use the official [pending-publisher guide](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) and [publishing guide](https://docs.pypi.org/trusted-publishers/using-a-publisher/). TestPyPI uses a separate publisher configuration.

## Vercel Git deployment

The Vercel project is connected directly to this GitHub repository. Pull requests receive previews and `main` deploys to production without Vercel credentials in GitHub. Keep `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` out of repository secrets.

The GitHub workflow verifies deployment rather than creating it: `/deployment.json` must report the exact triggering commit before the production check passes. Its default alias is `https://openbucket-eight.vercel.app`; set the non-secret repository variable `VERCEL_PRODUCTION_URL` when that alias changes. Vercel build variables belong in the Vercel project settings, and registry or daemon credentials never belong in dashboard build variables. See [Hosting the web application on Vercel](VERCEL.md).

Hosted authentication uses the server-only Vercel variables `MONGODB_URI`, `MONGODB_DATABASE`, `OPENBUCKET_AUTH_SECRET`, and `OPENBUCKET_ALLOW_SIGNUP`. They are unrelated to registry publishing and must never be copied into `NEXT_PUBLIC_*` values or GitHub release secrets.
One-time owner bootstrap additionally requires a distinct `OPENBUCKET_SIGNUP_TOKEN`; MongoDB consumes it atomically, and the raw token is never stored.

## Prepare a version

This release's unified version is `0.1.2`; existing registry versions cannot be republished.

Update every synchronized version location:

- `package.json` and `package-lock.json`
- `src/daemon/index.ts` (`OPENBUCKET_VERSION`)
- `python/pyproject.toml`
- `python/src/openbucket/__init__.py` (`__version__`)
- `python/src/openbucket/client.py` (the default `openbucket-client/<version>` user agent)

Then update [CHANGELOG.md](../CHANGELOG.md) and run:

```bash
npm ci
npm run release:check
python -m venv python/.venv
python/.venv/bin/python -m pip install --upgrade build twine
python/.venv/bin/python -m pip install -e './python[dev]'
python/.venv/bin/python -m unittest discover -s python/tests -p 'test_*.py' -v
python/.venv/bin/python -m ruff format --check --config python/pyproject.toml python
python/.venv/bin/python -m ruff check --config python/pyproject.toml python
python/.venv/bin/python -m mypy --config-file python/pyproject.toml python/src/openbucket
python/.venv/bin/python -m build --outdir python/dist python
python/.venv/bin/python -m twine check python/dist/*
```

On Windows, replace `python/.venv/bin/python` with `python\.venv\Scripts\python.exe` and let PowerShell expand `python/dist/*` for the Twine command.

Review the npm payload:

```bash
npm pack --dry-run
```

Commit the version change through a reviewed pull request.

## Publish

Create an annotated tag from the protected, green `main` commit and push it:

```bash
git tag -a v0.1.2 -m "OpenBucket v0.1.2"
git push origin v0.1.2
```

The release workflow verifies that the tag and every package version match, then:

1. builds and tests Node and Python artifacts;
2. publishes `openbucket` to npm through trusted publishing;
3. publishes `openbucket-client` to PyPI through trusted publishing;
4. publishes daemon/dashboard images with SBOMs and signed provenance attestations to GHCR;
5. creates a GitHub release with package archives and checksums.

Do not rerun only one registry job after changing source. Fix forward with a new patch version because registries do not allow replacing an existing immutable version.

## Verify and rollback

```bash
npm view openbucket@0.1.2 version dist.integrity dist.attestations
python -m pip index versions openbucket-client
docker buildx imagetools inspect ghcr.io/razin-developer/openbucket:0.1.2
```

Install into clean temporary environments and run `openbucket version` plus a real daemon health check. Confirm the Vercel production deployment separately.

If a release is unsafe, mark the npm version deprecated, yank the PyPI release when appropriate, remove mutable container tags, and publish a fixed patch. Do not delete Git tags or silently replace artifacts.
