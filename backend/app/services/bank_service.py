"""
Bank Service

Key change: STOCK_BUY / STOCK_SELL bank transactions now automatically
create / delete the matching portfolio transaction so the bank account is
the single source of truth for stock activity.

update_transaction: allows editing date, notes, fx_rate for all types,
and amount for non-stock types (reversing the delta on the account balance).
"""

import logging
import uuid
from decimal import Decimal
from datetime import date
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank import BankAccount, BankInterestRate, BankTransaction, BankTransactionType
from app.models.portfolio import Security
from app.models.transaction import Transaction, TransactionType
from app.schemas.bank import (
    BankAccountCreate, BankAccountUpdate, BankAccountResponse,
    BankInterestRateCreate, BankInterestRateResponse,
    BankTransactionCreate, BankTransactionUpdate, BankTransactionResponse,
    FxRateCreate, FxRateResponse,
)
from app.schemas.portfolio import TransactionCreate
from app.services.fx_service import FxService

logger = logging.getLogger("app.services.bank")

TRANSFER_MIRROR = {
    BankTransactionType.TRANSFER_OUT: BankTransactionType.TRANSFER_IN,
    BankTransactionType.TRANSFER_IN: BankTransactionType.TRANSFER_OUT,
}

STOCK_TYPES = {BankTransactionType.STOCK_BUY, BankTransactionType.STOCK_SELL}


