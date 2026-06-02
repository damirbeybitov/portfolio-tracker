# Portfolio Tracker — Backend API

A production-grade personal investment portfolio tracker with multi-currency support (USD / KZT), live market prices via Yahoo Finance, bank account management, and detailed P&L analytics.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI 0.115 |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 (async) |
| Migrations | Alembic |
| Auth | JWT (access + refresh tokens via `python-jose`) |
| Passwords | bcrypt via `passlib` |
| Market Data | `yfinance` |
| Validation | Pydantic v2 |
| Runtime | Python 3.12 |

---

## Project Structure

```
backend/
├── app/
│   ├── main.py                  # FastAPI app, CORS, lifespan
│   ├── api/
│   │   └── v1/
│   │       ├── router.py        # Root API router
│   │       └── endpoints/
│   │           ├── auth.py      # Register, login, refresh, me
│   │           ├── portfolios.py# Portfolio CRUD, transactions, securities
│   │           ├── bank.py      # Bank accounts, rates, transactions, FX
│   │           └── analytics.py # P&L analytics, period breakdown, overview
│   ├── core/
│   │   ├── config.py            # Pydantic Settings (env vars)
│   │   └── security.py          # JWT encode/decode, password hashing
│   ├── db/
│   │   ├── base.py              # DeclarativeBase + naming conventions
│   │   └── session.py           # Async engine, session factory, get_db
│   ├── models/
│   │   ├── user.py
│   │   ├── portfolio.py         # Portfolio, Security, Position
│   │   ├── transaction.py       # Transaction, TransactionType
│   │   └── bank.py              # BankAccount, BankInterestRate, BankTransaction, FxRate
│   ├── schemas/
│   │   ├── auth.py
│   │   ├── portfolio.py
│   │   ├── bank.py
│   │   └── analytics.py
│   └── services/
│       ├── auth_service.py
│       ├── portfolio_service.py
│       ├── bank_service.py
│       ├── analytics_service.py
│       ├── price_service.py     # Yahoo Finance wrapper (async)
│       └── fx_service.py        # USD/KZT rate — DB → Yahoo Finance → fallback
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/                # Migration files (auto-generated)
├── alembic.ini
├── Dockerfile
└── requirements.txt
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- PostgreSQL 16
- (Optional) Docker + Docker Compose

### 1. Clone & configure environment

```bash
cp .env.example .env
# Edit .env — at minimum change SECRET_KEY
```

### 2. Run with Docker Compose (recommended)

```bash
docker compose up --build
```

Services:
- **PostgreSQL** → `localhost:5432`
- **Backend API** → `http://localhost:8000`
- **Frontend** → `http://localhost:4200`

### 3. Run locally (without Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Start Postgres separately, then:
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://...` | Full async DB URL |
| `SECRET_KEY` | `change-this-in-production` | JWT signing key — **must change** |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Access token TTL |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token TTL |
| `ALLOWED_ORIGINS` | `http://localhost:4200` | CORS origins (comma-separated) |
| `ENVIRONMENT` | `development` | Enables SQLAlchemy echo in dev |
| `POSTGRES_USER` | `portfolio` | Used by Docker Compose |
| `POSTGRES_PASSWORD` | `portfolio_secret` | Used by Docker Compose |
| `POSTGRES_DB` | `portfolio_tracker` | Used by Docker Compose |

---

## Database Migrations

```bash
# Apply all migrations
alembic upgrade head

# Create a new migration after model changes
alembic revision --autogenerate -m "describe your change"

# Downgrade one step
alembic downgrade -1

# View current revision
alembic current
```

> **Note:** In development, `main.py` calls `Base.metadata.create_all` on startup as a convenience. For production, rely exclusively on Alembic migrations and remove `create_all` from lifespan.

---

## API Reference

Interactive docs are available at runtime:

| UI | URL |
|---|---|
| Swagger UI | `http://localhost:8000/api/docs` |
| ReDoc | `http://localhost:8000/api/redoc` |
| OpenAPI JSON | `http://localhost:8000/api/openapi.json` |
| Health check | `http://localhost:8000/api/health` |

