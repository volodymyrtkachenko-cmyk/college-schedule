from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Setting

SEMESTER_START_KEY = "semester_start"

class SettingsService:
    async def get(self, db: AsyncSession, key: str, default: str | None = None) -> str | None:
        value = await db.scalar(select(Setting.value).where(Setting.key == key))
        return value if value is not None else default

    async def set(self, db: AsyncSession, key: str, value: str) -> None:
        setting = await db.get(Setting, key)
        if setting is None:
            db.add(Setting(key=key, value=value))
        else:
            setting.value = value
        await db.commit()

    async def get_semester_start(self, db: AsyncSession) -> date:
        value = await self.get(
            db,
            SEMESTER_START_KEY,
            default="2025-09-01",
        )
        try:
            return date.fromisoformat(value or "2025-09-01")
        except ValueError as exc:
            raise ValueError(
                "Invalid semester_start setting; expected ISO date YYYY-MM-DD"
            ) from exc

settings_service = SettingsService()
