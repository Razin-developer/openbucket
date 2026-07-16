# S3 compatibility

OpenBucket implements a focused, path-style subset of the Amazon S3 HTTP API. “S3-compatible” here means the operations in this matrix work with SigV4-aware clients when configured for the OpenBucket endpoint. It does not mean behavioral parity with every S3 feature or AWS service guarantee.

Product version: 0.1
Default endpoint: `http://127.0.0.1:8333`

## Client configuration

Use:

- the OpenBucket endpoint, including scheme and port;
- path-style addressing;
- any consistent lowercase region such as `auto` or `us-east-1`;
- an OpenBucket access key and secret;
- plain HTTP locally, or HTTPS supplied by your reverse proxy.

JavaScript AWS SDK v3:

```js
const s3 = new S3Client({
  endpoint: "http://127.0.0.1:8333",
  region: "auto",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.OPENBUCKET_ACCESS_KEY,
    secretAccessKey: process.env.OPENBUCKET_SECRET_KEY,
  },
});
```

boto3:

```python
s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:8333",
    region_name="auto",
    aws_access_key_id=os.environ["OPENBUCKET_ACCESS_KEY"],
    aws_secret_access_key=os.environ["OPENBUCKET_SECRET_KEY"],
)
```

AWS CLI:

```bash
AWS_DEFAULT_REGION=auto aws \
  --endpoint-url http://127.0.0.1:8333 \
  s3api list-buckets
```

Examples in this repository read credentials from the environment and upload real local files.

## Cloudflare R2 distinction

