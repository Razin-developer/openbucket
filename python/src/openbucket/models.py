"""Immutable public data models returned by :class:`OpenBucketClient`."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class Health:
    ok: bool
    status: str
    version: str
    node_id: str
    uptime_seconds: int


@dataclass(frozen=True, slots=True)
class Endpoints:
    management: str
    s3: str
    public: str
    files: str
    dashboard: str | None


@dataclass(frozen=True, slots=True)
class NodeInfo:
    id: str
    name: str
    created_at: datetime
    uptime_seconds: int


@dataclass(frozen=True, slots=True)
class StorageInfo:
    root: str
    buckets: int
    objects: int
    bytes: int
    managed_bytes: int
    filesystem_used_bytes: int
    total_bytes: int
    free_bytes: int


@dataclass(frozen=True, slots=True)
class Status:
    online: bool
    node_id: str
    node_name: str
    version: str
    storage_root: str
    capacity_bytes: int
    used_bytes: int
    filesystem_used_bytes: int
    available_bytes: int
    bucket_count: int
    object_count: int
    requests_today: int
    uptime_seconds: int
    endpoints: Endpoints
    node: NodeInfo
    storage: StorageInfo


@dataclass(frozen=True, slots=True)
class ClientConfiguration:
    node_id: str
    node_name: str
    management_url: str
    s3_url: str
    public_base_url: str | None
    files_url: str
    dashboard_url: str | None
    storage_root: str


@dataclass(frozen=True, slots=True)
class Bucket:
    name: str
    created_at: datetime
    public: bool
    object_count: int | None = None
    size_bytes: int | None = None


@dataclass(frozen=True, slots=True)
class ObjectInfo:
    key: str
    size: int
    last_modified: datetime
    etag: str
    url: str | None = None


@dataclass(frozen=True, slots=True)
class ObjectHead:
    size: int
    last_modified: datetime
    etag: str
    content_type: str


@dataclass(frozen=True, slots=True)
class AccessKey:
    id: str
    name: str
    access_key_id: str
    created_at: datetime
    read_only: bool
    bucket: str | None
    secret_access_key: str | None = None


@dataclass(frozen=True, slots=True)
class Share:
    url: str
    expires_at: datetime
    bucket: str
    key: str


@dataclass(frozen=True, slots=True)
class RequestLog:
    timestamp: datetime
    request_id: str
    method: str
    path: str
    status: int
    duration_ms: float
    bytes_in: int
    bytes_out: int
    ip: str
    user_agent: str
    service: str
    access_key_id: str | None = None


@dataclass(frozen=True, slots=True)
class DailyAnalytics:
    date: date
    requests: int
    bytes_in: int
    bytes_out: int


@dataclass(frozen=True, slots=True)
class AnalyticsStorage:
    bucket_count: int
    object_count: int
    used_bytes: int


@dataclass(frozen=True, slots=True)
class Analytics:
    requests: int
    requests_today: int
    total_bytes_in: int
    total_bytes_out: int
    average_latency_ms: float
    errors: int
    status_codes: Mapping[str, int]
    methods: Mapping[str, int]
    recent_daily: tuple[DailyAnalytics, ...]
    storage: AnalyticsStorage


@dataclass(frozen=True, slots=True)
class DeleteResult:
    deleted: bool
    bucket: str | None = None
    key: str | None = None
    id: str | None = None


@dataclass(frozen=True, slots=True)
class StopResult:
    stopping: bool


JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject = Mapping[str, Any]
