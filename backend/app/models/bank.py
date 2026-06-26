from sqlalchemy import String, Text, Integer, DateTime, Numeric, Date, Boolean, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime, date
from decimal import Decimal
import enum
import uuid

from app.db.base import Base


class AccountCurrency(str, enum.Enum):
    KZT = "KZT"
    USD = "USD"


class BankTransactionType(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"
    INTEREST = "INTEREST"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    STOCK_BUY = "STOCK_BUY"
    STOCK_SELL = "STOCK_SELL"
    DIVIDEND = "DIVIDEND"
    TAX = "TAX"
    COMMISSION = "COMMISSION"
    EXCHANGE = "EXCHANGE"


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    currency: Mapped[AccountCurrency] = mapped_column(SAEnum(AccountCurrency), nullable=False)
    balance: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BankInterestRate(Base):
    __tablename__ = "bank_interest_rates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    rate_percent: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BankTransaction(Base):
    __tablename__ = "bank_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    type: Mapped[BankTransactionType] = mapped_column(SAEnum(BankTransactionType), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    related_account_id: Mapped[int | None] = mapped_column(Integer)
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    notes: Mapped[str | None] = mapped_column(Text)

    # ── Stock link fields (populated only for STOCK_BUY / STOCK_SELL) ────
    # When set, the backend automatically creates / deletes the corresponding
    # portfolio transaction so the bank tx is the single source of truth for
    # stock activity.
    ticker: Mapped[str | None] = mapped_column(String(20))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    price_per_share: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    portfolio_id: Mapped[int | None] = mapped_column(Integer)
    # FK to the auto-created portfolio transaction — used to delete it when
    # this bank tx is deleted.
    linked_portfolio_tx_id: Mapped[int | None] = mapped_column(Integer)

    # Links the two legs of an auto-created transfer pair so they can be
    # reliably found and deleted together.
    transfer_group_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FxRate(Base):
    __tablename__ = "fx_rates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, unique=True, index=True)
    usd_to_kzt: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    source: Mapped[str] = mapped_column(String(50), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
