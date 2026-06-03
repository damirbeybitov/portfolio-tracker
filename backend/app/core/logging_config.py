"""
Structured JSON logging configuration for Portfolio Tracker.

Features:
- JSON-formatted logs for production (easy ingestion by Datadog, ELK, etc.)
- Pretty console logs for development
- Request ID tracing via contextvars
- Performance timing
- Sensitive field redaction
"""

import logging
import logging.config
import json
import sys
import time
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings

# ── Context variable for per-request trace ID ──────────────────────────────
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
request_path_var: ContextVar[str] = ContextVar("request_path", default="-")


# ── JSON Formatter ──────────────────────────────────────────────────────────
class JsonFormatter(logging.Formatter):
    """Emit each log record as a single JSON line — safe for log aggregators."""

    REDACT_KEYS = {"password", "hashed_password", "access_token", "refresh_token", "authorization"}

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "module": record.module,
            "func": record.funcName,
            "line": record.lineno,
            "request_id": request_id_var.get("-"),
            "path": request_path_var.get("-"),
        }

        # Attach extra fields supplied via logger.info("...", extra={...})
        for key, val in record.__dict__.items():
            if key.startswith("_") or key in {
                "name", "msg", "args", "levelname", "levelno", "pathname",
                "filename", "module", "exc_info", "exc_text", "stack_info",
                "lineno", "funcName", "created", "msecs", "relativeCreated",
                "thread", "threadName", "processName", "process", "message",
                "taskName",
            }:
                continue
            if key.lower() in self.REDACT_KEYS:
                payload[key] = "***REDACTED***"
            else:
                payload[key] = val

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        return json.dumps(payload, default=str, ensure_ascii=False)


# ── Dev Formatter (colored, human-readable) ─────────────────────────────────
class DevFormatter(logging.Formatter):
    COLORS = {
        "DEBUG":    "\033[36m",   # cyan
        "INFO":     "\033[32m",   # green
        "WARNING":  "\033[33m",   # yellow
        "ERROR":    "\033[31m",   # red
        "CRITICAL": "\033[35m",   # magenta
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        rid = request_id_var.get("-")
        rid_str = f"[{rid[:8]}] " if rid != "-" else ""
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]

        base = (
            f"{color}{ts} {record.levelname:<8}{self.RESET} "
            f"\033[90m{record.name}:{record.lineno}{self.RESET} "
            f"{rid_str}{record.getMessage()}"
        )

        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)

        return base


def configure_logging() -> None:
    """Call once at application startup."""
    is_dev = settings.ENVIRONMENT == "development"

    formatter_class = "app.core.logging_config.DevFormatter" if is_dev else "app.core.logging_config.JsonFormatter"

    config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": formatter_class,
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "default",
            }
        },
        "root": {
            "level": "DEBUG" if is_dev else "INFO",
            "handlers": ["console"],
        },
        "loggers": {
            # Silence overly chatty third-party libs
            "uvicorn.access": {"level": "WARNING", "propagate": False},
            "sqlalchemy.engine": {"level": "WARNING", "propagate": True},
            "yfinance": {"level": "WARNING", "propagate": True},
            "httpx": {"level": "WARNING", "propagate": True},
            "asyncio": {"level": "WARNING", "propagate": True},
            # Our app loggers - verbose in dev
            "app": {"level": "DEBUG" if is_dev else "INFO", "propagate": True},
        },
    }

    logging.config.dictConfig(config)
