from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_user_id
from app.schemas.analytics import PortfolioAnalytics, BankSummary, OverallSummary
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
    - Period P&L: 1D / 1W / 1M / 1Y
    - Per-position breakdown
    """
    return await AnalyticsService.get_portfolio_analytics(db, user_id, portfolio_id)


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
