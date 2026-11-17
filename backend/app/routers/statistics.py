from app.core.time import today_local
from datetime import date
import time as _time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Group, Teacher
from app.schemas.statistics import StatisticsResponse
from app.services import cache_rev
from app.services.settings import settings_service
from app.services.statistics import group_statistics, teacher_statistics

router = APIRouter(prefix="/statistics", tags=["Statistics"])

_STATS_CACHE: dict[tuple, tuple[float, StatisticsResponse]] = {}
_STATS_CACHE_TTL = 120.0
_STATS_CACHE_MAX = 128


def invalidate_statistics_cache(group_id: int | None = None) -> None:
    if group_id is None:
        _STATS_CACHE.clear()
        return
    stale = [k for k in _STATS_CACHE if k[1] == "teacher" or (k[1] == "group" and k[2] == group_id)]
    for k in stale:
        _STATS_CACHE.pop(k, None)


cache_rev.register_cache_invalidator(invalidate_statistics_cache)


@router.get("/", response_model=StatisticsResponse)
async def statistics(
    group_id: int | None = Query(None, gt=0),
    teacher_id: int | None = Query(None, gt=0),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
    response: Response = None,
):
    if (group_id is None) == (teacher_id is None):
        raise HTTPException(
            status_code=422,
            detail="Вкажіть рівно одну групу або одного викладача",
        )

    today = today_local()
    etag = cache_rev.schedule_etag(
        group_id=group_id,
        teacher_id=teacher_id,
        variant=f"stats:{today.isoformat()}",
    )
    if response is not None:
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
        response.headers["Vary"] = "Accept-Encoding"
        if request is not None and cache_rev.etag_matches(request.headers.get("if-none-match"), etag):
            return Response(status_code=304, headers=dict(response.headers))

    semester_start = await settings_service.get_semester_start(db)
    semester_end = await settings_service.get_configured_semester_end(db)
    through_date = min(today, semester_end) if semester_end is not None else today

    can_use_cache = not db.new and not db.dirty and not db.deleted
    bind_id = id(db.get_bind())
    rev_sig = (
        (cache_rev.global_rev, cache_rev.group_rev.get(group_id, 0))
        if group_id is not None
        else (cache_rev.global_rev, cache_rev.any_rev)
    )
    cache_key = (
        bind_id,
        "group" if group_id is not None else "teacher",
        group_id if group_id is not None else teacher_id,
        semester_start,
        through_date,
        rev_sig,
    )
    now_mono = _time.monotonic()
    if can_use_cache:
        cached = _STATS_CACHE.get(cache_key)
        if cached is not None and (now_mono - cached[0]) < _STATS_CACHE_TTL:
            return cached[1]

    if group_id is not None:
        group = await db.scalar(
            select(Group).where(Group.id == group_id, Group.is_active.is_(True))
        )
        if group is None:
            raise HTTPException(status_code=404, detail="Групу не знайдено")
        data = await group_statistics(db, group, semester_start, through_date)
    else:
        teacher = await db.scalar(
            select(Teacher).where(Teacher.id == teacher_id, Teacher.is_active.is_(True))
        )
        if teacher is None:
            raise HTTPException(status_code=404, detail="Викладача не знайдено")
        data = await teacher_statistics(db, teacher, semester_start, through_date)

    result = StatisticsResponse(**data)
    if can_use_cache:
        if len(_STATS_CACHE) >= _STATS_CACHE_MAX:
            oldest_k = min(_STATS_CACHE, key=lambda k: _STATS_CACHE[k][0])
            _STATS_CACHE.pop(oldest_k, None)
        _STATS_CACHE[cache_key] = (now_mono, result)
    return result