OpenBucket is a self-hosted S3-compatible endpoint, not a Cloudflare R2 storage backend or mirroring service. Clients use the same custom-endpoint and path-style configuration pattern, but this does not imply full behavioral parity with R2 or AWS S3. See [Cloudflare's R2 S3 API documentation](https://developers.cloudflare.com/r2/api/s3/) for R2's supported behavior.

The local conformance job tests clients against an OpenBucket daemon. It does not test a live R2 account; that requires operator-supplied Cloudflare credentials.

## AWS CLI conformance verification

CI pins **awscli 1.45.49** (Botocore 1.43.49) and runs **scripts/test-aws-cli-sync.mjs** against a real ephemeral OpenBucket daemon on Ubuntu. The acceptance covers:

- path-style SigV4 authentication and **aws s3 mb**;
- local-to-S3 and S3-to-local **aws s3 sync**;
- **sync --delete** removal behavior;
- a greater-than-8-MiB object that must use multipart upload and complete successfully;
- byte-for-byte SHA-256 comparison after each download; and
- recursive **aws s3 rm** followed by **aws s3 rb**.

The test uses temporary local storage and OpenBucket-issued credentials; it does not require an AWS account or contact an AWS bucket. The pinned version is a reproducible compatibility claim, not a claim that every past or future AWS CLI release is supported. Update the pin only after the same acceptance passes.

To run the check locally after installing that AWS CLI version:

    npm run build:cli
    node scripts/test-aws-cli-sync.mjs

## Authentication

| Capability | Status | Notes |
| --- | --- | --- |
| SigV4 `Authorization` header | Supported | Algorithm `AWS4-HMAC-SHA256`, service scope must be `s3` |
| SigV4 presigned query | Supported | Maximum expiry seven days |
| Signed payload SHA-256 | Supported | Concrete SHA-256 is checked while PUT/part bytes are persisted |
| `UNSIGNED-PAYLOAD` | Supported | Header/query declaration accepted |
| Header clock skew | Supported | Requests more than 15 minutes from server time are rejected |
| Temporary session credentials / STS | Not supported | No token issuance or expiry policy; `X-Amz-Security-Token` has no credential semantics |
| SigV2 | Not supported | Use SigV4 |
| AWS streaming/chunked SigV4 payload | Not supported | Markers such as `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` are rejected |
| Anonymous object read | Supported for public buckets | Exact object `GET`/`HEAD` only; no anonymous listing |

All `x-amz-*` operation headers other than the payload-hash declaration must appear in `SignedHeaders`. Canonical request verification retains duplicate query parameters and applies AWS percent encoding.

## Authorization model

An OpenBucket S3 key can be:

- read/write or read-only;
- all-bucket or scoped to one bucket.

Read-only accepts only `GET` and `HEAD`; `PUT`, `POST`, and `DELETE` are denied. A bucket-scoped key is denied when the requested bucket differs.

Current limitation: a bucket-scoped key cannot call root `ListBuckets`, because root authorization has no bucket to match. It can list/read its named bucket directly. There are no prefix/action policies, ACLs, IAM conditions, temporary credentials, or explicit deny rules.

## Bucket operations

| S3 operation | HTTP shape | Status | OpenBucket behavior |
| --- | --- | --- | --- |
| ListBuckets | `GET /` | Supported for all-bucket keys | Returns XML owner/node and buckets sorted by name |
| CreateBucket | `PUT /{bucket}` | Supported | Creates a real directory; response 200 with `Location` header |
| HeadBucket | `HEAD /{bucket}` | Supported | 200 if present/authorized |
| DeleteBucket | `DELETE /{bucket}` | Supported | Empty buckets only; response 204 |
| GetBucketLocation | `GET /{bucket}?location` | Supported | Returns an empty `LocationConstraint` |
| ListObjectsV2 | `GET /{bucket}?list-type=2...` | Basic support | See listing behavior below |
| ListObjects (v1) | `GET /{bucket}` | Not a versioned contract | Router returns the same v2-like XML; v1 marker semantics are not implemented |
| Get/Put/Delete Bucket ACL | — | Not supported | Use management API `public` flag instead |
| Bucket policy/CORS APIs | — | Not supported | Daemon CORS is process configuration, not bucket configuration |
| Versioning/lifecycle/replication | — | Not supported | Single current object only |
| Bucket tagging/website/notification | — | Not supported | No equivalent S3 API |

### Bucket naming

Names must be 3-63 characters of lowercase letters, digits, dots, and hyphens; begin/end alphanumeric; not resemble an IPv4 address; not contain adjacent dots or invalid dot/hyphen edges; and not use reserved metadata naming.

Valid top-level directories already present under the storage root are discovered as private buckets. Invalid names remain untouched and invisible.

### ListObjectsV2 behavior

Supported query inputs:

- `prefix`
- `max-keys` (clamped to 0-1000; use a positive value for usable pagination)
- `start-after`
- `continuation-token`
- `encoding-type=url`

Response fields include `Name`, `Prefix`, `KeyCount`, `MaxKeys`, `IsTruncated`, optional input/output cursor fields, optional `EncodingType`, and `Contents` with `Key`, `LastModified`, quoted `ETag`, `Size`, and `STANDARD` storage class.

Differences/limits:

- no `delimiter` or `CommonPrefixes`;
- no owner/optional attributes;
- continuation tokens are unsigned base64url-encoded last keys, not durable opaque server state;
- ordering is lexical by object key;
- listing walks the filesystem and computes MD5 for each size/mtime version the first time it is seen; unchanged ETags are cached in process, but cold scans of large buckets can still be expensive;
- objects changed directly on disk can appear immediately without API events/version history;
- requesting `max-keys=0` can report truncation without a next token; clients should use a positive page size.

## Object operations

| S3 operation | Status | Notes |
| --- | --- | --- |
| PutObject | Supported | Streams via internal temp file, verifies declared SHA-256, replaces existing key, returns quoted MD5 ETag |
| GetObject | Supported | Full object or one byte range |
| HeadObject | Supported | Same metadata headers, no body |
| DeleteObject | Supported | Idempotent 204 when bucket exists |
| CopyObject | Supported | Whole-object copy with `x-amz-copy-source` |
| DeleteObjects (batch XML) | Not supported | Send individual deletes |
| SelectObjectContent | Not supported | — |
| RestoreObject/storage tiers | Not supported | All objects are ordinary local files |

### Object keys and layout

Keys map to slash-separated filesystem paths inside a bucket. They must contain 1-1024 UTF-8 bytes. Empty, `.`, `..`, `.openbucket`, backslash, NUL, unsafe Windows, traversal, and symlink paths are rejected.

This means some S3-valid but filesystem-hostile keys are intentionally unsupported. Repeated slashes create empty segments and are rejected by storage validation even though canonical signing preserves them.

### Object headers and metadata

Responses include:

- `Content-Type: application/octet-stream`
- quoted `ETag` (MD5 of current whole-file bytes)
- `Last-Modified`
- `Accept-Ranges: bytes`
- `Content-Length`
- `Content-Range` for partial responses

Not persisted/implemented:

- request `Content-Type`;
- `Content-Disposition`, cache control, content encoding/language;
- custom `x-amz-meta-*` fields;
- tags;
- checksums beyond request payload SHA-256 verification and MD5 ETag;
- storage class semantics;
- server-side encryption/KMS;
- object ownership/ACL;
- legal hold/Object Lock.

Clients must not rely on metadata round-tripping.

### Ranges

One `Range: bytes=...` form is supported, including:

- `bytes=6-10`
- `bytes=6-`
- `bytes=-5`

Valid ranges return 206. Invalid/unsatisfiable/multiple ranges return `InvalidRange`/416 with `Content-Range: bytes */<size>`. Multipart `multipart/byteranges` responses are not supported.

### Conditional operations

`If-Match`, `If-None-Match`, `If-Modified-Since`, and `If-Unmodified-Since` are not implemented as preconditions. Do not use OpenBucket for compare-and-swap or cache-validation correctness; unsupported conditional headers may be ignored instead of rejected.

### CopyObject

`x-amz-copy-source: /source-bucket/source/key` copies the entire current object. Bucket-scoped credentials must also be allowed to read the source bucket. The response contains `LastModified` and quoted ETag.

Not supported:

- range copy;
- UploadPartCopy;
- metadata/tagging directives;
- source version IDs;
- copy preconditions;
- cross-node/remote source.

## Multipart upload

| S3 operation | HTTP shape | Status |
| --- | --- | --- |
| CreateMultipartUpload | `POST /bucket/key?uploads` | Supported |
| UploadPart | `PUT ...?partNumber=N&uploadId=...` | Supported |
| CompleteMultipartUpload | `POST ...?uploadId=...` | Supported |
| AbortMultipartUpload | `DELETE ...?uploadId=...` | Supported |
| ListParts | — | Not supported |
| ListMultipartUploads | — | Not supported |
| UploadPartCopy | — | Not supported |

Details:

- part numbers must be 1-10000;
- uploaded parts and MD5s are stored under `.openbucket/multipart/<upload-id>`;
- completion body is capped at 2 MiB and parsed for part number/ETag pairs;
- requested parts are sorted by part number before concatenation;
- at least one part is required and supplied ETags are checked;
- AWS minimum non-final part size is not enforced;
- duplicate/out-of-order policy is not AWS-identical;
- completion streams parts into the normal object PUT path;
- final ETag is MD5 of the complete object, not AWS's `<multipart-md5>-<part-count>` format;
- successful complete or abort removes that upload directory;
- no automatic expiry/garbage collection exists for abandoned uploads.

Clients requiring list/resume APIs or AWS multipart ETag interpretation are not compatible yet.

## Presigned URLs versus OpenBucket share links

### S3 presigned URL

This is standard SigV4 query authentication generated by an S3 SDK/client. It can authorize a supported S3 operation subject to the credential policy and a maximum seven-day expiry.

### OpenBucket share link

This is created through `openbucket share` or the management API. It uses an OpenBucket HMAC and the `/files` route:

```text
/files/<bucket>/<key>?expires=<unix>&token=<hmac>
```

It supports browser-friendly `GET`/`HEAD`, inline content disposition, and ranges. It is not an S3 presigned URL and is not generated by AWS SDKs. Both URL types are bearer credentials.

## Error format

S3 failures use XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>NoSuchKey</Code>
  <Message>Object 'missing.txt' does not exist.</Message>
  <Resource>/bucket/missing.txt</Resource>
  <RequestId>...</RequestId>
</Error>
```

Common codes include:

| Code | Typical status | Meaning |
| --- | --- | --- |
| `AccessDenied` | 403 | Missing auth, public operation not allowed, policy mismatch, expired presign/share |
| `InvalidAccessKeyId` | 403 | Unknown S3 access key |
| `SignatureDoesNotMatch` | 403 | Canonical request/secret mismatch |
| `RequestTimeTooSkewed` | 403 | Header/presigned request time invalid |
| `AuthorizationHeaderMalformed` | 400 | Scope, signed headers, or authorization syntax invalid |
| `XAmzContentSHA256Mismatch` | 400 | Persisted bytes differ from declared hash |
| `InvalidBucketName` | 400 | Unsafe/invalid bucket name |
| `InvalidObjectName` / `InvalidURI` | 400 | Unsafe/invalid key/path |
| `NoSuchBucket` | 404 | Bucket absent after successful authorization |
| `NoSuchKey` | 404 | Object absent |
| `BucketAlreadyExists` | 409 | Local bucket exists |
| `BucketNotEmpty` | 409 | Delete requires an empty bucket |
| `NoSuchUpload` | 404 | Multipart upload absent/mismatched/aborted |
| `InvalidPart` | 400 | Part number/data/ETag problem |
| `InvalidRange` | 416 | Range cannot be served |
| `InsufficientStorage` | 507 | Underlying disk reports full |
| `MethodNotAllowed` | 405 | Operation outside implemented surface |

Error XML is S3-shaped but error selection/text is not guaranteed to match AWS in every edge case.

## CORS

The S3 listener uses the daemon-wide exact origin list, not S3 bucket CORS documents. Preflight supports the fixed methods/headers documented in [API.md](API.md#cors). This is sufficient for the OpenBucket dashboard and selected browser clients but not a full S3 CORS configuration API.

## Public/proxy compatibility

`--tunnel` supervises a real Cloudflare Quick Tunnel and replaces the advertised public/share root with its temporary HTTPS origin. Outside that mode, `OPENBUCKET_PUBLIC_BASE_URL` changes advertised roots only and a separately operated route must forward to the S3 listener. Every proxy/tunnel must preserve SigV4-significant host/path/query/headers. Virtual-host bucket routing is not recognized, so use:

```text
https://storage.example.com/bucket/key
```

not:

```text
https://bucket.storage.example.com/key
```

## Explicitly unsupported feature groups

- Virtual-hosted-style bucket addressing and S3 Accelerate
- SigV2, STS, IAM, temporary/session credentials
- Bucket/object ACL and policy evaluation
- Versioning, delete markers, lifecycle, replication
- Website hosting, notifications/events, inventory, analytics APIs
- Object tags, custom metadata, retention, legal holds
- SSE-S3, SSE-KMS, SSE-C, client-side encryption management
- Glacier/storage classes and restore
- Multi-delete, batch, Select, Object Lambda
- Conditional writes/reads and multipart range responses
- Checksums API, AWS multipart ETags, chunked streaming SigV4
- Cluster consistency, cross-region behavior, AWS durability/availability semantics

## Verification policy

The repository's current integration tests exercise signed bucket/object CRUD, payload mismatch, range behavior, copy, basic listing, multipart complete/abort, public reads, bucket-scoped/read-only keys, presigned authentication, expiry/skew, and traversal/symlink confinement using temporary real directories and ephemeral ports.

Before adopting a client or workload, run its own integration suite against the OpenBucket version and proxy topology you will deploy. Compatibility claims should be tied to a tested version, operation list, and object-size/concurrency profile.
