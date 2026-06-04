"""
Request logging middleware.

Fix: LogRecord already has a built-in 'name' attribute (the logger name).
Overwriting it raises KeyError in some Python/logging versions.
Renamed the custom field to 'req_name' / removed the conflict entirely.
"""

import logging
import time
import uuid
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("app.middleware.request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())[:8]
        start = time.perf_counter()

        # Attach request_id so downstream code can use it
        request.state.request_id = request_id

        try:
            response: Response = await call_next(request)
            elapsed_ms = (time.perf_counter() - start) * 1000

            logger.info(
                "[%s] %s %s %s  %.1fms",
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
            )
            return response

        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.error(
                "[%s] Unhandled exception on %s %s  %.1fms — %s",
                request_id,
                request.method,
                request.url.path,
                elapsed_ms,
                exc,
                exc_info=True,
            )
            raise
