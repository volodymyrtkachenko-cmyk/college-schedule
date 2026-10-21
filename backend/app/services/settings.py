import time
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Setting
from app.config import settings

SEMESTER_START_KEY = "semester_start"
SEMESTER_END_KEY = "semester_end"
_CACHE_TTL = 300.0

class SettingsService:
    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, str | None]] = {}

    def invalidate_cache(self) -> None:
        self._cache.clear()

    def clear_cache(self) -> None:
        self.invalidate_cache()

    async def get(self, db: AsyncSession, key: str, default: str | None = None) -> str | None:
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached is not None and now - cached[0] < _CACHE_TTL:
            return cached[1] if cached[1] is not None else default

        value = await db.scalar(select(Setting.value).where(Setting.key == key))
        self._cache[key] = (now, value)
        return value if value is not None else default

    async def set(self, db: AsyncSession, key: str, value: str) -> None:
        setting = await db.get(Setting, key)
        if setting is None:
            db.add(Setting(key=key, value=value))
        else:
            setting.value = value
        await db.commit()
        self.invalidate_cache()
        from app.services import cache_rev
        cache_rev.bump(global_=True)

    async def get_semester_start(self, db: AsyncSession) -> date:
        value = await self.get(
            db,
            SEMESTER_START_KEY,
            default=settings.semester_start,
        )
        try:
            return date.fromisoformat(value or settings.semester_start)
        except ValueError as exc:
            raise ValueError(
                "Invalid semester_start setting; expected ISO date YYYY-MM-DD"
            ) from exc

    async def get_saved_semester_dates(
        self, db: AsyncSession
    ) -> tuple[date | None, date | None]:
        start_value = await self.get(db, SEMESTER_START_KEY)
        end_value = await self.get(db, SEMESTER_END_KEY)
        try:
            start = date.fromisoformat(start_value) if start_value else None
            end = date.fromisoformat(end_value) if end_value else None
        except ValueError as exc:
            raise ValueError(
                "Invalid semester date setting; expected ISO date YYYY-MM-DD"
            ) from exc
        return start, end

    async def get_configured_semester_end(self, db: AsyncSession) -> date | None:
        start, end = await self.get_saved_semester_dates(db)
        return end if start is not None and end is not None else None

    async def set_semester_dates(
        self, db: AsyncSession, start: date, end: date
    ) -> None:
        for key, value in (
            (SEMESTER_START_KEY, start.isoformat()),
            (SEMESTER_END_KEY, end.isoformat()),
        ):
            setting = await db.get(Setting, key)
            if setting is None:
                db.add(Setting(key=key, value=value))
            else:
                setting.value = value
        await db.commit()
        self.invalidate_cache()
        from app.services import cache_rev
        cache_rev.bump(global_=True)

settings_service = SettingsService()
