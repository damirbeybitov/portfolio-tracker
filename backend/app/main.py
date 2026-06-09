from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.db.session import engine
from app.db.base import Base
from app.db.redis import get_redis, close_redis
from app.api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await get_redis()  # warm up Redis connection (fails gracefully)
    yield
    # Shutdown
    await engine.dispose()
    await close_redis()


app = FastAPI(
    title="Portfolio Tracker API",
    description="Personal investment portfolio tracker with stocks, bank accounts, and multi-currency support",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/api/health")
async def health_check():
    from app.db.redis import _redis
    return {
        "status": "ok",
        "version": "1.0.0",
        "redis": "connected" if _redis else "unavailable",
    }