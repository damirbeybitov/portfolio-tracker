import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc, func
from fastapi import HTTPException, status
from decimal import Decimal
from datetime import date
from typing import Optional

from app.models.bank import BankAccount, BankInterestRate, BankTransaction, BankTransactionType
from app.schemas.bank import (
    BankAccountCreate, BankAccountUpdate, BankAccountResponse,
    BankInterestRateCreate, BankInterestRateResponse,
    BankTransactionCreate, BankTransactionResponse,
    FxRateCreate, FxRateResponse,
)
from app.services.fx_service import FxService

logger = logging.getLogger("app.services.bank")


class BankService:

    @staticmethod
    async def create_account(db: AsyncSession, user_id: int, data: BankAccountCreate) -> BankAccountResponse:
        account = BankAccount(user_id=user_id, **data.model_dump())
        db.add(account)
        await db.flush()
        await db.refresh(account)
        logger.info(
            "Bank account created",
            extra={"user_id": user_id, "account_id": account.id, "currency": account.currency, "name": account.name},
        )
        resp = BankAccountResponse.model_validate(account)
        resp.current_rate = None
        return resp

    @staticmethod
    async def list_accounts(db: AsyncSession, user_id: int) -> list[BankAccountResponse]:
        result = await db.execute(select(BankAccount).where(BankAccount.user_id == user_id))
        accounts = result.scalars().all()
        logger.debug("Listed bank accounts", extra={"user_id": user_id, "count": len(accounts)})
        enriched = []
        for acc in accounts:
            rate = await BankService._get_current_rate(db, acc.id)
            resp = BankAccountResponse.model_validate(acc)
            resp.current_rate = rate
            enriched.append(resp)
        return enriched

    @staticmethod
    async def get_account_or_404(db: AsyncSession, user_id: int, account_id: int) -> BankAccount:
        result = await db.execute(
            select(BankAccount).where(and_(BankAccount.id == account_id, BankAccount.user_id == user_id))
        )
        acc = result.scalar_one_or_none()
        if not acc:
            logger.warning("Bank account not found", extra={"user_id": user_id, "account_id": account_id})
            raise HTTPException(status_code=404, detail="Bank account not found")
        return acc

    @staticmethod
    async def update_account(
        db: AsyncSession, user_id: int, account_id: int, data: BankAccountUpdate,
    ) -> BankAccountResponse:
        acc = await BankService.get_account_or_404(db, user_id, account_id)
        changes = data.model_dump(exclude_unset=True)
        for field, value in changes.items():
            setattr(acc, field, value)
        await db.flush()
        await db.refresh(acc)
        logger.info(
            "Bank account updated",
            extra={"user_id": user_id, "account_id": account_id, "fields": list(changes.keys())},
        )
        rate = await BankService._get_current_rate(db, acc.id)
        resp = BankAccountResponse.model_validate(acc)
        resp.current_rate = rate
        return resp

    @staticmethod
    async def set_interest_rate(
        db: AsyncSession, user_id: int, account_id: int, data: BankInterestRateCreate,
    ) -> BankInterestRateResponse:
        await BankService.get_account_or_404(db, user_id, account_id)
        rate = BankInterestRate(account_id=account_id, **data.model_dump())
        db.add(rate)
        await db.flush()
        await db.refresh(rate)
        logger.info(
            "Interest rate set",
            extra={
                "account_id": account_id,
                "rate_percent": float(data.rate_percent),
                "effective_from": str(data.effective_from),
            },
        )
        return BankInterestRateResponse.model_validate(rate)

    @staticmethod
    async def list_rates(
        db: AsyncSession, user_id: int, account_id: int,
    ) -> list[BankInterestRateResponse]:
        await BankService.get_account_or_404(db, user_id, account_id)
        result = await db.execute(
            select(BankInterestRate)
            .where(BankInterestRate.account_id == account_id)
            .order_by(desc(BankInterestRate.effective_from))
        )
        rates = result.scalars().all()
        logger.debug("Listed interest rates", extra={"account_id": account_id, "count": len(rates)})
        return [BankInterestRateResponse.model_validate(r) for r in rates]

    @staticmethod
    async def _get_current_rate(db: AsyncSession, account_id: int) -> Optional[Decimal]:
        result = await db.execute(
            select(BankInterestRate)
            .where(and_(
                BankInterestRate.account_id == account_id,
                BankInterestRate.effective_from <= date.today(),
            ))
            .order_by(desc(BankInterestRate.effective_from))
            .limit(1)
        )
        r = result.scalar_one_or_none()
        return r.rate_percent if r else None

    @staticmethod
    async def add_transaction(
        db: AsyncSession, user_id: int, account_id: int, data: BankTransactionCreate,
    ) -> BankTransactionResponse:
        account = await BankService.get_account_or_404(db, user_id, account_id)

        if data.related_account_id:
            result = await db.execute(
                select(BankAccount).where(and_(
                    BankAccount.id == data.related_account_id,
                    BankAccount.user_id == user_id,
                ))
            )
            if not result.scalar_one_or_none():
                logger.warning(
                    "Related account not found",
                    extra={"user_id": user_id, "related_account_id": data.related_account_id},
                )
                raise HTTPException(status_code=404, detail="Related account not found")

        new_balance = account.balance + data.amount
        if new_balance < 0:
            logger.warning(
                "Insufficient balance for transaction",
                extra={
                    "account_id": account_id,
                    "current_balance": float(account.balance),
                    "transaction_amount": float(data.amount),
                },
            )
            raise HTTPException(status_code=422, detail=f"Insufficient balance: {account.balance}")

        account.balance = new_balance
        tx = BankTransaction(
            account_id=account_id,
            type=data.type,
            date=data.date,
            amount=data.amount,
            balance_after=new_balance,
            related_account_id=data.related_account_id,
            fx_rate=data.fx_rate,
            notes=data.notes,
        )
        db.add(tx)
        await db.flush()
        await db.refresh(tx)

        logger.info(
            "Bank transaction added",
            extra={
                "account_id": account_id,
                "tx_id": tx.id,
                "type": data.type,
                "amount": float(data.amount),
                "balance_after": float(new_balance),
                "currency": account.currency,
            },
        )
        return BankTransactionResponse.model_validate(tx)

    @staticmethod
    async def list_transactions(
        db: AsyncSession, user_id: int, account_id: int,
    ) -> list[BankTransactionResponse]:
        await BankService.get_account_or_404(db, user_id, account_id)
        result = await db.execute(
            select(BankTransaction)
            .where(BankTransaction.account_id == account_id)
            .order_by(desc(BankTransaction.date), desc(BankTransaction.created_at))
        )
        txs = result.scalars().all()
        logger.debug("Listed bank transactions", extra={"account_id": account_id, "count": len(txs)})
        return [BankTransactionResponse.model_validate(tx) for tx in txs]

    @staticmethod
    async def set_fx_rate(db: AsyncSession, data: FxRateCreate) -> FxRateResponse:
        fx = await FxService.set_manual_rate(db, data.date, data.usd_to_kzt)
        return FxRateResponse.model_validate(fx)

    @staticmethod
    async def get_fx_rate(db: AsyncSession, target_date: Optional[date] = None) -> dict:
        rate = await FxService.get_rate(db, target_date)
        return {"date": str(target_date or date.today()), "usd_to_kzt": float(rate), "source": "computed"}
