from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.db.session import get_db
from app.core.security import get_current_user_id
from app.schemas.portfolio import (
    PortfolioCreate, PortfolioUpdate, PortfolioResponse,
    TransactionCreate, TransactionImportResult, TransactionResponse,
    SecurityResponse, PortfolioSummary,
)
from app.services.portfolio_service import PortfolioService
from app.services.import_service import ImportService

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


@router.post("/{portfolio_id}/recalculate", response_model=PortfolioSummary)
async def recalculate_portfolio(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Rebuild Holdings (positions) from the transaction history.

    Wipes the cached positions for this portfolio and replays every
    BUY/SELL/SPLIT transaction in date order to recompute quantity, average
    cost, and total invested from scratch. Use this if Holdings looks wrong
    after a bulk import or any other data inconsistency — the transaction
    history is always treated as the source of truth.
    """
    return await PortfolioService.recalculate_positions(db, user_id, portfolio_id)


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


@router.delete("/{portfolio_id}/transactions/{transaction_id}", status_code=204)
async def delete_transaction(
    portfolio_id: int,
    transaction_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a transaction and reverse its effect on the position.
    BUY reversal: decreases qty + cost basis.
    SELL reversal: restores qty + cost basis.
    SPLIT reversal: un-multiplies shares.
    DIVIDEND/TAX/COMMISSION: deleted with no position change.
    """
    await PortfolioService.delete_transaction(db, user_id, portfolio_id, transaction_id)

@router.post("/{portfolio_id}/transactions/import", response_model=TransactionImportResult, status_code=201)
async def import_transactions(
    portfolio_id: int,
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk-import transactions from CSV or Excel (.xlsx).

    Required columns: ticker, type, date, quantity, price_usd
    Optional columns: fx_rate_usd_kzt, commission_usd, split_ratio, notes

    type ∈ BUY, SELL, DIVIDEND, TAX, SPLIT, COMMISSION
    date formats: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY
    """
    content = await file.read()
    return await ImportService.import_transactions(db, user_id, portfolio_id, content, file.filename)

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
