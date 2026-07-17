# OpenBucket Python client

`openbucket-client` is the typed, dependency-free Python client for a running
[OpenBucket](https://github.com/Razin-developer/openbucket) management API. It supports Python 3.10+
and uses only the standard library at runtime.

This package is a client, not a Python implementation of the OpenBucket daemon.
Start the OpenBucket daemon separately, then point this client at its management
URL. Object data is stored and served by that daemon.

## Install

`openbucket-client` is not on PyPI yet. Install it from a checked-out OpenBucket repository:

```bash
python -m pip install ./python
```

After the first unified `0.1.1` release is visible on PyPI:

```bash
python -m pip install openbucket-client==0.1.1
pipx install openbucket-client==0.1.1
# or
uv tool install openbucket-client==0.1.1
```

The distribution is named `openbucket-client`; the import package is
`openbucket`.

## Python API

```python
import os

from openbucket import OpenBucketClient

client = OpenBucketClient(
    os.environ.get("OPENBUCKET_API_URL", "http://127.0.0.1:7272"),
    os.environ["OPENBUCKET_ADMIN_TOKEN"],
)

print(client.status().storage.free_bytes)

bucket = client.create_bucket("project-assets")
uploaded = client.upload_file(
    bucket.name,
    "images/logo.svg",
    "logo.svg",
    content_type="image/svg+xml",
)
print(uploaded.etag)

share = client.create_share(bucket.name, uploaded.key, expires_in=3600)
print(share.url)
```

The client exposes immutable typed models and methods for:

- daemon health, status, endpoints, and client configuration;
- bucket creation, visibility, listing, and deletion;
- object listing, streaming upload, download, metadata, and deletion;
- S3 access-key creation, listing, and revocation;
- expiring share URL creation;
- request logs, analytics, and graceful daemon stop.

`upload_file()` streams from disk. `download_to()` streams to disk, uses an
exclusive create by default, and can atomically replace a destination with
`overwrite=True`. `download_object()` returns bytes and accepts `max_bytes` when
the caller needs a memory safety bound.

## Error handling

```python
from openbucket import OpenBucketHTTPError

try:
    client.create_bucket("already-present")
except OpenBucketHTTPError as error:
    print(error.status)      # 409
    print(error.code)        # BucketAlreadyExists
    print(error.request_id)  # request correlation ID, when provided
```

Transport, protocol, configuration, and HTTP failures have separate exception
types. The client does not follow redirects, preventing a management bearer
token from being forwarded to another origin.

## Command line

Set credentials in the environment so the token does not appear in shell
history or the process list:

```bash
export OPENBUCKET_API_URL=http://127.0.0.1:7272
export OPENBUCKET_ADMIN_TOKEN='replace-with-the-daemon-token'

openbucket-client status
openbucket-client buckets list
openbucket-client buckets create project-assets
openbucket-client objects upload project-assets images/logo.svg ./logo.svg
openbucket-client objects download project-assets images/logo.svg ./downloaded.svg
openbucket-client share project-assets images/logo.svg --expires-in 3600
openbucket-client --json analytics
```

Use `openbucket-client --help` for the complete command tree. `--token` exists
for automation environments that cannot inject variables, but the environment
variable is safer for interactive use.

## TLS and remote use

Use an HTTPS management URL for any connection that leaves localhost or a
trusted private network. The bearer token grants full management access. Do not
embed it in browser code, logs, container images, or source control. Python uses
the platform/default CA trust store and honors the standard proxy environment
variables.

## Development and verification

The test suite performs real loopback HTTP requests against a threaded local
HTTP server; it does not patch or mock `urllib`.

```bash
cd python
python -m unittest discover -s tests -v
python -m pip install -e '.[dev]'
ruff check .
mypy src/openbucket
python -m build
twine check dist/*
python -m pip install --force-reinstall dist/openbucket_client-0.1.0-py3-none-any.whl
openbucket-client --version
```

`tox` verifies the built wheel on every locally installed Python version from
3.10 through 3.14:

```bash
tox
```

Licensed under Apache-2.0. See [LICENSE](LICENSE).
