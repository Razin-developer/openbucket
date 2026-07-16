"""Exceptions raised by the OpenBucket client."""

from __future__ import annotations

from typing import Any


class OpenBucketError(Exception):
    """Base class for all client errors."""


class OpenBucketConfigurationError(OpenBucketError, ValueError):
    """The client was configured with an invalid URL, token, or timeout."""


class OpenBucketConnectionError(OpenBucketError, ConnectionError):
    """The management API could not be reached."""

    def __init__(self, message: str, *, url: str) -> None:
        super().__init__(message)
        self.url = url


class OpenBucketProtocolError(OpenBucketError):
    """The server returned a response that does not match the management API."""

    def __init__(self, message: str, *, url: str | None = None) -> None:
        super().__init__(message)
        self.url = url


class OpenBucketHTTPError(OpenBucketError):
    """The management API rejected a request.

    ``code`` is OpenBucket's stable error code when the server returned one.
    ``details`` and ``request_id`` are retained for structured diagnostics.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        request_id: str | None = None,
        details: Any = None,
        url: str | None = None,
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details
        self.url = url
        suffix = f" (request {request_id})" if request_id else ""
        super().__init__(f"OpenBucket API error {status} {code}: {message}{suffix}")
