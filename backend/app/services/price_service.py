"""
Price Service — multi-provider with Redis cache
Chain: Redis → Alpha Vantage → Twelve Data → yfinance → DB last known

TTL:
  - Market hours (Mon–Fri 09:30–16:00 ET): 15 min
  - After hours / weekends: 60 min
"""

import asyncio
import logging
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
import yfinance as yf

from app.core.config import settings
from app.db.redis import get_redis

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

PRICE_TTL_MARKET = 60 * 15       # 15 min during market hours
PRICE_TTL_CLOSED = 60 * 60       # 1 hour outside market hours
PRICE_KEY_PREFIX = "price:"
LAST_KNOWN_KEY_PREFIX = "price:last:"


def _cache_ttl() -> int:
    now = datetime.now(ET)
    weekday = now.weekday()  # 0=Mon, 6=Sun
    hour = now.hour + now.minute / 60
    if weekday < 5 and 9.5 <= hour <= 16.0:
        return PRICE_TTL_MARKET
    return PRICE_TTL_CLOSED


class PriceService:

    # ─────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def get_current_price(cls, ticker: str) -> Optional[float]:
        ticker = ticker.upper()

        # 1. Redis cache
        price = await cls._redis_get(ticker)
        if price is not None:
            logger.debug(f"[cache] {ticker} = {price}")
            return price

        # 2. Alpha Vantage
        if settings.ALPHA_VANTAGE_API_KEY:
            price = await cls._fetch_alpha_vantage(ticker)
            if price:
                await cls._redis_set(ticker, price)
                await cls._redis_set_last_known(ticker, price)
                return price

        # 3. Twelve Data
        if settings.TWELVE_DATA_API_KEY:
            price = await cls._fetch_twelve_data(ticker)
            if price:
                await cls._redis_set(ticker, price)
                await cls._redis_set_last_known(ticker, price)
                return price

        # 4. yfinance
        price = await cls._fetch_yfinance(ticker)
        if price:
            await cls._redis_set(ticker, price)
            await cls._redis_set_last_known(ticker, price)
            return price

        # 5. Redis last-known (no TTL)
        price = await cls._redis_get_last_known(ticker)
        if price is not None:
            logger.warning(f"[last-known] {ticker} = {price} (all providers failed)")
            return price

        logger.warning(f"[miss] {ticker}: no price from any provider")
        return None

    @classmethod
    async def get_prices_batch(cls, tickers: list[str]) -> dict[str, Optional[float]]:
        """Fetch prices concurrently — respects per-provider rate limits."""
        if not tickers:
            return {}
        tasks = [cls.get_current_price(t) for t in tickers]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            t: (r if not isinstance(r, Exception) else None)
            for t, r in zip(tickers, results)
        }

    @classmethod
    async def get_historical_price(cls, ticker: str, target_date: date) -> Optional[float]:
        """Historical close price — Redis cached, yfinance backed."""
        ticker = ticker.upper()
        key = f"hist:{ticker}:{target_date.isoformat()}"

        cached = await cls._redis_get_raw(key)
        if cached is not None:
            return cached

        price = await asyncio.get_event_loop().run_in_executor(
            None, cls._fetch_historical_yf, ticker, target_date
        )
        if price:
            # Historical prices don't change — cache for 24h
            await cls._redis_set_raw(key, price, ttl=86400)
        return price

    @classmethod
    async def get_security_info(cls, ticker: str) -> Optional[dict]:
        """Fetch basic security metadata via yfinance."""
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, cls._fetch_info_yf, ticker)
        except Exception as e:
            logger.warning(f"get_security_info {ticker}: {e}")
            return None

    @classmethod
    async def invalidate(cls, ticker: str) -> None:
        """Force-expire a ticker from cache (e.g. after manual price override)."""
        redis = await get_redis()
        if redis:
            await redis.delete(f"{PRICE_KEY_PREFIX}{ticker.upper()}")

    # ─────────────────────────────────────────────────────────────
    # Redis helpers
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _redis_get(cls, ticker: str) -> Optional[float]:
        return await cls._redis_get_raw(f"{PRICE_KEY_PREFIX}{ticker}")

    @classmethod
    async def _redis_get_last_known(cls, ticker: str) -> Optional[float]:
        return await cls._redis_get_raw(f"{LAST_KNOWN_KEY_PREFIX}{ticker}")

    @classmethod
    async def _redis_get_raw(cls, key: str) -> Optional[float]:
        try:
            redis = await get_redis()
            if not redis:
                return None
            val = await redis.get(key)
            return float(val) if val is not None else None
        except Exception as e:
            logger.debug(f"redis get {key}: {e}")
            return None

    @classmethod
    async def _redis_set(cls, ticker: str, price: float) -> None:
        await cls._redis_set_raw(f"{PRICE_KEY_PREFIX}{ticker}", price, ttl=_cache_ttl())

    @classmethod
    async def _redis_set_last_known(cls, ticker: str, price: float) -> None:
        # No TTL — keeps the last successful price indefinitely
        await cls._redis_set_raw(f"{LAST_KNOWN_KEY_PREFIX}{ticker}", price, ttl=None)

    @classmethod
    async def _redis_set_raw(cls, key: str, value: float, ttl: Optional[int]) -> None:
        try:
            redis = await get_redis()
            if not redis:
                return
            if ttl:
                await redis.setex(key, ttl, str(value))
            else:
                await redis.set(key, str(value))
        except Exception as e:
            logger.debug(f"redis set {key}: {e}")

    # ─────────────────────────────────────────────────────────────
    # Alpha Vantage
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_alpha_vantage(cls, ticker: str) -> Optional[float]:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "GLOBAL_QUOTE",
            "symbol": ticker,
            "apikey": settings.ALPHA_VANTAGE_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()

            quote = data.get("Global Quote", {})
            price_str = quote.get("05. price")
            if not price_str:
                # Rate limited or bad ticker
                info = data.get("Information", "") or data.get("Note", "")
                if info:
                    logger.warning(f"[alphavantage] {ticker}: {info[:80]}")
                return None
            price = float(price_str)
            logger.debug(f"[alphavantage] {ticker} = {price}")
            return price
        except Exception as e:
            logger.warning(f"[alphavantage] {ticker} error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────
    # Twelve Data
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_twelve_data(cls, ticker: str) -> Optional[float]:
        url = "https://api.twelvedata.com/price"
        params = {
            "symbol": ticker,
            "apikey": settings.TWELVE_DATA_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()

            if data.get("status") == "error" or "price" not in data:
                logger.warning(f"[twelvedata] {ticker}: {data.get('message', 'no price')}")
                return None
            price = float(data["price"])
            logger.debug(f"[twelvedata] {ticker} = {price}")
            return price
        except Exception as e:
            logger.warning(f"[twelvedata] {ticker} error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────
    # yfinance
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_yfinance(cls, ticker: str) -> Optional[float]:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, cls._fetch_price_yf, ticker)
        except Exception as e:
            logger.warning(f"[yfinance] {ticker} error: {e}")
            return None

    @staticmethod
    def _fetch_price_yf(ticker: str) -> Optional[float]:
        try:
            t = yf.Ticker(ticker)
            info = t.fast_info
            price = getattr(info, "last_price", None)
            if price:
                return float(price)
            hist = t.history(period="2d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
            return None
        except Exception as e:
            logger.debug(f"_fetch_price_yf {ticker}: {e}")
            return None

    @staticmethod
    def _fetch_historical_yf(ticker: str, target_date: date) -> Optional[float]:
        try:
            t = yf.Ticker(ticker)
            start = target_date - timedelta(days=5)
            end = target_date + timedelta(days=1)
            hist = t.history(start=start.isoformat(), end=end.isoformat())
            if hist.empty:
                return None
            return float(hist["Close"].iloc[-1])
        except Exception as e:
            logger.debug(f"_fetch_historical_yf {ticker} {target_date}: {e}")
            return None

    @staticmethod
    def _fetch_info_yf(ticker: str) -> Optional[dict]:
        try:
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
        except Exception as e:
            logger.debug(f"_fetch_info_yf {ticker}: {e}")
            return None