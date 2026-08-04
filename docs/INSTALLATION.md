# Installation

OpenBucket has two separately versioned deliverables that share the same release number:

- `openbucket` is the Node.js daemon and CLI. Install this on the machine that owns the storage disk.
- `openbucket-client` is the optional Python management client. It controls a running daemon; it does not replace or embed the daemon.

Use Node.js 22.13 or newer for the daemon. Production releases are built and tested on Node.js 22 and 24.

Publication status: release `0.1.3` is published through trusted GitHub Actions to npm, PyPI, GHCR, and GitHub Releases. Pin exact versions in production.

## npm

The normal installation is a global npm package:

```bash
npm install --global openbucket@0.1.3
openbucket version
openbucket login --email you@example.com
openbucket serve /path/to/storage --name my-node
```

`login` uses a hidden password prompt. Override the hosted origin with `--control-plane-url` or `OPENBUCKET_CONTROL_PLANE_URL`.

Pin a production deployment to an exact version:

```bash
npm install --global openbucket@0.1.3
```

For a temporary evaluation without a global install:

```bash
npx --yes openbucket@0.1.3 version
```

Use a global, version-pinned install for a long-running daemon so an npm cache cleanup cannot affect process restarts.

## Run the daemon and dashboards

For an account-connected installation:

```bash
openbucket login --email you@example.com
openbucket serve /absolute/path/to/storage --name my-node --detach --no-open
openbucket dashboard
openbucket status
```

`serve` registers the node and reports heartbeat, storage, request counters, and separate S3/management endpoint state. Without `OPENBUCKET_PUBLIC_BASE_URL`, it starts supervised Quick Tunnels for both services. Those endpoints are development/preview only. The hosted `/dashboard/nodes/<node>` console obtains a five-minute node-scoped capability; `openbucket dashboard` opens the already-paired loopback console.

For standalone local development only:

```bash
openbucket serve /absolute/path/to/storage --name dev-node --offline
```

`--offline` (or `OPENBUCKET_OFFLINE=true`) disables account requirements, registration, metering, discovery, and automatic tunneling.

For a long-running production host, run foreground mode under an OS service manager or container restart policy:

```bash
export OPENBUCKET_ADMIN_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
export OPENBUCKET_HOME=/var/lib/openbucket/state
export OPENBUCKET_PUBLIC_BASE_URL=https://s3.example.com
openbucket doctor /srv/openbucket
openbucket login --email owner@example.com
openbucket serve /srv/openbucket --name production-node --no-tunnel --no-open
```

Route the stable origin to the S3 listener first; the variable does not provision DNS, TLS, or a proxy. Use a dedicated non-root account, protect token/environment and CLI credential files, configure graceful `SIGTERM`, rotate logs externally, and back up the entire storage root including `.openbucket`. See [Operating OpenBucket](OPERATIONS.md).

## GitHub release tarball

The unified tag workflow publishes the npm tarball, Python wheel/source archive, and `SHA256SUMS`. For `v0.1.3`:

```bash
npm install --global \
  https://github.com/Razin-developer/openbucket/releases/download/v0.1.3/openbucket-0.1.3.tgz
```

Verify a downloaded file before installation:

```bash
grep ' openbucket-0.1.3.tgz$' SHA256SUMS | sha256sum --check -
npm install --global ./openbucket-0.1.3.tgz
```

On PowerShell:

```powershell
Get-FileHash .\openbucket-0.1.3.tgz -Algorithm SHA256
npm install --global .\openbucket-0.1.3.tgz
```

Compare the printed digest with the corresponding `SHA256SUMS` entry. Run `sha256sum --check SHA256SUMS` without filtering only when every asset named in that file is present.

## Installer scripts

The published installers are small wrappers around npm and accept a version/package override. Download and review the script before running it:

```bash
curl -fsSLo openbucket-install.sh https://openbucket-eight.vercel.app/install.sh
OPENBUCKET_INSTALL_VERSION=0.1.3 sh ./openbucket-install.sh
```

```powershell
Invoke-WebRequest https://openbucket-eight.vercel.app/install.ps1 -OutFile openbucket-install.ps1
& .\openbucket-install.ps1 -Version 0.1.3
```

From a source checkout, run `sh scripts/install.sh --version 0.1.3` or `& .\scripts\install.ps1 -Version 0.1.3`. Both scripts install the npm package only; they do not register a service, modify the firewall, or expose the daemon.

## Docker and Docker Compose

The release also publishes daemon and dashboard images to GHCR. Pull pinned images:

```bash
git clone https://github.com/Razin-developer/openbucket.git
cd openbucket
cp .env.example .env
# Set a random OPENBUCKET_ADMIN_TOKEN with at least 32 bytes in .env.
# Keep OPENBUCKET_TUNNEL=false unless this image deliberately includes cloudflared.
docker compose build daemon
docker compose run --rm daemon login --email owner@example.com
docker compose up --build -d
docker compose ps
```

`docker compose run --rm` mounts the same declared `openbucket-state` volume at `/state`; the hidden-password login survives removal of the one-off container and the daemon later stores its node credential there. Compose keeps object bytes in `openbucket-data`, binds host ports to loopback, and runs separate daemon/dashboard services. Set `OPENBUCKET_STORAGE_MOUNT` for a host directory. Configure `OPENBUCKET_PUBLIC_BASE_URL` only after a managed route exists. The standard image does not include `cloudflared`, and Quick Tunnel is development-only even in a custom image that adds it.

```bash
docker pull ghcr.io/razin-developer/openbucket:0.1.3
docker pull ghcr.io/razin-developer/openbucket-dashboard:0.1.3
```

Use those commands only after the release exists. Do not use floating tags in unattended production; pin a semantic version or image digest.

## Build from source

Clone and pin the reviewed commit you intend to operate. Commit `822e01397c2cd53ec98c33a1bb4343c468834a34` is the source recorded in the npm `0.1.0` metadata:

```bash
git clone https://github.com/Razin-developer/openbucket.git
cd openbucket
git checkout 822e01397c2cd53ec98c33a1bb4343c468834a34
npm ci
npm run release:check
npm link
openbucket version
```

`npm ci` verifies the committed lockfile. Do not replace it with an unconstrained install in reproducible builds. Use a newer reviewed commit when you need the hosted landing/auth/docs work added after the npm `0.1.0` snapshot.

## Python management client

Install the Python management client from PyPI or a source checkout:

```bash
python -m pip install ./python
```

After the first unified release is visible on PyPI, use a pinned registry install or an isolated tool installation:

```bash
python -m pip install openbucket-client==0.1.3
pipx install openbucket-client==0.1.3
# or
uv tool install openbucket-client==0.1.3
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
