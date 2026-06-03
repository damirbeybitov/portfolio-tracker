"""
Price Service — live and historical stock prices via Yahoo Finance.

yfinance works fine for stock tickers (AAPL, MSFT, etc.) in most server
environments. The only problematic ticker is USDKZT=X (handled by FxService).

Key improvements vs original:
- Uses fast_info.last_price without calling .info (avoids the TypeError crash)
- Proper per-ticker exception isolation in batch fetch
- Historical price has a wider look-back window (10 days) for weekends/holidays
- Security info fetch is guarded against missing keys
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Optional

import yfinance as yf

logger = logging.getLogger(__name__)


class PriceService:

    # ------------------------------------------------------------------ #
    #  Current price                                                       #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_current_price(ticker: str) -> Optional[float]:
        """Return latest price for *ticker* in its native currency (usually USD)."""
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(None, PriceService._fetch_price, ticker)
        except Exception as e:
            logger.warning("get_current_price(%s) failed: %s", ticker, e)
            return None

    @staticmethod
    def _fetch_price(ticker: str) -> Optional[float]:
        try:
            t = yf.Ticker(ticker)
            # fast_info doesn't call .info so it avoids the NoneType crash
            price = getattr(t.fast_info, "last_price", None)
            if price and price > 0:
                return float(price)
            # Fallback: last close from recent history
            hist = t.history(period="5d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception as e:
            logger.debug("_fetch_price(%s): %s", ticker, e)
        return None

    @staticmethod
    async def get_prices_batch(tickers: list[str]) -> dict[str, Optional[float]]:
        """
        Fetch current prices for multiple tickers concurrently.
        Returns a dict {ticker: price_or_None}.
        """
        if not tickers:
            return {}
        tasks = {t: PriceService.get_current_price(t) for t in tickers}
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        return {
            ticker: (r if isinstance(r, float) else None)
            for ticker, r in zip(tasks.keys(), results)
        }

    # ------------------------------------------------------------------ #
    #  Historical price                                                    #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_historical_price(
        ticker: str, target_date: date
    ) -> Optional[float]:
        """
        Return the closing price on or just before *target_date*.
        Looks back up to 10 days to handle weekends and market holidays.
        """
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None,
                PriceService._fetch_historical,
                ticker,
                target_date,
            )
        except Exception as e:
            logger.warning(
                "get_historical_price(%s, %s) failed: %s", ticker, target_date, e
            )
            return None

    @staticmethod
    def _fetch_historical(ticker: str, target_date: date) -> Optional[float]:
        try:
            t = yf.Ticker(ticker)
            # Look back 10 days to cover weekends + holidays
            start = target_date - timedelta(days=10)
            end = target_date + timedelta(days=1)
            hist = t.history(
                start=start.isoformat(),
                end=end.isoformat(),
                auto_adjust=True,
            )
            if hist.empty:
                return None
            # Filter rows on or before target_date
            hist.index = hist.index.date  # type: ignore[attr-defined]
            eligible = hist[hist.index <= target_date]
            if eligible.empty:
                return None
            return float(eligible["Close"].iloc[-1])
        except Exception as e:
            logger.debug("_fetch_historical(%s, %s): %s", ticker, target_date, e)
        return None

    # ------------------------------------------------------------------ #
    #  Security metadata                                                   #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_security_info(ticker: str) -> Optional[dict]:
        """Fetch basic metadata for a ticker from Yahoo Finance."""
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None, PriceService._fetch_info, ticker
            )
        except Exception as e:
            logger.warning("get_security_info(%s) failed: %s", ticker, e)
            return None

    @staticmethod
    def _fetch_info(ticker: str) -> Optional[dict]:
        try:
            t = yf.Ticker(ticker)
            info = t.info or {}
            name = (
                info.get("longName")
                or info.get("shortName")
                or info.get("displayName")
                or ticker.upper()
            )
            return {
                "ticker": ticker.upper(),
                "name": name,
                "exchange": info.get("exchange"),
                "currency": info.get("currency", "USD"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
            }
        except Exception as e:
            logger.debug("_fetch_info(%s): %s", ticker, e)
            # Minimal fallback so the ticker can still be saved
            return {
                "ticker": ticker.upper(),
                "name": ticker.upper(),
                "exchange": None,
                "currency": "USD",
                "sector": None,
                "industry": None,
            }
