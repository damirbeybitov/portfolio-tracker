FROM apache/airflow:2.9.3-python3.11

# IMPORTANT: install extra packages using Airflow's own constraints file.
# Airflow 2.x requires SQLAlchemy<2.0 internally (its ORM models use the
# legacy declarative style) — installing packages without constraints lets
# pip pull in transitive deps (e.g. a newer SQLAlchemy) that silently break
# Airflow's own models. The constraints file pins every dependency Airflow
# is tested against, so adding packages here can't violate that.
#
# psycopg2-binary: talk to the app's Postgres DB from DAGs
# yfinance/pandas/httpx: same price-fetching stack the FastAPI backend uses,
#   so DAG code can mirror app/services/price_service.py logic
USER airflow
COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt \
    --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-2.9.3/constraints-3.11.txt"