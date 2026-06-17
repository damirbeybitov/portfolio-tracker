from pydantic import BaseModel, Field
from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from app.models.transaction import TransactionType


# ─── Portfolio ────────────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    currency: str = Field(default="USD", max_length=3)


class PortfolioUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    currency: Optional[str] = Field(None, max_length=3)


class PortfolioResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    currency: str
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Security ─────────────────────────────────────────────────────────────────

class SecurityCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=255)
    exchange: Optional[str] = None
    currency: str = Field(default="USD", max_length=3)
    sector: Optional[str] = None
    industry: Optional[str] = None


class SecurityResponse(BaseModel):
    id: int
    ticker: str
    name: str
    exchange: Optional[str]
    currency: str
    sector: Optional[str]
    industry: Optional[str]
    model_config = {"from_attributes": True}


# ─── Position ─────────────────────────────────────────────────────────────────

class PositionResponse(BaseModel):
    id: int
    portfolio_id: int
    security: SecurityResponse
    quantity: Decimal
    avg_cost_usd: Decimal
    avg_cost_kzt: Decimal
    total_invested_usd: Decimal
    total_invested_kzt: Decimal
    # Runtime-enriched fields
    current_price_usd: Optional[Decimal] = None
    current_price_kzt: Optional[Decimal] = None
    current_value_usd: Optional[Decimal] = None
    current_value_kzt: Optional[Decimal] = None
    profit_usd: Optional[Decimal] = None
    profit_kzt: Optional[Decimal] = None
    profit_percent: Optional[Decimal] = None
    model_config = {"from_attributes": True}


# ─── Transaction ──────────────────────────────────────────────────────────────

class TransactionCreate(BaseModel):
    security_id: int
    type: TransactionType
    date: date
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    price_usd: Decimal = Field(default=Decimal("0"), ge=0)
    fx_rate_usd_kzt: Optional[Decimal] = None  # auto-fetched if not provided
    commission_usd: Decimal = Field(default=Decimal("0"), ge=0)
    split_ratio: Optional[Decimal] = None
    notes: Optional[str] = None


class TransactionResponse(BaseModel):
    id: int
    portfolio_id: int
    security: SecurityResponse
    type: TransactionType
    date: date
    quantity: Decimal
    price_usd: Decimal
    price_kzt: Decimal
    total_usd: Decimal
    total_kzt: Decimal
    fx_rate_usd_kzt: Decimal
    commission_usd: Decimal
    commission_kzt: Decimal
    split_ratio: Optional[Decimal]
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}

class TransactionImportRow(BaseModel):
    row: int
    status: str  # "ok" | "error"
    error: Optional[str] = None
    transaction: Optional[TransactionResponse] = None


class TransactionImportResult(BaseModel):
    total: int
    imported: int
    failed: int
    results: list[TransactionImportRow]

# ─── Portfolio Summary ─────────────────────────────────────────────────────────

class PortfolioSummary(BaseModel):
    portfolio: PortfolioResponse
    total_value_usd: Decimal
    total_value_kzt: Decimal
    total_invested_usd: Decimal
    total_invested_kzt: Decimal
    total_profit_usd: Decimal
    total_profit_kzt: Decimal
    total_profit_percent: Decimal
    positions: list[PositionResponse]
    fx_rate: Decimal
