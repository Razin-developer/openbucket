"""Dependency-free OpenBucket management API client."""

from __future__ import annotations

import json
import math
import os
from collections.abc import Mapping
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from types import TracebackType
from typing import Any, BinaryIO, NoReturn, cast
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, OpenerDirector, Request, build_opener

from . import models
from .exceptions import (
    OpenBucketConfigurationError,
    OpenBucketConnectionError,
    OpenBucketHTTPError,
    OpenBucketProtocolError,
)

_MAX_ERROR_BYTES = 1_048_576
_DEFAULT_METADATA_LIMIT = 16 * 1_048_576


class _NoRedirectHandler(HTTPRedirectHandler):
    """Management endpoints never redirect; following one could leak the token."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def _mapping(value: Any, context: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise OpenBucketProtocolError(f"Expected {context} to be a JSON object.")
    return cast(Mapping[str, Any], value)


def _list(value: Any, context: str) -> list[Any]:
    if not isinstance(value, list):
        raise OpenBucketProtocolError(f"Expected {context} to be a JSON array.")
    return value


def _str(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise OpenBucketProtocolError(f"Expected {key!r} to be a string.")
    return value


def _optional_str(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise OpenBucketProtocolError(f"Expected {key!r} to be a string or null.")
    return value


def _bool(data: Mapping[str, Any], key: str) -> bool:
    value = data.get(key)
    if not isinstance(value, bool):
        raise OpenBucketProtocolError(f"Expected {key!r} to be a boolean.")
    return value


def _int(data: Mapping[str, Any], key: str) -> int:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise OpenBucketProtocolError(f"Expected {key!r} to be an integer.")
    return value


def _optional_int(data: Mapping[str, Any], key: str) -> int | None:
    value = data.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise OpenBucketProtocolError(f"Expected {key!r} to be an integer or null.")
    return cast(int, value)


def _number(data: Mapping[str, Any], key: str) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OpenBucketProtocolError(f"Expected {key!r} to be a number.")
    return float(value)


def _datetime(data: Mapping[str, Any], key: str) -> datetime:
    raw = _str(data, key)
    try:
        result = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise OpenBucketProtocolError(f"Expected {key!r} to be an ISO-8601 timestamp.") from error
    if result.tzinfo is None:
        raise OpenBucketProtocolError(f"Expected {key!r} to include a timezone.")
    return result


def _counts(value: Any, context: str) -> Mapping[str, int]:
    raw = _mapping(value, context)
    result: dict[str, int] = {}
    for key, item in raw.items():
        if not isinstance(key, str) or isinstance(item, bool) or not isinstance(item, int):
            raise OpenBucketProtocolError(f"Expected {context} to contain integer values.")
        result[key] = item
    return result


def _bucket(value: Any) -> models.Bucket:
    data = _mapping(value, "bucket")
    return models.Bucket(
        name=_str(data, "name"),
        created_at=_datetime(data, "createdAt"),
        public=_bool(data, "public"),
        object_count=_optional_int(data, "objectCount"),
        size_bytes=_optional_int(data, "sizeBytes"),
    )


def _object(value: Any) -> models.ObjectInfo:
    data = _mapping(value, "object")
    return models.ObjectInfo(
        key=_str(data, "key"),
        size=_int(data, "size"),
        last_modified=_datetime(data, "lastModified"),
        etag=_str(data, "etag"),
        url=_optional_str(data, "url"),
    )


def _access_key(value: Any) -> models.AccessKey:
    data = _mapping(value, "access key")
    return models.AccessKey(
        id=_str(data, "id"),
        name=_str(data, "name"),
        access_key_id=_str(data, "accessKeyId"),
        created_at=_datetime(data, "createdAt"),
        read_only=_bool(data, "readOnly"),
        bucket=_optional_str(data, "bucket"),
        secret_access_key=_optional_str(data, "secretAccessKey"),
    )


def _request_log(value: Any) -> models.RequestLog:
    data = _mapping(value, "request log")
    return models.RequestLog(
        timestamp=_datetime(data, "timestamp"),
        request_id=_str(data, "requestId"),
        method=_str(data, "method"),
        path=_str(data, "path"),
        status=_int(data, "status"),
        duration_ms=_number(data, "durationMs"),
        bytes_in=_int(data, "bytesIn"),
        bytes_out=_int(data, "bytesOut"),
        ip=_str(data, "ip"),
        user_agent=_str(data, "userAgent"),
        service=_str(data, "service"),
        access_key_id=_optional_str(data, "accessKeyId"),
    )


def _encoded_segment(value: str) -> str:
    return quote(value, safe="")


def _encoded_key(value: str) -> str:
    return "/".join(_encoded_segment(segment) for segment in value.split("/"))


class OpenBucketClient:
    """Synchronous client for one OpenBucket daemon's management API.

    The client deliberately does not follow HTTP redirects, because forwarding a
    management bearer token to a different origin would be unsafe. Instances are
    immutable from a connection perspective and may be reused between requests.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = 30.0,
        user_agent: str = "openbucket-client/0.1.5",
        max_metadata_bytes: int = _DEFAULT_METADATA_LIMIT,
        opener: OpenerDirector | None = None,
    ) -> None:
        parsed = urlsplit(base_url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise OpenBucketConfigurationError("base_url must be an absolute http:// or https:// URL.")
        if parsed.username is not None or parsed.password is not None:
            raise OpenBucketConfigurationError("base_url must not contain credentials.")
        if parsed.query or parsed.fragment:
            raise OpenBucketConfigurationError("base_url must not contain a query string or fragment.")
        if not token or token.strip() != token or "\r" in token or "\n" in token:
            raise OpenBucketConfigurationError("token must be a non-empty bearer token without surrounding whitespace.")
        if not math.isfinite(timeout) or timeout <= 0:
            raise OpenBucketConfigurationError("timeout must be a positive finite number.")
        if not user_agent or "\r" in user_agent or "\n" in user_agent:
            raise OpenBucketConfigurationError("user_agent must be a non-empty valid HTTP header value.")
        if max_metadata_bytes < 1:
            raise OpenBucketConfigurationError("max_metadata_bytes must be at least 1.")

        normalized_path = parsed.path.rstrip("/")
        self.base_url = urlunsplit((parsed.scheme.lower(), parsed.netloc, normalized_path, "", ""))
        self.timeout = float(timeout)
        self.max_metadata_bytes = max_metadata_bytes
        self._authorization = f"Bearer {token}"
        self._user_agent = user_agent
        self._opener = opener or build_opener(_NoRedirectHandler())

    def __enter__(self) -> OpenBucketClient:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    def _url(self, path: str, query: Mapping[str, str | int | bool | None] | None = None) -> str:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if query:
            values = {
                key: (str(value).lower() if isinstance(value, bool) else str(value))
                for key, value in query.items()
                if value is not None
            }
            if values:
                url = f"{url}?{urlencode(values)}"
        return url

    def _request(
        self,
        method: str,
        path: str,
        *,
        expected: tuple[int, ...],
        query: Mapping[str, str | int | bool | None] | None = None,
        data: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> Any:
        url = self._url(path, query)
        request = Request(url, data=data, method=method)
        request.add_header("Accept", "application/json")
        request.add_header("Authorization", self._authorization)
        request.add_header("User-Agent", self._user_agent)
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            response = self._opener.open(request, timeout=self.timeout)
        except HTTPError as error:
            self._raise_http_error(error, url)
        except (URLError, TimeoutError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise OpenBucketConnectionError(f"Could not reach OpenBucket at {url}: {reason}", url=url) from error

        status = int(getattr(response, "status", response.getcode()))
        if status not in expected:
            response.close()
            raise OpenBucketProtocolError(
                f"OpenBucket returned unexpected HTTP status {status}; expected {', '.join(map(str, expected))}.",
                url=url,
            )
        return response

    def _raise_http_error(self, error: HTTPError, url: str) -> NoReturn:
        body = error.read(_MAX_ERROR_BYTES + 1)
        if len(body) > _MAX_ERROR_BYTES:
            body = body[:_MAX_ERROR_BYTES]
        code = f"HTTP{error.code}"
        message = str(error.reason or "Request failed")
        request_id = error.headers.get("x-request-id")
        details: Any = None
        try:
            payload = json.loads(body.decode("utf-8")) if body else None
            if isinstance(payload, dict):
                error_value = payload.get("error")
                if isinstance(error_value, dict):
                    raw_code = error_value.get("code")
                    raw_message = error_value.get("message")
                    if isinstance(raw_code, str):
                        code = raw_code
                    if isinstance(raw_message, str):
                        message = raw_message
                    details = error_value.get("details")
                raw_request_id = payload.get("requestId")
                if isinstance(raw_request_id, str):
                    request_id = raw_request_id
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        finally:
            error.close()
        raise OpenBucketHTTPError(
            error.code,
            code,
            message,
            request_id=request_id,
            details=details,
            url=url,
        )

    @staticmethod
    def _read_limited(response: Any, limit: int, *, url: str) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(min(65_536, limit + 1 - total))
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
            total += len(chunk)
            if total > limit:
                raise OpenBucketProtocolError(f"Response exceeded the configured {limit}-byte limit.", url=url)

    def _json(
        self,
        method: str,
        path: str,
        *,
        expected: tuple[int, ...] = (200,),
        query: Mapping[str, str | int | bool | None] | None = None,
        payload: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        encoded: bytes | None = None
        headers: dict[str, str] = {}
        if payload is not None:
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        url = self._url(path, query)
        response = self._request(method, path, expected=expected, query=query, data=encoded, headers=headers)
        try:
            content_type = response.headers.get_content_type()
            if content_type != "application/json":
                raise OpenBucketProtocolError(
                    f"Expected an application/json response, received {content_type!r}.", url=url
                )
            body = self._read_limited(response, self.max_metadata_bytes, url=url)
        finally:
            response.close()
        try:
            decoded = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise OpenBucketProtocolError("OpenBucket returned malformed JSON.", url=url) from error
        try:
            return _mapping(decoded, "response")
        except OpenBucketProtocolError as error:
            error.url = url
            raise

    def health(self) -> models.Health:
        data = self._json("GET", "/healthz")
        return models.Health(
            ok=_bool(data, "ok"),
            status=_str(data, "status"),
            version=_str(data, "version"),
            node_id=_str(data, "nodeId"),
            uptime_seconds=_int(data, "uptimeSeconds"),
        )

    def status(self) -> models.Status:
        data = self._json("GET", "/v1/status")
        endpoint_data = _mapping(data.get("endpoints"), "endpoints")
        node_data = _mapping(data.get("node"), "node")
        storage_data = _mapping(data.get("storage"), "storage")
        return models.Status(
            online=_bool(data, "online"),
            node_id=_str(data, "nodeId"),
            node_name=_str(data, "nodeName"),
            version=_str(data, "version"),
            storage_root=_str(data, "storageRoot"),
            capacity_bytes=_int(data, "capacityBytes"),
            used_bytes=_int(data, "usedBytes"),
            filesystem_used_bytes=_int(data, "filesystemUsedBytes"),
            available_bytes=_int(data, "availableBytes"),
            bucket_count=_int(data, "bucketCount"),
            object_count=_int(data, "objectCount"),
            requests_today=_int(data, "requestsToday"),
            uptime_seconds=_int(data, "uptimeSeconds"),
            endpoints=models.Endpoints(
                management=_str(endpoint_data, "management"),
                s3=_str(endpoint_data, "s3"),
                public=_str(endpoint_data, "public"),
                files=_str(endpoint_data, "files"),
                dashboard=_optional_str(endpoint_data, "dashboard"),
            ),
            node=models.NodeInfo(
                id=_str(node_data, "id"),
                name=_str(node_data, "name"),
                created_at=_datetime(node_data, "createdAt"),
                uptime_seconds=_int(node_data, "uptimeSeconds"),
            ),
            storage=models.StorageInfo(
                root=_str(storage_data, "root"),
                buckets=_int(storage_data, "buckets"),
                objects=_int(storage_data, "objects"),
                bytes=_int(storage_data, "bytes"),
                managed_bytes=_int(storage_data, "managedBytes"),
                filesystem_used_bytes=_int(storage_data, "filesystemUsedBytes"),
                total_bytes=_int(storage_data, "totalBytes"),
                free_bytes=_int(storage_data, "freeBytes"),
            ),
        )

    def client_configuration(self) -> models.ClientConfiguration:
        data = self._json("GET", "/v1/config/client")
        return models.ClientConfiguration(
            node_id=_str(data, "nodeId"),
            node_name=_str(data, "nodeName"),
            management_url=_str(data, "managementUrl"),
            s3_url=_str(data, "s3Url"),
            public_base_url=_optional_str(data, "publicBaseUrl"),
            files_url=_str(data, "filesUrl"),
            dashboard_url=_optional_str(data, "dashboardUrl"),
            storage_root=_str(data, "storageRoot"),
        )

    def list_buckets(self) -> list[models.Bucket]:
        data = self._json("GET", "/v1/buckets")
        return [_bucket(item) for item in _list(data.get("buckets"), "buckets")]

    def create_bucket(self, name: str, *, public: bool = False) -> models.Bucket:
        data = self._json("POST", "/v1/buckets", expected=(201,), payload={"name": name, "public": public})
        return _bucket(data.get("bucket"))

    def set_bucket_public(self, name: str, public: bool) -> models.Bucket:
        data = self._json("PATCH", f"/v1/buckets/{_encoded_segment(name)}", payload={"public": public})
        return _bucket(data.get("bucket"))

    def delete_bucket(self, name: str, *, force: bool = False) -> models.DeleteResult:
        data = self._json("DELETE", f"/v1/buckets/{_encoded_segment(name)}", query={"force": force} if force else None)
        return models.DeleteResult(deleted=_bool(data, "deleted"), bucket=_str(data, "bucket"))

    def list_objects(self, bucket: str, *, prefix: str = "") -> list[models.ObjectInfo]:
        data = self._json(
            "GET",
            f"/v1/buckets/{_encoded_segment(bucket)}/objects",
            query={"prefix": prefix} if prefix else None,
        )
        return [_object(item) for item in _list(data.get("objects"), "objects")]

    def upload_object(
        self,
        bucket: str,
        key: str,
        data: bytes | bytearray | memoryview | BinaryIO,
        *,
        content_type: str = "application/octet-stream",
        content_length: int | None = None,
    ) -> models.ObjectInfo:
        if "\r" in content_type or "\n" in content_type or not content_type:
            raise ValueError("content_type must be a valid non-empty HTTP header value.")
        body: Any
        if isinstance(data, (bytes, bytearray, memoryview)):
            body = bytes(data)
            if content_length is not None and content_length != len(body):
                raise ValueError("content_length does not match the byte payload length.")
            content_length = len(body)
        elif hasattr(data, "read"):
            body = data
            if content_length is None:
                content_length = self._remaining_length(data)
        else:
            raise TypeError("data must be bytes-like or a binary file object.")
        if content_length is not None and content_length < 0:
            raise ValueError("content_length cannot be negative.")

        path = f"/v1/buckets/{_encoded_segment(bucket)}/objects/{_encoded_key(key)}"
        headers = {"Content-Type": content_type, "Accept": "application/json"}
        if content_length is not None:
            headers["Content-Length"] = str(content_length)
        response = self._request("PUT", path, expected=(201,), data=body, headers=headers)
        url = self._url(path)
        try:
            raw = self._read_limited(response, self.max_metadata_bytes, url=url)
        finally:
            response.close()
        try:
            payload = _mapping(json.loads(raw.decode("utf-8")), "response")
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise OpenBucketProtocolError("OpenBucket returned malformed JSON.", url=url) from error
        return _object(payload.get("object"))

    def upload_file(
        self,
        bucket: str,
        key: str,
        source: str | os.PathLike[str],
        *,
        content_type: str = "application/octet-stream",
    ) -> models.ObjectInfo:
        source_path = Path(source)
        size = source_path.stat().st_size
        with source_path.open("rb") as stream:
            return self.upload_object(bucket, key, stream, content_type=content_type, content_length=size)

    @staticmethod
    def _remaining_length(stream: BinaryIO) -> int | None:
        try:
            if not stream.seekable():
                return None
            position = stream.tell()
            stream.seek(0, os.SEEK_END)
            end = stream.tell()
            stream.seek(position)
            return end - position
        except (AttributeError, OSError):
            return None

    def download_object(self, bucket: str, key: str, *, max_bytes: int | None = None) -> bytes:
        if max_bytes is not None and max_bytes < 0:
            raise ValueError("max_bytes cannot be negative.")
        path = f"/v1/buckets/{_encoded_segment(bucket)}/objects/{_encoded_key(key)}"
        response = self._request("GET", path, expected=(200,), headers={"Accept": "application/octet-stream"})
        try:
            declared = self._content_length(response, path)
            if max_bytes is not None and declared > max_bytes:
                raise OpenBucketProtocolError(
                    f"Object is {declared} bytes, exceeding max_bytes={max_bytes}.", url=self._url(path)
                )
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(65_536)
                if not chunk:
                    return b"".join(chunks)
                total += len(chunk)
                if max_bytes is not None and total > max_bytes:
                    raise OpenBucketProtocolError(
                        f"Object exceeded max_bytes={max_bytes} while downloading.", url=self._url(path)
                    )
                chunks.append(chunk)
        finally:
            response.close()

    def download_to(
        self,
        bucket: str,
        key: str,
        destination: str | os.PathLike[str],
        *,
        overwrite: bool = False,
        max_bytes: int | None = None,
    ) -> models.ObjectHead:
        if max_bytes is not None and max_bytes < 0:
            raise ValueError("max_bytes cannot be negative.")
        target = Path(destination)
        target.parent.mkdir(parents=True, exist_ok=True)
        path = f"/v1/buckets/{_encoded_segment(bucket)}/objects/{_encoded_key(key)}"
        response = self._request("GET", path, expected=(200,), headers={"Accept": "application/octet-stream"})
        head = self._head_from_response(response, path)
        if max_bytes is not None and head.size > max_bytes:
            response.close()
            raise OpenBucketProtocolError(
                f"Object is {head.size} bytes, exceeding max_bytes={max_bytes}.", url=self._url(path)
            )

        output = target.with_name(f".{target.name}.{os.getpid()}.openbucket-part") if overwrite else target
        mode = "wb" if overwrite else "xb"
        try:
            with output.open(mode) as stream:
                copied = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if max_bytes is not None and copied > max_bytes:
                        raise OpenBucketProtocolError(
                            f"Object exceeded max_bytes={max_bytes} while downloading.", url=self._url(path)
                        )
                    stream.write(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            if copied != head.size:
                raise OpenBucketProtocolError(
                    f"Object body was {copied} bytes but Content-Length declared {head.size}.", url=self._url(path)
                )
            if overwrite:
                os.replace(output, target)
            return head
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        finally:
            response.close()

    def head_object(self, bucket: str, key: str) -> models.ObjectHead:
        path = f"/v1/buckets/{_encoded_segment(bucket)}/objects/{_encoded_key(key)}"
        response = self._request("HEAD", path, expected=(200,), headers={"Accept": "application/octet-stream"})
        try:
            return self._head_from_response(response, path)
        finally:
            response.close()

    def _head_from_response(self, response: Any, path: str) -> models.ObjectHead:
        raw_modified = response.headers.get("Last-Modified")
        raw_etag = response.headers.get("ETag")
        if not raw_modified or not raw_etag:
            raise OpenBucketProtocolError("Object response omitted Last-Modified or ETag.", url=self._url(path))
        try:
            modified = parsedate_to_datetime(raw_modified)
        except (TypeError, ValueError) as error:
            raise OpenBucketProtocolError("Object response contained an invalid Last-Modified header.") from error
        if modified.tzinfo is None:
            raise OpenBucketProtocolError("Object Last-Modified header did not include a timezone.")
        etag = (
            raw_etag[1:-1] if len(raw_etag) >= 2 and raw_etag.startswith('"') and raw_etag.endswith('"') else raw_etag
        )
        return models.ObjectHead(
            size=self._content_length(response, path),
            last_modified=modified,
            etag=etag,
            content_type=response.headers.get_content_type(),
        )

    def _content_length(self, response: Any, path: str) -> int:
        raw = response.headers.get("Content-Length")
        try:
            length = int(raw)
        except (TypeError, ValueError) as error:
            raise OpenBucketProtocolError(
                "Object response omitted a valid Content-Length.", url=self._url(path)
            ) from error
        if length < 0:
            raise OpenBucketProtocolError("Object response contained a negative Content-Length.", url=self._url(path))
        return length

    def delete_object(self, bucket: str, key: str) -> models.DeleteResult:
        data = self._json("DELETE", f"/v1/buckets/{_encoded_segment(bucket)}/objects/{_encoded_key(key)}")
        return models.DeleteResult(deleted=_bool(data, "deleted"), bucket=_str(data, "bucket"), key=_str(data, "key"))

    def create_share(self, bucket: str, key: str, *, expires_in: int = 3600) -> models.Share:
        if isinstance(expires_in, bool) or not 1 <= expires_in <= 604_800:
            raise ValueError("expires_in must be an integer from 1 through 604800.")
        data = self._json(
            "POST",
            f"/v1/buckets/{_encoded_segment(bucket)}/share",
            expected=(201,),
            payload={"key": key, "expiresIn": expires_in},
        )
        return models.Share(
            url=_str(data, "url"),
            expires_at=_datetime(data, "expiresAt"),
            bucket=_str(data, "bucket"),
            key=_str(data, "key"),
        )

    def list_keys(self) -> list[models.AccessKey]:
        data = self._json("GET", "/v1/keys")
        return [_access_key(item) for item in _list(data.get("keys"), "keys")]

    def create_key(
        self,
        *,
        name: str = "access key",
        read_only: bool = False,
        bucket: str | None = None,
    ) -> models.AccessKey:
        data = self._json(
            "POST",
            "/v1/keys",
            expected=(201,),
            payload={"name": name, "readOnly": read_only, "bucket": bucket},
        )
        key = _access_key(data.get("key"))
        if key.secret_access_key is None:
            raise OpenBucketProtocolError("Create-key response omitted secretAccessKey.")
        return key

    def revoke_key(self, key_id: str) -> models.DeleteResult:
        data = self._json("DELETE", f"/v1/keys/{_encoded_segment(key_id)}")
        return models.DeleteResult(deleted=_bool(data, "deleted"), id=_str(data, "id"))

    def logs(self, *, limit: int = 100) -> list[models.RequestLog]:
        if isinstance(limit, bool) or not 1 <= limit <= 1000:
            raise ValueError("limit must be an integer from 1 through 1000.")
        data = self._json("GET", "/v1/logs", query={"limit": limit})
        return [_request_log(item) for item in _list(data.get("logs"), "logs")]

    def analytics(self) -> models.Analytics:
        data = self._json("GET", "/v1/analytics")
        daily: list[models.DailyAnalytics] = []
        for item in _list(data.get("recentDaily"), "recentDaily"):
            entry = _mapping(item, "daily analytics")
            try:
                day = date.fromisoformat(_str(entry, "date"))
            except ValueError as error:
                raise OpenBucketProtocolError("Daily analytics contained an invalid date.") from error
            daily.append(
                models.DailyAnalytics(
                    date=day,
                    requests=_int(entry, "requests"),
                    bytes_in=_int(entry, "bytesIn"),
                    bytes_out=_int(entry, "bytesOut"),
                )
            )
        storage = _mapping(data.get("storage"), "analytics storage")
        return models.Analytics(
            requests=_int(data, "requests"),
            requests_today=_int(data, "requestsToday"),
            total_bytes_in=_int(data, "totalBytesIn"),
            total_bytes_out=_int(data, "totalBytesOut"),
            average_latency_ms=_number(data, "averageLatencyMs"),
            errors=_int(data, "errors"),
            status_codes=_counts(data.get("statusCodes"), "statusCodes"),
            methods=_counts(data.get("methods"), "methods"),
            recent_daily=tuple(daily),
            storage=models.AnalyticsStorage(
                bucket_count=_int(storage, "bucketCount"),
                object_count=_int(storage, "objectCount"),
                used_bytes=_int(storage, "usedBytes"),
            ),
        )

    def stop(self) -> models.StopResult:
        data = self._json("POST", "/v1/stop", expected=(202,), payload={})
        return models.StopResult(stopping=_bool(data, "stopping"))
