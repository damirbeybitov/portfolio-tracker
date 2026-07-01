from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_user_id
from app.schemas.analytics import PortfolioAnalytics, BankSummary, OverallSummary, CandlePoint
from app.services.analytics_service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/portfolio/{portfolio_id}", response_model=PortfolioAnalytics)
async def get_portfolio_analytics(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Full P&L analytics for a portfolio:
    - Current total value in USD and KZT
    - Total profit (all time)
    - Period P&L: 1D / 1W / 1M / 1Y — "real" profit, excluding cash you
      invested/withdrew during the window (see AnalyticsService docstring)
    - Per-position breakdown
    """
    return await AnalyticsService.get_portfolio_analytics(db, user_id, portfolio_id)


@router.get("/portfolio/{portfolio_id}/candles/{ticker}", response_model=list[CandlePoint])
async def get_candles(
    portfolio_id: int,
    ticker: str,
    days: int = Query(180, ge=7, le=1825),
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    OHLC candle data for a ticker held in this portfolio, sourced from
    price_history (populated by the daily Airflow ingest + live write-through).
    Powers the candlestick chart on the Analytics page.
    """
    return await AnalyticsService.get_candles(db, user_id, portfolio_id, ticker, days)


@router.get("/bank", response_model=BankSummary)
async def get_bank_summary(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Summary of all bank accounts:
    - Total balance in KZT and USD
    - Total interest earned
    - Per-account breakdown with current rates
    """
    return await AnalyticsService.get_bank_summary(db, user_id)


@router.get("/overview/{portfolio_id}", response_model=OverallSummary)
async def get_overall_summary(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Grand total: portfolio value + bank accounts combined.
    Single endpoint for the main dashboard.
    """
    return await AnalyticsService.get_overall_summary(db, user_id, portfolio_id)
