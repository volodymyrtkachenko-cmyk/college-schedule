from app.core.time import today_local, now_local
import logging
from datetime import date, time, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status, Request
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas import LessonMutation, ScheduleItem, ScheduleResponse
from app.core.security import require_roles
from app.models import Group, Teacher, ImportedScheduleChange, Schedule, Subject, User, ScheduleVersion, SchedulePeriod
from sqlalchemy import and_
from app.services.schedule import fetch_schedule, fetch_week_schedule, conflicting_lesson, save_schedule_item, resolve_active_period_info, _active_periods
from app.services.bells import (
    SHORTENED_BELL_TIMES,
    get_bell_times,
    invalidate_bell_cache,
)
from app.services.schedule_serializer import (
    effective_to_item,
    serialize_schedule_items,
    to_item,
)
from app.services.versions import lock_versions

from app.services.lesson_notes import attach_notes
from app.services.learning_mode import (
    resolve_group_learning_mode_detail,
    resolve_group_week_learning_modes,
)
from app.services.settings import settings_service

logger = logging.getLogger(__name__)

router = APIRouter()

def check_group_access(user: User, user_allowed_groups: list[int], group_id: int):

    if user.role == "admin": return
    if group_id not in user_allowed_groups:
        raise HTTPException(status_code=403, detail="Ви не маєте доступу до зміни розкладу цієї групи")

async def load_user_groups(db: AsyncSession, user: User) -> list[int]:
    u = await db.scalar(select(User).options(selectinload(User.allowed_groups)).where(User.id == user.id))
    return [g.id for g in u.allowed_groups] if u else []


async def _has_admin_or_editor_access(request: Request | None, db: AsyncSession) -> bool:
    if request is None:
        return False
    from app.core.security import get_current_user, decode_token
    override = request.app.dependency_overrides.get(get_current_user) if hasattr(request, "app") and request.app else None
    if override is not None:
        try:
            u = await override()
            if u and getattr(u, "role", None) in ("admin", "editor"):
                return True
        except Exception:
            pass
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        try:
            payload = decode_token(token, expected_type="access")
            role = payload.get("role")
            if role in ("admin", "editor"):
                return True
            sub = payload.get("sub")
            if sub:
                u = await db.scalar(select(User).where(User.username == str(sub), User.is_active == True))
                if u and u.role in ("admin", "editor"):
                    return True
        except Exception:
            pass
    return False


async def _resolve_public_schedule_horizon(db: AsyncSession) -> date:
    today = today_local()
    anchor_today = today + timedelta(days=8 - today.isoweekday()) if today.isoweekday() > 5 else today
    curr_monday = anchor_today - timedelta(days=anchor_today.isoweekday() - 1)
    default_horizon = curr_monday + timedelta(days=13)
    max_valid_until = await db.scalar(
        select(ScheduleVersion.valid_until)
        .where(ScheduleVersion.is_active == True, ScheduleVersion.valid_until >= today)
        .order_by(ScheduleVersion.valid_until.desc())
        .limit(1)
    )
    if max_valid_until is not None:
        return max_valid_until
    return default_horizon

