from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

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
    return await PortfolioService.get_summary(db, user_id, portfolio_id)


@router.post("/{portfolio_id}/recalculate", response_model=PortfolioSummary)
async def recalculate_portfolio(
    portfolio_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Rebuild positions from transaction history (use after data fixes)."""
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
    """List BUY, SELL, SPLIT transactions for this portfolio."""
    return await PortfolioService.list_transactions(db, user_id, portfolio_id)


@router.post("/{portfolio_id}/transactions", response_model=TransactionResponse, status_code=201)
async def add_transaction(
    portfolio_id: int,
    data: TransactionCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Add a SPLIT transaction directly.
    BUY and SELL are created automatically via bank STOCK_BUY/STOCK_SELL transactions.
    """
    return await PortfolioService.add_transaction(db, user_id, portfolio_id, data)


@router.delete("/{portfolio_id}/transactions/{transaction_id}", status_code=204)
async def delete_transaction(
    portfolio_id: int,
    transaction_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a portfolio transaction and reverse its position effect.
    Note: BUY/SELL transactions are normally deleted by deleting their linked
    bank transaction. This endpoint handles direct deletions and SPLIT removals.
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
    Bulk-import SPLIT transactions from CSV or Excel.

    Required columns: ticker, type, date, quantity, price_usd
    Optional columns: fx_rate_usd_kzt, split_ratio, notes

    type ∈ BUY, SELL, SPLIT
    Note: BUY/SELL imported here bypass bank account balance updates.
    Use bank transaction import for stock purchases/sales that affect cash.
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
    sec = await PortfolioService.get_or_create_security(db, ticker)
    return SecurityResponse.model_validate(sec)
