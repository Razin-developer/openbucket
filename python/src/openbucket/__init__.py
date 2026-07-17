"""Typed Python client for the OpenBucket management API."""

from .client import OpenBucketClient
from .exceptions import (
    OpenBucketConfigurationError,
    OpenBucketConnectionError,
    OpenBucketError,
    OpenBucketHTTPError,
    OpenBucketProtocolError,
)
from .models import (
    AccessKey,
    Analytics,
    AnalyticsStorage,
    Bucket,
    ClientConfiguration,
    DailyAnalytics,
    DeleteResult,
    Endpoints,
    Health,
    NodeInfo,
    ObjectHead,
    ObjectInfo,
    RequestLog,
    Share,
    Status,
    StopResult,
    StorageInfo,
)

__version__ = "0.1.1"

__all__ = [
    "AccessKey",
    "Analytics",
    "AnalyticsStorage",
    "Bucket",
    "ClientConfiguration",
    "DailyAnalytics",
    "DeleteResult",
    "Endpoints",
    "Health",
    "NodeInfo",
    "ObjectHead",
    "ObjectInfo",
    "OpenBucketClient",
    "OpenBucketConfigurationError",
    "OpenBucketConnectionError",
    "OpenBucketError",
    "OpenBucketHTTPError",
    "OpenBucketProtocolError",
    "RequestLog",
    "Share",
    "Status",
    "StopResult",
    "StorageInfo",
    "__version__",
]
