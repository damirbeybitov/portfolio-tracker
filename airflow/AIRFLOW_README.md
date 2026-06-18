# Airflow — Setup Notes

Adds Apache Airflow 2.9.3 (LocalExecutor) to the stack, for daily price-data
ingestion that will later feed a candlestick/line chart in Analytics.

No DAGs are included yet — this is infrastructure only, per plan. DAGs come
next, in a separate pass.

## What was added

```
airflow/
├── Dockerfile          # apache/airflow:2.9.3-python3.11 + yfinance/pandas/psycopg2
├── requirements.txt
├── dags/                ← put your .py DAG files here later
├── logs/                ← Airflow writes here (gitignored)
├── plugins/              ← custom operators/hooks go here later
└── config/               ← optional airflow.cfg overrides
```

`docker-compose.yml` gained 4 services:

- **airflow_db** — dedicated Postgres for Airflow's own metadata (DAG runs,
  task history). Intentionally separate from `db` (your app's Postgres) —
  Airflow's internal churn shouldn't touch portfolio data, and you can wipe
  Airflow's history without touching real data, or vice versa.
- **airflow-init** — one-shot: runs `airflow db upgrade` + creates the admin
  user, then exits. Re-running `docker compose up` won't recreate the user
  every time (the `|| true` swallows the "already exists" error).
- **airflow-webserver** — UI at `http://localhost:8080`
- **airflow-scheduler** — picks up DAGs from `airflow/dags/` and runs them

Why LocalExecutor and not Celery: a single daily parsing job doesn't need a
distributed task queue. Celery would add a Redis broker + worker + flower
just to run one task a day — pure overhead at this scale.

## How DAGs will reach your app's database

Two options will be available once you write DAGs (no setup needed now,
both already work via the shared Docker network):

1. **Env var** — `APP_DATABASE_URL` is already injected into every Airflow
   container (see `docker-compose.yml`), pointing at the `db` service. A DAG
   can just do `psycopg2.connect(os.environ["APP_DATABASE_URL"])` or build a
   SQLAlchemy engine from it directly.
2. **Airflow Connection** — register one in the UI (Admin → Connections),
   conn type Postgres, host `db`, port `5432`, using the same credentials as
   `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`. Then DAGs use
   `PostgresHook(postgres_conn_id="...")`. More idiomatic Airflow style,
   useful if you want connection details manageable from the UI without
   redeploying.

Either way, `db` is reachable from Airflow containers by hostname (same
Docker Compose network), at port 5432 — no extra networking work needed.

## First-time setup

1. Copy `.env.example` → `.env` if you haven't already, and review the new
   `AIRFLOW_*` variables at the bottom. At minimum:
   - On Linux, run `id -u` and set `AIRFLOW_UID` to that value (avoids the
     containers writing log files owned by root on your host). macOS/Windows
     Docker Desktop users can leave the default.
   - Change `AIRFLOW_ADMIN_PASSWORD` from `admin` before anything resembling
     production.

2. Build and start everything:

   ```bash
   docker compose up --build
   ```

   First boot will take a few minutes — Airflow's image build + the
   `airflow-init` migration run before the webserver/scheduler come up.

3. Open `http://localhost:8080`, log in with `AIRFLOW_ADMIN_USER` /
   `AIRFLOW_ADMIN_PASSWORD` from your `.env` (defaults: `admin` / `admin`).

4. You should see an empty DAGs list (no examples loaded —
   `AIRFLOW__CORE__LOAD_EXAMPLES: false`) and both the scheduler and webserver
   showing healthy in `docker compose ps`.

## Sanity checks

```bash
docker compose ps                          # all airflow-* should be "healthy" or "running"
docker compose logs airflow-init            # confirm admin user created / db migrated
docker compose exec airflow-scheduler airflow dags list   # should run, list will be empty
```

## Next step (separate chat, as planned)

Drop DAG files into `airflow/dags/`. The scheduler picks up new/changed
files automatically (default scan interval ~30s) — no rebuild or restart
needed for pure-Python DAG changes. A rebuild is only needed if you add new
pip packages to `airflow/requirements.txt`.

For the candlestick/line chart use case, the natural shape is: one DAG,
scheduled daily, that loops over distinct tickers held in any portfolio
(query `securities`/`positions` in the app DB), fetches OHLC data (yfinance,
or your existing Alpha Vantage/Twelve Data providers), and upserts into a new
table — something like `price_history(security_id, date, open, high, low,
close, volume)` — which the FastAPI analytics endpoints can then query for
the chart.