All endpoints are prefixed with `/api/v1`.

---

### Authentication — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | ❌ | Register new user, returns tokens |
| `POST` | `/login` | ❌ | Login, returns tokens |
| `POST` | `/refresh` | ❌ | Exchange refresh token for new pair |
| `GET` | `/me` | ✅ | Get current user profile |

**Token usage:** Pass the access token as `Authorization: Bearer <token>` on all protected routes.

**Register request:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securepassword"
}
```

**Response includes:**
```json
{
  "user": { "id": 1, "email": "...", "username": "...", "is_active": true, "created_at": "..." },
  "tokens": { "access_token": "...", "refresh_token": "...", "token_type": "bearer" }
}
```

---

### Portfolios — `/api/v1/portfolios`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List all portfolios |
| `POST` | `/` | Create portfolio |
| `PATCH` | `/{id}` | Update portfolio name/description |
| `DELETE` | `/{id}` | Delete portfolio |
| `GET` | `/{id}/summary` | Full portfolio snapshot with live prices and P&L |
| `GET` | `/{id}/transactions` | Transaction history |
| `POST` | `/{id}/transactions` | Record a transaction |
| `GET` | `/securities/search?q=` | Search securities by ticker or name |
| `POST` | `/securities/lookup/{ticker}` | Fetch from Yahoo Finance and store |

**Transaction types:** `BUY`, `SELL`, `DIVIDEND`, `TAX`, `SPLIT`, `COMMISSION`

**Add transaction request:**
```json
{
  "security_id": 1,
  "type": "BUY",
  "date": "2024-01-15",
  "quantity": "10",
  "price_usd": "185.50",
  "commission_usd": "1.00",
  "fx_rate_usd_kzt": null,
  "notes": "Initial position"
}
```

> `fx_rate_usd_kzt` is optional — if omitted, the rate is auto-fetched from Yahoo Finance or the stored FX table.

**Portfolio summary response includes:**
- `total_value_usd / kzt` — current market value
- `total_invested_usd / kzt` — total cost basis
- `total_profit_usd / kzt / percent` — unrealized P&L
- `positions[]` — per-security breakdown with live price, cost basis, profit
- `fx_rate` — USD/KZT rate used

---

### Bank Accounts — `/api/v1/bank`

#### Accounts

| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts` | List accounts with current interest rate |
| `POST` | `/accounts` | Create account (KZT or USD) |
| `GET` | `/accounts/{id}` | Get single account |
| `PATCH` | `/accounts/{id}` | Update name/notes |
| `DELETE` | `/accounts/{id}` | Soft-delete (sets `is_active = false`) |

#### Interest Rates

| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts/{id}/rates` | Full rate history |
| `POST` | `/accounts/{id}/rates` | Set new rate (effective from date) |

Rate entries are append-only. The current rate is always the most recent entry with `effective_from <= today`.

#### Transactions

| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts/{id}/transactions` | Transaction list |
| `POST` | `/accounts/{id}/transactions` | Record transaction |

**Bank transaction types:** `INCOME`, `EXPENSE`, `INTEREST`, `TRANSFER_IN`, `TRANSFER_OUT`, `STOCK_BUY`, `STOCK_SELL`, `DIVIDEND`, `TAX`, `COMMISSION`, `EXCHANGE`

**Amount sign convention:**
- Positive `amount`: money coming in (`INCOME`, `TRANSFER_IN`, `INTEREST`, `STOCK_SELL`, `DIVIDEND`)
- Negative `amount`: money going out (`EXPENSE`, `TRANSFER_OUT`, `STOCK_BUY`, `TAX`, `COMMISSION`)

#### FX Rates

| Method | Path | Description |
|---|---|---|
| `GET` | `/fx?target_date=YYYY-MM-DD` | Get USD/KZT rate for a date |
| `POST` | `/fx` | Manually set/override a rate |

---

### Analytics — `/api/v1/analytics`

