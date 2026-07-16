# Python boto3 example

This example uses SigV4 and path-style addressing, uploads real bytes, then verifies `HeadObject` and `GetObject`.

```bash
python -m pip install -r requirements.txt
OPENBUCKET_ACCESS_KEY='...' \
OPENBUCKET_SECRET_KEY='...' \
OPENBUCKET_S3_ENDPOINT=http://127.0.0.1:8333 \
python upload.py ./local-file.bin my-bucket path/in/bucket.bin
```

The file is read into memory to avoid the AWS streaming/chunked payload format, which OpenBucket v0.1 does not implement. Use a test file sized appropriately for available memory.
