from sqlalchemy import String, Text, Integer, DateTime, Numeric, Date, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime, date
from decimal import Decimal
import enum

from app.db.base import Base


class TransactionType(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    SPLIT = "SPLIT"


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    portfolio_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    security_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    type: Mapped[TransactionType] = mapped_column(SAEnum(TransactionType), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=0)
    price_usd: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=0)
    price_kzt: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=0)
    total_usd: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=0)
    total_kzt: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=0)
    fx_rate_usd_kzt: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0)
    split_ratio: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