| Method | Path | Description |
|---|---|---|
| `GET` | `/portfolio/{id}` | Full P&L with period breakdown |
| `GET` | `/bank` | Bank accounts summary |
| `GET` | `/overview/{portfolio_id}` | Grand total: portfolio + bank combined |

**Portfolio analytics response:**
```json
{
  "total_value_usd": "10500.00",
  "total_value_kzt": "4725000.00",
  "total_invested_usd": "9000.00",
  "total_profit_usd": "1500.00",
  "total_profit_kzt": "675000.00",
  "total_profit_percent": "16.67",
  "pnl_1d": { "period": "1D", "profit_usd": "45.00", "profit_kzt": "20250.00", "profit_percent": "0.43", "value_start_usd": "...", "value_end_usd": "..." },
  "pnl_1w": { ... },
  "pnl_1m": { ... },
  "pnl_1y": { ... },
  "fx_rate": "450.00",
  "positions_profit": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "quantity": 10,
      "avg_cost_usd": 170.0,
      "current_price_usd": 185.5,
      "current_value_usd": 1855.0,
      "profit_usd": 155.0,
      "profit_percent": 9.12
    }
  ]
}
```

---

## Data Models

### Core entities

```
User
 └── Portfolio (many)
      ├── Position (one per security)
      └── Transaction (full history)

Security (shared, not per-user)

BankAccount (per user)
 ├── BankInterestRate (history)
 └── BankTransaction (history)

FxRate (shared, one per date)
```

### Transaction logic

- **BUY** — increases position quantity, recalculates weighted average cost
- **SELL** — decreases quantity, reduces cost basis proportionally; deletes position if qty reaches zero
- **SPLIT** — multiplies quantity by `split_ratio`, divides avg cost accordingly
- **DIVIDEND / TAX / COMMISSION** — recorded for history only, no position change

### FX rate resolution order

1. Exact date match in `fx_rates` table
2. Live fetch from Yahoo Finance (`USDKZT=X`)
3. Most recent stored rate
4. Hard fallback: `450.00`

---

## Key Design Decisions

**Async throughout** — SQLAlchemy async + asyncpg + asyncio.gather for concurrent price fetches; no blocking I/O on the event loop.

**Position is a denormalized snapshot** — avg cost and total invested are maintained in real time on every transaction write, so summary queries never need to replay history.

**FX rate is stored per-date** — avoids repeated Yahoo Finance calls and lets you override rates manually for KZT accounts.

**Refresh token rotation** — both access and refresh tokens are returned on every `/refresh` call. Clients should replace both.

**Soft delete for bank accounts** — `is_active = false` preserves transaction history while hiding the account from normal queries.

---

## Development Notes

### Running tests (to be added)

```bash
pytest tests/ -v
```

### Adding a new endpoint

1. Create or extend a schema in `app/schemas/`
2. Add or extend service logic in `app/services/`
3. Add the route in `app/api/v1/endpoints/`
4. Register the router in `app/api/v1/router.py`

### Adding a new model

1. Define the SQLAlchemy model in `app/models/`
2. Import it in `app/models/__init__.py` (required for Alembic autogenerate)
3. Run `alembic revision --autogenerate -m "add <model>"`
4. Run `alembic upgrade head`

---

## Production Checklist

- [ ] Set a strong random `SECRET_KEY` (e.g. `openssl rand -hex 32`)
- [ ] Set `ENVIRONMENT=production` (disables SQLAlchemy echo)
- [ ] Remove `Base.metadata.create_all` from `main.py` lifespan — use Alembic only
- [ ] Set `ALLOWED_ORIGINS` to your actual frontend domain
- [ ] Use a secrets manager or vault for env vars — do not commit `.env`
- [ ] Add HTTPS termination at the reverse proxy level (nginx / Caddy)
- [ ] Configure database connection pooling appropriately for your load
- [ ] Set up log aggregation (structured JSON logs recommended)
- [ ] Add rate limiting on auth endpoints

---

## License

Private / proprietary. All rights reserved.
