from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user_settings import UserSettings
from app.schemas.settings import UserSettingsResponse, UserSettingsUpdate


class SettingsService:

    @staticmethod
    async def _get_or_create(db: AsyncSession, user_id: int) -> UserSettings:
        result = await db.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        settings = result.scalar_one_or_none()
        if settings is None:
            settings = UserSettings(user_id=user_id, hide_inactive_bank_accounts=False)
            db.add(settings)
            await db.flush()
            await db.refresh(settings)
        return settings

    @staticmethod
    async def get(db: AsyncSession, user_id: int) -> UserSettingsResponse:
        settings = await SettingsService._get_or_create(db, user_id)
        return UserSettingsResponse.model_validate(settings)

    @staticmethod
    async def update(db: AsyncSession, user_id: int, data: UserSettingsUpdate) -> UserSettingsResponse:
        settings = await SettingsService._get_or_create(db, user_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(settings, field, value)
        await db.flush()
        await db.refresh(settings)
        return UserSettingsResponse.model_validate(settings)
