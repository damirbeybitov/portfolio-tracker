from pydantic import BaseModel
from decimal import Decimal
from typing import Literal

PeriodType = Literal["1D", "1W", "1M", "1Y", "ALL"]


class PeriodPnl(BaseModel):
    period: PeriodType
    profit_usd: Decimal
    profit_kzt: Decimal
    profit_percent: Decimal
    value_start_usd: Decimal
    value_end_usd: Decimal


class PortfolioAnalytics(BaseModel):
    # Current snapshot
    total_value_usd: Decimal
    total_value_kzt: Decimal
    total_invested_usd: Decimal
    total_profit_usd: Decimal
    total_profit_kzt: Decimal
    total_profit_percent: Decimal

    # Period breakdown
    pnl_1d: PeriodPnl
    pnl_1w: PeriodPnl
    pnl_1m: PeriodPnl
    pnl_1y: PeriodPnl

    # FX
    fx_rate: Decimal

    # Per-position breakdown
    positions_profit: list[dict]


class BankSummary(BaseModel):
    total_kzt: Decimal
    total_usd: Decimal
    total_usd_equivalent: Decimal  # USD accounts + KZT/fx
    total_interest_earned_kzt: Decimal
    total_interest_earned_usd: Decimal
    accounts: list[dict]


class OverallSummary(BaseModel):
    portfolio: PortfolioAnalytics
    bank: BankSummary
    grand_total_usd: Decimal
    grand_total_kzt: Decimal
    fx_rate: Decimal
