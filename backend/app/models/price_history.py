# backend/app/models/price_history.py
"""
PriceHistory — daily OHLCV candlestick data for each security.

Populated by the Airflow `daily_price_ingest` DAG (and back-filled by
`backfill_price_history`).  Consumed by analytics endpoints to drive
period P&L calculations from real historical closes rather than live-price
deltas, and by the front-end candlestick / line chart (upcoming).
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class PriceHistory(Base):
    __tablename__ = "price_history"
    __table_args__ = (
        UniqueConstraint("security_id", "date", name="uq_price_history_security_date"),
    )

    id:          Mapped[int]           = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    security_id: Mapped[int]           = mapped_column(Integer, nullable=False, index=True)
    date:        Mapped[date]          = mapped_column(Date, nullable=False)
    open:        Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    high:        Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    low:         Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    close:       Mapped[Decimal]       = mapped_column(Numeric(20, 8), nullable=False)
    volume:      Mapped[int | None]    = mapped_column(BigInteger)
    source:      Mapped[str]           = mapped_column(String(32), default="yfinance")
    created_at:  Mapped[datetime]      = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )