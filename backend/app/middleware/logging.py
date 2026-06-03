"""
HTTP request/response logging middleware.

Per-request:
  - Assigns a UUID trace ID (propagated via X-Request-ID header)
  - Logs method, path, query params on arrival
  - Logs status code + wall-clock duration on completion
  - Captures and re-raises unhandled exceptions with full context
"""

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging_config import request_id_var, request_path_var

logger = logging.getLogger("app.middleware.request")

# Paths we skip logging for (health checks would spam logs)
_SILENT_PATHS = {"/api/health", "/api/docs", "/api/redoc", "/api/openapi.json", "/favicon.ico"}


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # Respect upstream trace ID (e.g. from a load balancer) or mint one
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        token_rid = request_id_var.set(rid)
        token_path = request_path_var.set(request.url.path)

        silent = request.url.path in _SILENT_PATHS
        start = time.perf_counter()

        if not silent:
            logger.info(
                "→ %s %s",
                request.method,
                request.url.path,
                extra={
                    "http_method": request.method,
                    "http_path": request.url.path,
                    "http_query": str(request.url.query) or None,
                    "client_ip": _get_client_ip(request),
                    "user_agent": request.headers.get("user-agent"),
                },
            )

        status_code = 500
        try:
            response: Response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as exc:
            logger.exception(
                "Unhandled exception on %s %s",
                request.method,
                request.url.path,
                extra={"http_method": request.method, "http_path": request.url.path},
            )
            raise
        finally:
            duration_ms = (time.perf_counter() - start) * 1000

            if not silent:
                level = logging.INFO if status_code < 400 else (
                    logging.WARNING if status_code < 500 else logging.ERROR
                )
                logger.log(
                    level,
                    "← %s %s %d  %.1fms",
                    request.method,
                    request.url.path,
                    status_code,
                    duration_ms,
                    extra={
                        "http_method": request.method,
                        "http_path": request.url.path,
                        "http_status": status_code,
                        "duration_ms": round(duration_ms, 2),
                    },
                )

            request_id_var.reset(token_rid)
            request_path_var.reset(token_path)


def _get_client_ip(request: Request) -> str:
    """Extract real client IP, respecting reverse proxy headers."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
