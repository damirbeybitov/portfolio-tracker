import yfinance as yf
import asyncio
from functools import lru_cache
from datetime import date, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class PriceService:

    @staticmethod
    async def get_current_price(ticker: str) -> Optional[float]:
        """Fetch latest price for a ticker in USD."""
        try:
            loop = asyncio.get_event_loop()
            price = await loop.run_in_executor(None, PriceService._fetch_price, ticker)
            return price
        except Exception as e:
            logger.warning(f"Failed to fetch price for {ticker}: {e}")
            return None

    @staticmethod
    def _fetch_price(ticker: str) -> Optional[float]:
        t = yf.Ticker(ticker)
        info = t.fast_info
        price = getattr(info, "last_price", None)
        if price is None:
            hist = t.history(period="1d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
        return float(price) if price else None

    @staticmethod
    async def get_prices_batch(tickers: list[str]) -> dict[str, Optional[float]]:
        """Fetch prices for multiple tickers concurrently."""
        tasks = [PriceService.get_current_price(ticker) for ticker in tickers]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            ticker: (r if not isinstance(r, Exception) else None)
            for ticker, r in zip(tickers, results)
        }

    @staticmethod
    async def get_historical_price(ticker: str, target_date: date) -> Optional[float]:
        """Get closing price on a specific date."""
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                PriceService._fetch_historical,
                ticker,
                target_date,
            )
        except Exception as e:
            logger.warning(f"Failed to fetch historical price for {ticker} on {target_date}: {e}")
            return None

    @staticmethod
    def _fetch_historical(ticker: str, target_date: date) -> Optional[float]:
        t = yf.Ticker(ticker)
        start = target_date - timedelta(days=5)
        end = target_date + timedelta(days=1)
        hist = t.history(start=start.isoformat(), end=end.isoformat())
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])

    @staticmethod
    async def get_security_info(ticker: str) -> Optional[dict]:
        """Fetch basic security metadata."""
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, PriceService._fetch_info, ticker)
        except Exception as e:
            logger.warning(f"Failed to fetch info for {ticker}: {e}")
            return None

    @staticmethod
    def _fetch_info(ticker: str) -> dict:
        t = yf.Ticker(ticker)
        info = t.info
        return {
            "ticker": ticker.upper(),
            "name": info.get("longName") or info.get("shortName") or ticker,
            "exchange": info.get("exchange"),
            "currency": info.get("currency", "USD"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }
