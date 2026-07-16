from __future__ import annotations

import io
import json
import socket
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from openbucket import (
    OpenBucketClient,
    OpenBucketConfigurationError,
    OpenBucketConnectionError,
    OpenBucketHTTPError,
    OpenBucketProtocolError,
)
from openbucket.cli import main as cli_main

NOW = "2026-07-16T00:00:00.000Z"
TOKEN = "integration-test-token"


class ApiState:
    def __init__(self) -> None:
        self.buckets: dict[str, dict[str, Any]] = {}
        self.objects: dict[tuple[str, str], bytes] = {}
        self.keys: list[dict[str, Any]] = [
            {
                "id": "initial-key",
                "name": "initial",
                "accessKeyId": "OBINITIAL",
                "createdAt": NOW,
                "readOnly": False,
                "bucket": None,
            }
        ]
        self.lock = threading.Lock()


class ManagementHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OpenBucketTestServer/1"

    @property
    def state(self) -> ApiState:
        return self.server.state  # type: ignore[attr-defined,no-any-return]

    @property
    def origin(self) -> str:
        host, port = self.server.server_address[:2]
        return f"http://{host}:{port}"

    def log_message(self, format: str, *args: Any) -> None:
        return None

    def _send_json(self, status: int, value: Any) -> None:
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Request-Id", "header-request-id")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status: int, code: str, message: str, details: Any = None) -> None:
        error: dict[str, Any] = {"code": code, "message": message}
        if details is not None:
            error["details"] = details
        self._send_json(status, {"error": error, "requestId": "json-request-id"})

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)

    def _read_json(self) -> dict[str, Any]:
        value = json.loads(self._read_body() or b"{}")
        assert isinstance(value, dict)
        return value

    def _bucket_value(self, name: str) -> dict[str, Any]:
        bucket = dict(self.state.buckets[name])
        objects = [value for (bucket_name, _), value in self.state.objects.items() if bucket_name == name]
        bucket.update(
            objectCount=len(objects),
            sizeBytes=sum(map(len, objects)),
            objects=len(objects),
            bytes=sum(map(len, objects)),
        )
        return bucket

    def do_GET(self) -> None:
        self._handle()

    def do_HEAD(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def do_PUT(self) -> None:
        self._handle()

    def do_PATCH(self) -> None:
        self._handle()

    def do_DELETE(self) -> None:
        self._handle()

    def _handle(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/_redirect/"):
            self.send_response(302)
            self.send_header("Location", self.origin + path.removeprefix("/_redirect"))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path.startswith("/_bad/"):
            body = b"not json"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/healthz" and self.command == "GET":
            self._send_json(
                200,
                {"ok": True, "status": "healthy", "version": "0.1.0", "nodeId": "node-1", "uptimeSeconds": 12},
            )
            return
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self._error(401, "Unauthorized", "A valid management bearer token is required.", {"hint": "check token"})
            return

        if path == "/v1/status" and self.command == "GET":
            with self.state.lock:
                bucket_count = len(self.state.buckets)
                object_count = len(self.state.objects)
                used_bytes = sum(map(len, self.state.objects.values()))
            self._send_json(
                200,
                {
                    "online": True,
                    "nodeId": "node-1",
                    "nodeName": "test-node",
                    "version": "0.1.0",
                    "storageRoot": "/tmp/openbucket",
                    "capacityBytes": 1_000_000,
                    "usedBytes": used_bytes,
                    "filesystemUsedBytes": 100,
                    "availableBytes": 999_900,
                    "bucketCount": bucket_count,
                    "objectCount": object_count,
                    "requestsToday": 3,
                    "uptimeSeconds": 12,
                    "endpoints": {
                        "management": self.origin,
                        "s3": self.origin,
                        "public": self.origin,
                        "files": self.origin + "/files",
                        "dashboard": None,
                    },
                    "node": {"id": "node-1", "name": "test-node", "createdAt": NOW, "uptimeSeconds": 12},
                    "storage": {
                        "root": "/tmp/openbucket",
                        "buckets": bucket_count,
                        "objects": object_count,
                        "bytes": used_bytes,
                        "managedBytes": used_bytes,
                        "filesystemUsedBytes": 100,
                        "totalBytes": 1_000_000,
                        "freeBytes": 999_900,
                    },
                },
            )
            return

        if path == "/v1/config/client" and self.command == "GET":
            self._send_json(
                200,
                {
                    "nodeId": "node-1",
                    "nodeName": "test-node",
                    "managementUrl": self.origin,
                    "s3Url": self.origin,
                    "publicBaseUrl": None,
                    "filesUrl": self.origin + "/files",
                    "dashboardUrl": None,
                    "storageRoot": "/tmp/openbucket",
                },
            )
            return

        if path == "/v1/buckets":
            if self.command == "GET":
                with self.state.lock:
                    buckets = [self._bucket_value(name) for name in sorted(self.state.buckets)]
                self._send_json(200, {"buckets": buckets})
                return
            if self.command == "POST":
                body = self._read_json()
                name = body["name"]
                with self.state.lock:
                    if name in self.state.buckets:
                        self._error(409, "BucketAlreadyExists", "Bucket already exists.")
                        return
                    self.state.buckets[name] = {"name": name, "createdAt": NOW, "public": body.get("public", False)}
                    bucket = self._bucket_value(name)
                self._send_json(201, {"bucket": bucket})
                return

        if path.startswith("/v1/buckets/"):
            parts = path.split("/")
            bucket = unquote(parts[3])
            with self.state.lock:
                exists = bucket in self.state.buckets
            if not exists:
                self._error(404, "NoSuchBucket", "Bucket does not exist.")
                return

            if len(parts) == 4:
                if self.command == "PATCH":
                    body = self._read_json()
                    with self.state.lock:
                        self.state.buckets[bucket]["public"] = body["public"]
                        value = dict(self.state.buckets[bucket])
                    self._send_json(200, {"bucket": value})
                    return
                if self.command == "DELETE":
                    force = query.get("force") == ["true"]
                    with self.state.lock:
                        has_objects = any(name == bucket for name, _ in self.state.objects)
                        if has_objects and not force:
                            self._error(409, "BucketNotEmpty", "Bucket is not empty.")
                            return
                        self.state.objects = {
                            item: value for item, value in self.state.objects.items() if item[0] != bucket
                        }
                        del self.state.buckets[bucket]
                    self._send_json(200, {"deleted": True, "bucket": bucket})
                    return

            if len(parts) >= 5 and parts[4] == "objects":
                if len(parts) == 5 and self.command == "GET":
                    prefix = query.get("prefix", [""])[0]
                    with self.state.lock:
                        values = [
                            {
                                "key": key,
                                "size": len(value),
                                "lastModified": NOW,
                                "etag": f"etag-{len(value)}",
                                "url": f"{self.origin}/{bucket}/"
                                + "/".join(quote_path(item) for item in key.split("/")),
                            }
                            for (name, key), value in sorted(self.state.objects.items())
                            if name == bucket and key.startswith(prefix)
                        ]
                    self._send_json(200, {"bucket": bucket, "prefix": prefix, "objects": values})
                    return
                if len(parts) > 5:
                    key = "/".join(unquote(item) for item in parts[5:])
                    identity = (bucket, key)
                    if self.command == "PUT":
                        value = self._read_body()
                        with self.state.lock:
                            self.state.objects[identity] = value
                        self._send_json(
                            201,
                            {
                                "object": {
                                    "key": key,
                                    "size": len(value),
                                    "lastModified": NOW,
                                    "etag": f"etag-{len(value)}",
                                }
                            },
                        )
                        return
                    if self.command in {"GET", "HEAD"}:
                        with self.state.lock:
                            value = self.state.objects.get(identity)
                        if value is None:
                            self._error(404, "NoSuchKey", "Object does not exist.")
                            return
                        self.send_response(200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Length", str(len(value)))
                        self.send_header("ETag", f'"etag-{len(value)}"')
                        self.send_header("Last-Modified", "Thu, 16 Jul 2026 00:00:00 GMT")
                        self.end_headers()
                        if self.command == "GET":
                            self.wfile.write(value)
                        return
                    if self.command == "DELETE":
                        with self.state.lock:
                            deleted = self.state.objects.pop(identity, None) is not None
                        self._send_json(200, {"deleted": deleted, "bucket": bucket, "key": key})
                        return

            if len(parts) == 5 and parts[4] == "share" and self.command == "POST":
                body = self._read_json()
                key = body["key"]
                with self.state.lock:
                    exists = (bucket, key) in self.state.objects
                if not exists:
                    self._error(404, "NoSuchKey", "Object does not exist.")
                    return
                self._send_json(
                    201,
                    {
                        "url": f"{self.origin}/files/{bucket}/{quote_path(key)}?expires=1&token=test",
                        "expiresAt": "2026-07-16T01:00:00.000Z",
                        "bucket": bucket,
                        "key": key,
                    },
                )
                return

        if path == "/v1/keys":
            if self.command == "GET":
                with self.state.lock:
                    self._send_json(200, {"keys": [dict(item) for item in self.state.keys]})
                return
            if self.command == "POST":
                body = self._read_json()
                value = {
                    "id": f"key-{len(self.state.keys) + 1}",
                    "name": body.get("name", "access key"),
                    "accessKeyId": "OBNEW",
                    "secretAccessKey": "one-time-secret",
                    "createdAt": NOW,
                    "readOnly": body.get("readOnly", False),
                    "bucket": body.get("bucket"),
                }
                with self.state.lock:
                    self.state.keys.append({key: item for key, item in value.items() if key != "secretAccessKey"})
                self._send_json(201, {"key": value})
                return

        if path.startswith("/v1/keys/") and self.command == "DELETE":
            key_id = unquote(path.rsplit("/", 1)[1])
            with self.state.lock:
                original = len(self.state.keys)
                self.state.keys = [item for item in self.state.keys if item["id"] != key_id]
            if len(self.state.keys) == original:
                self._error(404, "NoSuchAccessKey", "Access key does not exist.")
                return
            self._send_json(200, {"deleted": True, "id": key_id})
            return

        if path == "/v1/logs" and self.command == "GET":
            self._send_json(
                200,
                {
                    "logs": [
                        {
                            "timestamp": NOW,
                            "requestId": "request-1",
                            "method": "GET",
                            "path": "/bucket/key",
                            "status": 200,
                            "durationMs": 1.25,
                            "bytesIn": 0,
                            "bytesOut": 12,
                            "ip": "127.0.0.1",
                            "userAgent": "test",
                            "accessKeyId": "OBINITIAL",
                            "service": "s3",
                        }
                    ]
                },
            )
            return

        if path == "/v1/analytics" and self.command == "GET":
            self._send_json(
                200,
                {
                    "requests": 10,
                    "requestsToday": 3,
                    "totalBytesIn": 12,
                    "totalBytesOut": 34,
                    "averageLatencyMs": 1.5,
                    "errors": 1,
                    "statusCodes": {"200": 9, "404": 1},
                    "methods": {"GET": 10},
                    "recentDaily": [{"date": "2026-07-16", "requests": 3, "bytesIn": 12, "bytesOut": 34}],
                    "storage": {
                        "bucketCount": len(self.state.buckets),
                        "objectCount": len(self.state.objects),
                        "usedBytes": sum(map(len, self.state.objects.values())),
                    },
                },
            )
            return

        if path == "/v1/stop" and self.command == "POST":
            self._read_body()
            self._send_json(202, {"stopping": True})
            return

        self._error(404, "NotFound", "Management endpoint not found.")


def quote_path(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


class LiveServer:
    def __init__(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ManagementHandler)
        self.server.state = ApiState()  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self.server.server_address[:2]
        return f"http://{host}:{port}"

    def __enter__(self) -> LiveServer:
        self.thread.start()
        return self

    def __exit__(self, *args: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class OpenBucketClientTests(unittest.TestCase):
    def test_full_management_lifecycle_over_real_http(self) -> None:
        with LiveServer() as server, tempfile.TemporaryDirectory() as directory:
            client = OpenBucketClient(server.url + "/", TOKEN)
            self.assertTrue(client.health().ok)
            self.assertEqual(client.status().node_name, "test-node")
            self.assertEqual(client.client_configuration().management_url, server.url)

            bucket = client.create_bucket("project-assets")
            self.assertEqual(bucket.object_count, 0)
            self.assertTrue(client.set_bucket_public(bucket.name, True).public)
            self.assertEqual(client.list_buckets()[0].name, bucket.name)

            payload = "OpenBucket says hello \N{WAVING HAND SIGN}".encode()
            key = "images/a file-\N{WAVING HAND SIGN}.txt"
            uploaded = client.upload_object(bucket.name, key, payload, content_type="text/plain")
            self.assertEqual(uploaded.size, len(payload))
            self.assertEqual(client.list_objects(bucket.name, prefix="images/")[0].key, key)
            self.assertEqual(client.head_object(bucket.name, key).etag, f"etag-{len(payload)}")
            self.assertEqual(client.download_object(bucket.name, key), payload)
            with self.assertRaises(OpenBucketProtocolError):
                client.download_object(bucket.name, key, max_bytes=2)

            destination = Path(directory, "nested", "download.txt")
            head = client.download_to(bucket.name, key, destination)
            self.assertEqual(head.size, len(payload))
            self.assertEqual(destination.read_bytes(), payload)
            with self.assertRaises(FileExistsError):
                client.download_to(bucket.name, key, destination)
            client.download_to(bucket.name, key, destination, overwrite=True)

            source = Path(directory, "source.bin")
            source.write_bytes(b"from a real file")
            self.assertEqual(client.upload_file(bucket.name, "source.bin", source).size, 16)

            share = client.create_share(bucket.name, key, expires_in=60)
            self.assertEqual(share.key, key)
            self.assertEqual(share.expires_at.tzinfo, timezone.utc)

            created_key = client.create_key(name="reader", read_only=True, bucket=bucket.name)
            self.assertEqual(created_key.secret_access_key, "one-time-secret")
            self.assertIsNone(client.list_keys()[-1].secret_access_key)
            self.assertTrue(client.revoke_key(created_key.id).deleted)

            self.assertEqual(client.logs(limit=1)[0].service, "s3")
            self.assertEqual(client.analytics().status_codes["404"], 1)
            self.assertTrue(client.stop().stopping)

            self.assertTrue(client.delete_object(bucket.name, key).deleted)
            self.assertTrue(client.delete_bucket(bucket.name, force=True).deleted)

    def test_http_errors_preserve_server_diagnostics(self) -> None:
        with LiveServer() as server:
            client = OpenBucketClient(server.url, "wrong-token")
            with self.assertRaises(OpenBucketHTTPError) as caught:
                client.status()
            error = caught.exception
            self.assertEqual(error.status, 401)
            self.assertEqual(error.code, "Unauthorized")
            self.assertEqual(error.request_id, "json-request-id")
            self.assertEqual(error.details, {"hint": "check token"})

    def test_redirects_are_rejected_and_token_is_not_forwarded(self) -> None:
        with LiveServer() as server:
            client = OpenBucketClient(server.url + "/_redirect", TOKEN)
            with self.assertRaises(OpenBucketHTTPError) as caught:
                client.status()
            self.assertEqual(caught.exception.status, 302)

    def test_malformed_protocol_response_is_clear(self) -> None:
        with LiveServer() as server:
            client = OpenBucketClient(server.url + "/_bad", TOKEN)
            with self.assertRaises(OpenBucketProtocolError):
                client.status()

    def test_configuration_and_value_validation(self) -> None:
        for url in ("localhost:7272", "ftp://localhost", "http://user:secret@localhost", "http://localhost/?x=1"):
            with self.subTest(url=url), self.assertRaises(OpenBucketConfigurationError):
                OpenBucketClient(url, TOKEN)
        with self.assertRaises(OpenBucketConfigurationError):
            OpenBucketClient("http://localhost", " token ")
        with LiveServer() as server:
            client = OpenBucketClient(server.url, TOKEN)
            with self.assertRaises(ValueError):
                client.logs(limit=0)
            with self.assertRaises(ValueError):
                client.create_share("bucket", "key", expires_in=0)
            with self.assertRaises(ValueError):
                client.upload_object("bucket", "key", b"abc", content_length=2)

    def test_transport_errors_are_wrapped(self) -> None:
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        client = OpenBucketClient(f"http://127.0.0.1:{port}", TOKEN, timeout=0.2)
        with self.assertRaises(OpenBucketConnectionError):
            client.status()

    def test_cli_uses_the_real_http_transport_and_emits_json(self) -> None:
        with LiveServer() as server:
            stdout = io.StringIO()
            stderr = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = cli_main(["--url", server.url, "--token", TOKEN, "--json", "status"])
            self.assertEqual(code, 0, stderr.getvalue())
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["node_name"], "test-node")


if __name__ == "__main__":
    unittest.main()
