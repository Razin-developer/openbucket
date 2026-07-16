# Installation

OpenBucket has two separately versioned deliverables that share the same release number:

- `openbucket` is the Node.js daemon and CLI. Install this on the machine that owns the storage disk.
- `openbucket-client` is the optional Python management client. It controls a running daemon; it does not replace or embed the daemon.

Use Node.js 22.13 or newer for the daemon. Production releases are built and tested on Node.js 22 and 24.

## npm

The normal installation is a global npm package:

```bash
npm install --global openbucket
openbucket version
openbucket serve /path/to/storage
```

Pin a production deployment to an exact version:

```bash
npm install --global openbucket@0.1.0
```

For a temporary evaluation without a global install:

```bash
npx --yes openbucket@0.1.0 version
```

Use a global, version-pinned install for a long-running daemon so an npm cache cleanup cannot affect process restarts.

## GitHub release tarball

Every tagged release workflow produces the same npm tarball, a Python wheel/source archive, and `SHA256SUMS`. After the first GitHub release exists:

```bash
npm install --global \
  https://github.com/Razin-developer/openbucket/releases/download/v0.1.0/openbucket-0.1.0.tgz
```

Verify a downloaded file before installation:

```bash
grep ' openbucket-0.1.0.tgz$' SHA256SUMS | sha256sum --check -
npm install --global ./openbucket-0.1.0.tgz
```

Run `sha256sum --check SHA256SUMS` without filtering only when every release asset named in that file is present.

On PowerShell:

```powershell
Get-FileHash .\openbucket-0.1.0.tgz -Algorithm SHA256
npm install --global .\openbucket-0.1.0.tgz
```

Compare the printed digest with the corresponding `SHA256SUMS` entry.

## Installer scripts

The checked-in installers are small wrappers around npm and accept a version/package override. Review them before piping a remote script into a shell.

```bash
OPENBUCKET_INSTALL_VERSION=0.1.0 sh scripts/install.sh
```

```powershell
& .\scripts\install.ps1 -Version 0.1.0
```

Once `openbucket.dev` hosts the checksummed release assets, the documented short URLs can point to these same scripts without changing their behavior.

## Docker and Docker Compose

Tagged releases publish two multi-platform OCI images to GitHub Container Registry:

```bash
docker pull ghcr.io/razin-developer/openbucket:0.1.0
docker pull ghcr.io/razin-developer/openbucket-dashboard:0.1.0
```

Run the daemon with persistent data and state:

```bash
docker run --name openbucket --restart unless-stopped \
  -p 127.0.0.1:7272:7272 \
  -p 127.0.0.1:8333:8333 \
  -e OPENBUCKET_ADMIN_TOKEN='replace-with-at-least-32-random-bytes' \
  -v openbucket-data:/data \
  -v openbucket-state:/state \
  ghcr.io/razin-developer/openbucket:0.1.0
```

For the daemon and dashboard together, clone the repository, copy `.env.example` to `.env`, set a strong `OPENBUCKET_ADMIN_TOKEN`, and run:

```bash
docker compose up --build -d
```

Do not use floating `latest` tags in unattended production. Pin a semantic version or image digest.

## Build from source

```bash
git clone https://github.com/Razin-developer/openbucket.git
cd openbucket
git checkout v0.1.0
npm ci
npm run release:check
npm link
openbucket version
```

`npm ci` verifies the committed lockfile. Do not replace it with an unconstrained install in reproducible builds.

## Python management client

Install the management SDK from PyPI:

```bash
python -m pip install openbucket-client
```

For an isolated command installation, use either:

```bash
pipx install openbucket-client
uv tool install openbucket-client
```

Use the console client against an already running daemon:

```bash
openbucket-client --url http://127.0.0.1:7272 \
  --token "$OPENBUCKET_ADMIN_TOKEN" status
```

Or use the typed library:

```python
import os
from openbucket import OpenBucketClient

client = OpenBucketClient(
    "http://127.0.0.1:7272",
    token=os.environ["OPENBUCKET_ADMIN_TOKEN"],
)
print(client.status())
```

Use `boto3`, the AWS CLI, or another S3 client for high-volume object transfers. The Python management package is for the `/v1` control API.

## Upgrade and uninstall

```bash
npm install --global openbucket@0.2.0
npm uninstall --global openbucket
python -m pip install --upgrade openbucket-client
python -m pip uninstall openbucket-client
```

Removing a package never removes storage roots, `.openbucket` metadata, Docker volumes, or user-created service definitions. Back those up and delete them only as a separate, intentional operation.
