# OpenBucket management API

Version: v1 (product 0.1)
Default base: `http://127.0.0.1:7272`

The management API is the control plane used by the CLI and dashboard. It is not an AWS API. It returns JSON except for raw object download responses and empty `HEAD` bodies.

The S3 data-plane contract is documented separately in [S3_COMPATIBILITY.md](S3_COMPATIBILITY.md).

## Authentication

`GET /healthz` is always unauthenticated.

Every `/v1/*` request must send:

```http
Authorization: Bearer <OPENBUCKET_ADMIN_TOKEN>
```

The dashboard sends the same bearer token. `X-OpenBucket-Client: dashboard` identifies the client but does not bypass authentication. CORS controls which browser origins can read the API; it is not authentication. `startDaemon()` generates a random token when `adminToken` is omitted or blank; programmatic callers can read the effective value from `handle.config.adminToken`.

Shell setup for examples:

```bash
export OPENBUCKET_API=http://127.0.0.1:7272
export OPENBUCKET_ADMIN_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
```

```powershell
$env:OPENBUCKET_API = "http://127.0.0.1:7272"
$env:OPENBUCKET_ADMIN_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Common response behavior

- JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.
- Every handled request receives `X-Request-Id`; S3 responses also receive `X-Amz-Request-Id`.
- JSON object request bodies are limited to 1 MiB.
- Dates are ISO-8601 UTC strings.
- Byte counts are integer bytes.
- Unknown endpoints return HTTP 404 with `NotFound`.

Error shape:

```json
{
  "error": {
    "code": "NoSuchBucket",
    "message": "Bucket 'missing' does not exist."
  },
  "requestId": "5f9..."
}
```

Known filesystem mappings include `ENOSPC` → `InsufficientStorage`/507 and `EACCES`/`EPERM` → `AccessDenied`/403. Unknown internal failures return `InternalError`/500 without the internal exception message.

## Endpoint summary

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `GET` | `/healthz` | 200 | Unauthenticated liveness/status |
| `GET` | `/v1/status` | 200 | Node, disk, object, request, endpoint status |
| `GET` | `/v1/config/client` | 200 | Client connection configuration |
| `GET` | `/v1/buckets` | 200 | Buckets with live object/byte totals |
| `POST` | `/v1/buckets` | 201 | Create bucket |
| `PATCH`, `PUT` | `/v1/buckets/{bucket}` | 200 | Change public flag |
| `DELETE` | `/v1/buckets/{bucket}` | 200 | Delete empty/forced bucket |
| `GET` | `/v1/buckets/{bucket}/objects` | 200 | List objects by prefix |
| `PUT` | `/v1/buckets/{bucket}/objects/{key}` | 201 | Upload raw object bytes |
| `GET`, `HEAD` | `/v1/buckets/{bucket}/objects/{key}` | 200 | Download/inspect object |
| `DELETE` | `/v1/buckets/{bucket}/objects/{key}` | 200 | Delete object |
| `POST` | `/v1/buckets/{bucket}/share` | 201 | Create expiring file URL |
| `GET` | `/v1/keys` | 200 | List keys without secrets |
| `POST` | `/v1/keys` | 201 | Create S3 credential |
| `DELETE` | `/v1/keys/{id}` | 200 | Revoke S3 credential |
| `GET` | `/v1/logs` | 200 | Newest request logs |
| `GET` | `/v1/analytics` | 200 | Aggregated request/storage analytics |
| `POST` | `/v1/stop` | 202 | Begin graceful daemon stop |

Path parameters must be percent-encoded per segment. Object keys may contain `/`; encode each key segment rather than encoding the entire slash-separated key as one value.

## Health

### `GET /healthz`

No authentication.

```json
{
  "ok": true,
  "status": "healthy",
  "version": "0.1.0",
  "nodeId": "d56c...",
  "uptimeSeconds": 42
}
```

This confirms daemon startup, not a writable-object round trip or backup health.

## Status and client configuration

### `GET /v1/status`

```bash
curl -fsS "$OPENBUCKET_API/v1/status" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN"
```

Response:

```json
{
  "online": true,
  "nodeId": "d56c...",
  "nodeName": "media-node",
  "version": "0.1.0",
  "storageRoot": "/srv/openbucket",
  "capacityBytes": 1000000000,
  "usedBytes": 1234,
  "filesystemUsedBytes": 100000000,
  "availableBytes": 900000000,
  "bucketCount": 1,
  "objectCount": 2,
  "requestsToday": 17,
  "uptimeSeconds": 42,
  "endpoints": {
    "management": "http://127.0.0.1:7272",
    "s3": "http://127.0.0.1:8333",
    "public": "http://127.0.0.1:8333",
    "files": "http://127.0.0.1:8333/files",
    "dashboard": "http://localhost:3000"
  },
  "node": {
    "id": "d56c...",
    "name": "media-node",
    "createdAt": "2026-07-16T00:00:00.000Z",
    "uptimeSeconds": 42
  },
  "storage": {
    "root": "/srv/openbucket",
    "buckets": 1,
    "objects": 2,
    "bytes": 1234,
    "managedBytes": 1234,
    "filesystemUsedBytes": 100000000,
    "totalBytes": 1000000000,
    "freeBytes": 900000000
  }
}
```

`usedBytes`/`managedBytes` count regular object bytes managed by OpenBucket. `filesystemUsedBytes` measures all used blocks on the underlying filesystem, so the dashboard capacity ring does not mistake OpenBucket data for total disk use. Bucket totals walk file metadata without hashing and are shared in a five-second process cache; very large namespaces can still make a cold scan expensive.

### `GET /v1/config/client`

```json
{
  "nodeId": "d56c...",
  "nodeName": "media-node",
  "managementUrl": "http://127.0.0.1:7272",
  "s3Url": "http://127.0.0.1:8333",
  "publicBaseUrl": null,
  "filesUrl": "http://127.0.0.1:8333/files",
  "dashboardUrl": "http://localhost:3000",
  "storageRoot": "/srv/openbucket"
}
```

Secrets are not included.

## Buckets

Bucket names must be 3-63 lowercase letters, digits, dots, or hyphens; cannot resemble an IPv4 address; cannot contain adjacent dots or invalid dot/hyphen edges; and cannot use the reserved `.openbucket` name.

### `GET /v1/buckets`

Response:

```json
{
  "buckets": [
    {
      "name": "project-assets",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "public": false,
      "objectCount": 2,
      "sizeBytes": 1234,
      "objects": 2,
      "bytes": 1234
    }
  ]
}
```

Both the newer (`objectCount`, `sizeBytes`) and CLI-compatible (`objects`, `bytes`) totals are returned.

### `POST /v1/buckets`

Request:

```json
{
  "name": "project-assets",
  "public": false
}
```

`public` is optional and defaults false.

```bash
curl -fsS "$OPENBUCKET_API/v1/buckets" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"project-assets","public":false}'
```

Response wraps the created bucket as `{ "bucket": ... }` with zero object/byte totals. Existing names return `BucketAlreadyExists`/409.

### `PATCH /v1/buckets/{bucket}`

`PUT` is also accepted with the same semantics.

```json
{
  "public": true
}
```

Response:

```json
{
  "bucket": {
    "name": "project-assets",
    "createdAt": "2026-07-16T00:00:00.000Z",
    "public": true
  }
}
```

Public permits anonymous S3 `GET`/`HEAD` for a known object path. It does not make listings or management public.

### `DELETE /v1/buckets/{bucket}`

An empty bucket:

```bash
curl -fsS -X DELETE "$OPENBUCKET_API/v1/buckets/project-assets" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN"
```

Response:

```json
{
  "deleted": true,
  "bucket": "project-assets"
}
```

A non-empty bucket returns `BucketNotEmpty`/409. `?force=true` recursively deletes the physical bucket directory and all object bytes:

```text
DELETE /v1/buckets/project-assets?force=true
```

## Objects through management

Object keys are 1-1024 UTF-8 bytes and safe slash-separated path segments. Backslashes, NUL, empty/`.`/`..`/`.openbucket` segments, traversal, symlinks, and unrepresentable Windows paths are rejected.

### `GET /v1/buckets/{bucket}/objects?prefix={prefix}`

Response:

```json
{
  "bucket": "project-assets",
  "prefix": "images/",
  "objects": [
    {
      "key": "images/logo.svg",
      "size": 844,
      "lastModified": "2026-07-16T00:00:00.000Z",
      "etag": "4a7d1ed414474e4033ac29ccb8653d9b",
      "url": "http://127.0.0.1:8333/project-assets/images/logo.svg"
    }
  ]
}
```

Prefix matching is lexical `startsWith`; there is no delimiter/common-prefix behavior on this endpoint.

### `PUT /v1/buckets/{bucket}/objects/{key}`

The request body is the raw object bytes, not JSON or multipart form data.

```bash
curl -fsS -X PUT \
  "$OPENBUCKET_API/v1/buckets/project-assets/objects/images/logo.svg" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -H 'Content-Type: image/svg+xml' \
  --data-binary @./logo.svg
