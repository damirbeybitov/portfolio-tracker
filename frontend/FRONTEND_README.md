# Portfolio Tracker — Frontend

Angular 17 standalone components, dark luxury UI, full integration with the FastAPI backend.

## Stack
- **Angular 17** — standalone components, signals, new control flow (`@if`, `@for`)
- **SCSS** — custom design system, no UI library dependency
- **RxJS** — HTTP, auth token refresh
- **Fonts**: Syne (display), DM Mono (numbers), DM Sans (body)

## Design
Dark financial terminal aesthetic — `#0a0b0e` base, `#c8ff47` acid-green accent, monospace numbers throughout.

---

## Setup

### Option A — Docker (recommended, with existing docker-compose)

1. Place this `frontend/` folder at the root of your project (same level as `backend/`).
2. Update `docker-compose.yml` — change the frontend service `command` to:
   ```
   ng serve --host 0.0.0.0 --port 4200 --poll 2000 --proxy-config proxy.conf.json
   ```
3. Run:
   ```bash
   docker compose up
   ```
   Frontend → http://localhost:4200  
   Backend  → http://localhost:8000

### Option B — Local dev

```bash
cd frontend
npm install
ng serve --proxy-config proxy.conf.json
```

The proxy forwards `/api/*` → `http://localhost:8000/api/*`.

---

## Project Structure

```
src/app/
├── core/
│   ├── models/index.ts          # All TypeScript interfaces (mirrors backend schemas)
│   ├── services/
│   │   ├── api.service.ts       # All HTTP calls to FastAPI
│   │   └── auth.service.ts      # JWT token management, currentUser signal
│   ├── interceptors/
│   │   └── auth.interceptor.ts  # Injects Bearer token, auto-refresh on 401
│   └── guards/
│       └── auth.guard.ts        # Redirect to /auth/login if not authenticated
│
├── features/
│   ├── auth/
│   │   ├── login/               # Login form
│   │   └── register/            # Registration form
│   ├── dashboard/               # Overview: portfolio cards + bank summary
│   ├── portfolio/               # Holdings table + Add Transaction modal
│   ├── transactions/            # Full transaction history with filters
│   ├── analytics/               # Period P&L (1D/1W/1M/1Y), position breakdown
│   └── bank/                    # Bank accounts, transactions, interest rates, FX
│
└── shared/components/
    └── layout/                  # Sidebar nav with collapse, user info, logout
```

---

## Features Implemented

### Dashboard
- Total portfolio value (USD + KZT)
- Total P&L with %
- Bank balance totals
- Live FX rate with pulse indicator
- Portfolio cards with per-portfolio P&L
- Create portfolio modal

### Portfolio View (`/portfolio/:id`)
- Full positions table: qty, avg cost, current price, market value, P&L USD/KZT/%
- Quick Buy/Sell from any row
- **Add Transaction modal** supporting all types:
  - BUY, SELL, DIVIDEND, TAX, SPLIT, COMMISSION
  - Ticker search from DB + Yahoo Finance lookup
  - Auto FX rate (or manual override)
  - Commission tracking
  - Split ratio for stock splits
- Link to transaction history and analytics

### Transaction History (`/portfolio/:id/transactions`)
- Full history table with all fields
- Filter by: free text, transaction type, date range
- Summary totals: invested / proceeds / commissions

### Analytics (`/analytics/:id`)
- Period P&L tabs: **1D / 1W / 1M / 1Y** — profit in USD, KZT, and %
- All-period overview cards (clickable)
- Per-position breakdown with portfolio weight bar
- Refresh button

### Bank Accounts (`/bank`)
- Account cards (KZT + USD) with current balance
- Click account → see full transaction history
- Add transactions: INCOME, EXPENSE, INTEREST, TRANSFER_IN/OUT, STOCK_BUY/SELL, DIVIDEND, TAX, COMMISSION, EXCHANGE
- Set interest rate with history (effective date tracking)
- Set/override FX rate (USD/KZT) with current rate shown
- Summary totals with USD equivalent calculation

---

## Auth Flow
- JWT access + refresh tokens stored in `localStorage`
- HTTP interceptor auto-attaches `Authorization: Bearer <token>`
- On 401: silently refreshes tokens and retries
- On refresh failure: redirects to `/auth/login`
- Auth guard protects all non-auth routes

---

## Key Design Decisions
- **Angular Signals** used for all component state (modern reactive pattern)
- **Standalone components** — no NgModules
- **Lazy loaded routes** — each feature loads on demand
- All monetary values displayed in both **USD** and **KZT**
- Numbers use `DM Mono` font for clean tabular alignment
- **No external UI library** — pure custom CSS with design tokens

---

## Connecting to Backend

All API calls go through `ApiService` → proxy → FastAPI.

If deploying to production, update `proxy.conf.json` target to your backend URL, or configure your reverse proxy (nginx) to forward `/api` to the backend service.
