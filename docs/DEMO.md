# OpenBucket end-to-end demo

This demo starts the real daemon, serves the real dashboard, writes bytes through the API, verifies them on disk, creates a scoped S3 credential, uses a standard SDK, creates a share URL, inspects logs/analytics, restarts the daemon, and verifies persistence.

Nothing in the flow depends on seeded dashboard data or a hosted OpenBucket service.

## Prerequisites

- Node.js 22.13+ and npm
- curl for the POSIX flow, or PowerShell 7/Windows PowerShell for the Windows flow
- a browser for the dashboard step
- optional Python 3 for the boto3 example
- optional installed `cloudflared` for the public HTTPS variant

Run from the repository root.

## Build once

```bash
npm ci
npm run build
npm run type-check
```

The full build creates the CLI/daemon and the production dashboard bundle that `openbucket serve` can host.

## Windows PowerShell walkthrough

### 1. Create an operator token and start

```powershell
$env:OPENBUCKET_ADMIN_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
$env:OPENBUCKET_OPEN_DASHBOARD = "false"
$demoRoot = Join-Path $PWD "openbucket-demo-data"

npm run openbucket -- serve $demoRoot --detach --no-open
npm run openbucket -- dashboard
npm run openbucket -- status
```

Save the initial S3 credential printed on first start. The detached child suppresses it from the daemon log and the parent scrubs its temporary active-state handoff after printing; this demo still creates a separate scoped key below.

The expected local services are management `7272`, S3 `8333`, and dashboard `3000`. If dashboard `3000` was occupied, the banner reports a later port.

For a different-network hackathon demo, add `--tunnel` to the `serve` command. The banner then reports temporary public S3, remote management, and dashboard HTTPS URLs. Use the public S3 endpoint from the second machine and run the same physical-file verification on the storage host. Quick Tunnel mode is intentionally ephemeral and stops all tunnel subprocesses with `openbucket stop`; use a named tunnel and an independent management access policy outside a controlled demo.

### 2. Open the live dashboard

`openbucket dashboard` opens the clean active URL with a one-time token fragment; the page consumes it into API-scoped session storage and removes it. In the UI, verify:

- node name, uptime, and disk capacity;
- zero buckets/objects on a new root;
- management/S3/files endpoints;
- request log entries from status/health.

There is no placeholder dataset: the page is reading `/v1/status`, `/v1/buckets`, `/v1/keys`, `/v1/logs`, `/v1/analytics`, and `/v1/config/client`.

### 3. Create a real bucket and source file

```powershell
npm run openbucket -- bucket create demo-assets

$source = Join-Path $PWD "openbucket-demo.txt"
[IO.File]::WriteAllText($source, "OpenBucket real bytes $([DateTime]::UtcNow.ToString('O'))`n")
Get-FileHash $source -Algorithm SHA256
```

### 4. Upload through the management API

```powershell
$api = "http://127.0.0.1:7272"
$headers = @{ Authorization = "Bearer $env:OPENBUCKET_ADMIN_TOKEN" }

Invoke-RestMethod `
  -Method Put `
  -Uri "$api/v1/buckets/demo-assets/objects/from-management.txt" `
  -Headers $headers `
  -InFile $source `
  -ContentType "text/plain"
```

Verify the API and physical file are the same bytes:

```powershell
$download = Join-Path $PWD "openbucket-demo-download.txt"
Invoke-WebRequest `
  -Uri "$api/v1/buckets/demo-assets/objects/from-management.txt" `
  -Headers $headers `
  -OutFile $download

Get-FileHash $source -Algorithm SHA256
Get-FileHash $download -Algorithm SHA256
Get-FileHash (Join-Path $demoRoot "demo-assets/from-management.txt") -Algorithm SHA256
npm run openbucket -- objects demo-assets
```

All three SHA-256 values must match.

### 5. Create a bucket-scoped SDK key

```powershell
$body = @{
  name = "demo SDK"
  readOnly = $false
  bucket = "demo-assets"
} | ConvertTo-Json

$created = Invoke-RestMethod `
  -Method Post `
  -Uri "$api/v1/keys" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body

$env:OPENBUCKET_ACCESS_KEY = $created.key.accessKeyId
$env:OPENBUCKET_SECRET_KEY = $created.key.secretAccessKey
$env:OPENBUCKET_S3_ENDPOINT = "http://127.0.0.1:8333"
$env:OPENBUCKET_REGION = "auto"
$created.key | Select-Object id,name,accessKeyId,readOnly,bucket
```

The secret came from this running node and is not committed in an example.

### 6. Upload using the AWS SDK for JavaScript

```powershell
Push-Location examples/javascript
npm install
node upload.mjs $source demo-assets from-aws-sdk.txt
Pop-Location
```

The example performs a put, head, get, and byte-for-byte comparison. Verify the second object exists physically:

```powershell
Get-FileHash (Join-Path $demoRoot "demo-assets/from-aws-sdk.txt") -Algorithm SHA256
npm run openbucket -- objects demo-assets
```

### 7. Create and use an expiring share URL

```powershell
$share = Invoke-RestMethod `
  -Method Post `
  -Uri "$api/v1/buckets/demo-assets/share" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ key = "from-aws-sdk.txt"; expiresIn = 300 } | ConvertTo-Json)

$share | Select-Object url,expiresAt
$sharedDownload = Join-Path $PWD "openbucket-demo-shared.txt"
Invoke-WebRequest -Uri $share.url -OutFile $sharedDownload
Get-FileHash $source,$sharedDownload -Algorithm SHA256
```

The hashes must match. Treat the printed URL as a five-minute bearer secret.

### 8. Inspect real logs and analytics

```powershell
npm run openbucket -- logs --limit 20

