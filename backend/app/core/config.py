from pydantic_settings import BaseSettings
from typing import List, Optional


class Settings(BaseSettings):
    # App
    ENVIRONMENT: str = "development"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://portfolio:portfolio_secret@localhost:5432/portfolio_tracker"

    # Redis
    REDIS_URL: Optional[str] = "redis://redis:6379/0"

    # JWT
    SECRET_KEY: str = "change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:4200"

    # Price providers
    ALPHA_VANTAGE_API_KEY: Optional[str] = None
    TWELVE_DATA_API_KEY: Optional[str] = None

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()