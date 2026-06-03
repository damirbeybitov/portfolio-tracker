"""
FX Service — USD/KZT rate resolution.

Priority chain:
  1. Exact date match in local DB  (instant, free)
  2. fawazahmed0 CDN API           (free, no key, very reliable)
  3. open.er-api.com               (free tier, no key)
  4. frankfurter.app               (ECB-backed, free)
  5. Most recent stored rate       (stale but better than nothing)
  6. Hard fallback 475.00          (last resort)

Why not yfinance for KZT?
  Yahoo Finance returns 403 for USDKZT=X from many server environments.
  The free CDN APIs below are more reliable for this pair.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date
from decimal import Decimal
from typing import Optional

import httpx
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import FxRate

logger = logging.getLogger(__name__)

# HTTP client shared across requests — reuse connections
_HTTP_TIMEOUT = httpx.Timeout(8.0, connect=4.0)
_HTTP_HEADERS = {
    "User-Agent": "PortfolioTracker/1.0 (personal finance app)",
    "Accept": "application/json",
}


class FxService:

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_rate(db: AsyncSession, target_date: Optional[date] = None) -> Decimal:
        """
        Return USD→KZT rate for *target_date* (default: today).
        Fetches from external API if not already stored; caches result to DB.
        """
        if target_date is None:
            target_date = date.today()

        # 1. DB hit — cheapest path
        stored = await FxService._db_get(db, target_date)
        if stored:
            return stored.usd_to_kzt

        # 2. Fetch from external APIs
        rate = await FxService._fetch_usd_kzt()
        if rate:
            fx = FxRate(
                date=target_date,
                usd_to_kzt=Decimal(str(round(rate, 4))),
                source="api",
            )
            db.add(fx)
            try:
                await db.flush()
            except Exception:
                # Unique constraint race — another request saved it first; just read it
                await db.rollback()
                stored = await FxService._db_get(db, target_date)
                if stored:
                    return stored.usd_to_kzt
            return fx.usd_to_kzt

        # 3. Most recent stored rate
        result = await db.execute(
            select(FxRate).order_by(desc(FxRate.date)).limit(1)
        )
        fx = result.scalar_one_or_none()
        if fx:
            logger.warning(
                "Using stale FX rate from %s: %s for date %s",
                fx.date,
                fx.usd_to_kzt,
                target_date,
            )
            return fx.usd_to_kzt

        # 4. Hard fallback
        logger.error("All FX sources exhausted, using fallback rate 475.00")
        return Decimal("475.00")

    @staticmethod
    async def set_manual_rate(
        db: AsyncSession, target_date: date, rate: Decimal
    ) -> FxRate:
        """Manually set or override a rate for a specific date."""
        result = await db.execute(
            select(FxRate).where(FxRate.date == target_date)
        )
        fx = result.scalar_one_or_none()
        if fx:
            fx.usd_to_kzt = rate
            fx.source = "manual"
        else:
            fx = FxRate(date=target_date, usd_to_kzt=rate, source="manual")
            db.add(fx)
        await db.flush()
        return fx

    # ------------------------------------------------------------------ #
    #  Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _db_get(db: AsyncSession, target_date: date) -> Optional[FxRate]:
        result = await db.execute(
            select(FxRate).where(FxRate.date == target_date)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def _fetch_usd_kzt() -> Optional[float]:
        """Try multiple free FX APIs concurrently, return first success."""
        providers = [
            FxService._fetch_fawazahmed0,
            FxService._fetch_open_er_api,
            FxService._fetch_frankfurter,
        ]
        # Run all providers concurrently; return first non-None result
        tasks = [p() for p in providers]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, float) and r > 0:
                return r
        return None

    @staticmethod
    async def _fetch_fawazahmed0() -> Optional[float]:
        """
        fawazahmed0 currency API — free, no key, served from Cloudflare CDN.
        https://github.com/fawazahmed0/exchange-api
        """
        urls = [
            "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
            "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
        ]
        async with httpx.AsyncClient(
            timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS, follow_redirects=True
        ) as client:
            for url in urls:
                try:
                    r = await client.get(url)
                    r.raise_for_status()
                    data = r.json()
                    kzt = data.get("usd", {}).get("kzt")
                    if kzt:
                        logger.debug("FX from fawazahmed0: %s", kzt)
                        return float(kzt)
                except Exception as e:
                    logger.debug("fawazahmed0 %s failed: %s", url, e)
        return None

    @staticmethod
    async def _fetch_open_er_api() -> Optional[float]:
        """open.er-api.com — free tier, no key required."""
        url = "https://open.er-api.com/v6/latest/USD"
        try:
            async with httpx.AsyncClient(
                timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS, follow_redirects=True
            ) as client:
                r = await client.get(url)
                r.raise_for_status()
                data = r.json()
                kzt = data.get("rates", {}).get("KZT")
                if kzt:
                    logger.debug("FX from open.er-api: %s", kzt)
                    return float(kzt)
        except Exception as e:
            logger.debug("open.er-api failed: %s", e)
        return None

    @staticmethod
    async def _fetch_frankfurter() -> Optional[float]:
        """
        frankfurter.app — ECB-backed, free, no key.
        Note: only business days; KZT may not be in their basket.
        """
        url = "https://api.frankfurter.app/latest?from=USD&to=KZT"
        try:
            async with httpx.AsyncClient(
                timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS, follow_redirects=True
            ) as client:
                r = await client.get(url)
                r.raise_for_status()
                data = r.json()
                kzt = data.get("rates", {}).get("KZT")
                if kzt:
                    logger.debug("FX from frankfurter: %s", kzt)
                    return float(kzt)
        except Exception as e:
            logger.debug("frankfurter failed: %s", e)
        return None
