"""Cached bell-schedule lookup and shortened-day constants."""
import time as _time

from sqlalchemy import select

from app.core.time import today_local
from app.models import BellSchedule
from app.services.settings import settings_service

_bell_cache: tuple[float, dict[int, tuple[str, str]]] | None = None

SHORTENED_BELL_TIMES: dict[int, tuple[str, str]] = {
    1: ("09:00", "09:50"),
    2: ("10:00", "10:50"),
    3: ("11:00", "11:50"),
    4: ("12:00", "12:50"),
    5: ("13:00", "13:50"),
}


def _to_minutes(hhmm: str) -> int:
    hours, mins = hhmm.split(":", 1)
    return int(hours) * 60 + int(mins)


def build_bell_slot_items(
    bell_map: dict[int, tuple[str, str]],
    *,
    optional_after: int = 4,
) -> list[dict]:
    """Build sorted bell slots with lesson duration and break lengths."""
    ordered = sorted(bell_map.items(), key=lambda pair: pair[0])
    items: list[dict] = []
    for idx, (lesson_number, (start_time, end_time)) in enumerate(ordered):
        duration = max(0, _to_minutes(end_time) - _to_minutes(start_time))
        break_after = None
        if idx + 1 < len(ordered):
            next_start = ordered[idx + 1][1][0]
            break_after = max(0, _to_minutes(next_start) - _to_minutes(end_time))
        items.append({
            "lesson_number": lesson_number,
            "start_time": start_time,
            "end_time": end_time,
            "duration_minutes": duration,
            "break_after_minutes": break_after,
            "is_optional": lesson_number > optional_after,
        })
    return items


async def get_public_bells_payload(db) -> dict:
    """Return active standard/shortened bells and Kyiv today shortened-day status."""
    standard_map = await get_bell_times(db)
    today = today_local()
    today_iso = today.isoformat()
    shortened_items = await settings_service.get_shortened_days(db)
    today_item = next((it for it in shortened_items if it["date"] == today_iso), None)
    upcoming = [it for it in shortened_items if it["date"] >= today_iso][:10]
    return {
        "standard": build_bell_slot_items(standard_map, optional_after=4),
        "shortened": build_bell_slot_items(SHORTENED_BELL_TIMES, optional_after=4),
        "today_date": today,
        "is_shortened_today": today_item is not None,
        "today_reason": today_item.get("reason") if today_item else None,
        "upcoming_shortened_days": [
            {"date": it["date"], "reason": it.get("reason")} for it in upcoming
        ],
    }


def invalidate_bell_cache() -> None:
    """Reset the in-memory bell schedule cache."""
    global _bell_cache
    _bell_cache = None


async def get_bell_times(db) -> dict[int, tuple[str, str]]:
    """Return active bell times indexed by lesson number, cached for 300 seconds."""
    global _bell_cache
    now = _time.monotonic()
    if _bell_cache is not None and now - _bell_cache[0] < 300.0:
        return _bell_cache[1]
    records = (await db.scalars(select(BellSchedule).where(BellSchedule.is_active == True))).all()
    result = (
        {r.lesson_number: (r.start_time.strftime("%H:%M"), r.end_time.strftime("%H:%M")) for r in records}
        if records
        else {
            1: ("09:00", "10:20"),
            2: ("10:40", "12:00"),
            3: ("12:30", "13:50"),
            4: ("14:00", "15:20"),
        }
    )
    if result:
        _bell_cache = (now, result)
    return result
