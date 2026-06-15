from fastapi import APIRouter
from app.api.v1.endpoints import auth, portfolios, bank, analytics, settings

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(portfolios.router)
api_router.include_router(bank.router)
api_router.include_router(analytics.router)
api_router.include_router(settings.router)
