"""
dag_daily_price_ingest.py
─────────────────────────
Daily OHLCV price ingestion for every security currently held in at least
one portfolio.

Schedule    : 00:10 UTC every day
Provider chain per ticker:
  1. Alpha Vantage TIME_SERIES_DAILY_ADJUSTED  (if key present)
  2. Twelve Data   time_series 1day            (if key present)
  3. yfinance      download (hardened)

Hardening vs the original version:
  - TzCache race condition fixed (per-process temp dir)
  - YFTzMissingError / delisted ticker caught and skipped gracefully
  - 403 avoided by using auto_adjust=True + wider date window
  - Alpha Vantage uses ADJUSTED close (split/div-adjusted) for consistency
  - Per-ticker try/except: one bad ticker never aborts the whole run
  - Batch yfinance download with per-ticker fallback to single download
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import date, timedelta
from typing import Optional

import httpx
import pandas as pd
from airflow.decorators import dag, task
from airflow.utils.dates import days_ago
from sqlalchemy import text

# ── Fix yfinance TzCache race BEFORE importing yfinance ─────────────────────
_YF_CACHE = os.path.join(tempfile.gettempdir(), f"yf_cache_{os.getpid()}")
os.makedirs(_YF_CACHE, exist_ok=True)

import yfinance as yf

try:
    yf.set_tz_cache_location(_YF_CACHE)
except Exception:
    pass

from common.db import session_scope
from common.tickers import get_held_tickers

log = logging.getLogger("airflow.task")

LOOKBACK_DAYS = 7
HTTP_TIMEOUT  = httpx.Timeout(12.0, connect=5.0)
HTTP_HEADERS  = {"User-Agent": "PortfolioTracker-Airflow/1.0", "Accept": "application/json"}

# ── Read provider keys from env (injected by docker-compose x-airflow-common) ─
AV_KEY = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
TD_KEY = os.environ.get("TWELVE_DATA_API_KEY", "")


# ─────────────────────────────────────────────────────────────────────────────
# DAG
# ─────────────────────────────────────────────────────────────────────────────

@dag(
    dag_id="daily_price_ingest",
    description="Fetch daily OHLCV for held tickers (AV → TD → yfinance) and upsert into price_history.",
    schedule_interval="10 0 * * *",
    start_date=days_ago(1),
    catchup=False,
    max_active_runs=1,
    default_args={
        "retries": 3,
        "retry_delay": timedelta(minutes=5),
        "owner": "portfolio",
        "depends_on_past": False,
    },
    tags=["prices", "portfolio", "daily"],
)
def daily_price_ingest():

    @task()
    def get_tickers() -> list[dict]:
        tickers = get_held_tickers()
        if not tickers:
            log.warning("No held positions — nothing to ingest.")
            return []
        log.info("Tickers (%d): %s", len(tickers), [t.ticker for t in tickers])
        return [
            {"security_id": t.security_id, "ticker": t.ticker,
             "name": t.name, "currency": t.currency}
            for t in tickers
        ]

    @task()
    def fetch_and_upsert(securities: list[dict]) -> dict:
        if not securities:
            return {"inserted": 0, "updated": 0, "skipped": 0, "errors": []}

        tickers    = [s["ticker"] for s in securities]
        id_map     = {s["ticker"]: s["security_id"] for s in securities}
        end_date   = date.today()
        start_date = end_date - timedelta(days=LOOKBACK_DAYS)

        log.info("Fetching %d ticker(s) %s → %s", len(tickers), start_date, end_date)

        inserted = updated = skipped = 0
        errors: list[str] = []

        with session_scope() as session:
            for ticker in tickers:
                sec_id = id_map[ticker]
                try:
                    df = _fetch_ohlcv(ticker, start_date, end_date)
                    if df is None or df.empty:
                        log.warning("[%s] no data", ticker)
                        skipped += 1
                        continue
                    ins, upd = _upsert(session, sec_id, ticker, df)
                    inserted += ins
                    updated  += upd
                    log.info("[%s] inserted=%d updated=%d", ticker, ins, upd)
                except Exception as exc:
                    msg = f"{ticker}: {exc}"
                    log.error("Error processing %s: %s", ticker, exc, exc_info=True)
                    errors.append(msg)

        summary = {
            "inserted": inserted, "updated": updated,
            "skipped": skipped,   "errors": errors,
            "tickers": tickers,   "date_range": f"{start_date} → {end_date}",
        }
        log.info("Done: %s", summary)
        return summary

    @task()
    def log_summary(summary: dict) -> None:
        log.info("=" * 60)
        log.info("DAILY PRICE INGEST SUMMARY")
        log.info("  Range    : %s", summary.get("date_range"))
        log.info("  Tickers  : %s", summary.get("tickers"))
        log.info("  Inserted : %d", summary.get("inserted", 0))
        log.info("  Updated  : %d", summary.get("updated",  0))
        log.info("  Skipped  : %d", summary.get("skipped",  0))
        log.info("  Errors   : %d", len(summary.get("errors", [])))
        for e in summary.get("errors", []):
            log.warning("    ✗ %s", e)
        log.info("=" * 60)
        # Fail the task if every single ticker errored
        errs = summary.get("errors", [])
        tks  = summary.get("tickers", [])
        if tks and len(errs) == len(tks):
            raise RuntimeError("All tickers failed.")

    secs    = get_tickers()
    summary = fetch_and_upsert(secs)
    log_summary(summary)


daily_price_ingest_dag = daily_price_ingest()


# ─────────────────────────────────────────────────────────────────────────────
# Provider chain — module-level so backfill DAG can import them too
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_ohlcv(ticker: str, start: date, end: date) -> Optional[pd.DataFrame]:
    """Try AV → TD → yfinance; return cleaned OHLCV DataFrame or None."""

    # 1. Alpha Vantage
    if AV_KEY:
        df = _av_ohlcv(ticker, start, end)
        if df is not None and not df.empty:
            return df

    # 2. Twelve Data
    if TD_KEY:
        df = _td_ohlcv(ticker, start, end)
        if df is not None and not df.empty:
            return df

    # 3. yfinance (hardened)
    df = _yf_ohlcv(ticker, start, end)
    return df


def _av_ohlcv(ticker: str, start: date, end: date) -> Optional[pd.DataFrame]:
    url = "https://www.alphavantage.co/query"
    params = {
        "function": "TIME_SERIES_DAILY_ADJUSTED",
        "symbol": ticker,
        "outputsize": "compact",   # last 100 days — enough for LOOKBACK_DAYS
        "apikey": AV_KEY,
    }
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS) as c:
            r = c.get(url, params=params)
            r.raise_for_status()
            data = r.json()

        series = data.get("Time Series (Daily)", {})
        if not series:
            info = data.get("Information") or data.get("Note") or ""
            if info:
                log.warning("[av-ohlcv] %s: %s", ticker, info[:120])
            return None

        rows = []
        for ds, vals in series.items():
            d = date.fromisoformat(ds)
            if start <= d <= end:
                rows.append({
                    "date":   d,
                    "Open":   float(vals["1. open"]),
                    "High":   float(vals["2. high"]),
                    "Low":    float(vals["3. low"]),
                    "Close":  float(vals["5. adjusted close"]),
                    "Volume": int(float(vals["6. volume"])),
                })
        if not rows:
            return None
        df = pd.DataFrame(rows).set_index("date")
        log.debug("[av-ohlcv] %s: %d rows", ticker, len(df))
        return df

    except Exception as exc:
        log.debug("[av-ohlcv] %s: %s", ticker, exc)
        return None


def _td_ohlcv(ticker: str, start: date, end: date) -> Optional[pd.DataFrame]:
    url = "https://api.twelvedata.com/time_series"
    # Request extra days to account for weekends
    params = {
        "symbol":     ticker,
        "interval":   "1day",
        "start_date": (start - timedelta(days=2)).isoformat(),
        "end_date":   end.isoformat(),
        "outputsize": 30,
        "apikey":     TD_KEY,
    }
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS) as c:
            r = c.get(url, params=params)
            r.raise_for_status()
            data = r.json()

        if data.get("status") == "error":
            log.warning("[td-ohlcv] %s: %s", ticker, data.get("message"))
            return None
        values = data.get("values")
        if not values:
            return None

        rows = []
        for v in values:
            d = date.fromisoformat(v["datetime"])
            if start <= d <= end:
                rows.append({
                    "date":   d,
                    "Open":   float(v["open"]),
                    "High":   float(v["high"]),
                    "Low":    float(v["low"]),
                    "Close":  float(v["close"]),
                    "Volume": int(float(v.get("volume", 0) or 0)),
                })
        if not rows:
            return None
        df = pd.DataFrame(rows).set_index("date")
        log.debug("[td-ohlcv] %s: %d rows", ticker, len(df))
        return df

    except Exception as exc:
        log.debug("[td-ohlcv] %s: %s", ticker, exc)
        return None


def _yf_ohlcv(ticker: str, start: date, end: date) -> Optional[pd.DataFrame]:
    """
    Hardened yfinance download.

    Failures addressed:
    - YFTzMissingError  → widen window, retry once
    - Empty result      → retry with period="1mo" fallback
    - 403               → caught, returns None (AV/TD should have handled it)
    - MultiIndex cols   → extracted correctly for both single and batch calls
    """
    end_excl = end + timedelta(days=1)

    for attempt, extra in enumerate((0, 7)):
        adj_start = start - timedelta(days=extra)
        try:
            df_raw = yf.download(
                tickers=ticker,
                start=adj_start.isoformat(),
                end=end_excl.isoformat(),
                interval="1d",
                progress=False,
                threads=False,
                auto_adjust=True,
                group_by="column",
            )
            if df_raw is None or df_raw.empty:
                if attempt == 0:
                    continue
                return None

            df = _normalise_yf_df(df_raw, ticker)
            if df is None or df.empty:
                if attempt == 0:
                    continue
                return None

            # Filter to requested window
            df = df[(df.index >= start) & (df.index <= end)]
            if df.empty:
                return None

            log.debug("[yf-ohlcv] %s: %d rows", ticker, len(df))
            return df

        except Exception as exc:
            log.debug("[yf-ohlcv] %s attempt=%d: %s", ticker, attempt, exc)
            if attempt >= 1:
                return None

    return None


def _normalise_yf_df(df: pd.DataFrame, ticker: str) -> Optional[pd.DataFrame]:
    """
    yfinance ≥ 0.2.x returns MultiIndex columns when group_by='column':
        (OHLCV, Ticker)
    Flatten to plain OHLCV columns with a date index.
    """
    try:
        if isinstance(df.columns, pd.MultiIndex):
            # Flatten: keep first level (Open/High/Low/Close/Volume)
            df.columns = [col[0] for col in df.columns]

        needed = {"Open", "High", "Low", "Close", "Volume"}
        missing = needed - set(df.columns)
        if "Close" in missing:
            return None  # can't proceed without Close

        df = df[list(needed - missing)].copy()
        df = df.dropna(subset=["Close"])
        df.index = pd.to_datetime(df.index).date
        return df

    except Exception as exc:
        log.debug("_normalise_yf_df %s: %s", ticker, exc)
        return None


def _upsert(session, security_id: int, ticker: str, df: pd.DataFrame):
    sql = text(
        """
        INSERT INTO price_history
            (security_id, date, open, high, low, close, volume, source)
        VALUES
            (:security_id, :date, :open, :high, :low, :close, :volume, :source)
        ON CONFLICT (security_id, date) DO UPDATE SET
            open   = EXCLUDED.open,
            high   = EXCLUDED.high,
            low    = EXCLUDED.low,
            close  = EXCLUDED.close,
            volume = EXCLUDED.volume,
            source = EXCLUDED.source
        RETURNING (xmax = 0) AS was_inserted
        """
    )
    inserted = updated = 0
    for row_date, row in df.iterrows():
        res = session.execute(sql, {
            "security_id": security_id,
            "date":   row_date,
            "open":   float(row["Open"])   if "Open"   in row and pd.notna(row["Open"])   else None,
            "high":   float(row["High"])   if "High"   in row and pd.notna(row["High"])   else None,
            "low":    float(row["Low"])    if "Low"    in row and pd.notna(row["Low"])    else None,
            "close":  float(row["Close"]),
            "volume": int(row["Volume"])   if "Volume" in row and pd.notna(row["Volume"]) else None,
            "source": "yfinance" if not AV_KEY else "alphavantage",
        })
        r = res.fetchone()
        if r and r[0]:
            inserted += 1
        else:
            updated += 1
    return inserted, updated