class BankService:

    # ── Accounts ──────────────────────────────────────────────────────────────

    @staticmethod
    async def create_account(db: AsyncSession, user_id: int, data: BankAccountCreate) -> BankAccountResponse:
        account = BankAccount(user_id=user_id, **data.model_dump())
        db.add(account)
        await db.flush()
        await db.refresh(account)
        resp = BankAccountResponse.model_validate(account)
        resp.current_rate = None
        return resp

    @staticmethod
    async def list_accounts(db: AsyncSession, user_id: int) -> list[BankAccountResponse]:
        result = await db.execute(select(BankAccount).where(BankAccount.user_id == user_id))
        accounts = result.scalars().all()
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
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(acc, field, value)
        await db.flush()
        await db.refresh(acc)
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
        return BankInterestRateResponse.model_validate(rate)

    @staticmethod
    async def list_rates(db: AsyncSession, user_id: int, account_id: int) -> list[BankInterestRateResponse]:
        await BankService.get_account_or_404(db, user_id, account_id)
        result = await db.execute(
            select(BankInterestRate)
            .where(BankInterestRate.account_id == account_id)
            .order_by(desc(BankInterestRate.effective_from))
        )
        return [BankInterestRateResponse.model_validate(r) for r in result.scalars().all()]

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

    # ── Transactions ──────────────────────────────────────────────────────────

    @staticmethod
    async def add_transaction(
        db: AsyncSession, user_id: int, account_id: int, data: BankTransactionCreate,
    ) -> BankTransactionResponse:
        """
        Add a bank transaction.

        For STOCK_BUY/STOCK_SELL: auto-creates the matching portfolio
        transaction and stores its id in linked_portfolio_tx_id so it can be
        found and deleted when this bank tx is removed.

        For TRANSFER_IN/TRANSFER_OUT with related_account_id: auto-creates
        the mirrored leg on the other account (existing behaviour).
        """
        account = await BankService.get_account_or_404(db, user_id, account_id)

        related_account: Optional[BankAccount] = None
        if data.related_account_id:
            if data.related_account_id == account_id:
                raise HTTPException(status_code=422, detail="Related account cannot be the same account")
            related_account = await BankService.get_account_or_404(db, user_id, data.related_account_id)

        is_mirrored_transfer = bool(related_account and data.type in TRANSFER_MIRROR)
        is_cross_currency = bool(
            related_account and str(account.currency) != str(related_account.currency)
        )

        if is_mirrored_transfer and is_cross_currency and not data.fx_rate:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"This transfer moves money between a {account.currency} account and a "
                    f"{related_account.currency} account. Provide fx_rate (USD->KZT) "
                    f"so the converted amount is explicit."
                ),
            )

        group_id = uuid.uuid4() if is_mirrored_transfer else None

        # ── Handle stock buy/sell → auto-create portfolio transaction ────
        linked_portfolio_tx_id: Optional[int] = None
        if data.type in STOCK_TYPES:
            linked_portfolio_tx_id = await BankService._create_portfolio_tx(
                db, user_id, data
            )

        tx = await BankService._apply_transaction(
            db, account, data,
            transfer_group_id=group_id,
            linked_portfolio_tx_id=linked_portfolio_tx_id,
        )

        # Mirror the other leg of a transfer
        if is_mirrored_transfer:
            mirrored_amount = await BankService._convert_amount(
                db, amount=data.amount,
                from_currency=str(account.currency.value),
                to_currency=str(related_account.currency.value),
                fx_rate=data.fx_rate,
            )
            mirrored_data = BankTransactionCreate(
                type=TRANSFER_MIRROR[data.type],
                date=data.date,
                amount=-mirrored_amount,
                related_account_id=account_id,
                fx_rate=data.fx_rate,
                notes=data.notes,
            )
            await BankService._apply_transaction(db, related_account, mirrored_data, transfer_group_id=group_id)

        await db.flush()
        await db.refresh(tx)
        return BankTransactionResponse.model_validate(tx)

    # ── Update transaction ────────────────────────────────────────────────────

    @staticmethod
    async def update_transaction(
        db: AsyncSession,
        user_id: int,
        account_id: int,
        transaction_id: int,
        data: BankTransactionUpdate,
    ) -> BankTransactionResponse:
        """
        Partially update a bank transaction.

        - date / notes / fx_rate: always editable.
        - amount: editable for non-stock types only.  The delta is applied to
          the account's current balance (historical balance_after snapshots on
          other rows are intentionally left as-is — they are display-only
          artifacts; the live balance is the authoritative figure).
        - STOCK_BUY / STOCK_SELL: changing the amount would require replaying
          the linked portfolio position, which is too complex to do safely
          here.  Guide the user to delete + re-add instead.
        """
        account = await BankService.get_account_or_404(db, user_id, account_id)

        result = await db.execute(
            select(BankTransaction).where(
                and_(
                    BankTransaction.id == transaction_id,
                    BankTransaction.account_id == account_id,
                )
            )
        )
        tx = result.scalar_one_or_none()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")

        # Guard: stock amount changes not allowed
        if data.amount is not None and tx.type in STOCK_TYPES:
            raise HTTPException(
                status_code=422,
                detail=(
                    "The amount of a stock transaction cannot be changed here because it is "
                    "linked to a portfolio position.  Delete this transaction and re-add it "
                    "with the correct amount."
                ),
            )

        # Apply amount delta to live account balance
        if data.amount is not None and data.amount != tx.amount:
            delta = data.amount - tx.amount          # positive → more money in
            new_balance = account.balance + delta
            if new_balance < 0:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Editing this transaction would result in a negative balance "
                        f"({new_balance:.2f}).  Adjust the amount or leave it unchanged."
                    ),
                )
            account.balance = new_balance
            tx.amount = data.amount
            tx.balance_after = new_balance           # update this tx's snapshot

        if data.date is not None:
            tx.date = data.date
        if data.fx_rate is not None:
            tx.fx_rate = data.fx_rate
        # Allow explicitly clearing notes by passing ""
        if data.notes is not None:
            tx.notes = data.notes or None

        await db.flush()
        await db.refresh(tx)
        logger.info(
            "Bank transaction updated",
            extra={"account_id": account_id, "transaction_id": transaction_id},
        )
        return BankTransactionResponse.model_validate(tx)

    @staticmethod
    async def _create_portfolio_tx(
        db: AsyncSession, user_id: int, data: BankTransactionCreate,
    ) -> int:
        """
        Auto-create a portfolio BUY or SELL transaction from a bank STOCK
        transaction. Returns the id of the created portfolio transaction.
        """
        from app.models.portfolio import Portfolio

        # Verify the portfolio belongs to this user
        result = await db.execute(
            select(Portfolio).where(
                and_(Portfolio.id == data.portfolio_id, Portfolio.user_id == user_id)
            )
        )
        portfolio = result.scalar_one_or_none()
        if not portfolio:
            raise HTTPException(status_code=404, detail="Portfolio not found")

        # Resolve or create security
        ticker = data.ticker.upper()
        result = await db.execute(
            select(Security).where(Security.ticker == ticker)
        )
        security = result.scalar_one_or_none()
        if not security:
            from app.services.price_service import PriceService
            info = await PriceService.get_security_info(ticker)
            if not info:
                raise HTTPException(status_code=422, detail=f"Ticker '{ticker}' not found")
            security = Security(**info)
            db.add(security)
            await db.flush()
            await db.refresh(security)

        fx_rate = data.fx_rate or await FxService.get_rate(db, data.date)
        price_usd = data.price_per_share
        price_kzt = price_usd * fx_rate
        total_usd = price_usd * data.quantity
        total_kzt = price_kzt * data.quantity

        tx_type = TransactionType.BUY if data.type == BankTransactionType.STOCK_BUY else TransactionType.SELL

        tx = Transaction(
            portfolio_id=data.portfolio_id,
            security_id=security.id,
            type=tx_type,
            date=data.date,
            quantity=data.quantity,
            price_usd=price_usd,
            price_kzt=price_kzt,
            total_usd=total_usd,
            total_kzt=total_kzt,
            fx_rate_usd_kzt=fx_rate,
            notes=data.notes,
        )
        db.add(tx)
        await db.flush()

        # Update the position
        from app.services.portfolio_service import PortfolioService
        await PortfolioService._update_position(db, data.portfolio_id, security, tx, fx_rate)

        logger.info(
            "Auto-created portfolio tx from bank tx",
            extra={
                "portfolio_id": data.portfolio_id,
                "ticker": ticker,
                "type": tx_type,
                "portfolio_tx_id": tx.id,
            },
        )
        return tx.id

    @staticmethod
    async def _convert_amount(
        db: AsyncSession,
        amount: Decimal,
        from_currency: str,
        to_currency: str,
        fx_rate: Optional[Decimal],
    ) -> Decimal:
        if from_currency == to_currency:
            return amount
        rate = fx_rate if fx_rate else await FxService.get_rate(db)
        if from_currency == "USD" and to_currency == "KZT":
            return amount * rate
        if from_currency == "KZT" and to_currency == "USD":
            return amount / rate
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported currency pair: {from_currency} -> {to_currency}",
        )

    @staticmethod
    async def _apply_transaction(
        db: AsyncSession,
        account: BankAccount,
        data: BankTransactionCreate,
        transfer_group_id: Optional[uuid.UUID] = None,
        linked_portfolio_tx_id: Optional[int] = None,
    ) -> BankTransaction:
        new_balance = account.balance + data.amount
        if new_balance < 0:
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
            transfer_group_id=transfer_group_id,
            # Stock link fields
            ticker=data.ticker,
            quantity=data.quantity,
            price_per_share=data.price_per_share,
            portfolio_id=data.portfolio_id,
            linked_portfolio_tx_id=linked_portfolio_tx_id,
        )
        db.add(tx)
        await db.flush()
        return tx

    # ── Delete transaction ────────────────────────────────────────────────────

    @staticmethod
    async def delete_transaction(
        db: AsyncSession, user_id: int, account_id: int, transaction_id: int,
    ) -> None:
        """
        Delete a bank transaction and reverse its balance effect.

        For STOCK_BUY/STOCK_SELL: also deletes the linked portfolio
        transaction and reverses the position.

        For transfer pairs: deletes the mirrored leg too.
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

        # ── Delete linked portfolio transaction ───────────────────────────
        if tx.type in STOCK_TYPES and tx.linked_portfolio_tx_id:
            await BankService._delete_linked_portfolio_tx(
                db, user_id, tx.linked_portfolio_tx_id, tx.portfolio_id
            )

        # ── Delete transfer mirror leg ────────────────────────────────────
        mirror_tx: Optional[BankTransaction] = None
        if tx.transfer_group_id is not None:
            mirror_result = await db.execute(
                select(BankTransaction).where(
                    and_(
                        BankTransaction.transfer_group_id == tx.transfer_group_id,
                        BankTransaction.id != tx.id,
                    )
                ).limit(1)
            )
            mirror_tx = mirror_result.scalar_one_or_none()
        elif tx.related_account_id and tx.type in TRANSFER_MIRROR:
            mirror_result = await db.execute(
                select(BankTransaction).where(
                    and_(
                        BankTransaction.account_id == tx.related_account_id,
                        BankTransaction.related_account_id == account_id,
                        BankTransaction.type == TRANSFER_MIRROR[tx.type],
                        BankTransaction.date == tx.date,
                        BankTransaction.transfer_group_id.is_(None),
                    )
                ).order_by(desc(BankTransaction.created_at)).limit(1)
            )
            mirror_tx = mirror_result.scalar_one_or_none()

        await BankService._reverse_and_delete(db, account, tx)

        if mirror_tx:
            related_account = await BankService.get_account_or_404(db, user_id, tx.related_account_id)
            await BankService._reverse_and_delete(db, related_account, mirror_tx)

        await db.flush()

    @staticmethod
    async def _delete_linked_portfolio_tx(
        db: AsyncSession, user_id: int, portfolio_tx_id: int, portfolio_id: int
    ) -> None:
        """Delete the portfolio transaction created by a bank STOCK_BUY/SELL."""
        from app.services.portfolio_service import PortfolioService
        try:
            await PortfolioService.delete_transaction(
                db, user_id, portfolio_id, portfolio_tx_id
            )
            logger.info(
                "Auto-deleted linked portfolio tx",
                extra={"portfolio_tx_id": portfolio_tx_id, "portfolio_id": portfolio_id},
            )
        except HTTPException as e:
            # If the portfolio tx is already gone (manual deletion), log and continue
            logger.warning(
                "Linked portfolio tx not found during bank tx delete: %s", e.detail
            )

    @staticmethod
    async def _reverse_and_delete(db: AsyncSession, account: BankAccount, tx: BankTransaction) -> None:
        new_balance = account.balance - tx.amount
        if new_balance < 0:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot delete: reversal would result in negative balance on '{account.name}' ({new_balance:.2f})",
            )
        account.balance = new_balance
        await db.delete(tx)

    # ── List transactions ─────────────────────────────────────────────────────

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
        return [BankTransactionResponse.model_validate(tx) for tx in result.scalars().all()]

    # ── FX ────────────────────────────────────────────────────────────────────

    @staticmethod
    async def set_fx_rate(db: AsyncSession, data: FxRateCreate) -> FxRateResponse:
        fx = await FxService.set_manual_rate(db, data.date, data.usd_to_kzt)
        return FxRateResponse.model_validate(fx)

    @staticmethod
    async def get_fx_rate(db: AsyncSession, target_date: Optional[date] = None) -> dict:
        rate = await FxService.get_rate(db, target_date)
        return {"date": str(target_date or date.today()), "usd_to_kzt": float(rate), "source": "computed"}
