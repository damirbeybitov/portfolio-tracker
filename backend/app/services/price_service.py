"""
Price Service — live and historical stock prices via Yahoo Finance.

Fixes in this version:
1. Security lookup uses fast_info first (avoids the heavy quoteSummary endpoint
   that triggers 429s). Falls back to .info only if fast_info is empty.
2. Exponential backoff retry (up to 3 attempts) on 429 / transient errors.
3. _fetch_price no longer calls .info at all — uses fast_info only.
4. Historical fetch uses a 10-day look-back for weekends/holidays.
5. All sync helpers are fully isolated — one ticker failure never affects others.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, timedelta
from typing import Optional

import yfinance as yf

logger = logging.getLogger(__name__)

# Seconds to wait between retries: 1s, 3s, 7s
_RETRY_DELAYS = (1, 3, 7)


def _with_retry(fn, *args, retries: int = 3, **kwargs):
    """
    Call fn(*args, **kwargs), retrying on 429 / transient network errors.
    Returns None if all attempts fail.
    """
    last_exc = None
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            msg = str(exc).lower()
            is_rate_limit = "429" in msg or "too many requests" in msg or "rate" in msg
            is_transient = "connection" in msg or "timeout" in msg or "reset" in msg

            if not (is_rate_limit or is_transient):
                logger.debug("%s failed (non-retryable): %s", fn.__name__, exc)
                return None

            last_exc = exc
            delay = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]
            logger.warning(
                "%s attempt %d/%d failed (%s), retrying in %ds",
                fn.__name__, attempt + 1, retries, exc, delay,
            )
            time.sleep(delay)

    logger.error("%s failed after %d attempts: %s", fn.__name__, retries, last_exc)
    return None


class PriceService:

    # ------------------------------------------------------------------ #
    #  Current price                                                       #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_current_price(ticker: str) -> Optional[float]:
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None, _with_retry, PriceService._fetch_price, ticker
            )
        except Exception as e:
            logger.warning("get_current_price(%s) outer error: %s", ticker, e)
            return None

    @staticmethod
    def _fetch_price(ticker: str) -> Optional[float]:
        t = yf.Ticker(ticker)
        # fast_info does NOT call quoteSummary — safe from 429
        price = getattr(t.fast_info, "last_price", None)
        if price and float(price) > 0:
            return float(price)
        # Fallback: last close from 5-day bar data
        hist = t.history(period="5d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
        return None

    @staticmethod
    async def get_prices_batch(tickers: list[str]) -> dict[str, Optional[float]]:
        if not tickers:
            return {}
        tasks = [PriceService.get_current_price(t) for t in tickers]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            ticker: (r if isinstance(r, float) else None)
            for ticker, r in zip(tickers, results)
        }

    # ------------------------------------------------------------------ #
    #  Historical price                                                    #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_historical_price(ticker: str, target_date: date) -> Optional[float]:
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None,
                _with_retry,
                PriceService._fetch_historical,
                ticker,
                target_date,
            )
        except Exception as e:
            logger.warning("get_historical_price(%s, %s) outer error: %s", ticker, target_date, e)
            return None

    @staticmethod
    def _fetch_historical(ticker: str, target_date: date) -> Optional[float]:
        t = yf.Ticker(ticker)
        start = target_date - timedelta(days=10)
        end = target_date + timedelta(days=1)
        hist = t.history(
            start=start.isoformat(),
            end=end.isoformat(),
            auto_adjust=True,
        )
        if hist.empty:
            return None
        hist.index = hist.index.date  # type: ignore[attr-defined]
        eligible = hist[hist.index <= target_date]
        if eligible.empty:
            return None
        return float(eligible["Close"].iloc[-1])

    # ------------------------------------------------------------------ #
    #  Security metadata (lookup)                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_security_info(ticker: str) -> Optional[dict]:
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None, _with_retry, PriceService._fetch_info, ticker
            )
            return result or PriceService._minimal_info(ticker)
        except Exception as e:
            logger.warning("get_security_info(%s) outer error: %s", ticker, e)
            return PriceService._minimal_info(ticker)

    @staticmethod
    def _fetch_info(ticker: str) -> dict:
        """
        Fetch security metadata.

        Strategy (least to most aggressive Yahoo endpoint):
        1. fast_info  — lightweight chart endpoint, rarely rate-limited
        2. .info      — hits quoteSummary, may 429; retried by _with_retry caller
        3. minimal stub — so the ticker is never completely lost
        """
        t = yf.Ticker(ticker)

        # Step 1: fast_info (safe, no quoteSummary call)
        fi = t.fast_info
        fi_name = getattr(fi, "name", None) or getattr(fi, "longName", None)
        fi_exchange = getattr(fi, "exchange", None)
        fi_currency = getattr(fi, "currency", None)

        if fi_name and fi_currency:
            return {
                "ticker": ticker.upper(),
                "name": fi_name,
                "exchange": fi_exchange,
                "currency": fi_currency,
                "sector": None,
                "industry": None,
            }

        # Step 2: .info (heavier, may 429 — caller retries)
        try:
            info = t.info or {}
        except Exception as e:
            logger.debug("_fetch_info(%s) .info failed: %s", ticker, e)
            info = {}

        resolved_name = (
            info.get("longName")
            or info.get("shortName")
            or info.get("displayName")
            or fi_name
            or ticker.upper()
        )
        return {
            "ticker": ticker.upper(),
            "name": resolved_name,
            "exchange": info.get("exchange") or fi_exchange,
            "currency": info.get("currency") or fi_currency or "USD",
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }

    @staticmethod
    def _minimal_info(ticker: str) -> dict:
        """Last-resort stub when all Yahoo calls fail — ticker still gets saved."""
        return {
            "ticker": ticker.upper(),
            "name": ticker.upper(),
            "exchange": None,
            "currency": "USD",
            "sector": None,
            "industry": None,
        }
