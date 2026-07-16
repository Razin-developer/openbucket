"""Command-line interface for the Python management client."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from . import __version__
from .client import OpenBucketClient
from .exceptions import OpenBucketError, OpenBucketHTTPError


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openbucket-client",
        description="Manage a running OpenBucket daemon through its HTTP API.",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("OPENBUCKET_API_URL", "http://127.0.0.1:7272"),
        help="management API URL (default: OPENBUCKET_API_URL or http://127.0.0.1:7272)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("OPENBUCKET_ADMIN_TOKEN"),
        help="management bearer token (prefer OPENBUCKET_ADMIN_TOKEN to avoid process-list exposure)",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="request timeout in seconds")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")

    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health", help="check the unauthenticated daemon health endpoint")
    commands.add_parser("status", help="show daemon and storage status")
    commands.add_parser("config", help="show connection configuration")
    commands.add_parser("analytics", help="show aggregate request and storage analytics")

    logs = commands.add_parser("logs", help="show newest request logs")
    logs.add_argument("--limit", type=int, default=100)

    buckets = commands.add_parser("buckets", help="manage buckets").add_subparsers(dest="bucket_command", required=True)
    buckets.add_parser("list", help="list buckets")
    create_bucket = buckets.add_parser("create", help="create a bucket")
    create_bucket.add_argument("name")
    create_bucket.add_argument("--public", action="store_true")
    update_bucket = buckets.add_parser("set-public", help="change anonymous-read visibility")
    update_bucket.add_argument("name")
    visibility = update_bucket.add_mutually_exclusive_group(required=True)
    visibility.add_argument("--public", dest="public", action="store_true")
    visibility.add_argument("--private", dest="public", action="store_false")
    delete_bucket = buckets.add_parser("delete", help="delete a bucket")
    delete_bucket.add_argument("name")
    delete_bucket.add_argument("--force", action="store_true")

    objects = commands.add_parser("objects", help="manage objects").add_subparsers(dest="object_command", required=True)
    list_objects = objects.add_parser("list", help="list objects")
    list_objects.add_argument("bucket")
    list_objects.add_argument("--prefix", default="")
    upload = objects.add_parser("upload", help="upload a local file")
    upload.add_argument("bucket")
    upload.add_argument("key")
    upload.add_argument("file", type=Path)
    upload.add_argument("--content-type")
    download = objects.add_parser("download", help="download to a local file")
    download.add_argument("bucket")
    download.add_argument("key")
    download.add_argument("output", type=Path)
    download.add_argument("--force", action="store_true", help="replace an existing output file")
    head = objects.add_parser("head", help="inspect object metadata")
    head.add_argument("bucket")
    head.add_argument("key")
    delete_object = objects.add_parser("delete", help="delete an object")
    delete_object.add_argument("bucket")
    delete_object.add_argument("key")

    keys = commands.add_parser("keys", help="manage S3 access keys").add_subparsers(dest="key_command", required=True)
    keys.add_parser("list", help="list keys without secrets")
    create_key = keys.add_parser("create", help="create a key; the secret is returned once")
    create_key.add_argument("--name", default="access key")
    create_key.add_argument("--read-only", action="store_true")
    create_key.add_argument("--bucket")
    revoke = keys.add_parser("revoke", help="revoke a key")
    revoke.add_argument("id")

    share = commands.add_parser("share", help="create an expiring object URL")
    share.add_argument("bucket")
    share.add_argument("key")
    share.add_argument("--expires-in", type=int, default=3600)

    return parser


def _jsonable(value: Any) -> Any:
    if is_dataclass(value) and not isinstance(value, type):
        return _jsonable(asdict(value))
    if isinstance(value, datetime):
        text = value.isoformat()
        return text.replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _emit(value: Any, *, as_json: bool) -> None:
    converted = _jsonable(value)
    if as_json:
        print(json.dumps(converted, ensure_ascii=False, separators=(",", ":")))
        return
    if isinstance(converted, list):
        if not converted:
            print("No results.")
            return
        for item in converted:
            print(json.dumps(item, ensure_ascii=False, sort_keys=True))
        return
    if isinstance(converted, dict):
        for key, item in converted.items():
            if isinstance(item, (dict, list)):
                print(f"{key}: {json.dumps(item, ensure_ascii=False, sort_keys=True)}")
            else:
                print(f"{key}: {item}")
        return
    print(converted)


def _run(client: OpenBucketClient, args: argparse.Namespace) -> Any:
    if args.command == "health":
        return client.health()
    if args.command == "status":
        return client.status()
    if args.command == "config":
        return client.client_configuration()
    if args.command == "analytics":
        return client.analytics()
    if args.command == "logs":
        return client.logs(limit=args.limit)
    if args.command == "buckets":
        if args.bucket_command == "list":
            return client.list_buckets()
        if args.bucket_command == "create":
            return client.create_bucket(args.name, public=args.public)
        if args.bucket_command == "set-public":
            return client.set_bucket_public(args.name, args.public)
        if args.bucket_command == "delete":
            return client.delete_bucket(args.name, force=args.force)
    if args.command == "objects":
        if args.object_command == "list":
            return client.list_objects(args.bucket, prefix=args.prefix)
        if args.object_command == "upload":
            content_type = args.content_type or mimetypes.guess_type(args.file.name)[0] or "application/octet-stream"
            return client.upload_file(args.bucket, args.key, args.file, content_type=content_type)
        if args.object_command == "download":
            head = client.download_to(args.bucket, args.key, args.output, overwrite=args.force)
            return {"output": str(args.output), "object": head}
        if args.object_command == "head":
            return client.head_object(args.bucket, args.key)
        if args.object_command == "delete":
            return client.delete_object(args.bucket, args.key)
    if args.command == "keys":
        if args.key_command == "list":
            return client.list_keys()
        if args.key_command == "create":
            return client.create_key(name=args.name, read_only=args.read_only, bucket=args.bucket)
        if args.key_command == "revoke":
            return client.revoke_key(args.id)
    if args.command == "share":
        return client.create_share(args.bucket, args.key, expires_in=args.expires_in)
    raise RuntimeError("unreachable command")


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if not args.token:
        parser.error("a management token is required; set OPENBUCKET_ADMIN_TOKEN or pass --token")
    try:
        client = OpenBucketClient(args.url, args.token, timeout=args.timeout)
        result = _run(client, args)
        _emit(result, as_json=args.json)
        return 0
    except OpenBucketHTTPError as error:
        print(str(error), file=sys.stderr)
        if error.details is not None:
            print(f"details: {json.dumps(error.details, ensure_ascii=False)}", file=sys.stderr)
        return 1
    except (OpenBucketError, OSError, ValueError) as error:
        print(f"openbucket-client: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