```

Response:

```json
{
  "object": {
    "key": "images/logo.svg",
    "size": 844,
    "lastModified": "2026-07-16T00:00:00.000Z",
    "etag": "4a7d1ed414474e4033ac29ccb8653d9b"
  }
}
```

The supplied content type is not persisted. An existing key is replaced. Uploads stream through an internal temporary file and final rename.

### `GET /v1/buckets/{bucket}/objects/{key}`

Returns raw bytes with:

- `Content-Type: application/octet-stream`
- quoted `ETag`
- `Last-Modified`
- `Accept-Ranges: bytes`
- `Content-Length`

The management download route does not currently implement `Range`; use the S3/files endpoint for range requests.

### `HEAD /v1/buckets/{bucket}/objects/{key}`

Returns the same metadata headers and no body.

### `DELETE /v1/buckets/{bucket}/objects/{key}`

Response:

```json
{
  "deleted": true,
  "bucket": "project-assets",
  "key": "images/logo.svg"
}
```

Deleting an absent key is idempotent and returns `deleted: false` if the bucket exists.

## Share links

### `POST /v1/buckets/{bucket}/share`

Request:

```json
{
  "key": "images/logo.svg",
  "expiresIn": 3600
}
```

`expiresIn` defaults to 3600 and must be an integer from 1 through 604800 seconds.

Response:

```json
{
  "url": "http://127.0.0.1:8333/files/project-assets/images/logo.svg?expires=...&token=...",
  "expiresAt": "2026-07-16T01:00:00.000Z",
  "bucket": "project-assets",
  "key": "images/logo.svg"
}
```

The object must exist. The URL root uses the configured public base when present, otherwise the S3 listener. The public base is not validated for reachability.

Share URL behavior:

```text
GET|HEAD /files/{bucket}/{key}?expires=<unix>&token=<hmac>
```

It is served on the S3 listener, supports single byte ranges, and sets inline content disposition. Other methods return 405. Invalid/expired tokens return 403.

## S3 access keys

### `GET /v1/keys`

Response secrets are omitted:

```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "backup reader",
      "accessKeyId": "OB...",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "readOnly": true,
      "bucket": "project-assets"
    }
  ]
}
```

`bucket` is `null` for an all-bucket key.

### `POST /v1/keys`

Request fields are optional:

```json
{
  "name": "backup reader",
  "readOnly": true,
  "bucket": "project-assets"
}
```

- `name` defaults to `access key`.
- `readOnly` defaults false.
- `bucket` may be a bucket name or `null`/omitted for all buckets.

The response includes the secret:

```json
{
  "key": {
    "id": "uuid",
    "name": "backup reader",
    "accessKeyId": "OB...",
    "secretAccessKey": "save-this-value",
    "createdAt": "2026-07-16T00:00:00.000Z",
    "readOnly": true,
    "bucket": "project-assets"
  }
}
```

The secret is omitted from future API listings/UI display, but it remains in protected node state for SigV4 verification.

### `DELETE /v1/keys/{id}`

```json
{
  "deleted": true,
  "id": "uuid"
}
```

An unknown ID returns `NoSuchAccessKey`/404. The final remaining S3 credential cannot be deleted (`LastAccessKey`/409).

## Logs

### `GET /v1/logs?limit=100`

`limit` is bounded to 1-1000 and defaults 100. Results are newest-first.

```json
{
  "logs": [
    {
      "timestamp": "2026-07-16T00:00:00.000Z",
      "requestId": "5f9...",
      "method": "GET",
      "path": "/project-assets/images/logo.svg",
      "status": 200,
      "durationMs": 1.23,
      "bytesIn": 0,
      "bytesOut": 844,
      "ip": "127.0.0.1",
      "userAgent": "aws-sdk-js",
      "accessKeyId": "OB...",
      "service": "s3"
    }
  ]
}
```

`accessKeyId` is absent for unauthenticated requests. `service` is `management`, `s3`, or `files`.

## Analytics

### `GET /v1/analytics`

```json
{
  "requests": 100,
  "requestsToday": 25,
  "totalBytesIn": 2048,
  "totalBytesOut": 4096,
  "averageLatencyMs": 2.31,
  "errors": 3,
  "statusCodes": { "200": 90, "403": 3, "404": 7 },
  "methods": { "GET": 80, "PUT": 20 },
  "recentDaily": [
    { "date": "2026-07-16", "requests": 25, "bytesIn": 1024, "bytesOut": 2048 }
  ],
  "storage": {
    "bucketCount": 1,
    "objectCount": 2,
    "usedBytes": 1234
  }
}
```

Analytics scans the append-only request log and shares the result in a two-second process cache. `recentDaily` contains up to the latest 30 dates present in the log.

## Stop

### `POST /v1/stop`

The body is optional; the CLI sends `{}`.

Response is HTTP 202:

```json
{
  "stopping": true
}
```

The response is sent before shutdown begins. Clients should poll `/healthz` until it becomes unreachable rather than treating the 202 as completed shutdown.

## CORS

An `Origin` is allowed when it exactly matches an entry in `OPENBUCKET_ALLOWED_ORIGINS` or when `*` is configured. The CLI also adds the configured/effective dashboard origin and its localhost alias.

Allowed preflight response includes:

```text
Access-Control-Allow-Methods: GET, HEAD, PUT, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, Range,
  X-OpenBucket-Client, X-Amz-Date, X-Amz-Content-Sha256,
  X-Amz-Copy-Source, X-Amz-Security-Token
Access-Control-Max-Age: 86400
```

An unlisted preflight returns 403. For a non-preflight request, absence of an allowed CORS response header prevents a browser from exposing the result, but CORS itself is not request authentication.

## PowerShell example

```powershell
$headers = @{ Authorization = "Bearer $env:OPENBUCKET_ADMIN_TOKEN" }
$status = Invoke-RestMethod "$env:OPENBUCKET_API/v1/status" -Headers $headers
$status.storage
```

See [examples/curl/management.ps1](../examples/curl/management.ps1) and [examples/curl/management.sh](../examples/curl/management.sh) for executable flows that create, list, upload, download, and clean up real data without embedded credentials.