Invoke-RestMethod "$api/v1/analytics" -Headers $headers |
  Select-Object requests,requestsToday,totalBytesIn,totalBytesOut,averageLatencyMs,errors
```

The request counts/bytes reflect the operations just performed.

### 9. Restart and prove persistence

```powershell
npm run openbucket -- stop
npm run openbucket -- serve $demoRoot --detach --no-open
npm run openbucket -- status
npm run openbucket -- objects demo-assets
```

The node ID, bucket, objects, and S3 keys persist because state and bytes are under `$demoRoot`.

### 10. Clean up

The following recursively deletes the demo bucket's real directory, then stops the daemon:

```powershell
npm run openbucket -- bucket delete demo-assets --force
npm run openbucket -- stop

Remove-Item -LiteralPath $source,$download,$sharedDownload -Force -ErrorAction SilentlyContinue
# Inspect $demoRoot before choosing whether to remove the demo storage root.
```

Do not copy the force-delete command to a non-demo bucket.

## POSIX shell walkthrough

### 1. Start with a generated token

```bash
export OPENBUCKET_ADMIN_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
export OPENBUCKET_OPEN_DASHBOARD=false
export DEMO_ROOT="$PWD/openbucket-demo-data"
export OPENBUCKET_API=http://127.0.0.1:7272

npm run openbucket -- serve "$DEMO_ROOT" --detach --no-open
npm run openbucket -- dashboard
npm run openbucket -- status
npm run openbucket -- bucket create demo-assets
```

The dashboard command opens/re-pairs the live page without printing its token. On a headless host, open the configured dashboard manually and enter the explicit management token in Connection settings.

### 2. Upload and verify physical bytes

```bash
node -e "require('fs').writeFileSync('openbucket-demo.txt', 'OpenBucket real bytes '+new Date().toISOString()+'\n')"

curl -fsS -X PUT \
  "$OPENBUCKET_API/v1/buckets/demo-assets/objects/from-management.txt" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -H 'Content-Type: text/plain' \
  --data-binary @openbucket-demo.txt

curl -fsS \
  "$OPENBUCKET_API/v1/buckets/demo-assets/objects/from-management.txt" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -o openbucket-demo-download.txt

node -e "const c=require('crypto'),f=require('fs'); for (const p of ['openbucket-demo.txt','openbucket-demo-download.txt',process.env.DEMO_ROOT+'/demo-assets/from-management.txt']) console.log(c.createHash('sha256').update(f.readFileSync(p)).digest('hex'),p)"
```

All hashes must match.

### 3. Create credentials from live API data

```bash
CREDENTIAL_JSON="$(curl -fsS -X POST \
  "$OPENBUCKET_API/v1/keys" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"demo SDK","readOnly":false,"bucket":"demo-assets"}')"

export OPENBUCKET_ACCESS_KEY="$(printf '%s' "$CREDENTIAL_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).key.accessKeyId))")"
export OPENBUCKET_SECRET_KEY="$(printf '%s' "$CREDENTIAL_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).key.secretAccessKey))")"
export OPENBUCKET_S3_ENDPOINT=http://127.0.0.1:8333
export OPENBUCKET_REGION=auto
```

No credential is hard-coded. Avoid enabling shell tracing while secrets are in variables.

### 4. Use a standard SDK

```bash
(
  cd examples/javascript
  npm install
  node upload.mjs ../../openbucket-demo.txt demo-assets from-aws-sdk.txt
)

npm run openbucket -- objects demo-assets
```

Optional boto3 validation:

```bash
python -m pip install -r examples/python/requirements.txt
python examples/python/upload.py openbucket-demo.txt demo-assets from-boto3.txt
```

### 5. Share, observe, restart

```bash
SHARE_JSON="$(curl -fsS -X POST \
  "$OPENBUCKET_API/v1/buckets/demo-assets/share" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"key":"from-aws-sdk.txt","expiresIn":300}')"

SHARE_URL="$(printf '%s' "$SHARE_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).url))")"
curl -fsS "$SHARE_URL" -o openbucket-demo-shared.txt

npm run openbucket -- logs --limit 20
curl -fsS "$OPENBUCKET_API/v1/analytics" \
  -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN"

npm run openbucket -- stop
npm run openbucket -- serve "$DEMO_ROOT" --detach --no-open
npm run openbucket -- objects demo-assets
```

### 6. Clean up

```bash
npm run openbucket -- bucket delete demo-assets --force
npm run openbucket -- stop
rm -f openbucket-demo.txt openbucket-demo-download.txt openbucket-demo-shared.txt
# Inspect "$DEMO_ROOT" before choosing whether to remove the demo storage root.
```

## Demo acceptance checklist

- [ ] Full build completed.
- [ ] Daemon health and status succeeded.
- [ ] Dashboard showed the actual selected root and zero-state/new objects.
- [ ] Management upload bytes matched the downloaded and physical file hashes.
- [ ] A runtime-created scoped key authenticated a standard SDK.
- [ ] SDK upload/download matched source bytes.
- [ ] Share link worked and carried a real expiry.
- [ ] Logs and analytics reflected performed requests.
- [ ] Stop/restart preserved node identity, credentials, bucket, and objects.
- [ ] Cleanup was intentional and limited to the demo root.

If any check fails, run `openbucket doctor`, inspect [Operations](OPERATIONS.md#troubleshooting), and compare the operation with [S3 compatibility](S3_COMPATIBILITY.md).