@router.get("/schedule", response_model=ScheduleResponse)
async def schedule(request: Request = None,
                   group_id: int | None = None, teacher_id: int | None = None,
                   day_of_week: int | None = Query(None, ge=1, le=7),
                   target_date: date | None = None,
                   include_cancelled: bool = Query(False),
                   has_access: bool | None = None,
                   db: AsyncSession = Depends(get_db)):
    try:
        target_date = target_date or today_local()
        is_privileged = await _has_admin_or_editor_access(request, db)
        horizon_date = None if is_privileged else await _resolve_public_schedule_horizon(db)
        if horizon_date is not None and target_date > horizon_date:
            from app.services.projection import get_week_type
            semester_start = await settings_service.get_semester_start(db)
            week_type = get_week_type(target_date, semester_start)
            shortened_dates = await settings_service.get_shortened_dates_set(db)
            learning_mode, learning_mode_override = await resolve_group_learning_mode_detail(db, group_id, target_date)
            active_periods = await _active_periods(db, target_date)
            period_info = resolve_active_period_info(active_periods, target_date, group_id)
            return ScheduleResponse(
                date=target_date,
                week_type=week_type,
                lessons=[],
                learning_mode=learning_mode,
                learning_mode_override=learning_mode_override,
                is_shortened_day=(target_date in shortened_dates),
                period_info=period_info,
            )

        week_type, lessons = await fetch_schedule(
            db=db,
            target_date=target_date,
            group_id=group_id,
            teacher_id=teacher_id,
            day_of_week=day_of_week,
            include_cancelled=include_cancelled,
        )
        shortened_dates = await settings_service.get_shortened_dates_set(db)
        is_shortened = target_date in shortened_dates
        bell_t = SHORTENED_BELL_TIMES if is_shortened else await get_bell_times(db)
        learning_mode, learning_mode_override = await resolve_group_learning_mode_detail(db, group_id, target_date)
        serialized_items = await attach_notes(db, target_date, serialize_schedule_items(lessons, week_type, target_date, bell_t))

        from app.services.classroom_access import check_classroom_group_access, check_teacher_access, sanitize_note_for_guest, sanitize_room_for_guest, MEETING_URL_RE

        is_teacher_auth = False
        group_access_cache: dict[int, bool] = {}

        if teacher_id and not group_id:
            if has_access is True:
                is_teacher_auth = True
            else:
                is_teacher_auth = await check_teacher_access(db, request)
        else:
            if has_access is None:
                has_access = await check_classroom_group_access(db, group_id, request)

        for item in serialized_items:
            has_meeting = bool(
                (item.note and MEETING_URL_RE.search(item.note))
                or (item.room and MEETING_URL_RE.search(item.room))
                or (item.teacher_room and MEETING_URL_RE.search(item.teacher_room))
                or (item.second_teacher_room and MEETING_URL_RE.search(item.second_teacher_room))
            )
            if has_meeting:
                item.is_online = True

            if teacher_id and not group_id:
                if is_teacher_auth:
                    item_has_access = True
                elif item.group_id:
                    if item.group_id not in group_access_cache:
                        group_access_cache[item.group_id] = await check_classroom_group_access(db, item.group_id, request)
                    item_has_access = group_access_cache[item.group_id]
                else:
                    item_has_access = False
            else:
                item_has_access = bool(has_access)

            if not item_has_access:
                if has_meeting:
                    item.has_protected_link = True
                item.note, _ = sanitize_note_for_guest(item.note)
                item.room, _ = sanitize_room_for_guest(item.room)
                item.teacher_room, _ = sanitize_room_for_guest(item.teacher_room)
                item.second_teacher_room, _ = sanitize_room_for_guest(item.second_teacher_room)
                item.room_override, _ = sanitize_room_for_guest(item.room_override)

        active_periods = await _active_periods(db, target_date)
        period_info = resolve_active_period_info(active_periods, target_date, group_id)

        return ScheduleResponse(
            date=target_date,
            week_type=week_type,
            lessons=serialized_items,
            learning_mode=learning_mode,
            learning_mode_override=learning_mode_override,
            is_shortened_day=is_shortened,
            period_info=period_info,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in /schedule: {e}", exc_info=True)
        import traceback
        raise HTTPException(status_code=500, detail={"msg": f"Schedule error: {e}", "trace": traceback.format_exc().splitlines()[-10:]})

@router.get("/schedule/today", response_model=ScheduleResponse)
async def today(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    group_id: int | None = None,
    teacher_id: int | None = None,
    include_cancelled: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    from app.services.classroom.worker import run_background_sync_task, should_trigger_background_sync
    if should_trigger_background_sync(group_id):
        background_tasks.add_task(run_background_sync_task, group_id)

    target = today_local()
    if target.isoweekday() > 5:
        target = target + timedelta(days=8 - target.isoweekday())

    from app.services.classroom_access import check_classroom_group_access, check_teacher_access
    if teacher_id and not group_id:
        is_auth = await check_teacher_access(db, request)
    else:
        is_auth = await check_classroom_group_access(db, group_id, request)

    from app.services import cache_rev
    cred_tag = "0"
    if teacher_id and not group_id and not is_auth and request:
        c_uid = request.headers.get("x-classroom-user-id") or request.query_params.get("classroom_user_id") or ""
        c_email = request.headers.get("x-classroom-email") or request.query_params.get("classroom_email") or ""
        if c_uid or c_email:
            import hashlib
            cred_tag = hashlib.sha256(f"{c_uid}:{c_email.strip().lower()}".encode()).hexdigest()[:8]
    variant = f"today:{target.isoformat()}:{int(include_cancelled)}:{int(is_auth)}:{cred_tag}"
    etag = cache_rev.schedule_etag(group_id=group_id, teacher_id=teacher_id, variant=variant)
    response.headers["ETag"] = etag
    has_auth_context = False
    if request:
        has_auth_context = bool(
            request.headers.get("authorization")
            or request.headers.get("x-teacher-pin")
            or request.headers.get("x-classroom-user-id")
            or request.headers.get("x-classroom-email")
            or request.query_params.get("teacher_pin")
            or request.query_params.get("classroom_user_id")
            or request.query_params.get("classroom_email")
        )
    if has_auth_context:
        response.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
    else:
        response.headers["Cache-Control"] = "public, max-age=0, s-maxage=15, stale-while-revalidate=300"
    response.headers["Vary"] = "Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization"

    if cache_rev.etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=dict(response.headers))

    if group_id:
        scope = await db.get(Group, group_id)
    elif teacher_id:
        scope = await db.get(Teacher, teacher_id)
    else:
        scope = None

    if scope and getattr(scope, "updated_at", None):
        import datetime
        last_modified = scope.updated_at.replace(microsecond=0)
        if last_modified.tzinfo is None:
            last_modified = last_modified.replace(tzinfo=datetime.timezone.utc)
        else:
            last_modified = last_modified.astimezone(datetime.timezone.utc)
        if_modified_since = request.headers.get("if-modified-since")
        if if_modified_since and not request.headers.get("if-none-match") and cache_rev.global_rev == 0:
            try:
                from email.utils import parsedate_to_datetime
                client_time = parsedate_to_datetime(if_modified_since)
                if last_modified <= client_time:
                    return Response(status_code=304, headers=dict(response.headers))
            except Exception:
                pass
        
        from email.utils import format_datetime
        response.headers["Last-Modified"] = format_datetime(last_modified, usegmt=True)

    return await schedule(
        request=request,
        group_id=group_id,
        teacher_id=teacher_id,
        target_date=target,
        day_of_week=target.isoweekday(),
        include_cancelled=include_cancelled,
        has_access=True if is_auth else None,
        db=db,
    )

@router.get("/schedule/week")
async def week(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    group_id: int | None = None,
    teacher_id: int | None = None,
    target_date: date | None = None,
    include_cancelled: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    from app.services.classroom.worker import run_background_sync_task, should_trigger_background_sync
    if should_trigger_background_sync(group_id):
        background_tasks.add_task(run_background_sync_task, group_id)

    requested = target_date or today_local()
    start = requested - timedelta(days=requested.isoweekday() - 1)

    from app.services.classroom_access import check_classroom_group_access, check_teacher_access, sanitize_note_for_guest, sanitize_room_for_guest, MEETING_URL_RE
    if teacher_id and not group_id:
        is_auth = await check_teacher_access(db, request)
    else:
        is_auth = await check_classroom_group_access(db, group_id, request)

    from app.services import cache_rev
    cred_tag = "0"
    if teacher_id and not group_id and not is_auth and request:
        c_uid = request.headers.get("x-classroom-user-id") or request.query_params.get("classroom_user_id") or ""
        c_email = request.headers.get("x-classroom-email") or request.query_params.get("classroom_email") or ""
        if c_uid or c_email:
            import hashlib
            cred_tag = hashlib.sha256(f"{c_uid}:{c_email.strip().lower()}".encode()).hexdigest()[:8]
    variant = f"week:{start.isoformat()}:{int(include_cancelled)}:{int(is_auth)}:{cred_tag}"
    etag = cache_rev.schedule_etag(group_id=group_id, teacher_id=teacher_id, variant=variant)
    response.headers["ETag"] = etag
    has_auth_context = False
    if request:
        has_auth_context = bool(
            request.headers.get("authorization")
            or request.headers.get("x-teacher-pin")
            or request.headers.get("x-classroom-user-id")
            or request.headers.get("x-classroom-email")
            or request.query_params.get("teacher_pin")
            or request.query_params.get("classroom_user_id")
            or request.query_params.get("classroom_email")
        )
    if has_auth_context:
        response.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
    else:
        response.headers["Cache-Control"] = "public, max-age=0, s-maxage=15, stale-while-revalidate=300"
    response.headers["Vary"] = "Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization"

    if cache_rev.etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=dict(response.headers))

    # T11: PWA Offline caching via Last-Modified
    if group_id:
        scope = await db.get(Group, group_id)
    elif teacher_id:
        scope = await db.get(Teacher, teacher_id)
    else:
        scope = None

    if scope and getattr(scope, "updated_at", None):
        import datetime
        last_modified = scope.updated_at.replace(microsecond=0)
        if last_modified.tzinfo is None:
            last_modified = last_modified.replace(tzinfo=datetime.timezone.utc)
        else:
            last_modified = last_modified.astimezone(datetime.timezone.utc)
        if_modified_since = request.headers.get("if-modified-since")
        if if_modified_since and not request.headers.get("if-none-match") and cache_rev.global_rev == 0:
            try:
                from email.utils import parsedate_to_datetime
                client_time = parsedate_to_datetime(if_modified_since)
                if last_modified <= client_time:
                    return Response(status_code=304, headers=dict(response.headers))
            except Exception:
                pass
        
        from email.utils import format_datetime
        response.headers["Last-Modified"] = format_datetime(last_modified, usegmt=True)

    is_privileged = await _has_admin_or_editor_access(request, db)
    horizon_date = None if is_privileged else await _resolve_public_schedule_horizon(db)
    if horizon_date is not None and start > horizon_date:
        from app.services.projection import get_week_type
        semester_start = await settings_service.get_semester_start(db)
        week_type = get_week_type(start, semester_start)
        lessons_by_day = {}
    else:
        week_type, lessons_by_day = await fetch_week_schedule(db, start, group_id, teacher_id, include_cancelled=include_cancelled)
    standard_bells = await get_bell_times(db)
    shortened_dates = await settings_service.get_shortened_dates_set(db)
    from app.services.lesson_notes import attach_week_notes
    days_serialized = [
        (
            start + timedelta(days=i),
            [] if (horizon_date is not None and (start + timedelta(days=i)) > horizon_date) else serialize_schedule_items(
                lessons_by_day.get(i + 1, []),
                week_type,
                start + timedelta(days=i),
                SHORTENED_BELL_TIMES if (start + timedelta(days=i)) in shortened_dates else standard_bells,
            ),
        )
        for i in range(5)
    ]
    await attach_week_notes(db, days_serialized)

    group_access_cache: dict[int, bool] = {}
    for day_date, day_lessons in days_serialized:
        for item in day_lessons:
            has_meeting = bool(
                (item.note and MEETING_URL_RE.search(item.note))
                or (item.room and MEETING_URL_RE.search(item.room))
                or (item.teacher_room and MEETING_URL_RE.search(item.teacher_room))
                or (item.second_teacher_room and MEETING_URL_RE.search(item.second_teacher_room))
            )
            if has_meeting:
                item.is_online = True

            if teacher_id and not group_id:
                if is_auth:
                    item_has_access = True
                elif item.group_id:
                    if item.group_id not in group_access_cache:
                        group_access_cache[item.group_id] = await check_classroom_group_access(db, item.group_id, request)
                    item_has_access = group_access_cache[item.group_id]
                else:
                    item_has_access = False
            else:
                item_has_access = bool(is_auth)

            if not item_has_access:
                if has_meeting:
                    item.has_protected_link = True
                item.note, _ = sanitize_note_for_guest(item.note)
                item.room, _ = sanitize_room_for_guest(item.room)
                item.teacher_room, _ = sanitize_room_for_guest(item.teacher_room)
                item.second_teacher_room, _ = sanitize_room_for_guest(item.second_teacher_room)
                item.room_override, _ = sanitize_room_for_guest(item.room_override)

    week_dates = [day_date for day_date, _ in days_serialized]
    modes_by_date = await resolve_group_week_learning_modes(
        db, group_id, week_dates, group=scope if isinstance(scope, Group) else None
    )

    week_periods = (
        await db.scalars(
            select(SchedulePeriod)
            .where(
                SchedulePeriod.start_date <= (start + timedelta(days=4)),
                SchedulePeriod.end_date >= start,
            )
            .options(selectinload(SchedulePeriod.groups))
        )
    ).unique().all()

    return [
        ScheduleResponse(
            date=day_date,
            week_type=week_type,
            lessons=day_lessons,
            learning_mode=modes_by_date.get(day_date, (None, None))[0],
            learning_mode_override=modes_by_date.get(day_date, (None, None))[1],
            is_shortened_day=(day_date in shortened_dates),
            period_info=resolve_active_period_info(week_periods, day_date, group_id),
        )
        for day_date, day_lessons in days_serialized
    ]



@router.post("/schedule", response_model=ScheduleItem, status_code=status.HTTP_201_CREATED)
async def create_lesson(payload: LessonMutation, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(require_roles("admin", "editor"))):
    if payload.group_id is None or payload.subject_id is None and payload.subject is None or \
            payload.lesson_number is None or \
            payload.day_of_week is None and payload.date is None:
        raise HTTPException(422, "Не всі обов'язкові поля заповнені")

    await lock_versions(db)
    user_groups = await load_user_groups(db, current_user)
    check_group_access(current_user, user_groups, payload.group_id)
    
    target_date = payload.date or today_local()
    active_version = await db.scalar(
        select(ScheduleVersion).where(
            and_(ScheduleVersion.valid_from <= target_date, ScheduleVersion.valid_until >= target_date, ScheduleVersion.is_active == True)
        ).order_by(ScheduleVersion.valid_from.desc()).limit(1)
    )
    
    item = Schedule(is_active=True, version_id=active_version.id if active_version else None)
    db.add(item)
    saved_item = await save_schedule_item(item, payload, db, create=True)
    bell_t = await get_bell_times(db)
    effective_date = payload.date or today_local()
    serialized = to_item(saved_item, saved_item.week_type, effective_date, bell_t)
    return (await attach_notes(db, effective_date, [serialized]))[0]

@router.patch("/schedule/{lesson_id}", response_model=ScheduleItem)
async def update_lesson(lesson_id: int, payload: LessonMutation, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(require_roles("admin", "editor"))):
    await lock_versions(db)
    item = await db.get(Schedule, lesson_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Заняття не знайдено")

    user_groups = await load_user_groups(db, current_user)
    check_group_access(current_user, user_groups, item.group_id)
    if payload.group_id is not None and payload.group_id != item.group_id:
        check_group_access(current_user, user_groups, payload.group_id)
        
    db.info["note_actor_id"] = current_user.id
    saved_item = await save_schedule_item(item, payload, db)
    bell_t = await get_bell_times(db)
    effective_date = payload.date or today_local()
    serialized = to_item(saved_item, saved_item.week_type, effective_date, bell_t)
    return (await attach_notes(db, effective_date, [serialized]))[0]

@router.delete("/schedule/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(lesson_id: int, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(require_roles("admin", "editor"))):
    await lock_versions(db)
    item = await db.get(Schedule, lesson_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Заняття не знайдено")

    user_groups = await load_user_groups(db, current_user)
    check_group_access(current_user, user_groups, item.group_id)
    from app.services.lesson_notes import archive_template_notes
    await archive_template_notes(db, item, current_user.id)
    item.is_active = False
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Не вдалося видалити заняття") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class BulkCuratorRequest(BaseModel):
    day_of_week: int
    lesson_number: int
    week_type: str
    group_ids: list[int]
    action: str = "create" # "create" or "delete"

@router.post("/schedule/bulk-curator")
async def bulk_curator_hours(
    payload: BulkCuratorRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    try:
        await lock_versions(db)
        user_groups = await load_user_groups(db, current_user)
        if current_user.role == "editor":
            if not payload.group_ids:
                payload.group_ids = user_groups
            elif not set(payload.group_ids).issubset(set(user_groups)):
                raise HTTPException(403, "Ви не маєте доступу до однієї або кількох вказаних груп")

        today = today_local()
        active_version = await db.scalar(
            select(ScheduleVersion)
            .where(
                ScheduleVersion.valid_from <= today,
                ScheduleVersion.valid_until >= today,
                ScheduleVersion.is_active.is_(True),
            )
            .order_by(ScheduleVersion.valid_from.desc())
            .limit(1)
        )
        version_id = active_version.id if active_version else None

        subject_name = "Виховна година"
        subject = await db.scalar(select(Subject).where(Subject.name == subject_name))
        if not subject:
            subject = Subject(name=subject_name, is_active=True)
            db.add(subject)
            await db.flush()

        query = select(Group).where(Group.is_active.is_(True))
        if payload.group_ids:
            query = query.where(Group.id.in_(payload.group_ids))
        groups = (await db.scalars(query)).all()

        deleted_count = 0
        created_count = 0
        skipped_count = 0

        from sqlalchemy import update
        for group in groups:
            version_cond = (
                Schedule.version_id == version_id
                if version_id is not None
                else Schedule.version_id.is_(None)
            )
            upd_query = (
                update(Schedule)
                .where(
                    Schedule.group_id == group.id,
                    Schedule.subject_id == subject.id,
                    Schedule.day_of_week == payload.day_of_week,
                    Schedule.lesson_number == payload.lesson_number,
                    Schedule.week_type.in_(("both", payload.week_type)),
                    Schedule.is_active.is_(True),
                    version_cond,
                )
                .values(is_active=False)
            )
            res = await db.execute(upd_query)
            deleted_count += res.rowcount

            if payload.action == "create":
                if not group.curator_id:
                    skipped_count += 1
                    continue

                conflict = await conflicting_lesson(
                    db,
                    group_id=group.id,
                    day_of_week=payload.day_of_week,
                    lesson_number=payload.lesson_number,
                    week_type=payload.week_type,
                    teacher_id=group.curator_id,
                    subject_id=subject.id,
                    version_id=version_id,
                )
                if conflict:
                    skipped_count += 1
                    continue

                db.add(
                    Schedule(
                        group_id=group.id,
                        subject_id=subject.id,
                        teacher_id=group.curator_id,
                        day_of_week=payload.day_of_week,
                        lesson_number=payload.lesson_number,
                        week_type=payload.week_type,
                        version_id=version_id,
                        is_active=True,
                    )
                )
                created_count += 1

        await db.commit()
        return {"created": created_count, "deleted": deleted_count, "skipped": skipped_count}
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("bulk_curator_hours failed")
        raise HTTPException(status_code=500, detail="Внутрішня помилка сервера")

