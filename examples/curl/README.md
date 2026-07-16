# Management API examples

These scripts create a bucket if necessary, upload the file argument as raw bytes, list and download it, create a five-minute share link, and show analytics. They leave the bucket/object in place so you can inspect real data.

No credential is embedded. Start OpenBucket with an explicit management token, then set the same token in the calling environment.

```bash
export OPENBUCKET_ADMIN_TOKEN='...'
sh management.sh ./local-file.bin my-bucket path/in/bucket.bin
```

```powershell
$env:OPENBUCKET_ADMIN_TOKEN = "..."
./management.ps1 ./local-file.bin my-bucket path/in/bucket.bin
```

Optional variables:

- `OPENBUCKET_API` (default `http://127.0.0.1:7272`)
- `OPENBUCKET_DOWNLOAD_PATH`

Forced cleanup is deliberately not automated. Use the CLI or API after inspecting the target.
