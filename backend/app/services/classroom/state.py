import json
import time as _time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting

MAX_ACCOUNTS_PER_CYCLE = 5
CACHE_TTL_TEACHERS_TOPICS = 12 * 3600  # 12 годин TTL для статичних метаданих курсів (викладачі та теми)
CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY = "classroom_auto_sync_heartbeat"
_HEARTBEAT_CACHE_TTL = 30.0
_heartbeat_cache: tuple[float, Optional[dict[str, Any]]] | None = None

_last_students_synced_at: dict[int, datetime] = {}
_course_teachers_cache: dict[str, tuple[float, Any]] = {}
_course_topics_cache: dict[str, tuple[float, Any]] = {}

# (group_id -> (consecutive_failures, next_allowed_monotonic_ts))
_sync_backoff_state: dict[int, tuple[int, float]] = {}
_latest_unmapped_tasks: dict[int, list[dict]] = {}
_latest_group_tasks: dict[int, list[dict]] = {}
_latest_scope_missing: dict[int, bool] = {}
_SYNC_LOCK_GROUPS: set[int] = set()
_last_request_trigger: dict[int, float] = {}


def _iso_utc(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


async def _write_classroom_heartbeat(db: AsyncSession, payload: dict[str, Any]) -> None:
    """Зберігає стан останнього циклу автосинхронізації без інвалідації ETag розкладу."""
    value = json.dumps(payload, ensure_ascii=False)
    try:
        dialect = db.get_bind().dialect.name
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            stmt = pg_insert(Setting).values(key=CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY, value=value)
            await db.execute(
                stmt.on_conflict_do_update(index_elements=["key"], set_={"value": value}),
                execution_options={"skip_cache_rev": True},
            )
        elif dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            stmt = sqlite_insert(Setting).values(key=CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY, value=value)
            await db.execute(
                stmt.on_conflict_do_update(index_elements=["key"], set_={"value": value}),
                execution_options={"skip_cache_rev": True},
            )
        else:
            existing = await db.get(Setting, CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY)
            if existing is None:
                db.add(Setting(key=CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY, value=value))
            else:
                existing.value = value
    except Exception:
        existing = await db.get(Setting, CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY)
        if existing is None:
            db.add(Setting(key=CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY, value=value))
        else:
            existing.value = value
    global _heartbeat_cache
    await db.commit()
    _heartbeat_cache = (_time.monotonic(), payload)


async def _read_classroom_heartbeat(db: AsyncSession) -> Optional[dict[str, Any]]:
    global _heartbeat_cache
    now_mono = _time.monotonic()
    if _heartbeat_cache is not None and (now_mono - _heartbeat_cache[0]) < _HEARTBEAT_CACHE_TTL:
        return _heartbeat_cache[1]
    row = await db.get(Setting, CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY)
    if not row or not row.value:
        _heartbeat_cache = (now_mono, None)
        return None
    try:
        data = json.loads(row.value)
        parsed = data if isinstance(data, dict) else None
        _heartbeat_cache = (now_mono, parsed)
        return parsed
    except Exception:
        _heartbeat_cache = (now_mono, None)
        return None
