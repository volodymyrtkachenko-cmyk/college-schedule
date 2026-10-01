from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Setting

SEMESTER_START_KEY = "semester_start"
SEMESTER_END_KEY = "semester_end"

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

settings_service = SettingsService()
