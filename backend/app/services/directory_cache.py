"""Shared in-memory directory cache and invalidation helper."""
from __future__ import annotations

import time as _time
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

_DIR_CACHE: dict[tuple[Any, int], Any] = {}
_DIR_JSON_CACHE: dict[tuple[str, int, Any], bytes] = {}
_SCOPE_CACHE: dict[tuple[Any, int, int, int], tuple[float, Any]] = {}
_SCOPE_CACHE_TTL = 60.0
_SCOPE_CACHE_MAX = 256


def invalidate_directory_cache() -> None:
    """Clear the cached directory and scope entries."""
    _DIR_CACHE.clear()
    _DIR_JSON_CACHE.clear()
    _SCOPE_CACHE.clear()


def invalidate_scope_cache(group_id: Optional[int] = None) -> None:
    """Invalidate cached Group/Teacher scope lookups."""
    if group_id is None:
        _SCOPE_CACHE.clear()
        return
    stale = [k for k in _SCOPE_CACHE if k[1] == group_id]
    for k in stale:
        _SCOPE_CACHE.pop(k, None)


async def get_cached_scope(db: AsyncSession, model: Any, entity_id: Optional[int]) -> Any:
    """Fetch Group/Teacher from in-memory directory/scope cache when possible."""
    if not entity_id:
        return None
    if db.new or db.dirty or db.deleted:
        return await db.get(model, entity_id)

    from app.services import cache_rev
    rev = cache_rev.global_rev
    is_group = getattr(model, "__tablename__", None) == "groups"
    sub_rev = cache_rev.group_rev.get(entity_id, 0) if is_group else cache_rev.any_rev

    # Reuse already-loaded active directory list when the group's row hasn't changed since boot/rev
    if sub_rev == 0:
        dir_rows = _DIR_CACHE.get((model, rev))
        if dir_rows is not None:
            found = next((r for r in dir_rows if getattr(r, "id", None) == entity_id), None)
            if found is not None:
                return found

    cache_key = (model, entity_id, rev, sub_rev)
    now_mono = _time.monotonic()
    cached = _SCOPE_CACHE.get(cache_key)
    if cached is not None and (now_mono - cached[0]) < _SCOPE_CACHE_TTL:
        return cached[1]

    obj = await db.get(model, entity_id)
    if obj is not None:
        db.expunge(obj)
        if len(_SCOPE_CACHE) >= _SCOPE_CACHE_MAX:
            oldest_key = min(_SCOPE_CACHE, key=lambda k: _SCOPE_CACHE[k][0])
            _SCOPE_CACHE.pop(oldest_key, None)
        _SCOPE_CACHE[cache_key] = (now_mono, obj)
    return obj
