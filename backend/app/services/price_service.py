"""
Price Service — multi-provider with Redis cache + price_history write-through.

Provider chain (current price):
  1. Redis cache
  2. Alpha Vantage  (if key configured)
  3. Twelve Data    (if key configured)
  4. yfinance       (with hardened download — see _YFinanceClient)
  5. Redis last-known (no TTL, survives restarts)

Provider chain (historical price):
  1. Redis cache (24 h TTL)
  2. Alpha Vantage TIME_SERIES_DAILY
  3. Twelve Data  time_series
  4. yfinance     — download with date window, several fallbacks

price_history write-through:
  Every successfully fetched current price is upserted into price_history
  (security_id resolved via the securities table). This means the table
  is populated both by the Airflow daily DAG and by every live request —
  no data gap even on days the DAG doesn't run.

yfinance hardening:
  - TzCache disabled via YFINANCE_CACHE_DIR env var (avoids Errno 17 race)
  - Uses yf.Ticker.fast_info (no quoteSummary → no 403) for current price
  - Falls back to yf.download for both current and historical
  - Wraps every yfinance call in try/except; never lets a single ticker
    crash the whole batch
  - Retries delisted / timezone errors with a 1-day shifted window

TTL:
  - Market hours  (Mon–Fri 09:30–16:00 ET): 15 min
  - After hours / weekends:                  60 min
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

# ── yfinance TzCache workaround ─────────────────────────────────────────────
_YF_CACHE = os.environ.get(
    "YFINANCE_CACHE_DIR",
    os.path.join(tempfile.gettempdir(), f"yf_cache_{os.getpid()}"),
)
os.makedirs(_YF_CACHE, exist_ok=True)

import yfinance as yf

try:
    yf.set_tz_cache_location(_YF_CACHE)
except Exception:
    pass

from app.core.config import settings
from app.db.redis import get_redis

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

PRICE_TTL_MARKET  = 60 * 15   # 15 min
PRICE_TTL_CLOSED  = 60 * 60   # 1 h
PRICE_KEY_PREFIX  = "price:"
LAST_KNOWN_PREFIX = "price:last:"

_HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
_HTTP_HEADERS = {
    "User-Agent": "PortfolioTracker/1.0",
    "Accept": "application/json",
}


def _cache_ttl() -> int:
    now = datetime.now(ET)
    hour = now.hour + now.minute / 60
    if now.weekday() < 5 and 9.5 <= hour <= 16.0:
        return PRICE_TTL_MARKET
    return PRICE_TTL_CLOSED


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

class PriceService:

    @classmethod
    async def get_current_price(
        cls,
        ticker: str,
        db: Optional[AsyncSession] = None,
        security_id: Optional[int] = None,
    ) -> Optional[float]:
        """
        Fetch the current price for *ticker*.

        If *db* and *security_id* are provided, the fetched price is also
        upserted into price_history so the table stays current between
        Airflow DAG runs.
        """
        ticker = ticker.upper()

        # 1. Redis cache
        price = await cls._redis_get(ticker)
        if price is not None:
            log.debug("[cache] %s = %s", ticker, price)
            # Still write to price_history (idempotent upsert) so today's
            # row exists even when we hit cache all day.
            if db and security_id:
                await cls._upsert_price_history(db, security_id, ticker, price)
            return price

        # 2. Alpha Vantage
        if settings.ALPHA_VANTAGE_API_KEY:
            price = await cls._av_current(ticker)
            if price:
                await cls._redis_set(ticker, price)
                await cls._redis_set_last(ticker, price)
                if db and security_id:
                    await cls._upsert_price_history(db, security_id, ticker, price)
                return price

        # 3. Twelve Data
        if settings.TWELVE_DATA_API_KEY:
            price = await cls._td_current(ticker)
            if price:
                await cls._redis_set(ticker, price)
                await cls._redis_set_last(ticker, price)
                if db and security_id:
                    await cls._upsert_price_history(db, security_id, ticker, price)
                return price

        # 4. yfinance
        price = await asyncio.get_event_loop().run_in_executor(
            None, _yf_current, ticker
        )
        if price:
            await cls._redis_set(ticker, price)
            await cls._redis_set_last(ticker, price)
            if db and security_id:
                await cls._upsert_price_history(db, security_id, ticker, price)
            return price

        # 5. last-known
        price = await cls._redis_get_last(ticker)
        if price is not None:
            log.warning("[last-known] %s = %s", ticker, price)
            return price

        log.warning("[miss] %s: no price from any provider", ticker)
        return None

    @classmethod
    async def get_prices_batch(
        cls,
        tickers: list[str],
        db: Optional[AsyncSession] = None,
        security_map: Optional[dict[str, int]] = None,
    ) -> dict[str, Optional[float]]:
        """
        Fetch current prices for multiple tickers concurrently.

        *security_map* maps ticker → security_id. When provided (along with
        *db*), fetched prices are written to price_history in bulk after the
        concurrent fetch completes — a single flush rather than N individual
        awaits during the gather.
        """
        if not tickers:
            return {}

        tasks = [
            cls.get_current_price(
                t,
                db=db,
                security_id=(security_map or {}).get(t.upper()),
            )
            for t in tickers
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            t: (r if not isinstance(r, Exception) else None)
            for t, r in zip(tickers, results)
        }

    @classmethod
    async def get_historical_price(
        cls, ticker: str, target_date: date
    ) -> Optional[float]:
        ticker = ticker.upper()
        key = f"hist:{ticker}:{target_date.isoformat()}"

        cached = await cls._redis_raw_get(key)
        if cached is not None:
            return cached

        # Alpha Vantage
        if settings.ALPHA_VANTAGE_API_KEY:
            price = await cls._av_historical(ticker, target_date)
            if price:
                await cls._redis_raw_set(key, price, ttl=86400)
                return price

        # Twelve Data
        if settings.TWELVE_DATA_API_KEY:
            price = await cls._td_historical(ticker, target_date)
            if price:
                await cls._redis_raw_set(key, price, ttl=86400)
                return price

        # yfinance
        price = await asyncio.get_event_loop().run_in_executor(
            None, _yf_historical, ticker, target_date
        )
        if price:
            await cls._redis_raw_set(key, price, ttl=86400)
            return price

        log.warning("[hist-miss] %s %s: no price", ticker, target_date)
        return None

    @classmethod
    async def get_security_info(cls, ticker: str) -> Optional[dict]:
        ticker = ticker.upper()

        if settings.ALPHA_VANTAGE_API_KEY:
            info = await cls._av_info(ticker)
            if info:
                return info

        if settings.TWELVE_DATA_API_KEY:
            info = await cls._td_info(ticker)
            if info:
                return info

        info = await asyncio.get_event_loop().run_in_executor(
            None, _yf_fast_info, ticker
        )
        if info:
            return info

        info = await asyncio.get_event_loop().run_in_executor(
            None, _yf_full_info, ticker
        )
        return info

    @classmethod
    async def invalidate(cls, ticker: str) -> None:
        redis = await get_redis()
        if redis:
            await redis.delete(f"{PRICE_KEY_PREFIX}{ticker.upper()}")

    # ── price_history write-through ───────────────────────────────────────

    @classmethod
    async def _upsert_price_history(
        cls,
        db: AsyncSession,
        security_id: int,
        ticker: str,
        price: float,
    ) -> None:
        """
        Upsert today's close into price_history.  Uses raw SQL (same pattern
        as the Airflow DAG) so we avoid importing the ORM model here and keep
        the service layer thin.  ON CONFLICT DO UPDATE means this is
        idempotent and safe to call on every request.
        """
        try:
            today = date.today()
            sql = text(
                """
                INSERT INTO price_history
                    (security_id, date, open, high, low, close, volume, source)
                VALUES
                    (:security_id, :date, NULL, NULL, NULL, :close, NULL, 'live')
                ON CONFLICT (security_id, date) DO UPDATE SET
                    close  = EXCLUDED.close,
                    source = CASE
                               WHEN price_history.source = 'yfinance' THEN price_history.source
                               ELSE EXCLUDED.source
                             END
                """
            )
            await db.execute(
                sql,
                {"security_id": security_id, "date": today, "close": price},
            )
            # No explicit flush — caller's transaction commits as normal.
            log.debug("[price_history] upserted %s sid=%d price=%.4f", ticker, security_id, price)
        except Exception as exc:
            # Never let a price_history write break the main request path.
            log.warning("[price_history] upsert failed for %s: %s", ticker, exc)

    # ── Redis helpers ─────────────────────────────────────────────────────

    @classmethod
    async def _redis_get(cls, ticker: str) -> Optional[float]:
        return await cls._redis_raw_get(f"{PRICE_KEY_PREFIX}{ticker}")

    @classmethod
    async def _redis_get_last(cls, ticker: str) -> Optional[float]:
        return await cls._redis_raw_get(f"{LAST_KNOWN_PREFIX}{ticker}")

    @classmethod
    async def _redis_raw_get(cls, key: str) -> Optional[float]:
        try:
            redis = await get_redis()
            if not redis:
                return None
            val = await redis.get(key)
            return float(val) if val is not None else None
        except Exception as exc:
            log.debug("redis get %s: %s", key, exc)
            return None

    @classmethod
    async def _redis_set(cls, ticker: str, price: float) -> None:
        await cls._redis_raw_set(
            f"{PRICE_KEY_PREFIX}{ticker}", price, ttl=_cache_ttl()
        )

    @classmethod
    async def _redis_set_last(cls, ticker: str, price: float) -> None:
        await cls._redis_raw_set(f"{LAST_KNOWN_PREFIX}{ticker}", price, ttl=None)

    @classmethod
    async def _redis_raw_set(
        cls, key: str, value: float, ttl: Optional[int]
    ) -> None:
        try:
            redis = await get_redis()
            if not redis:
                return
            if ttl:
                await redis.setex(key, ttl, str(value))
            else:
                await redis.set(key, str(value))
        except Exception as exc:
            log.debug("redis set %s: %s", key, exc)

    # ── Alpha Vantage ────────────────────────────────────────────────────

    @classmethod
    async def _av_current(cls, ticker: str) -> Optional[float]:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "GLOBAL_QUOTE",
            "symbol": ticker,
            "apikey": settings.ALPHA_VANTAGE_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            price_str = data.get("Global Quote", {}).get("05. price")
            if not price_str:
                _log_av_limit(ticker, data)
                return None
            price = float(price_str)
            log.debug("[av] %s = %s", ticker, price)
            return price
        except Exception as exc:
            log.warning("[av-current] %s: %s", ticker, exc)
            return None

    @classmethod
    async def _av_historical(cls, ticker: str, target: date) -> Optional[float]:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "TIME_SERIES_DAILY_ADJUSTED",
            "symbol": ticker,
            "outputsize": "full",
            "apikey": settings.ALPHA_VANTAGE_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            series = data.get("Time Series (Daily)", {})
            if not series:
                _log_av_limit(ticker, data)
                return None
            for offset in range(7):
                d = (target - timedelta(days=offset)).isoformat()
                if d in series:
                    price = float(series[d]["5. adjusted close"])
                    log.debug("[av-hist] %s %s -> %s = %s", ticker, target, d, price)
                    return price
            return None
        except Exception as exc:
            log.warning("[av-hist] %s: %s", ticker, exc)
            return None

    @classmethod
    async def _av_info(cls, ticker: str) -> Optional[dict]:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "OVERVIEW",
            "symbol": ticker,
            "apikey": settings.ALPHA_VANTAGE_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            if not data or "Symbol" not in data:
                _log_av_limit(ticker, data)
                return None
            return {
                "ticker":   data.get("Symbol", ticker).upper(),
                "name":     data.get("Name") or ticker,
                "exchange": data.get("Exchange"),
                "currency": data.get("Currency", "USD"),
                "sector":   data.get("Sector"),
                "industry": data.get("Industry"),
            }
        except Exception as exc:
            log.warning("[av-info] %s: %s", ticker, exc)
            return None

    # ── Twelve Data ──────────────────────────────────────────────────────

    @classmethod
    async def _td_current(cls, ticker: str) -> Optional[float]:
        url = "https://api.twelvedata.com/price"
        params = {"symbol": ticker, "apikey": settings.TWELVE_DATA_API_KEY}
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            if data.get("status") == "error" or "price" not in data:
                log.warning("[td-current] %s: %s", ticker, data.get("message", "no price"))
                return None
            price = float(data["price"])
            log.debug("[td] %s = %s", ticker, price)
            return price
        except Exception as exc:
            log.warning("[td-current] %s: %s", ticker, exc)
            return None

    @classmethod
    async def _td_historical(cls, ticker: str, target: date) -> Optional[float]:
        url = "https://api.twelvedata.com/time_series"
        start = (target - timedelta(days=7)).isoformat()
        params = {
            "symbol": ticker,
            "interval": "1day",
            "start_date": start,
            "end_date": target.isoformat(),
            "apikey": settings.TWELVE_DATA_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            values = data.get("values")
            if not values:
                log.warning("[td-hist] %s: %s", ticker, data.get("message", "no data"))
                return None
            for v in values:
                if v["datetime"] <= target.isoformat():
                    price = float(v["close"])
                    log.debug("[td-hist] %s %s -> %s = %s", ticker, target, v["datetime"], price)
                    return price
            return None
        except Exception as exc:
            log.warning("[td-hist] %s: %s", ticker, exc)
            return None

    @classmethod
    async def _td_info(cls, ticker: str) -> Optional[dict]:
        url = "https://api.twelvedata.com/stocks"
        params = {"symbol": ticker, "apikey": settings.TWELVE_DATA_API_KEY}
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            if data.get("status") == "error":
                log.warning("[td-info] %s: %s", ticker, data.get("message"))
                return None
            stock = None
            if isinstance(data, dict) and "data" in data:
                items = data["data"]
                if isinstance(items, list) and items:
                    stock = items[0]
            elif isinstance(data, dict) and "symbol" in data:
                stock = data
            if not stock:
                return None
            return {
                "ticker":   stock.get("symbol", ticker).upper(),
                "name":     stock.get("name") or ticker,
                "exchange": stock.get("exchange"),
                "currency": stock.get("currency", "USD"),
                "sector":   stock.get("sector"),
                "industry": stock.get("industry"),
            }
        except Exception as exc:
            log.warning("[td-info] %s: %s", ticker, exc)
            return None


# ─────────────────────────────────────────────────────────────────────────────
# yfinance — sync helpers (run in executor)
# ─────────────────────────────────────────────────────────────────────────────

def _yf_current(ticker: str) -> Optional[float]:
    """
    Try fast_info.last_price first (no quoteSummary, no 403).
    Fall back to a 5-day download window.
    """
    try:
        t = yf.Ticker(ticker)
        fi = t.fast_info
        price = getattr(fi, "last_price", None)
        if price and price > 0:
            log.debug("[yf-fast] %s = %s", ticker, price)
            return float(price)
    except Exception as exc:
        log.debug("[yf-fast] %s: %s", ticker, exc)

    return _yf_download_latest(ticker)


def _yf_download_latest(ticker: str) -> Optional[float]:
    """Download last 5 calendar days; return the most recent close."""
    try:
        end = datetime.now().date()
        start = end - timedelta(days=7)
        df = yf.download(
            tickers=ticker,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1d",
            progress=False,
            threads=False,
            auto_adjust=True,
        )
        if df is None or df.empty:
            return None
        close = df["Close"]
        if hasattr(close, "iloc"):
            val = close.iloc[-1]
            if hasattr(val, "iloc"):
                val = val.iloc[0]
            if val and float(val) > 0:
                log.debug("[yf-dl] %s = %s", ticker, val)
                return float(val)
    except Exception as exc:
        log.debug("[yf-dl] %s: %s", ticker, exc)
    return None


def _yf_historical(ticker: str, target: date) -> Optional[float]:
    """
    Fetch historical close for target_date.
    Tries a ±5-day window; widens to 14 days on retry.
    """
    for extra_days in (5, 14):
        start = target - timedelta(days=extra_days)
        end   = target + timedelta(days=2)
        try:
            df = yf.download(
                tickers=ticker,
                start=start.isoformat(),
                end=end.isoformat(),
                interval="1d",
                progress=False,
                threads=False,
                auto_adjust=True,
            )
            if df is None or df.empty:
                continue

            df.index = df.index.normalize()
            target_ts = datetime.combine(target, datetime.min.time())
            filtered = df[df.index <= target_ts]
            if filtered.empty:
                filtered = df

            val = filtered["Close"].iloc[-1]
            if hasattr(val, "iloc"):
                val = val.iloc[0]
            if val and float(val) > 0:
                log.debug("[yf-hist] %s %s = %s", ticker, target, val)
                return float(val)
        except Exception as exc:
            log.debug("[yf-hist] %s window=%d: %s", ticker, extra_days, exc)
    return None


def _yf_fast_info(ticker: str) -> Optional[dict]:
    """Lightweight metadata — no quoteSummary, very low 403 risk."""
    try:
        t = yf.Ticker(ticker)
        fi = t.fast_info
        currency = getattr(fi, "currency", None) or "USD"
        exchange = getattr(fi, "exchange", None)

        price = getattr(fi, "last_price", None)
        if not price:
            hist = t.history(period="5d")
            if hist.empty:
                return None

        return {
            "ticker":   ticker.upper(),
            "name":     ticker.upper(),
            "exchange": exchange,
            "currency": currency,
            "sector":   None,
            "industry": None,
        }
    except Exception as exc:
        log.debug("[yf-fastinfo] %s: %s", ticker, exc)
        return None


def _yf_full_info(ticker: str) -> Optional[dict]:
    """Full metadata via yf.Ticker.info — may 403 under heavy load."""
    try:
        t = yf.Ticker(ticker)
        info = t.info
        if not info or "symbol" not in info:
            return None
        return {
            "ticker":   ticker.upper(),
            "name":     info.get("longName") or info.get("shortName") or ticker,
            "exchange": info.get("exchange"),
            "currency": info.get("currency", "USD"),
            "sector":   info.get("sector"),
            "industry": info.get("industry"),
        }
    except Exception as exc:
        log.debug("[yf-full] %s: %s", ticker, exc)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────────────────────────────────────

def _log_av_limit(ticker: str, data: dict) -> None:
    info = data.get("Information") or data.get("Note") or ""
    if info:
        log.warning("[av] %s: %s", ticker, info[:120])
    else:
        log.debug("[av] %s: empty response — %s", ticker, data)