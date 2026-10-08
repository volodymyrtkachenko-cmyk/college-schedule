from app.core.time import today_local, now_local
import logging
from datetime import date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas import LessonMutation, ScheduleItem, ScheduleResponse
from app.core.security import require_roles
from app.models import Group, ImportedScheduleChange, Schedule, Subject, User, ScheduleVersion
from sqlalchemy import and_
from app.services.schedule import fetch_schedule, fetch_week_schedule, conflicting_lesson, save_schedule_item

from app.routers.schedule_versions import lock_versions

logger = logging.getLogger(__name__)

router = APIRouter()

def check_group_access(user: User, user_allowed_groups: list[int], group_id: int):
    if user.role == "admin": return
    if group_id not in user_allowed_groups:
        raise HTTPException(status_code=403, detail="Ви не маєте доступу до зміни розкладу цієї групи")

async def load_user_groups(db: AsyncSession, user: User) -> list[int]:
    u = await db.scalar(select(User).options(selectinload(User.allowed_groups)).where(User.id == user.id))
    return [g.id for g in u.allowed_groups] if u else []


def format_teacher_name(name: str) -> str:
    if not name:
        return name
    parts = [p.strip("., ") for p in name.split() if p.strip("., ")]
    if len(parts) >= 3:
        return f"{parts[0]} {parts[1][0].upper()}. {parts[2][0].upper()}."
    elif len(parts) == 2:
        return f"{parts[0]} {parts[1][0].upper()}."
    return name


from app.models import BellSchedule
async def get_bell_times(db):
    records = (await db.scalars(select(BellSchedule).where(BellSchedule.is_active == True))).all()
    if records:
        return {r.lesson_number: (r.start_time.strftime('%H:%M'), r.end_time.strftime('%H:%M')) for r in records}
    return dict()

def to_item(item, week_type, target_date, bell_times=None, *, item_id=None, is_replacement=None):
    if bell_times is None:
        bell_times = {}

    matching_note = None
    t_names = []
    t_rooms = []
    if item.teacher:
        t_names.append(item.teacher.name)
        if item.teacher.room:
            t_rooms.append(item.teacher.room)
    if getattr(item, "second_teacher", None):
        t_names.append(item.second_teacher.name)
        if item.second_teacher.room:
            t_rooms.append(item.second_teacher.room)
    teacher_name = " / ".join(t_names) if t_names else None
    room_name = getattr(item, 'room_override', None) or (" / ".join(t_rooms) if t_rooms else None)
    return ScheduleItem(id=item.id if item_id is None else item_id, group_id=item.group_id, subject_id=item.subject_id, teacher_id=item.teacher_id, second_teacher_id=item.second_teacher_id,
        day_of_week=item.day_of_week, lesson_number=item.lesson_number,
        time=f"{bell_times.get(item.lesson_number, ('00:00', '00:00'))[0]}-{bell_times.get(item.lesson_number, ('', ''))[1]}",
        subject=item.subject.name, teacher=teacher_name, room=room_name, room_override=getattr(item, 'room_override', None),
        subject_name=item.subject.name, teacher_name=teacher_name,
        stream_id=getattr(item, "stream_id", None),
        week_type=item.week_type,
        is_relevant_this_week=item.week_type in ("both", week_type),
        is_replacement=getattr(item, "is_replacement", False) if is_replacement is None else is_replacement,
        group_name=getattr(item.group, "name", None),
        note=matching_note.note if matching_note else None,
        note_id=matching_note.id if matching_note else None)


def imported_change_to_item(change, week_type, target_date, bell_times=None):
    """Adapt a date-specific imported replacement to the regular schedule API shape."""
    if change.kind != "substitution" or change.subject is None:
        return None
    teacher_name = change.teacher.name if change.teacher else None
    if change.second_teacher:
        teacher_name = " / ".join(
            name for name in (teacher_name, change.second_teacher.name) if name
        )
    return ScheduleItem(
        id=-change.id,
        group_id=change.group_id,
        subject_id=change.subject_id,
        teacher_id=change.teacher_id,
        second_teacher_id=change.second_teacher_id,
        day_of_week=target_date.isoweekday(),
        lesson_number=change.lesson_number,
        time=f"{(bell_times or {}).get(change.lesson_number, ('00:00', '00:00'))[0]}-"
        f"{(bell_times or {}).get(change.lesson_number, ('', ''))[1]}",
        subject=change.subject.name,
        teacher=teacher_name,
        room=change.room_override,
        room_override=change.room_override,
        subject_name=change.subject.name,
        teacher_name=teacher_name,
        stream_id=None,
        week_type="both",
        is_relevant_this_week=True,
        is_replacement=True,
        group_name=change.group.name if change.group else None,
        note=None,
        note_id=None,
    )


