"""Cached bell-schedule lookup and shortened-day constants."""
import time as _time

from sqlalchemy import select

from app.models import BellSchedule

_bell_cache: tuple[float, dict[int, tuple[str, str]]] | None = None

SHORTENED_BELL_TIMES: dict[int, tuple[str, str]] = {
    1: ("09:00", "09:50"),
    2: ("10:00", "10:50"),
    3: ("11:00", "11:50"),
    4: ("12:00", "12:50"),
    5: ("13:00", "13:50"),
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
