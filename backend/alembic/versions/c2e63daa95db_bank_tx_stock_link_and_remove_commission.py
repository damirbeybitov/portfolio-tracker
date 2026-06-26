"""bank_tx_stock_link_and_remove_commission
 
Adds stock-link columns to bank_transactions (ticker, quantity,
price_per_share, portfolio_id, linked_portfolio_tx_id) and removes
commission_usd / commission_kzt from transactions.

Revision ID: c2e63daa95db
Revises: 58acae84c2df
Create Date: 2026-06-25 12:40:57.071203

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2e63daa95db'
down_revision: Union[str, None] = '58acae84c2df'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. bank_transactions: add stock link columns ──────────────────────
    op.add_column('bank_transactions',
        sa.Column('ticker', sa.String(length=20), nullable=True))
    op.add_column('bank_transactions',
        sa.Column('quantity', sa.Numeric(precision=20, scale=8), nullable=True))
    op.add_column('bank_transactions',
        sa.Column('price_per_share', sa.Numeric(precision=20, scale=8), nullable=True))
    op.add_column('bank_transactions',
        sa.Column('portfolio_id', sa.Integer(), nullable=True))
    op.add_column('bank_transactions',
        sa.Column('linked_portfolio_tx_id', sa.Integer(), nullable=True))
 
    # ── 2. transactions: drop commission columns if they exist ────────────
    # Use separate op.execute calls — asyncpg cannot run multi-statement SQL
    op.execute("""
        ALTER TABLE transactions
        DROP COLUMN IF EXISTS commission_usd
    """)
    op.execute("""
        ALTER TABLE transactions
        DROP COLUMN IF EXISTS commission_kzt
    """)
 
    # ── 3. Purge legacy transaction types before restricting the enum ─────
    op.execute("""
        DELETE FROM transactions
        WHERE type::text NOT IN ('BUY', 'SELL', 'SPLIT')
    """)
 
    # ── 4. Swap the enum to the restricted set ────────────────────────────
    # asyncpg requires each DDL statement in its own execute() call.
    op.execute("ALTER TYPE transactiontype RENAME TO transactiontype_old")
    op.execute("CREATE TYPE transactiontype AS ENUM ('BUY', 'SELL', 'SPLIT')")
    op.execute("""
        ALTER TABLE transactions
            ALTER COLUMN type TYPE transactiontype
            USING type::text::transactiontype
    """)
    op.execute("DROP TYPE transactiontype_old")
 
 
def downgrade() -> None:
    # Restore old enum
    op.execute("ALTER TYPE transactiontype RENAME TO transactiontype_new")
    op.execute(
        "CREATE TYPE transactiontype AS ENUM "
        "('BUY', 'SELL', 'DIVIDEND', 'TAX', 'SPLIT', 'COMMISSION')"
    )
    op.execute("""
        ALTER TABLE transactions
            ALTER COLUMN type TYPE transactiontype
            USING type::text::transactiontype
    """)
    op.execute("DROP TYPE transactiontype_new")
 
    # Restore commission columns
    op.add_column('transactions',
        sa.Column('commission_usd', sa.Numeric(precision=12, scale=4),
                  server_default='0', nullable=False))
    op.add_column('transactions',
        sa.Column('commission_kzt', sa.Numeric(precision=12, scale=4),
                  server_default='0', nullable=False))
 
    # Drop stock link columns
    op.drop_column('bank_transactions', 'linked_portfolio_tx_id')
    op.drop_column('bank_transactions', 'portfolio_id')
    op.drop_column('bank_transactions', 'price_per_share')
    op.drop_column('bank_transactions', 'quantity')
    op.drop_column('bank_transactions', 'ticker')
