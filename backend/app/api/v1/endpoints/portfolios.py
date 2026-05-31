from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.db.session import get_db
from app.core.security import get_current_user_id
from app.schemas.portfolio import (
    PortfolioCreate, PortfolioUpdate, PortfolioResponse,
    TransactionCreate, TransactionResponse,
    SecurityResponse, PortfolioSummary,
)
from app.services.portfolio_service import PortfolioService

router = APIRouter(prefix="/portfolios", tags=["Portfolios"])


# ── Portfolio CRUD ────────────────────────────────────────────────────────────

@router.get("", response_model=list[PortfolioResponse])
async def list_portfolios(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await PortfolioService.list_portfolios(db, user_id)


@router.post("", response_model=PortfolioResponse, status_code=201)
async def create_portfolio(
    data: PortfolioCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await PortfolioService.create(db, user_id, data)


@router.get("/{portfolio_id}/summary", response_model=PortfolioSummary)
async def get_portfolio_summary(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get full portfolio with live prices, P&L, and FX conversion."""
    return await PortfolioService.get_summary(db, user_id, portfolio_id)


@router.patch("/{portfolio_id}", response_model=PortfolioResponse)
async def update_portfolio(
    portfolio_id: int,
    data: PortfolioUpdate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await PortfolioService.update(db, user_id, portfolio_id, data)


@router.delete("/{portfolio_id}", status_code=204)
async def delete_portfolio(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    await PortfolioService.delete(db, user_id, portfolio_id)


# ── Transactions ──────────────────────────────────────────────────────────────

@router.get("/{portfolio_id}/transactions", response_model=list[TransactionResponse])
async def list_transactions(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await PortfolioService.list_transactions(db, user_id, portfolio_id)


@router.post("/{portfolio_id}/transactions", response_model=TransactionResponse, status_code=201)
async def add_transaction(
    portfolio_id: int,
    data: TransactionCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await PortfolioService.add_transaction(db, user_id, portfolio_id, data)


# ── Securities ────────────────────────────────────────────────────────────────

@router.get("/securities/search", response_model=list[SecurityResponse], tags=["Securities"])
async def search_securities(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    _: int = Depends(get_current_user_id),
):
    return await PortfolioService.search_securities(db, q)


@router.post("/securities/lookup/{ticker}", response_model=SecurityResponse, status_code=201, tags=["Securities"])
async def lookup_and_add_security(
    ticker: str,
    db: AsyncSession = Depends(get_db),
    _: int = Depends(get_current_user_id),
):
    """Fetch security info from Yahoo Finance and store it."""
    from app.services.portfolio_service import PortfolioService
    sec = await PortfolioService.get_or_create_security(db, ticker)
    from app.schemas.portfolio import SecurityResponse
    return SecurityResponse.model_validate(sec)
