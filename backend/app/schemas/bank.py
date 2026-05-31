from pydantic import BaseModel, Field
from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from app.models.bank import AccountCurrency, BankTransactionType


class BankAccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    currency: AccountCurrency
    balance: Decimal = Field(default=Decimal("0"), ge=0)
    notes: Optional[str] = None


class BankAccountUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class BankInterestRateCreate(BaseModel):
    rate_percent: Decimal = Field(..., ge=0, le=100)
    effective_from: date
    notes: Optional[str] = None


class BankInterestRateResponse(BaseModel):
    id: int
    account_id: int
    rate_percent: Decimal
    effective_from: date
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class BankAccountResponse(BaseModel):
    id: int
    name: str
    currency: AccountCurrency
    balance: Decimal
    is_active: bool
    notes: Optional[str]
    current_rate: Optional[Decimal] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class BankTransactionCreate(BaseModel):
    type: BankTransactionType
    date: date
    amount: Decimal = Field(..., description="Positive = in, negative = out")
    related_account_id: Optional[int] = None
    fx_rate: Optional[Decimal] = None
    notes: Optional[str] = None


class BankTransactionResponse(BaseModel):
    id: int
    account_id: int
    type: BankTransactionType
    date: date
    amount: Decimal
    balance_after: Decimal
    related_account_id: Optional[int]
    fx_rate: Optional[Decimal]
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class FxRateCreate(BaseModel):
    date: date
    usd_to_kzt: Decimal = Field(..., gt=0)


class FxRateResponse(BaseModel):
    id: int
    date: date
    usd_to_kzt: Decimal
    source: str
    model_config = {"from_attributes": True}
