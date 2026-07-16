# Release process

OpenBucket releases the Node daemon/CLI, Python management client, daemon container, dashboard container, and GitHub release assets from one `vMAJOR.MINOR.PATCH` tag.

## One-time repository setup

Create or push this repository as:

```text
https://github.com/Razin-developer/openbucket
```

The npm trusted publisher checks `package.json.repository.url`; update that field and every workflow publisher setting before using a different owner or repository name.

Protect `main`, require the CI and security checks, require pull-request review, block force pushes, and restrict creation of `v*` tags. Create GitHub environments named `npm`, `pypi`, `preview`, and `production`. Leave `preview` unprotected for pull-request deployments; add required reviewers to registry and production environments where appropriate.

## npm trusted publishing

1. Sign in with `npm login`. npm requires the package to exist before its trusted-publisher settings are available, so reserve the name with a disposable manual `openbucket@0.0.0` bootstrap package, then deprecate that placeholder after the real release. **Do not manually publish `0.1.0`**; registry versions are immutable and that would make the automated `v0.1.0` release fail.
2. In the package's **Trusted Publisher** settings choose GitHub Actions.
3. Set organization/user to `Razin-developer`, repository to `openbucket`, workflow filename to `release.yml`, and environment to `npm`.
4. Allow `npm publish` and keep the workflow's `id-token: write` permission.
5. After a green `v0.1.0` release, run `npm deprecate openbucket@0.0.0 "Bootstrap placeholder; install 0.1.0 or newer."`.
6. Do not create an `NPM_TOKEN` for GitHub; the release workflow uses short-lived OIDC credentials and publishes provenance automatically for a public repository/package.

Trusted publishing requires an OIDC-capable npm CLI and supported Node.js release. The workflow deliberately uses Node.js 24 and npm 12.0.1; keep both current when npm raises its minimum versions.

The unscoped `openbucket` name was available when this release configuration was written, but registry names are first-come-first-served. If it is claimed before the first publish, change the package name and installer documentation together.

Create the bootstrap package in a disposable directory outside this checkout:

```bash
mkdir openbucket-npm-bootstrap
cd openbucket-npm-bootstrap
npm init --yes
npm pkg set name=openbucket version=0.0.0 license=Apache-2.0 description="OpenBucket package-name bootstrap"
npm pkg delete scripts
npm publish --access public
```

Delete that disposable directory after publishing. Configure the trusted publisher immediately, then create the real release from this repository through the tag workflow.

## PyPI trusted publishing

The Python distribution is `openbucket-client`; its import package is `openbucket`.

1. Create a pending publisher on PyPI, or add a publisher to the existing project.
2. Set owner to `Razin-developer`, repository to `openbucket`, workflow to `release.yml`, environment to `pypi`, and project name to `openbucket-client`.
3. Keep the publish job's `id-token: write` permission.
4. Do not store a PyPI password or long-lived API token in GitHub.

Use TestPyPI for a dry run when changing package metadata. A TestPyPI publisher is separate from the production PyPI publisher.

## Vercel deployment credentials

Follow [Hosting the dashboard on Vercel](VERCEL.md), then configure the three repository secrets listed there. Vercel build variables belong in the Vercel project settings; registry or daemon credentials never belong in dashboard build variables.

## Prepare a version

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
git tag -a v0.1.0 -m "OpenBucket v0.1.0"
git push origin v0.1.0
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
npm view openbucket@0.1.0 version dist.integrity
python -m pip index versions openbucket-client
docker buildx imagetools inspect ghcr.io/razin-developer/openbucket:0.1.0
```

Install into clean temporary environments and run `openbucket version` plus a real daemon health check. Confirm the Vercel production deployment separately.

If a release is unsafe, mark the npm version deprecated, yank the PyPI release when appropriate, remove mutable container tags, and publish a fixed patch. Do not delete Git tags or silently replace artifacts.