def serialize_schedule_items(lessons, week_type, target_date, bell_times):
    items = []
    for lesson in lessons:
        if isinstance(lesson, ImportedScheduleChange):
            item = imported_change_to_item(lesson, week_type, target_date, bell_times)
        else:
            is_replacement = (
                True
                if hasattr(lesson, "period_id") or hasattr(lesson, "is_published")
                else None
            )
            item = to_item(
                lesson,
                week_type,
                target_date,
                bell_times,
                is_replacement=is_replacement,
            )
        if item is not None:
            items.append(item)
    return sorted(items, key=lambda item: (item.lesson_number, item.group_name or "", item.id))

@router.get("/schedule", response_model=ScheduleResponse)
async def schedule(group_id: int | None = None, teacher_id: int | None = None,
                   day_of_week: int | None = Query(None, ge=1, le=7),
                   target_date: date | None = None, db: AsyncSession = Depends(get_db)):
    target_date = target_date or today_local()
    week_type, lessons = await fetch_schedule(db=db, target_date=target_date, group_id=group_id, teacher_id=teacher_id, day_of_week=day_of_week)
    bell_t = await get_bell_times(db)
    return ScheduleResponse(
        date=target_date,
        week_type=week_type,
        lessons=serialize_schedule_items(lessons, week_type, target_date, bell_t),
    )

@router.get("/schedule/today", response_model=ScheduleResponse)
async def today(response: Response, group_id: int | None = None, teacher_id: int | None = None, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    response.headers["Vary"] = "Date, Origin, Accept-Encoding"
    target = today_local()
    if target.isoweekday() > 5:
        target = target + timedelta(days=8 - target.isoweekday())
    return await schedule(group_id=group_id, teacher_id=teacher_id, target_date=target, day_of_week=target.isoweekday(), db=db)

@router.get("/schedule/week")
async def week(response: Response, group_id: int | None = None, teacher_id: int | None = None, target_date: date | None = None,
               db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    response.headers["Vary"] = "Date, Origin, Accept-Encoding"
    requested = target_date or today_local()
    start = requested - timedelta(days=requested.isoweekday() - 1)
    week_type, lessons_by_day = await fetch_week_schedule(db, start, group_id, teacher_id)
    bell_t = await get_bell_times(db)
    return [
        ScheduleResponse(
            date=start + timedelta(days=i),
            week_type=week_type,
            lessons=serialize_schedule_items(
                lessons_by_day.get(i + 1, []),
                week_type,
                start + timedelta(days=i),
                bell_t,
            ),
        )
        for i in range(5)
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
    return to_item(saved_item, saved_item.week_type, payload.date or today_local(), bell_t)

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
        
    saved_item = await save_schedule_item(item, payload, db)
    bell_t = await get_bell_times(db)
    return to_item(saved_item, saved_item.week_type, payload.date or today_local(), bell_t)

@router.delete("/schedule/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(lesson_id: int, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(require_roles("admin", "editor"))):
    await lock_versions(db)
    item = await db.get(Schedule, lesson_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Заняття не знайдено")

    user_groups = await load_user_groups(db, current_user)
    check_group_access(current_user, user_groups, item.group_id)
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
async def bulk_curator_hours(payload: BulkCuratorRequest, db: AsyncSession = Depends(get_db), _: object = Depends(require_roles("admin"))):
    try:
        subject_name = "Виховна година"
        
        # Find or create subject
        subject = await db.scalar(select(Subject).where(Subject.name == subject_name))
        if not subject:
            subject = Subject(name=subject_name)
            db.add(subject)
            await db.flush()
            
        query = select(Group).where(Group.is_active == True)
        if payload.group_ids:
            query = query.where(Group.id.in_(payload.group_ids))
        groups = (await db.scalars(query)).all()
        
        deleted_count = 0
        created_count = 0
        skipped_count = 0
        
        for group in groups:
            # Delete existing curator hour at this specific time slot
            from sqlalchemy import update
            upd_query = update(Schedule).where(
                Schedule.group_id == group.id,
                Schedule.subject_id == subject.id,
                Schedule.day_of_week == payload.day_of_week,
                Schedule.lesson_number == payload.lesson_number,
                Schedule.week_type.in_(("both", payload.week_type))
            ).values(is_active=False)
            res = await db.execute(upd_query)
            deleted_count += res.rowcount
            
            if payload.action == "create":
                # Check for conflict with OTHER subjects
                conflict = await conflicting_lesson(
                    db, group_id=group.id, day_of_week=payload.day_of_week,
                    lesson_number=payload.lesson_number, week_type=payload.week_type,
                    teacher_id=group.curator_id, subject_id=subject.id
                )
                if conflict:
                    skipped_count += 1
                    continue
                    
                new_lesson = Schedule(
                    group_id=group.id,
                    subject_id=subject.id,
                    teacher_id=group.curator_id,
                    day_of_week=payload.day_of_week,
                    lesson_number=payload.lesson_number,
                    week_type=payload.week_type,
                    is_active=True
                )
                db.add(new_lesson)
                created_count += 1
                
        await db.commit()
        return {"created": created_count, "deleted": deleted_count, "skipped": skipped_count}
    except Exception as e:
        await db.rollback()
        logger.exception("bulk_curator_hours failed")
        raise HTTPException(status_code=500, detail="Внутрішня помилка сервера")
