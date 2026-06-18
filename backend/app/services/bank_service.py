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

# Transfer types that get an automatic mirrored leg on the related account.
TRANSFER_MIRROR = {
    BankTransactionType.TRANSFER_OUT: BankTransactionType.TRANSFER_IN,
    BankTransactionType.TRANSFER_IN: BankTransactionType.TRANSFER_OUT,
}


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
    def _enrich_account(acc: BankAccount, rate: Optional[Decimal]) -> BankAccountResponse:
        resp = BankAccountResponse.model_validate(acc)
        resp.current_rate = rate
        return resp

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
        """
        Add a bank transaction.

        For TRANSFER_IN / TRANSFER_OUT with a related_account_id set, this
        automatically creates the mirrored leg on the related account in the
        same DB transaction, so a single "Transfer" action in the UI produces
        a balanced pair of entries instead of requiring the user to create
        each side manually. Both legs commit together or not at all.
        """
        account = await BankService.get_account_or_404(db, user_id, account_id)

        related_account: Optional[BankAccount] = None
        if data.related_account_id:
            if data.related_account_id == account_id:
                raise HTTPException(status_code=422, detail="Related account cannot be the same account")

            related_account = await BankService.get_account_or_404(db, user_id, data.related_account_id)

        tx = await BankService._apply_transaction(db, account, data)

        # Auto-create the mirrored leg for transfers between two of the
        # user's own accounts. We don't mirror INCOME/EXPENSE/etc. — only
        # TRANSFER_IN/TRANSFER_OUT, since those are explicitly two-sided.
        if related_account and data.type in TRANSFER_MIRROR:
            mirrored_data = BankTransactionCreate(
                type=TRANSFER_MIRROR[data.type],
                date=data.date,
                amount=-data.amount,
                related_account_id=account_id,
                fx_rate=data.fx_rate,
                notes=data.notes,
            )
            await BankService._apply_transaction(db, related_account, mirrored_data)

        await db.flush()
        await db.refresh(tx)

        logger.info(
            "Bank transaction added",
            extra={
                "account_id": account_id,
                "tx_id": tx.id,
                "type": data.type,
                "amount": float(data.amount),
                "currency": account.currency,
                "mirrored": bool(related_account and data.type in TRANSFER_MIRROR),
            },
        )
        return BankTransactionResponse.model_validate(tx)

    @staticmethod
    async def _apply_transaction(
        db: AsyncSession,
        account: BankAccount,
        data: BankTransactionCreate,
    ) -> BankTransaction:
        """
        Core balance-update + row-insert logic, shared by both legs of a
        transfer. Raises if the resulting balance would go negative.
        """
        new_balance = account.balance + data.amount
        if new_balance < 0:
            logger.warning(
                "Insufficient balance for transaction",
                extra={
                    "account_id": account.id,
                    "current_balance": float(account.balance),
                    "transaction_amount": float(data.amount),
                },
            )
            raise HTTPException(
                status_code=422,
                detail=f"Insufficient balance on account '{account.name}': {account.balance}",
            )

        account.balance = new_balance
        tx = BankTransaction(
            account_id=account.id,
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
        return tx

    @staticmethod
    async def delete_transaction(
        db: AsyncSession, user_id: int, account_id: int, transaction_id: int,
    ) -> None:
        """
        Delete a bank transaction and reverse its balance effect.

        If the transaction is one leg of an auto-created transfer pair (it
        has a related_account_id and type TRANSFER_IN/TRANSFER_OUT), the
        mirrored leg on the other account is found and deleted too, with its
        balance effect reversed as well — otherwise deleting one side would
        leave the books unbalanced.
        """
        account = await BankService.get_account_or_404(db, user_id, account_id)

        result = await db.execute(
            select(BankTransaction).where(
                and_(BankTransaction.id == transaction_id, BankTransaction.account_id == account_id)
            )
        )
        tx = result.scalar_one_or_none()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")

        # Find the mirrored leg, if any: same type-pair, same date/amount
        # magnitude, pointing back at this account, on the related account.
        mirror_tx: Optional[BankTransaction] = None
        if tx.related_account_id and tx.type in TRANSFER_MIRROR:
            mirror_result = await db.execute(
                select(BankTransaction).where(
                    and_(
                        BankTransaction.account_id == tx.related_account_id,
                        BankTransaction.related_account_id == account_id,
                        BankTransaction.type == TRANSFER_MIRROR[tx.type],
                        BankTransaction.date == tx.date,
                        BankTransaction.amount == -tx.amount,
                    )
                ).order_by(desc(BankTransaction.created_at)).limit(1)
            )
            mirror_tx = mirror_result.scalar_one_or_none()

        await BankService._reverse_and_delete(db, account, tx)

        if mirror_tx:
            related_account = await BankService.get_account_or_404(db, user_id, tx.related_account_id)
            await BankService._reverse_and_delete(db, related_account, mirror_tx)
            logger.info(
                "Mirrored transfer leg deleted alongside primary transaction",
                extra={"account_id": account_id, "primary_tx_id": transaction_id, "mirror_tx_id": mirror_tx.id},
            )

        await db.flush()

    @staticmethod
    async def _reverse_and_delete(db: AsyncSession, account: BankAccount, tx: BankTransaction) -> None:
        new_balance = account.balance - tx.amount
        if new_balance < 0:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot delete: reversal would result in negative balance on '{account.name}' ({new_balance:.2f})",
            )

        account.balance = new_balance

        logger.info(
            "Bank transaction deleted",
            extra={
                "account_id": account.id,
                "tx_id": tx.id,
                "amount_reversed": float(tx.amount),
                "new_balance": float(new_balance),
            },
        )

        await db.delete(tx)

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
