"""
common.tickers — figure out which tickers a price-ingestion DAG actually
needs to fetch.

The app's `securities` table accumulates every ticker anyone has ever looked
up (see PortfolioService.get_or_create_security), including ones nobody
holds anymore — e.g. fully sold positions, where the Position row gets
deleted but the Security row sticks around for transaction history.
Fetching daily prices for those is wasted API calls. The function below
joins against `positions` and filters to currently-held (quantity > 0)
tickers only.

If you later want price history for delisted/no-longer-held tickers too
(to keep historical charts intact even after a full sell-off), see
get_all_known_tickers() instead — kept separate on purpose so the two
behaviors don't get conflated.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text

from common.db import session_scope

logger = logging.getLogger("airflow.task")


@dataclass(frozen=True)
class TrackedSecurity:
    """One security currently held in at least one portfolio."""
    security_id: int
    ticker: str
    name: str
    currency: str
    exchange: str | None


def get_held_tickers() -> list[TrackedSecurity]:
    """
    Return the distinct set of securities with a non-zero position in at
    least one portfolio, across all users.

    This is what a daily price-ingestion DAG should iterate over — there's
    no reason to fetch OHLC data for a ticker nobody currently holds.

    Position.quantity > 0 mirrors how the app itself treats a "real"
    holding: PortfolioService deletes the Position row entirely once
    quantity reaches zero (see _update_position / delete_transaction in
    portfolio_service.py), so in practice any remaining row already has
    quantity > 0 — the filter is just defensive in case that invariant
    ever drifts.
    """
    query = text(
        """
        SELECT DISTINCT
            s.id AS security_id,
            s.ticker,
            s.name,
            s.currency,
            s.exchange
        FROM securities s
        INNER JOIN positions p ON p.security_id = s.id
        WHERE p.quantity > 0
        ORDER BY s.ticker
        """
    )
    with session_scope() as session:
        rows = session.execute(query).fetchall()

    tracked = [
        TrackedSecurity(
            security_id=row.security_id,
            ticker=row.ticker,
            name=row.name,
            currency=row.currency,
            exchange=row.exchange,
        )
        for row in rows
    ]
    logger.info("Found %d held ticker(s): %s", len(tracked), [t.ticker for t in tracked])
    return tracked


def get_held_ticker_symbols() -> list[str]:
    """Convenience wrapper — just the ticker strings, e.g. for yfinance.download(tickers=...)."""
    return [t.ticker for t in get_held_tickers()]


def get_all_known_tickers() -> list[TrackedSecurity]:
    """
    Return every security ever registered, regardless of whether it's
    currently held by anyone.

    Use this instead of get_held_tickers() if you want historical price
    continuity for tickers that were fully sold off — otherwise a gap opens
    up in price_history right after the position is closed, and any old
    chart referencing that ticker stops updating.
    """
    query = text(
        """
        SELECT id AS security_id, ticker, name, currency, exchange
        FROM securities
        ORDER BY ticker
        """
    )
    with session_scope() as session:
        rows = session.execute(query).fetchall()

    tracked = [
        TrackedSecurity(
            security_id=row.security_id,
            ticker=row.ticker,
            name=row.name,
            currency=row.currency,
            exchange=row.exchange,
        )
        for row in rows
    ]
    logger.info("Found %d known ticker(s) total", len(tracked))
    return tracked