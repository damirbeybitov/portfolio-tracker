"""
common.db — connection to the app's PostgreSQL database (the same one
FastAPI backend uses), for DAGs that need to read portfolio data or write
ingested price history.

Connection is via the APP_DATABASE_URL env var, already injected into every
Airflow container by docker-compose.yml (see x-airflow-common.environment).
No Airflow Connection / UI setup needed.

NOTE on SQLAlchemy version: Airflow 2.9.3 pins SQLAlchemy<2.0 (currently
1.4.52) via its own constraints file — see airflow/Dockerfile. This module
is written in 1.4-compatible style (sessionmaker + plain Session, no 2.0
`Mapped[]`/declarative annotations) so it doesn't fight that pin. Don't
import sqlalchemy==2.x idioms here even if you're used to them from the
backend (which uses SQLAlchemy 2.0 async) — the two codebases intentionally
run different major versions of the same library.

Usage in a DAG:

    from common.db import get_engine, session_scope

    def my_task():
        with session_scope() as session:
            rows = session.execute(text("SELECT 1")).fetchall()

    # or, for pandas / raw SQL:
    engine = get_engine()
    df = pd.read_sql("SELECT * FROM securities", engine)
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

logger = logging.getLogger("airflow.task")

_ENV_VAR = "APP_DATABASE_URL"

# Module-level cache — one Engine per worker process, reused across tasks
# instead of opening a fresh connection pool on every call.
_engine: Engine | None = None
_SessionFactory: sessionmaker | None = None


class AppDatabaseConfigError(RuntimeError):
    """Raised when APP_DATABASE_URL is missing or malformed."""


def get_database_url() -> str:
    """
    Return the app DB connection string from APP_DATABASE_URL.

    Raises AppDatabaseConfigError with a clear message if it's unset —
    fails fast with an obvious cause instead of a cryptic SQLAlchemy error
    further down the stack.
    """
    url = os.environ.get(_ENV_VAR)
    if not url:
        raise AppDatabaseConfigError(
            f"{_ENV_VAR} is not set. Check docker-compose.yml — it should be "
            f"injected via x-airflow-common.environment for every Airflow "
            f"service (webserver, scheduler, and any task containers)."
        )
    return url


def get_engine(*, echo: bool = False) -> Engine:
    """
    Return a process-wide cached SQLAlchemy Engine for the app database.

    pool_pre_ping avoids handing out dead connections after the app DB
    container restarts or a long-idle connection gets dropped — cheap
    insurance for a once-a-day batch job where a stale connection would
    otherwise silently fail the whole DAG run.
    """
    global _engine
    if _engine is None:
        url = get_database_url()
        _engine = create_engine(
            url,
            echo=echo,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            future=False,  # stay on 1.4 legacy engine style, not the 2.0-style "future" engine
        )
        logger.info("Created SQLAlchemy engine for app database (host hidden from logs)")
    return _engine


def get_session_factory() -> sessionmaker:
    """Return a process-wide cached sessionmaker bound to get_engine()."""
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(bind=get_engine(), autocommit=False, autoflush=False)
    return _SessionFactory


@contextmanager
def session_scope() -> Iterator[Session]:
    """
    Context manager yielding a SQLAlchemy Session, committing on success and
    rolling back on any exception — mirrors the pattern in app/db/session.py
    (get_db) on the FastAPI side, just sync instead of async since Airflow
    tasks run sync.

    with session_scope() as session:
        session.execute(...)
        # commits automatically on clean exit
    """
    session: Session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def dispose_engine() -> None:
    """
    Close all pooled connections and drop the cached engine/session factory.

    Not needed in normal DAG runs (the process exits and the pool goes with
    it), but useful in tests or a long-lived process that wants to force a
    clean reconnect.
    """
    global _engine, _SessionFactory
    if _engine is not None:
        _engine.dispose()
        logger.info("Disposed app database engine")
    _engine = None
    _SessionFactory = None