import json
import time
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Setting
from app.config import settings

SEMESTER_START_KEY = "semester_start"
SEMESTER_END_KEY = "semester_end"
TEACHER_PIN_KEY = "teacher_pin"
SHORTENED_DAYS_KEY = "shortened_days"
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

    async def get_teacher_pin(self, db: AsyncSession) -> str:
        value = await self.get(db, TEACHER_PIN_KEY, default=settings.teacher_pin)
        return value or settings.teacher_pin

    async def get_shortened_days(self, db: AsyncSession) -> list[dict[str, Any]]:
        raw = await self.get(db, SHORTENED_DAYS_KEY, default="[]")
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                result = []
                for item in parsed:
                    if isinstance(item, str):
                        result.append({"date": item, "reason": None})
                    elif isinstance(item, dict) and "date" in item:
                        result.append({"date": str(item["date"]), "reason": item.get("reason")})
                result.sort(key=lambda x: x["date"])
                return result
        except Exception:
            pass
        return []

    async def get_shortened_dates_set(self, db: AsyncSession) -> set[date]:
        items = await self.get_shortened_days(db)
        res = set()
        for it in items:
            try:
                res.add(date.fromisoformat(it["date"]))
            except Exception:
                pass
        return res

    async def add_shortened_day(self, db: AsyncSession, day_date: date, reason: str | None = None) -> list[dict[str, Any]]:
        items = await self.get_shortened_days(db)
        d_str = day_date.isoformat()
        found = False
        for it in items:
            if it["date"] == d_str:
                it["reason"] = reason
                found = True
                break
        if not found:
            items.append({"date": d_str, "reason": reason})
        items.sort(key=lambda x: x["date"])
        await self.set(db, SHORTENED_DAYS_KEY, json.dumps(items))
        return items

    async def remove_shortened_day(self, db: AsyncSession, day_date: date) -> list[dict[str, Any]]:
        items = await self.get_shortened_days(db)
        d_str = day_date.isoformat()
        items = [it for it in items if it["date"] != d_str]
        await self.set(db, SHORTENED_DAYS_KEY, json.dumps(items))
        return items

    async def toggle_shortened_day(self, db: AsyncSession, day_date: date, reason: str | None = None) -> bool:
        items = await self.get_shortened_days(db)
        d_str = day_date.isoformat()
        exists = any(it["date"] == d_str for it in items)
        if exists:
            await self.remove_shortened_day(db, day_date)
            return False
        else:
            await self.add_shortened_day(db, day_date, reason)
            return True

settings_service = SettingsService()
