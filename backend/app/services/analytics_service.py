import logging
import asyncio
import time
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from decimal import Decimal
from datetime import date, timedelta

from app.models.portfolio import Portfolio, Position, Security
from app.models.transaction import Transaction
from app.models.bank import BankAccount, BankTransaction, BankInterestRate, BankTransactionType
from app.schemas.analytics import PeriodPnl, PortfolioAnalytics, BankSummary, OverallSummary
from app.services.price_service import PriceService
from app.services.fx_service import FxService

logger = logging.getLogger("app.services.analytics")


class AnalyticsService:

    @staticmethod
    async def get_portfolio_analytics(
        db: AsyncSession, user_id: int, portfolio_id: int,
    ) -> PortfolioAnalytics:
        from fastapi import HTTPException
        t0 = time.perf_counter()

        result = await db.execute(
            select(Portfolio).where(and_(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
        )
        if not result.scalar_one_or_none():
            logger.warning("Analytics requested for unknown portfolio", extra={"user_id": user_id, "portfolio_id": portfolio_id})
            raise HTTPException(status_code=404, detail="Portfolio not found")

        fx_rate = await FxService.get_rate(db)
        zero = Decimal("0")

        result = await db.execute(select(Position).where(Position.portfolio_id == portfolio_id))
        positions = result.scalars().all()

        if not positions:
            logger.info("Analytics: no positions in portfolio", extra={"portfolio_id": portfolio_id})
            empty = PeriodPnl(period="1D", profit_usd=zero, profit_kzt=zero,
                              profit_percent=zero, value_start_usd=zero, value_end_usd=zero)
            return PortfolioAnalytics(
                total_value_usd=zero, total_value_kzt=zero, total_invested_usd=zero,
                total_profit_usd=zero, total_profit_kzt=zero, total_profit_percent=zero,
                pnl_1d=empty, pnl_1w=empty.model_copy(update={"period": "1W"}),
                pnl_1m=empty.model_copy(update={"period": "1M"}),
                pnl_1y=empty.model_copy(update={"period": "1Y"}),
                fx_rate=fx_rate, positions_profit=[],
            )

        security_ids = [p.security_id for p in positions]
        sec_result = await db.execute(select(Security).where(Security.id.in_(security_ids)))
        securities = {s.id: s for s in sec_result.scalars().all()}

        tickers = [securities[p.security_id].ticker for p in positions if p.security_id in securities]
        current_prices = await PriceService.get_prices_batch(tickers) if tickers else {}

        total_value_usd = zero
        total_invested_usd = zero
        positions_profit = []

        for pos in positions:
            security = securities.get(pos.security_id)
            if not security:
                continue
            price = current_prices.get(security.ticker)
            price_dec = Decimal(str(price)) if price else pos.avg_cost_usd
            value = price_dec * pos.quantity
            profit = value - pos.total_invested_usd
            profit_pct = (profit / pos.total_invested_usd * 100) if pos.total_invested_usd else zero
            total_value_usd += value
            total_invested_usd += pos.total_invested_usd
            positions_profit.append({
                "ticker": security.ticker,
                "name": security.name,
                "quantity": float(pos.quantity),
                "avg_cost_usd": float(pos.avg_cost_usd),
                "current_price_usd": float(price_dec),
                "current_value_usd": float(value),
                "current_value_kzt": float(value * fx_rate),
                "profit_usd": float(profit),
                "profit_kzt": float(profit * fx_rate),
                "profit_percent": float(profit_pct),
            })

        total_profit_usd = total_value_usd - total_invested_usd
        total_profit_pct = (total_profit_usd / total_invested_usd * 100) if total_invested_usd else zero

        pnl_tasks = [
            AnalyticsService._calc_period_pnl(db, positions, securities, current_prices, fx_rate, days, key)
            for key, days in [("1D", 1), ("1W", 7), ("1M", 30), ("1Y", 365)]
        ]
        pnl_1d, pnl_1w, pnl_1m, pnl_1y = await asyncio.gather(*pnl_tasks)

        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            "Portfolio analytics computed",
            extra={
                "portfolio_id": portfolio_id,
                "positions": len(positions_profit),
                "total_value_usd": float(total_value_usd),
                "total_profit_usd": float(total_profit_usd),
                "pnl_1d": float(pnl_1d.profit_usd),
                "pnl_1m": float(pnl_1m.profit_usd),
                "duration_ms": round(elapsed_ms, 1),
            },
        )

        return PortfolioAnalytics(
            total_value_usd=total_value_usd,
            total_value_kzt=total_value_usd * fx_rate,
            total_invested_usd=total_invested_usd,
            total_profit_usd=total_profit_usd,
            total_profit_kzt=total_profit_usd * fx_rate,
            total_profit_percent=total_profit_pct,
            pnl_1d=pnl_1d, pnl_1w=pnl_1w, pnl_1m=pnl_1m, pnl_1y=pnl_1y,
            fx_rate=fx_rate,
            positions_profit=positions_profit,
        )

    @staticmethod
    async def _calc_period_pnl(db, positions, securities, current_prices, fx_rate, days, period_key):
        zero = Decimal("0")
        start_date = date.today() - timedelta(days=days)

        hist_tasks = [
            PriceService.get_historical_price(securities[p.security_id].ticker, start_date)
            for p in positions if p.security_id in securities
        ]
        hist_list = await asyncio.gather(*hist_tasks, return_exceptions=True)
        hist_prices = {
            securities[p.security_id].ticker: (r if not isinstance(r, Exception) else None)
            for p, r in zip(positions, hist_list)
            if p.security_id in securities
        }

        value_start = zero
        value_end = zero
        for pos in positions:
            sec = securities.get(pos.security_id)
            if not sec:
                continue
            curr = current_prices.get(sec.ticker)
            hist = hist_prices.get(sec.ticker)
            curr_dec = Decimal(str(curr)) if curr else pos.avg_cost_usd
            hist_dec = Decimal(str(hist)) if hist else curr_dec
            value_end += curr_dec * pos.quantity
            value_start += hist_dec * pos.quantity

        profit = value_end - value_start
        profit_pct = (profit / value_start * 100) if value_start else zero
        logger.debug(
            "Period PnL computed",
            extra={
                "period": period_key,
                "value_start": float(value_start),
                "value_end": float(value_end),
                "profit_usd": float(profit),
            },
        )
        return PeriodPnl(
            period=period_key, profit_usd=profit, profit_kzt=profit * fx_rate,
            profit_percent=profit_pct, value_start_usd=value_start, value_end_usd=value_end,
        )

    @staticmethod
    async def get_bank_summary(db: AsyncSession, user_id: int) -> BankSummary:
        result = await db.execute(
            select(BankAccount).where(and_(BankAccount.user_id == user_id, BankAccount.is_active == True))
        )
        accounts = result.scalars().all()
        fx_rate = await FxService.get_rate(db)
        zero = Decimal("0")
        total_kzt = zero
        total_usd = zero
        total_interest_kzt = zero
        total_interest_usd = zero
        accounts_data = []

        for acc in accounts:
            result = await db.execute(
                select(func.sum(BankTransaction.amount)).where(and_(
                    BankTransaction.account_id == acc.id,
                    BankTransaction.type == BankTransactionType.INTEREST,
                ))
            )
            interest_earned = Decimal(str(result.scalar() or 0))

            from app.services.bank_service import BankService
            rate = await BankService._get_current_rate(db, acc.id)

            if acc.currency == "KZT":
                total_kzt += acc.balance
                total_interest_kzt += interest_earned
            else:
                total_usd += acc.balance
                total_interest_usd += interest_earned

            accounts_data.append({
                "id": acc.id,
                "name": acc.name,
                "currency": acc.currency,
                "balance": float(acc.balance),
                "balance_usd_equiv": float(acc.balance / fx_rate if acc.currency == "KZT" else acc.balance),
                "current_rate_percent": float(rate) if rate else None,
                "interest_earned": float(interest_earned),
            })

        logger.debug(
            "Bank summary computed",
            extra={"user_id": user_id, "accounts": len(accounts), "total_kzt": float(total_kzt), "total_usd": float(total_usd)},
        )

        return BankSummary(
            total_kzt=total_kzt,
            total_usd=total_usd,
            total_usd_equivalent=total_usd + (total_kzt / fx_rate),
            total_interest_earned_kzt=total_interest_kzt,
            total_interest_earned_usd=total_interest_usd,
            accounts=accounts_data,
        )

    @staticmethod
    async def get_overall_summary(db: AsyncSession, user_id: int, portfolio_id: int) -> OverallSummary:
        fx_rate = await FxService.get_rate(db)
        portfolio_analytics = await AnalyticsService.get_portfolio_analytics(db, user_id, portfolio_id)
        bank_summary = await AnalyticsService.get_bank_summary(db, user_id)
        grand_total_usd = portfolio_analytics.total_value_usd + bank_summary.total_usd_equivalent
        logger.info(
            "Overall summary computed",
            extra={
                "user_id": user_id,
                "portfolio_id": portfolio_id,
                "grand_total_usd": float(grand_total_usd),
                "fx_rate": float(fx_rate),
            },
        )
        return OverallSummary(
            portfolio=portfolio_analytics,
            bank=bank_summary,
            grand_total_usd=grand_total_usd,
            grand_total_kzt=grand_total_usd * fx_rate,
            fx_rate=fx_rate,
        )
