# JavaScript AWS SDK example

This example reads a local file into a bounded buffer, uploads it with AWS SDK v3, calls `HeadObject` and `GetObject`, and compares the returned bytes. Reading into a buffer avoids AWS streaming/chunked signing, which OpenBucket v0.1 does not support.

Create the bucket first, then provide credentials through the environment:

```bash
npm install
OPENBUCKET_ACCESS_KEY='...' \
OPENBUCKET_SECRET_KEY='...' \
OPENBUCKET_S3_ENDPOINT=http://127.0.0.1:8333 \
node upload.mjs ./local-file.bin my-bucket path/in/bucket.bin
```

Do not place credentials in this directory or commit them.
