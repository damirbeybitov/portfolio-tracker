import logging
import asyncio
from datetime import date, timedelta
from typing import Optional

import yfinance as yf

logger = logging.getLogger("app.services.price")


class PriceService:

    @staticmethod
    async def get_current_price(ticker: str) -> Optional[float]:
        try:
            loop = asyncio.get_event_loop()
            price = await loop.run_in_executor(None, PriceService._fetch_price, ticker)
            if price is None:
                logger.warning("No price returned for ticker", extra={"ticker": ticker})
            else:
                logger.debug("Price fetched", extra={"ticker": ticker, "price": price})
            return price
        except Exception:
            logger.exception("Failed to fetch price", extra={"ticker": ticker})
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
        logger.debug("Batch price fetch", extra={"tickers": tickers, "count": len(tickers)})
        tasks = [PriceService.get_current_price(ticker) for ticker in tickers]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        prices = {
            ticker: (r if not isinstance(r, Exception) else None)
            for ticker, r in zip(tickers, results)
        }
        missing = [t for t, p in prices.items() if p is None]
        if missing:
            logger.warning("Missing prices after batch fetch", extra={"missing_tickers": missing})
        return prices

    @staticmethod
    async def get_historical_price(ticker: str, target_date: date) -> Optional[float]:
        try:
            loop = asyncio.get_event_loop()
            price = await loop.run_in_executor(
                None, PriceService._fetch_historical, ticker, target_date,
            )
            logger.debug(
                "Historical price fetched",
                extra={"ticker": ticker, "date": str(target_date), "price": price},
            )
            return price
        except Exception:
            logger.exception("Failed to fetch historical price", extra={"ticker": ticker, "date": str(target_date)})
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
        try:
            loop = asyncio.get_event_loop()
            info = await loop.run_in_executor(None, PriceService._fetch_info, ticker)
            logger.info("Security info fetched", extra={"ticker": ticker, "name": info.get("name")})
            return info
        except Exception:
            logger.exception("Failed to fetch security info", extra={"ticker": ticker})
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
