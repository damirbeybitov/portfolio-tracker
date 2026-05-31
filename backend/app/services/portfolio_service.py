from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from fastapi import HTTPException, status
from decimal import Decimal
from datetime import date

from app.models.portfolio import Portfolio, Security, Position
from app.models.transaction import Transaction, TransactionType
from app.schemas.portfolio import (
    PortfolioCreate, PortfolioUpdate, PortfolioResponse,
    TransactionCreate, TransactionResponse,
    PositionResponse, PortfolioSummary, SecurityResponse,
)
from app.services.price_service import PriceService
from app.services.fx_service import FxService


class PortfolioService:

    # ── Portfolios ────────────────────────────────────────────────────────────

    @staticmethod
    async def create(db: AsyncSession, user_id: int, data: PortfolioCreate) -> PortfolioResponse:
        p = Portfolio(user_id=user_id, **data.model_dump())
        db.add(p)
        await db.flush()
        await db.refresh(p)
        return PortfolioResponse.model_validate(p)

    @staticmethod
    async def list_portfolios(db: AsyncSession, user_id: int) -> list[PortfolioResponse]:
        result = await db.execute(select(Portfolio).where(Portfolio.user_id == user_id))
        return [PortfolioResponse.model_validate(p) for p in result.scalars().all()]

    @staticmethod
    async def get_or_404(db: AsyncSession, user_id: int, portfolio_id: int) -> Portfolio:
        result = await db.execute(
            select(Portfolio).where(and_(Portfolio.id == portfolio_id, Portfolio.user_id == user_id))
        )
        p = result.scalar_one_or_none()
        if not p:
            raise HTTPException(status_code=404, detail="Portfolio not found")
        return p

    @staticmethod
    async def update(db: AsyncSession, user_id: int, portfolio_id: int, data: PortfolioUpdate) -> PortfolioResponse:
        p = await PortfolioService.get_or_404(db, user_id, portfolio_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(p, field, value)
        await db.flush()
        await db.refresh(p)
        return PortfolioResponse.model_validate(p)

    @staticmethod
    async def delete(db: AsyncSession, user_id: int, portfolio_id: int) -> None:
        p = await PortfolioService.get_or_404(db, user_id, portfolio_id)
        await db.delete(p)

    # ── Securities ────────────────────────────────────────────────────────────

    @staticmethod
    async def get_or_create_security(db: AsyncSession, ticker: str) -> Security:
        ticker = ticker.upper()
        result = await db.execute(select(Security).where(Security.ticker == ticker))
        sec = result.scalar_one_or_none()
        if sec:
            return sec

        info = await PriceService.get_security_info(ticker)
        if not info:
            raise HTTPException(status_code=422, detail=f"Ticker '{ticker}' not found")

        sec = Security(**info)
        db.add(sec)
        await db.flush()
        await db.refresh(sec)
        return sec

    @staticmethod
    async def search_securities(db: AsyncSession, q: str) -> list[SecurityResponse]:
        result = await db.execute(
            select(Security).where(
                Security.ticker.ilike(f"%{q}%") | Security.name.ilike(f"%{q}%")
            ).limit(20)
        )
        return [SecurityResponse.model_validate(s) for s in result.scalars().all()]

    # ── Transactions ──────────────────────────────────────────────────────────

    @staticmethod
    async def add_transaction(
        db: AsyncSession, user_id: int, portfolio_id: int, data: TransactionCreate,
    ) -> TransactionResponse:
        await PortfolioService.get_or_404(db, user_id, portfolio_id)

        result = await db.execute(select(Security).where(Security.id == data.security_id))
        security = result.scalar_one_or_none()
        if not security:
            raise HTTPException(status_code=404, detail="Security not found")

        fx_rate = data.fx_rate_usd_kzt or await FxService.get_rate(db, data.date)
        price_kzt = data.price_usd * fx_rate
        total_usd = data.price_usd * data.quantity
        total_kzt = price_kzt * data.quantity
        commission_kzt = data.commission_usd * fx_rate

        tx = Transaction(
            portfolio_id=portfolio_id,
            security_id=data.security_id,
            type=data.type,
            date=data.date,
            quantity=data.quantity,
            price_usd=data.price_usd,
            price_kzt=price_kzt,
            total_usd=total_usd,
            total_kzt=total_kzt,
            fx_rate_usd_kzt=fx_rate,
            commission_usd=data.commission_usd,
            commission_kzt=commission_kzt,
            split_ratio=data.split_ratio,
            notes=data.notes,
        )
        db.add(tx)
        await db.flush()

        await PortfolioService._update_position(db, portfolio_id, security, tx, fx_rate)
        await db.refresh(tx)

        return await PortfolioService._tx_to_response(db, tx)

    @staticmethod
    async def _tx_to_response(db: AsyncSession, tx: Transaction) -> TransactionResponse:
        result = await db.execute(select(Security).where(Security.id == tx.security_id))
        security = result.scalar_one()
        data = TransactionResponse.model_validate(tx)
        data.security = SecurityResponse.model_validate(security)
        return data

    @staticmethod
    async def _update_position(
        db: AsyncSession, portfolio_id: int, security: Security, tx: Transaction, fx_rate: Decimal,
    ) -> None:
        result = await db.execute(
            select(Position).where(
                and_(Position.portfolio_id == portfolio_id, Position.security_id == security.id)
            )
        )
        pos = result.scalar_one_or_none()

        if tx.type == TransactionType.SPLIT:
            if pos and tx.split_ratio:
                pos.quantity = pos.quantity * tx.split_ratio
                if tx.split_ratio > 0:
                    pos.avg_cost_usd = pos.avg_cost_usd / tx.split_ratio
                    pos.avg_cost_kzt = pos.avg_cost_kzt / tx.split_ratio
            return

        if tx.type in (TransactionType.DIVIDEND, TransactionType.TAX, TransactionType.COMMISSION):
            return

        if tx.type == TransactionType.BUY:
            cost_usd = tx.price_usd * tx.quantity + tx.commission_usd
            cost_kzt = tx.price_kzt * tx.quantity + tx.commission_kzt

            if pos is None:
                pos = Position(
                    portfolio_id=portfolio_id,
                    security_id=security.id,
                    quantity=tx.quantity,
                    avg_cost_usd=cost_usd / tx.quantity if tx.quantity else Decimal("0"),
                    avg_cost_kzt=cost_kzt / tx.quantity if tx.quantity else Decimal("0"),
                    total_invested_usd=cost_usd,
                    total_invested_kzt=cost_kzt,
                )
                db.add(pos)
            else:
                new_qty = pos.quantity + tx.quantity
                pos.total_invested_usd += cost_usd
                pos.total_invested_kzt += cost_kzt
                pos.avg_cost_usd = pos.total_invested_usd / new_qty
                pos.avg_cost_kzt = pos.total_invested_kzt / new_qty
                pos.quantity = new_qty

        elif tx.type == TransactionType.SELL:
            if pos is None or pos.quantity < tx.quantity:
                raise HTTPException(
                    status_code=422,
                    detail=f"Insufficient shares: have {pos.quantity if pos else 0}, selling {tx.quantity}",
                )
            ratio = tx.quantity / pos.quantity
            pos.total_invested_usd -= pos.total_invested_usd * ratio
            pos.total_invested_kzt -= pos.total_invested_kzt * ratio
            pos.quantity -= tx.quantity
            if pos.quantity <= 0:
                await db.delete(pos)

        await db.flush()

    @staticmethod
    async def list_transactions(
        db: AsyncSession, user_id: int, portfolio_id: int,
    ) -> list[TransactionResponse]:
        await PortfolioService.get_or_404(db, user_id, portfolio_id)

        result = await db.execute(
            select(Transaction)
            .where(Transaction.portfolio_id == portfolio_id)
            .order_by(Transaction.date.desc(), Transaction.created_at.desc())
        )
        txs = result.scalars().all()

        # Fetch all securities in one query
        security_ids = list({tx.security_id for tx in txs})
        sec_result = await db.execute(select(Security).where(Security.id.in_(security_ids)))
        securities = {s.id: s for s in sec_result.scalars().all()}

        responses = []
        for tx in txs:
            r = TransactionResponse.model_validate(tx)
            r.security = SecurityResponse.model_validate(securities[tx.security_id])
            responses.append(r)
        return responses

    # ── Portfolio Summary ─────────────────────────────────────────────────────

    @staticmethod
    async def get_summary(db: AsyncSession, user_id: int, portfolio_id: int) -> PortfolioSummary:
        portfolio = await PortfolioService.get_or_404(db, user_id, portfolio_id)

        result = await db.execute(
            select(Position).where(Position.portfolio_id == portfolio_id)
        )
        positions = result.scalars().all()

        fx_rate = await FxService.get_rate(db)

        # Fetch securities in one query
        security_ids = [p.security_id for p in positions]
        securities = {}
        if security_ids:
            sec_result = await db.execute(select(Security).where(Security.id.in_(security_ids)))
            securities = {s.id: s for s in sec_result.scalars().all()}

        tickers = [securities[p.security_id].ticker for p in positions if p.security_id in securities]
        prices = await PriceService.get_prices_batch(tickers) if tickers else {}

        enriched_positions = []
        total_value_usd = Decimal("0")
        total_invested_usd = Decimal("0")

        for pos in positions:
            security = securities.get(pos.security_id)
            if not security:
                continue

            price_usd = prices.get(security.ticker)
            if price_usd:
                price_usd_dec = Decimal(str(price_usd))
                price_kzt_dec = price_usd_dec * fx_rate
                current_value_usd = price_usd_dec * pos.quantity
                current_value_kzt = current_value_usd * fx_rate
                profit_usd = current_value_usd - pos.total_invested_usd
                profit_kzt = profit_usd * fx_rate
                profit_pct = (profit_usd / pos.total_invested_usd * 100) if pos.total_invested_usd else Decimal("0")
                total_value_usd += current_value_usd
            else:
                price_usd_dec = price_kzt_dec = current_value_usd = current_value_kzt = None
                profit_usd = profit_kzt = profit_pct = None
                total_value_usd += pos.total_invested_usd

            total_invested_usd += pos.total_invested_usd

            enriched_positions.append(PositionResponse(
                id=pos.id,
                portfolio_id=pos.portfolio_id,
                security=SecurityResponse.model_validate(security),
                quantity=pos.quantity,
                avg_cost_usd=pos.avg_cost_usd,
                avg_cost_kzt=pos.avg_cost_kzt,
                total_invested_usd=pos.total_invested_usd,
                total_invested_kzt=pos.total_invested_kzt,
                current_price_usd=price_usd_dec,
                current_price_kzt=price_kzt_dec,
                current_value_usd=current_value_usd,
                current_value_kzt=current_value_kzt,
                profit_usd=profit_usd,
                profit_kzt=profit_kzt,
                profit_percent=profit_pct,
            ))

        total_value_kzt = total_value_usd * fx_rate
        total_invested_kzt = total_invested_usd * fx_rate
        total_profit_usd = total_value_usd - total_invested_usd
        total_profit_kzt = total_profit_usd * fx_rate
        total_profit_pct = (
            (total_profit_usd / total_invested_usd * 100) if total_invested_usd else Decimal("0")
        )

        return PortfolioSummary(
            portfolio=PortfolioResponse.model_validate(portfolio),
            total_value_usd=total_value_usd,
            total_value_kzt=total_value_kzt,
            total_invested_usd=total_invested_usd,
            total_invested_kzt=total_invested_kzt,
            total_profit_usd=total_profit_usd,
            total_profit_kzt=total_profit_kzt,
            total_profit_percent=total_profit_pct,
            positions=enriched_positions,
            fx_rate=fx_rate,
        )
