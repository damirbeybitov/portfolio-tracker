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
        """Historical close price — multi-provider chain, Redis cached for 24h."""
        ticker = ticker.upper()
        key = f"hist:{ticker}:{target_date.isoformat()}"

        cached = await cls._redis_get_raw(key)
        if cached is not None:
            return cached

        # 1. Alpha Vantage
        if settings.ALPHA_VANTAGE_API_KEY:
            price = await cls._fetch_alpha_vantage_historical(ticker, target_date)
            if price:
                await cls._redis_set_raw(key, price, ttl=86400)
                return price

        # 2. Twelve Data
        if settings.TWELVE_DATA_API_KEY:
            price = await cls._fetch_twelve_data_historical(ticker, target_date)
            if price:
                await cls._redis_set_raw(key, price, ttl=86400)
                return price

        # 3. yfinance
        price = await asyncio.get_event_loop().run_in_executor(
            None, cls._fetch_historical_yf, ticker, target_date
        )
        if price:
            await cls._redis_set_raw(key, price, ttl=86400)
            return price

        logger.warning(f"[hist-miss] {ticker} {target_date}: no price from any provider")
        return None

    @classmethod
    async def get_security_info(cls, ticker: str) -> Optional[dict]:
        """Fetch basic security metadata — multi-provider chain."""
        ticker = ticker.upper()

        # 1. Alpha Vantage
        if settings.ALPHA_VANTAGE_API_KEY:
            logger.debug(f"[security-info] {ticker}: trying Alpha Vantage")
            info = await cls._fetch_alpha_vantage_info(ticker)
            if info:
                return info
        else:
            logger.warning(f"[security-info] {ticker}: Alpha Vantage key not configured, skipping")

        # 2. Twelve Data
        if settings.TWELVE_DATA_API_KEY:
            logger.debug(f"[security-info] {ticker}: trying Twelve Data")
            info = await cls._fetch_twelve_data_info(ticker)
            if info:
                return info
        else:
            logger.warning(f"[security-info] {ticker}: Twelve Data key not configured, skipping")

        # 3. yfinance — fast_info (lightweight, rarely 429s) then full info as last resort
        logger.debug(f"[security-info] {ticker}: trying yfinance fast_info")
        try:
            loop = asyncio.get_event_loop()
            info = await loop.run_in_executor(None, cls._fetch_fast_info_yf, ticker)
            if info:
                return info
        except Exception as e:
            logger.warning(f"[yfinance-fastinfo] {ticker}: {e}")

        logger.debug(f"[security-info] {ticker}: trying yfinance full info")
        try:
            loop = asyncio.get_event_loop()
            info = await loop.run_in_executor(None, cls._fetch_info_yf, ticker)
            if info:
                return info
        except Exception as e:
            logger.warning(f"[yfinance-info] {ticker}: {e}")

        logger.warning(f"[info-miss] {ticker}: no security info from any provider")
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
    # Alpha Vantage — security info
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_alpha_vantage_info(cls, ticker: str) -> Optional[dict]:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "OVERVIEW",
            "symbol": ticker,
            "apikey": settings.ALPHA_VANTAGE_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()

            if not data or "Symbol" not in data:
                info = data.get("Information", "") or data.get("Note", "")
                if info:
                    logger.warning(f"[alphavantage-info] {ticker}: {info[:80]}")
                else:
                    # Alpha Vantage OVERVIEW returns {} for ETFs and many
                    # non-equity instruments — not an error, just unsupported.
                    logger.warning(f"[alphavantage-info] {ticker}: no OVERVIEW data (likely ETF/fund) — response: {data}")
                return None

            result = {
                "ticker": data.get("Symbol", ticker).upper(),
                "name": data.get("Name") or data.get("AssetType") or ticker,
                "exchange": data.get("Exchange"),
                "currency": data.get("Currency", "USD"),
                "sector": data.get("Sector"),
                "industry": data.get("Industry"),
                # "description": data.get("Description"),
            }
            logger.debug(f"[alphavantage-info] {ticker} = {result['name']}")
            return result
        except Exception as e:
            logger.warning(f"[alphavantage-info] {ticker} error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────
    # Twelve Data — security info
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_twelve_data_info(cls, ticker: str) -> Optional[dict]:
        url = "https://api.twelvedata.com/stocks"
        params = {
            "symbol": ticker,
            "apikey": settings.TWELVE_DATA_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()

            if data.get("status") == "error":
                logger.warning(f"[twelvedata-info] {ticker}: {data.get('message', 'no data')}")
                return None

            # Response is a list of matches or a single dict
            stock = None
            if isinstance(data, list) and data:
                stock = data[0]
            elif isinstance(data, dict) and "data" in data:
                items = data["data"]
                if isinstance(items, list) and items:
                    stock = items[0]
            elif isinstance(data, dict) and "symbol" in data:
                stock = data

            if not stock:
                # /stocks with a symbol filter returns {"data": []} when the
                # symbol isn't in Twelve Data's reference list (common for
                # leveraged/derivative ETFs on free plans) — not an error.
                logger.warning(f"[twelvedata-info] {ticker}: no matching entry in /stocks — response: {data}")
                return None

            result = {
                "ticker": stock.get("symbol", ticker).upper(),
                "name": stock.get("name") or ticker,
                "exchange": stock.get("exchange"),
                "currency": stock.get("currency", "USD"),
                "sector": stock.get("sector"),
                "industry": stock.get("industry"),
            }
            logger.debug(f"[twelvedata-info] {ticker} = {result['name']}")
            return result
        except Exception as e:
            logger.warning(f"[twelvedata-info] {ticker} error: {e}")
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
            df = yf.download(
                tickers=ticker,
                period="5d",
                interval="1d",
                progress=False,
                threads=False,
                group_by="column",
            )

            if df is None or df.empty:
                return None

            return float(df["Close"].iloc[-1])

        except Exception as e:
            logger.debug(f"_fetch_price_yf {ticker}: {e}")
            return None

    # ─────────────────────────────────────────────────────────────
    # Alpha Vantage — historical
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_alpha_vantage_historical(cls, ticker: str, target_date: date) -> Optional[float]:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "TIME_SERIES_DAILY",
            "symbol": ticker,
            "outputsize": "full",
            "apikey": settings.ALPHA_VANTAGE_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()

            series = data.get("Time Series (Daily)", {})
            if not series:
                info = data.get("Information", "") or data.get("Note", "")
                if info:
                    logger.warning(f"[alphavantage-hist] {ticker}: {info[:80]}")
                return None

            # Find exact date, or nearest earlier trading day (within 5 days)
            for offset in range(6):
                d = (target_date - timedelta(days=offset)).isoformat()
                if d in series:
                    price = float(series[d]["4. close"])
                    logger.debug(f"[alphavantage-hist] {ticker} {target_date} -> {d} = {price}")
                    return price
            return None
        except Exception as e:
            logger.warning(f"[alphavantage-hist] {ticker} error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────
    # Twelve Data — historical
    # ─────────────────────────────────────────────────────────────

    @classmethod
    async def _fetch_twelve_data_historical(cls, ticker: str, target_date: date) -> Optional[float]:
        url = "https://api.twelvedata.com/time_series"
        # Request a small window ending at target_date so we get the closest
        # earlier trading day if target_date itself is a weekend/holiday
        start = (target_date - timedelta(days=7)).isoformat()
        end = target_date.isoformat()
        params = {
            "symbol": ticker,
            "interval": "1day",
            "start_date": start,
            "end_date": end,
            "apikey": settings.TWELVE_DATA_API_KEY,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()

            values = data.get("values")
            if not values:
                logger.warning(f"[twelvedata-hist] {ticker}: {data.get('message', 'no data')}")
                return None

            # values are returned newest-first; take the most recent <= target_date
            for v in values:
                if v["datetime"] <= end:
                    price = float(v["close"])
                    logger.debug(f"[twelvedata-hist] {ticker} {target_date} -> {v['datetime']} = {price}")
                    return price
            return None
        except Exception as e:
            logger.warning(f"[twelvedata-hist] {ticker} error: {e}")
            return None

    @staticmethod
    def _fetch_historical_yf(ticker: str, target_date: date) -> Optional[float]:
        try:
            start = target_date - timedelta(days=5)
            end = target_date + timedelta(days=1)

            df = yf.download(
                tickers=ticker,
                start=start.isoformat(),
                end=end.isoformat(),
                interval="1d",
                progress=False,
                threads=False,
            )

            if df is None or df.empty:
                return None

            return float(df["Close"].iloc[-1])

        except Exception as e:
            logger.debug(f"_fetch_historical_yf {ticker} {target_date}: {e}")
            return None

    @staticmethod
    def _fetch_fast_info_yf(ticker: str) -> Optional[dict]:
        """
        Lightweight metadata via yfinance's fast_info — does NOT hit the
        quoteSummary endpoint that gets 429'd, so it's much less likely to
        be rate-limited. Doesn't give sector/industry, but gives enough to
        register the security (name falls back to ticker, currency/exchange
        from fast_info where available).
        """
        try:
            t = yf.Ticker(ticker)
            fi = t.fast_info
            currency = getattr(fi, "currency", None) or "USD"
            exchange = getattr(fi, "exchange", None)

            # fast_info has no long name — try a quick history call to make
            # sure the ticker is actually valid before accepting it.
            last_price = getattr(fi, "last_price", None)
            if last_price is None:
                hist = t.history(period="5d")
                if hist.empty:
                    return None

            return {
                "ticker": ticker.upper(),
                "name": ticker.upper(),
                "exchange": exchange,
                "currency": currency,
                "sector": None,
                "industry": None,
            }
        except Exception as e:
            logger.debug(f"_fetch_fast_info_yf {ticker}: {e}")
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