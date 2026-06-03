import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from datetime import date
from decimal import Decimal
from typing import Optional
import yfinance as yf
import asyncio

from app.models.bank import FxRate

logger = logging.getLogger("app.services.fx")


class FxService:

    @staticmethod
    async def get_rate(db: AsyncSession, target_date: Optional[date] = None) -> Decimal:
        if target_date is None:
            target_date = date.today()

        result = await db.execute(select(FxRate).where(FxRate.date == target_date))
        fx = result.scalar_one_or_none()
        if fx:
            logger.debug("FX rate from DB", extra={"date": str(target_date), "rate": float(fx.usd_to_kzt)})
            return fx.usd_to_kzt

        logger.info("FX rate not in DB, fetching from Yahoo Finance", extra={"date": str(target_date)})
        rate = await FxService._fetch_usd_kzt()
        if rate:
            fx = FxRate(date=target_date, usd_to_kzt=Decimal(str(rate)), source="api")
            db.add(fx)
            await db.flush()
            logger.info("FX rate fetched and stored", extra={"date": str(target_date), "rate": rate})
            return Decimal(str(rate))

        result = await db.execute(select(FxRate).order_by(desc(FxRate.date)).limit(1))
        fx = result.scalar_one_or_none()
        if fx:
            logger.warning(
                "Using latest stored FX rate as fallback",
                extra={"fallback_date": str(fx.date), "rate": float(fx.usd_to_kzt)},
            )
            return fx.usd_to_kzt

        logger.error("No FX rate available — using hardcoded fallback 450.00")
        return Decimal("450.00")

    @staticmethod
    async def _fetch_usd_kzt() -> Optional[float]:
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, FxService._do_fetch)
        except Exception:
            logger.exception("Yahoo Finance FX fetch failed")
            return None

    @staticmethod
    def _do_fetch() -> Optional[float]:
        t = yf.Ticker("USDKZT=X")
        info = t.fast_info
        price = getattr(info, "last_price", None)
        if not price:
            hist = t.history(period="2d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
        return float(price) if price else None

    @staticmethod
    async def set_manual_rate(db: AsyncSession, target_date: date, rate: Decimal) -> FxRate:
        result = await db.execute(select(FxRate).where(FxRate.date == target_date))
        fx = result.scalar_one_or_none()
        if fx:
            old_rate = float(fx.usd_to_kzt)
            fx.usd_to_kzt = rate
            fx.source = "manual"
            logger.info(
                "FX rate overridden",
                extra={"date": str(target_date), "old_rate": old_rate, "new_rate": float(rate)},
            )
        else:
            fx = FxRate(date=target_date, usd_to_kzt=rate, source="manual")
            db.add(fx)
            logger.info(
                "FX rate set manually",
                extra={"date": str(target_date), "rate": float(rate)},
            )
        await db.flush()
        return fx
