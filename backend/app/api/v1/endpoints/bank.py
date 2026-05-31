from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date
from typing import Optional

from app.db.session import get_db
from app.core.security import get_current_user_id
from app.schemas.bank import (
    BankAccountCreate, BankAccountUpdate, BankAccountResponse,
    BankInterestRateCreate, BankInterestRateResponse,
    BankTransactionCreate, BankTransactionResponse,
    FxRateCreate, FxRateResponse,
)
from app.services.bank_service import BankService

router = APIRouter(prefix="/bank", tags=["Bank Accounts"])


# ── Accounts ──────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=list[BankAccountResponse])
async def list_accounts(
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List all bank accounts with current interest rate."""
    return await BankService.list_accounts(db, user_id)


@router.post("/accounts", response_model=BankAccountResponse, status_code=201)
async def create_account(
    data: BankAccountCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await BankService.create_account(db, user_id, data)


@router.get("/accounts/{account_id}", response_model=BankAccountResponse)
async def get_account(
    account_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    acc = await BankService.get_account_or_404(db, user_id, account_id)
    from app.services.bank_service import BankService as BS
    rate = await BS._get_current_rate(db, acc.id)
    return BankService._enrich_account(acc, rate)


@router.patch("/accounts/{account_id}", response_model=BankAccountResponse)
async def update_account(
    account_id: int,
    data: BankAccountUpdate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await BankService.update_account(db, user_id, account_id, data)


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(
    account_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    acc = await BankService.get_account_or_404(db, user_id, account_id)
    acc.is_active = False


# ── Interest Rates ────────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/rates", response_model=list[BankInterestRateResponse])
async def list_rates(
    account_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get full interest rate history for an account."""
    return await BankService.list_rates(db, user_id, account_id)


@router.post("/accounts/{account_id}/rates", response_model=BankInterestRateResponse, status_code=201)
async def set_rate(
    account_id: int,
    data: BankInterestRateCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Add a new interest rate entry (effective from a given date)."""
    return await BankService.set_interest_rate(db, user_id, account_id, data)


# ── Transactions ──────────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/transactions", response_model=list[BankTransactionResponse])
async def list_transactions(
    account_id: int,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await BankService.list_transactions(db, user_id, account_id)


@router.post("/accounts/{account_id}/transactions", response_model=BankTransactionResponse, status_code=201)
async def add_transaction(
    account_id: int,
    data: BankTransactionCreate,
    user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Add a bank transaction. Amount sign rules:
    - Positive: INCOME, TRANSFER_IN, INTEREST, STOCK_SELL, DIVIDEND
    - Negative: EXPENSE, TRANSFER_OUT, STOCK_BUY, TAX, COMMISSION
    """
    return await BankService.add_transaction(db, user_id, account_id, data)


# ── FX Rates ──────────────────────────────────────────────────────────────────

@router.get("/fx", response_model=dict)
async def get_fx_rate(
    target_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    _: int = Depends(get_current_user_id),
):
    """Get USD/KZT rate for a date (fetches from market if not stored)."""
    return await BankService.get_fx_rate(db, target_date)


@router.post("/fx", response_model=FxRateResponse, status_code=201)
async def set_fx_rate(
    data: FxRateCreate,
    db: AsyncSession = Depends(get_db),
    _: int = Depends(get_current_user_id),
):
    """Manually set USD/KZT rate for a specific date."""
    return await BankService.set_fx_rate(db, data)
