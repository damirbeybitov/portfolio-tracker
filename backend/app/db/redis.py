"""
Redis connection — lazy singleton.
Gracefully degrades if Redis is unavailable (price fetching still works,
just without caching).
"""

import logging
from typing import Optional

import redis.asyncio as aioredis

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> Optional[aioredis.Redis]:
    """Return a connected Redis client, or None if Redis is unavailable."""
    global _redis
    if _redis is not None:
        return _redis
    if not settings.REDIS_URL:
        return None
    try:
        client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        await client.ping()
        _redis = client
        logger.info(f"Redis connected: {settings.REDIS_URL}")
        return _redis
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}) — price caching disabled")
        return None


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None