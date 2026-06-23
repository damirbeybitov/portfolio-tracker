"""
dag_daily_fx_ingest.py
──────────────────────
Fetches the USD/KZT exchange rate once a day and upserts it into the
`fx_rates` table that the FastAPI backend already uses.

Why this DAG?
  The backend's FxService fetches the rate lazily (on first request per day)
  via free CDN APIs and stores it.  That's fine in production, but means the
  very first analytics call of the day bears the latency.  This DAG pre-warms
  the table at 00:15 UTC so the rate is ready before any user opens the app.

It also acts as a canary: if all three FX providers fail, the DAG fails loudly
in Airflow instead of silently falling back to a stale rate inside the app.

Schedule: 00:15 UTC daily (5 minutes after the price ingest, same cluster).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

import httpx
from airflow.decorators import dag, task
from airflow.utils.dates import days_ago
from sqlalchemy import text

from common.db import session_scope

log = logging.getLogger("airflow.task")

TIMEOUT = httpx.Timeout(10.0, connect=5.0)
HEADERS = {
    "User-Agent": "PortfolioTracker-Airflow/1.0",
    "Accept": "application/json",
}

# ── DAG ──────────────────────────────────────────────────────────────────────

@dag(
    dag_id="daily_fx_ingest",
    description="Fetch USD/KZT rate from free APIs and upsert into fx_rates.",
    schedule_interval="15 0 * * *",
    start_date=days_ago(1),
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 3,
        "retry_delay": timedelta(minutes=5),
        "owner": "portfolio",
    },
    tags=["fx", "portfolio", "daily"],
)
def daily_fx_ingest():

    @task()
    def fetch_usd_kzt() -> float:
        """
        Try three free providers in order.  Return the first successful rate.
        Raises RuntimeError (→ Airflow task failure) if all three fail.
        """
        rate = _try_fawazahmed0()
        if rate:
            log.info("FX from fawazahmed0: %.4f", rate)
            return rate

        rate = _try_open_er_api()
        if rate:
            log.info("FX from open.er-api: %.4f", rate)
            return rate

        rate = _try_frankfurter()
        if rate:
            log.info("FX from frankfurter: %.4f", rate)
            return rate

        raise RuntimeError(
            "All FX providers failed — USD/KZT rate could not be fetched."
        )

    @task()
    def upsert_fx_rate(rate: float) -> dict:
        today = date.today()
        rate_dec = round(Decimal(str(rate)), 4)

        upsert_sql = text(
            """
            INSERT INTO fx_rates (date, usd_to_kzt, source)
            VALUES (:date, :rate, :source)
            ON CONFLICT (date) DO UPDATE SET
                usd_to_kzt = EXCLUDED.usd_to_kzt,
                source      = EXCLUDED.source
            RETURNING id, (xmax = 0) AS was_inserted
            """
        )

        with session_scope() as session:
            result = session.execute(
                upsert_sql,
                {"date": today, "rate": float(rate_dec), "source": "airflow_dag"},
            )
            row = result.fetchone()

        action = "inserted" if (row and row[1]) else "updated"
        log.info("FX rate for %s: %.4f (%s, id=%s)", today, rate_dec, action, row[0] if row else "?")

        return {"date": today.isoformat(), "rate": float(rate_dec), "action": action}

    @task()
    def log_result(result: dict) -> None:
        log.info(
            "FX ingest done — date: %s  rate: %.4f  action: %s",
            result["date"], result["rate"], result["action"],
        )

    rate   = fetch_usd_kzt()
    result = upsert_fx_rate(rate)
    log_result(result)


# ── Provider helpers ─────────────────────────────────────────────────────────

def _try_fawazahmed0() -> float | None:
    urls = [
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
        "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
    ]
    for url in urls:
        try:
            with httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True) as client:
                r = client.get(url)
                r.raise_for_status()
                kzt = r.json().get("usd", {}).get("kzt")
                if kzt:
                    return float(kzt)
        except Exception as exc:
            log.debug("fawazahmed0 %s: %s", url, exc)
    return None


def _try_open_er_api() -> float | None:
    try:
        with httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True) as client:
            r = client.get("https://open.er-api.com/v6/latest/USD")
            r.raise_for_status()
            kzt = r.json().get("rates", {}).get("KZT")
            return float(kzt) if kzt else None
    except Exception as exc:
        log.debug("open.er-api: %s", exc)
        return None


def _try_frankfurter() -> float | None:
    try:
        with httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True) as client:
            r = client.get("https://api.frankfurter.app/latest?from=USD&to=KZT")
            r.raise_for_status()
            kzt = r.json().get("rates", {}).get("KZT")
            return float(kzt) if kzt else None
    except Exception as exc:
        log.debug("frankfurter: %s", exc)
        return None


daily_fx_ingest_dag = daily_fx_ingest()
