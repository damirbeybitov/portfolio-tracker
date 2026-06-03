import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging_config import configure_logging

# ── Configure logging BEFORE any other imports that might emit logs ─────────
configure_logging()

from app.db.session import engine          # noqa: E402 — must come after logging
from app.db.base import Base               # noqa: E402
from app.api.v1.router import api_router   # noqa: E402
from app.middleware.logging import RequestLoggingMiddleware  # noqa: E402

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting Portfolio Tracker API",
        extra={"environment": settings.ENVIRONMENT, "version": "1.0.0"},
    )
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema verified / created")
    except Exception:
        logger.exception("Failed to initialise database schema")
        raise

    yield

    logger.info("Shutting down — disposing DB engine")
    await engine.dispose()


app = FastAPI(
    title="Portfolio Tracker API",
    description=(
        "Personal investment portfolio tracker with stocks, bank accounts, "
        "and multi-currency (USD / KZT) support."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ── Middleware (order matters — outermost first) ────────────────────────────
app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handler — log + return clean JSON ──────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled exception",
        extra={
            "http_method": request.method,
            "http_path": request.url.path,
        },
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ── Routes ───────────────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")


@app.get("/api/health", tags=["System"])
async def health_check():
    return {"status": "ok", "version": "1.0.0", "environment": settings.ENVIRONMENT}
