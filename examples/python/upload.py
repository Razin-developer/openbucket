#!/usr/bin/env python3
"""Upload and byte-verify a real file against a path-style OpenBucket endpoint."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

import boto3
from botocore.config import Config


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required.")
    return value


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print("Usage: python upload.py <file> <bucket> [key]", file=sys.stderr)
        return 2

    source_path = Path(sys.argv[1]).expanduser().resolve(strict=True)
    bucket = sys.argv[2]
    key = sys.argv[3] if len(sys.argv) == 4 else source_path.name
    endpoint = os.environ.get(
        "OPENBUCKET_S3_ENDPOINT", "http://127.0.0.1:8333"
    ).rstrip("/")
    region = os.environ.get("OPENBUCKET_REGION", "auto").strip() or "auto"
    source = source_path.read_bytes()

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=required_environment("OPENBUCKET_ACCESS_KEY"),
        aws_secret_access_key=required_environment("OPENBUCKET_SECRET_KEY"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )

    put = s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=source,
        ContentLength=len(source),
    )
    head = s3.head_object(Bucket=bucket, Key=key)
    downloaded = s3.get_object(Bucket=bucket, Key=key)["Body"].read()

    if downloaded != source:
        raise RuntimeError(f"Byte verification failed for s3://{bucket}/{key}.")
    if int(head["ContentLength"]) != len(source):
        raise RuntimeError(
            f"HeadObject reported {head['ContentLength']} bytes; expected {len(source)}."
        )

    print(
        json.dumps(
            {
                "ok": True,
                "endpoint": endpoint,
                "bucket": bucket,
                "key": key,
                "bytes": len(source),
                "etag": head.get("ETag", put.get("ETag")),
                "verified": True,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
