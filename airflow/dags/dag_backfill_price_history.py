"""
dag_backfill_price_history.py
─────────────────────────────
Manually triggered DAG to back-fill price_history over any date range.

Trigger via Airflow UI → Trigger DAG w/ config:
    { "start_date": "2020-01-01", "end_date": "2026-06-22" }

Optional — restrict to specific tickers:
    { "start_date": "2023-01-01", "end_date": "2026-06-22",
      "tickers_override": "AAPL,NVDA,TSLA" }

Provider chain: Alpha Vantage → Twelve Data → yfinance (same as daily DAG).
Idempotent: ON CONFLICT DO UPDATE — safe to re-run.
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import date, timedelta

import httpx
import pandas as pd
from airflow.decorators import dag, task
from airflow.models.param import Param
from airflow.utils.dates import days_ago
from sqlalchemy import text

_YF_CACHE = os.path.join(tempfile.gettempdir(), f"yf_cache_{os.getpid()}")
os.makedirs(_YF_CACHE, exist_ok=True)

import yfinance as yf

try:
    yf.set_tz_cache_location(_YF_CACHE)
except Exception:
    pass

from common.db import session_scope
from common.tickers import get_held_tickers

# Import shared helpers from the daily DAG module
from dag_daily_price_ingest import (
    _fetch_ohlcv,
    _upsert,
    AV_KEY,
    TD_KEY,
)

log = logging.getLogger("airflow.task")


@dag(
    dag_id="backfill_price_history",
    description="Manual: back-fill OHLCV for held tickers from start_date to end_date.",
    schedule_interval=None,
    start_date=days_ago(1),
    catchup=False,
    max_active_runs=1,
    params={
        "start_date": Param(
            default=(date.today() - timedelta(days=5 * 365)).isoformat(),
            type="string",
            description="YYYY-MM-DD",
        ),
        "end_date": Param(
            default=date.today().isoformat(),
            type="string",
            description="YYYY-MM-DD",
        ),
        "tickers_override": Param(
            default="",
            type=["null", "string"],
            description="Comma-separated, e.g. AAPL,MSFT. Leave blank for all held.",
        ),
    },
    default_args={
        "retries": 1,
        "retry_delay": timedelta(minutes=5),
        "owner": "portfolio",
    },
    tags=["prices", "portfolio", "backfill", "manual"],
)
def backfill_price_history():

    @task()
    def resolve_params(**context) -> dict:
        params = context["params"]
        try:
            start = date.fromisoformat(params["start_date"])
        except Exception:
            start = date.today() - timedelta(days=5 * 365)
        try:
            end = date.fromisoformat(params["end_date"])
        except Exception:
            end = date.today()

        if start >= end:
            raise ValueError(f"start_date ({start}) must be < end_date ({end})")

        override = (params.get("tickers_override") or "").strip()
        if override:
            tickers_upper = [t.strip().upper() for t in override.split(",") if t.strip()]
            with session_scope() as session:
                rows = session.execute(
                    text("SELECT id, ticker FROM securities WHERE ticker = ANY(:t)"),
                    {"t": tickers_upper},
                ).fetchall()
            id_map = {r.ticker: r.id for r in rows}
            unknown = set(tickers_upper) - set(id_map)
            if unknown:
                log.warning("Unknown tickers (not in DB): %s", unknown)
            securities = [
                {"ticker": t, "security_id": id_map[t]}
                for t in tickers_upper
                if t in id_map
            ]
        else:
            held = get_held_tickers()
            securities = [{"ticker": t.ticker, "security_id": t.security_id} for t in held]

        log.info(
            "Backfill: %s → %s  tickers (%d): %s",
            start, end, len(securities), [s["ticker"] for s in securities],
        )
        return {
            "start_date": start.isoformat(),
            "end_date":   end.isoformat(),
            "securities": securities,
        }

    @task()
    def run_backfill(resolved: dict) -> dict:
        securities = resolved["securities"]
        start      = date.fromisoformat(resolved["start_date"])
        end        = date.fromisoformat(resolved["end_date"])

        if not securities:
            log.info("Nothing to backfill.")
            return {"totals": {}, "per_ticker": {}, "errors": []}

        per_ticker: dict[str, dict] = {}
        errors: list[str] = []
        total_ins = total_upd = total_rows = 0

        with session_scope() as session:
            for s in securities:
                ticker = s["ticker"]
                sec_id = s["security_id"]
                try:
                    df = _fetch_ohlcv(ticker, start, end)
                    if df is None or df.empty:
                        log.warning("[%s] no data for range", ticker)
                        per_ticker[ticker] = {"rows": 0, "inserted": 0, "updated": 0}
                        continue

                    ins, upd = _upsert(session, sec_id, ticker, df)
                    per_ticker[ticker] = {"rows": len(df), "inserted": ins, "updated": upd}
                    total_ins  += ins
                    total_upd  += upd
                    total_rows += len(df)
                    log.info("[%s] rows=%d ins=%d upd=%d", ticker, len(df), ins, upd)

                except Exception as exc:
                    msg = f"{ticker}: {exc}"
                    log.error(msg, exc_info=True)
                    errors.append(msg)
                    per_ticker[ticker] = {"error": str(exc)}

        return {
            "per_ticker": per_ticker,
            "errors":     errors,
            "totals":     {"rows": total_rows, "inserted": total_ins, "updated": total_upd},
        }

    @task()
    def log_result(result: dict) -> None:
        totals = result.get("totals", {})
        errors = result.get("errors", [])
        log.info("=" * 60)
        log.info("BACKFILL COMPLETE")
        log.info("  Total rows : %d", totals.get("rows", 0))
        log.info("  Inserted   : %d", totals.get("inserted", 0))
        log.info("  Updated    : %d", totals.get("updated", 0))
        log.info("  Errors     : %d", len(errors))
        for ticker, stats in result.get("per_ticker", {}).items():
            if "error" in stats:
                log.warning("  ✗ %-8s  %s", ticker, stats["error"])
            else:
                log.info("  ✓ %-8s  rows=%-5d ins=%d upd=%d",
                         ticker, stats["rows"], stats["inserted"], stats["updated"])
        log.info("=" * 60)

    resolved = resolve_params()
    result   = run_backfill(resolved)
    log_result(result)


backfill_price_history_dag = backfill_price_history()