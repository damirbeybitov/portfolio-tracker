import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status

from app.models.user import User
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from app.schemas.auth import UserRegister, UserLogin, TokenResponse, AuthResponse, UserResponse

logger = logging.getLogger("app.services.auth")


class AuthService:

    @staticmethod
    async def register(db: AsyncSession, data: UserRegister) -> AuthResponse:
        result = await db.execute(select(User).where(User.email == data.email))
        if result.scalar_one_or_none():
            logger.warning("Registration attempt with duplicate email", extra={"email": data.email})
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

        result = await db.execute(select(User).where(User.username == data.username))
        if result.scalar_one_or_none():
            logger.warning("Registration attempt with duplicate username", extra={"username": data.username})
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

        user = User(
            email=data.email,
            username=data.username,
            hashed_password=hash_password(data.password),
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)

        logger.info("User registered", extra={"user_id": user.id, "username": user.username})
        tokens = TokenResponse(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id),
        )
        return AuthResponse(user=UserResponse.model_validate(user), tokens=tokens)

    @staticmethod
    async def login(db: AsyncSession, data: UserLogin) -> AuthResponse:
        result = await db.execute(select(User).where(User.email == data.email))
        user = result.scalar_one_or_none()

        if not user or not verify_password(data.password, user.hashed_password):
            logger.warning("Failed login attempt", extra={"email": data.email})
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if not user.is_active:
            logger.warning("Login attempt for inactive account", extra={"user_id": user.id})
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

        logger.info("User logged in", extra={"user_id": user.id, "username": user.username})
        tokens = TokenResponse(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id),
        )
        return AuthResponse(user=UserResponse.model_validate(user), tokens=tokens)

    @staticmethod
    async def refresh(db: AsyncSession, refresh_token: str) -> TokenResponse:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            logger.warning("Token refresh attempt with wrong token type")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            logger.warning("Token refresh for unknown/inactive user", extra={"user_id": user_id})
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        logger.debug("Token refreshed", extra={"user_id": user.id})
        return TokenResponse(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id),
        )

    @staticmethod
    async def get_me(db: AsyncSession, user_id: int) -> UserResponse:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            logger.error("get_me called with non-existent user_id", extra={"user_id": user_id})
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return UserResponse.model_validate(user)
