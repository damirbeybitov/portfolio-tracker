"""
Analytics Service — portfolio P&L, bank summary, grand total.

price_history write-through:
  Every call to get_prices_batch or get_current_price now passes the db
  session and a ticker→security_id map so live fetched prices are upserted
  into price_history automatically — no data gap between Airflow DAG runs.

Period P&L uses price_history first (fast, no external call), falls back to
the live provider chain only when a historical row is missing.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import (
    BankAccount,
    BankInterestRate,
    BankTransaction,
    BankTransactionType,
)
from app.models.portfolio import Portfolio, Position, Security
from app.models.transaction import Transaction
from app.schemas.analytics import (
    BankSummary,
    OverallSummary,
    PeriodPnl,
    PortfolioAnalytics,
)
from app.services.fx_service import FxService
from app.services.price_service import PriceService

logger = logging.getLogger(__name__)

ZERO = Decimal("0")


class AnalyticsService:

    # ------------------------------------------------------------------ #
    #  Portfolio analytics                                                 #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_portfolio_analytics(
        db: AsyncSession, user_id: int, portfolio_id: int
    ) -> PortfolioAnalytics:
        result = await db.execute(
            select(Portfolio).where(
                and_(Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Portfolio not found")

        fx_rate = await FxService.get_rate(db)

        result = await db.execute(
            select(Position).where(Position.portfolio_id == portfolio_id)
        )
        positions = result.scalars().all()

        if not positions:
            empty = PeriodPnl(
                period="1D",
                profit_usd=ZERO,
                profit_kzt=ZERO,
                profit_percent=ZERO,
                value_start_usd=ZERO,
                value_end_usd=ZERO,
            )
            return PortfolioAnalytics(
                total_value_usd=ZERO,
                total_value_kzt=ZERO,
                total_invested_usd=ZERO,
                total_profit_usd=ZERO,
                total_profit_kzt=ZERO,
                total_profit_percent=ZERO,
                pnl_1d=empty,
                pnl_1w=empty.model_copy(update={"period": "1W"}),
                pnl_1m=empty.model_copy(update={"period": "1M"}),
                pnl_1y=empty.model_copy(update={"period": "1Y"}),
                fx_rate=fx_rate,
                positions_profit=[],
            )

        # Load securities
        security_ids = [p.security_id for p in positions]
        sec_result = await db.execute(
            select(Security).where(Security.id.in_(security_ids))
        )
        securities: dict[int, Security] = {
            s.id: s for s in sec_result.scalars().all()
        }

        tickers = [
            securities[p.security_id].ticker
            for p in positions
            if p.security_id in securities
        ]

        # security_map for price_history write-through
        security_map: dict[str, int] = {
            securities[p.security_id].ticker: p.security_id
            for p in positions
            if p.security_id in securities
        }

        today = date.today()
        period_dates = {
            "1D": today - timedelta(days=1),
            "1W": today - timedelta(days=7),
            "1M": today - timedelta(days=30),
            "1Y": today - timedelta(days=365),
        }

        # Fetch current prices with price_history write-through
        current_prices_task = PriceService.get_prices_batch(
            tickers, db=db, security_map=security_map
        )

        async def fetch_hist_batch(target: date) -> dict[str, Optional[float]]:
            """
            For each ticker resolve historical price:
            1. price_history table (fast, free)
            2. Provider chain fallback via get_historical_price
            """
            ph_prices = await AnalyticsService._prices_from_history(
                db, security_map, target
            )

            tasks = {}
            for t in tickers:
                if ph_prices.get(t) is None:
                    tasks[t] = PriceService.get_historical_price(t, target)

            if tasks:
                results = await asyncio.gather(*tasks.values(), return_exceptions=True)
                for ticker, r in zip(tasks.keys(), results):
                    if isinstance(r, float):
                        ph_prices[ticker] = r

            return ph_prices

        hist_tasks = [fetch_hist_batch(d) for d in period_dates.values()]
        all_results = await asyncio.gather(
            current_prices_task, *hist_tasks, return_exceptions=False
        )

        current_prices: dict[str, Optional[float]] = all_results[0]
        hist_by_period: dict[str, dict[str, Optional[float]]] = {
            key: all_results[i + 1]
            for i, key in enumerate(period_dates.keys())
        }

        # Build current snapshot
        total_value_usd = ZERO
        total_invested_usd = ZERO
        positions_profit = []

        for pos in positions:
            security = securities.get(pos.security_id)
            if not security:
                continue
            price = current_prices.get(security.ticker)
            price_dec = (
                Decimal(str(price)) if price and price > 0 else pos.avg_cost_usd
            )
            value = price_dec * pos.quantity
            profit = value - pos.total_invested_usd
            profit_pct = (
                (profit / pos.total_invested_usd * 100)
                if pos.total_invested_usd
                else ZERO
            )
            total_value_usd += value
            total_invested_usd += pos.total_invested_usd
            positions_profit.append(
                {
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
                }
            )

        total_profit_usd = total_value_usd - total_invested_usd
        total_profit_pct = (
            (total_profit_usd / total_invested_usd * 100)
            if total_invested_usd
            else ZERO
        )

        def build_pnl(period_key: str) -> PeriodPnl:
            hist = hist_by_period[period_key]
            value_start = ZERO
            value_end = ZERO
            for pos in positions:
                sec = securities.get(pos.security_id)
                if not sec:
                    continue
                curr = current_prices.get(sec.ticker)
                h = hist.get(sec.ticker)
                curr_dec = (
                    Decimal(str(curr)) if curr and curr > 0 else pos.avg_cost_usd
                )
                hist_dec = Decimal(str(h)) if h and h > 0 else curr_dec
                value_end += curr_dec * pos.quantity
                value_start += hist_dec * pos.quantity

            profit = value_end - value_start
            profit_pct = (profit / value_start * 100) if value_start else ZERO
            return PeriodPnl(
                period=period_key,  # type: ignore[arg-type]
                profit_usd=profit,
                profit_kzt=profit * fx_rate,
                profit_percent=profit_pct,
                value_start_usd=value_start,
                value_end_usd=value_end,
            )

        return PortfolioAnalytics(
            total_value_usd=total_value_usd,
            total_value_kzt=total_value_usd * fx_rate,
            total_invested_usd=total_invested_usd,
            total_profit_usd=total_profit_usd,
            total_profit_kzt=total_profit_usd * fx_rate,
            total_profit_percent=total_profit_pct,
            pnl_1d=build_pnl("1D"),
            pnl_1w=build_pnl("1W"),
            pnl_1m=build_pnl("1M"),
            pnl_1y=build_pnl("1Y"),
            fx_rate=fx_rate,
            positions_profit=positions_profit,
        )

    # ------------------------------------------------------------------ #
    #  price_history lookup helper                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _prices_from_history(
        db: AsyncSession,
        security_map: dict[str, int],
        target_date: date,
    ) -> dict[str, Optional[float]]:
        """
        Batch-fetch the closest available close price on or before target_date
        from price_history for each security in security_map.

        Returns {ticker: close_price | None}.
        """
        if not security_map:
            return {}

        # Use DISTINCT ON to get the most recent row per security on or before
        # target_date in a single round-trip — much cheaper than N individual
        # queries when a portfolio has many positions.
        sql = text(
            """
            SELECT DISTINCT ON (security_id)
                security_id,
                close
            FROM price_history
            WHERE security_id = ANY(:ids)
              AND date <= :target
            ORDER BY security_id, date DESC
            """
        )
        sec_id_to_ticker = {v: k for k, v in security_map.items()}
        result = await db.execute(
            sql,
            {"ids": list(security_map.values()), "target": target_date},
        )
        rows = result.fetchall()

        prices: dict[str, Optional[float]] = {t: None for t in security_map}
        for row in rows:
            ticker = sec_id_to_ticker.get(row.security_id)
            if ticker and row.close is not None:
                prices[ticker] = float(row.close)

        return prices

    # ------------------------------------------------------------------ #
    #  Bank summary                                                        #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_bank_summary(db: AsyncSession, user_id: int) -> BankSummary:
        result = await db.execute(
            select(BankAccount).where(
                and_(
                    BankAccount.user_id == user_id,
                    BankAccount.is_active == True,  # noqa: E712
                )
            )
        )
        accounts = result.scalars().all()
        fx_rate = await FxService.get_rate(db)

        total_kzt = ZERO
        total_usd = ZERO
        total_interest_kzt = ZERO
        total_interest_usd = ZERO
        accounts_data = []

        for acc in accounts:
            interest_result = await db.execute(
                select(func.sum(BankTransaction.amount)).where(
                    and_(
                        BankTransaction.account_id == acc.id,
                        BankTransaction.type == BankTransactionType.INTEREST,
                    )
                )
            )
            interest_earned = Decimal(str(interest_result.scalar() or 0))

            from app.services.bank_service import BankService

            rate = await BankService._get_current_rate(db, acc.id)

            if str(acc.currency) == "KZT":
                total_kzt += acc.balance
                total_interest_kzt += interest_earned
            else:
                total_usd += acc.balance
                total_interest_usd += interest_earned

            accounts_data.append(
                {
                    "id": acc.id,
                    "name": acc.name,
                    "currency": str(acc.currency),
                    "balance": float(acc.balance),
                    "balance_usd_equiv": float(
                        acc.balance / fx_rate
                        if str(acc.currency) == "KZT"
                        else acc.balance
                    ),
                    "current_rate_percent": float(rate) if rate else None,
                    "interest_earned": float(interest_earned),
                }
            )

        return BankSummary(
            total_kzt=total_kzt,
            total_usd=total_usd,
            total_usd_equivalent=total_usd + (total_kzt / fx_rate if fx_rate else ZERO),
            total_interest_earned_kzt=total_interest_kzt,
            total_interest_earned_usd=total_interest_usd,
            accounts=accounts_data,
        )

    # ------------------------------------------------------------------ #
    #  Overall (portfolio + bank)                                         #
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_overall_summary(
        db: AsyncSession, user_id: int, portfolio_id: int
    ) -> OverallSummary:
        portfolio_task = AnalyticsService.get_portfolio_analytics(
            db, user_id, portfolio_id
        )
        bank_task = AnalyticsService.get_bank_summary(db, user_id)

        portfolio_analytics, bank_summary = await asyncio.gather(
            portfolio_task, bank_task
        )

        fx_rate = portfolio_analytics.fx_rate
        grand_total_usd = (
            portfolio_analytics.total_value_usd + bank_summary.total_usd_equivalent
        )
        return OverallSummary(
            portfolio=portfolio_analytics,
            bank=bank_summary,
            grand_total_usd=grand_total_usd,
            grand_total_kzt=grand_total_usd * fx_rate,
            fx_rate=fx_rate,
        )