from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Setting

SEMESTER_START_KEY = "semester_start"

class SettingsService:
    def __init__(self) -> None:
        self._cache: dict[str, str | None] = {}

    async def get(self, db: AsyncSession, key: str, default: str | None = None) -> str | None:
        if key in self._cache:
            return self._cache[key]
        value = (await db.scalar(select(Setting.value).where(Setting.key == key)))
        self._cache[key] = value if value is not None else default
        return self._cache[key]

    async def set(self, db: AsyncSession, key: str, value: str) -> None:
        setting = await db.get(Setting, key)
        if setting is None:
            db.add(Setting(key=key, value=value))
        else:
            setting.value = value
        await db.commit()
        self.invalidate(key)

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

    def invalidate(self, key: str | None = None) -> None:
        if key is None:
            self._cache.clear()
        else:
            self._cache.pop(key, None)

    def clear_cache(self) -> None:
        self.invalidate()

settings_service = SettingsService()
