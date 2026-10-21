from datetime import date, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.entities import Schedule, ScheduleOverride, ScheduleVersion, User, Group, Subject, Teacher
from app.core.security import require_roles
from app.core.time import today_local
from app.schemas.common import ScheduleItem, LessonMutation
from app.services.schedule import conflicting_lesson
from app.services.lesson_notes import authorize_group
from app.routers.schedule import get_bell_times, to_item
from app.routers.schedule_versions import lock_versions, ScheduleVersionResponse

router = APIRouter(prefix="/schedule/template", tags=["Schedule Template"])


def get_current_monday(d: Optional[date] = None) -> date:
    t = d or today_local()
    return t - timedelta(days=t.isoweekday() - 1)


async def find_affected_dates(db: AsyncSession, group_id: int, current_monday: date) -> List[str]:
    query = select(ScheduleOverride.date).where(
        ScheduleOverride.group_id == group_id,
        ScheduleOverride.date >= current_monday,
    ).distinct().order_by(ScheduleOverride.date)
    dates = (await db.scalars(query)).all()
    return [d.isoformat() for d in dates]


DAY_NAMES = {
    1: "Понеділок",
    2: "Вівторок",
    3: "Середа",
    4: "Четвер",
    5: "П'ятниця",
}


class TemplateDaySchedule(BaseModel):
    day_of_week: int
    name: str
    lessons: List[ScheduleItem]


class TemplateScheduleResponse(BaseModel):
    version: ScheduleVersionResponse
    week_type: str
    effective_from: date
    days: List[TemplateDaySchedule]
    all_lessons: List[ScheduleItem]


class TemplateCopyPayload(BaseModel):
    version_id: int
    source_lesson_id: int
    target_day_of_week: int
    target_lesson_number: int
    target_week_type: str


class TemplateMovePayload(BaseModel):
    version_id: int
    source_lesson_id: int
    target_day_of_week: int
    target_lesson_number: int
    target_week_type: str


class TemplateSwapPayload(BaseModel):
    version_id: int
    first_lesson_id: int
    second_lesson_id: int


class TemplateDayActionPayload(BaseModel):
    action: str  # "copy" or "move"
    version_id: int
    group_id: int
    source_day_of_week: int
    source_week_type: str
    target_day_of_week: int
    target_week_type: str


@router.get("", response_model=TemplateScheduleResponse)
async def get_template_schedule(
    version_id: int = Query(...),
    group_id: Optional[int] = Query(None),
    teacher_id: Optional[int] = Query(None),
    week_type: str = Query("numerator"),
    effective_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    version = await db.get(ScheduleVersion, version_id)
    if not version:
        raise HTTPException(404, "Версію розкладу не знайдено")

    eff_date = effective_date or get_current_monday()

    conds = [
        Schedule.version_id == version_id,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
        or_(Schedule.effective_from.is_(None), Schedule.effective_from <= eff_date),
        or_(Schedule.effective_until.is_(None), Schedule.effective_until >= eff_date),
    ]
    if group_id is not None:
        conds.append(Schedule.group_id == group_id)
    if teacher_id is not None:
        conds.append(
            or_(
                Schedule.teacher_id == teacher_id,
                Schedule.second_teacher_id == teacher_id,
            )
        )

    stmt = select(Schedule).where(*conds).options(
        joinedload(Schedule.group),
        joinedload(Schedule.subject),
        joinedload(Schedule.teacher),
        joinedload(Schedule.second_teacher),
    ).order_by(Schedule.day_of_week, Schedule.lesson_number)

    rows = (await db.scalars(stmt)).all()
    bell_t = await get_bell_times(db)

    # Group by day 1..5
    days_data: List[TemplateDaySchedule] = []
    all_items: List[ScheduleItem] = []

    for dow in range(1, 6):
        day_lessons = [r for r in rows if r.day_of_week == dow]
        serialized_lessons = [
            to_item(l, week_type, eff_date, bell_t) for l in day_lessons
        ]
        all_items.extend(serialized_lessons)
        days_data.append(
            TemplateDaySchedule(
                day_of_week=dow,
                name=DAY_NAMES.get(dow, f"День {dow}"),
                lessons=serialized_lessons,
            )
        )

    return TemplateScheduleResponse(
        version=ScheduleVersionResponse.model_validate(version),
        week_type=week_type,
        effective_from=eff_date,
        days=days_data,
        all_lessons=all_items,
    )


@router.post("/lesson", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_template_lesson(
    payload: LessonMutation,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    if not payload.version_id:
        raise HTTPException(422, "version_id є обов'язковим")
    if not payload.group_id or not payload.subject_id or not payload.day_of_week or not payload.lesson_number:
        raise HTTPException(422, "Не всі обов'язкові поля заповнені")

    await authorize_group(db, current_user, payload.group_id)
    await lock_versions(db)
    current_monday = get_current_monday(payload.date)

    # Check conflicts
    conflict = await conflicting_lesson(
        db,
        group_id=payload.group_id,
        day_of_week=payload.day_of_week,
        lesson_number=payload.lesson_number,
        week_type=payload.week_type or "both",
        teacher_id=payload.teacher_id,
        second_teacher_id=payload.second_teacher_id,
        subject_id=payload.subject_id,
        version_id=payload.version_id,
        effective_date=current_monday,
    )
    if conflict:
        d_name = DAY_NAMES.get(payload.day_of_week, str(payload.day_of_week))
        if conflict.group_id != payload.group_id:
            g_name = conflict.group.name if conflict.group else "???"
            raise HTTPException(409, f"Викладач уже веде заняття в цей час (група {g_name})")
        raise HTTPException(409, f"Неможливо зберегти: на {d_name} ({payload.lesson_number}-а пара) уже призначене інше заняття.")

    item = Schedule(
        version_id=payload.version_id,
        group_id=payload.group_id,
        subject_id=payload.subject_id,
        teacher_id=payload.teacher_id,
        second_teacher_id=payload.second_teacher_id,
        day_of_week=payload.day_of_week,
        lesson_number=payload.lesson_number,
        week_type=payload.week_type or "both",
        room_override=payload.room.strip() if payload.room else None,
        effective_from=current_monday,
        is_active=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item, ["group", "subject", "teacher", "second_teacher"])

    affected = await find_affected_dates(db, payload.group_id, current_monday)
    bell_t = await get_bell_times(db)
    serialized = to_item(item, item.week_type, current_monday, bell_t)

    return {"lesson": serialized.model_dump(), "affected_dates": affected}


@router.patch("/lesson/{lesson_id}", response_model=dict)
async def update_template_lesson(
    lesson_id: int,
    payload: LessonMutation,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    await lock_versions(db)
    item = await db.get(Schedule, lesson_id)
    if not item or not item.is_active:
        raise HTTPException(404, "Заняття не знайдено")

    await authorize_group(db, current_user, item.group_id)
    current_monday = get_current_monday(payload.date)
    target_group_id = payload.group_id or item.group_id
    if target_group_id != item.group_id:
        await authorize_group(db, current_user, target_group_id)
    target_day = payload.day_of_week or item.day_of_week
    target_lesson_num = payload.lesson_number or item.lesson_number
    target_week_type = payload.week_type or item.week_type
    target_subject_id = payload.subject_id or item.subject_id
    target_teacher_id = payload.teacher_id if "teacher_id" in payload.model_fields_set else item.teacher_id
    target_second_teacher_id = payload.second_teacher_id if "second_teacher_id" in payload.model_fields_set else item.second_teacher_id
    target_room = payload.room.strip() if payload.room and payload.room.strip() else (None if "room" in payload.model_fields_set else item.room_override)

    # Check conflicts
    conflict = await conflicting_lesson(
        db,
        group_id=target_group_id,
        day_of_week=target_day,
        lesson_number=target_lesson_num,
        week_type=target_week_type,
        teacher_id=target_teacher_id,
        second_teacher_id=target_second_teacher_id,
        subject_id=target_subject_id,
        version_id=item.version_id,
        exclude_id=item.id,
        effective_date=current_monday,
    )
    if conflict:
        d_name = DAY_NAMES.get(target_day, str(target_day))
        if conflict.group_id != target_group_id:
            g_name = conflict.group.name if conflict.group else "???"
            raise HTTPException(409, f"Викладач уже веде заняття в цей час (група {g_name})")
        raise HTTPException(409, f"Неможливо зберегти: на {d_name} ({target_lesson_num}-а пара) уже призначене інше заняття.")

    # Revision mechanism: preserve past history if item was effective before current week
    if item.effective_from is None or item.effective_from < current_monday:
        # Cap old lesson at the end of previous week
        item.effective_until = current_monday - timedelta(days=1)
        # Create new lesson effective from current Monday
        new_item = Schedule(
            version_id=item.version_id,
            group_id=target_group_id,
            subject_id=target_subject_id,
            teacher_id=target_teacher_id,
            second_teacher_id=target_second_teacher_id,
            day_of_week=target_day,
            lesson_number=target_lesson_num,
            week_type=target_week_type,
            room_override=target_room,
            effective_from=current_monday,
            is_active=True,
        )
        db.add(new_item)
        await db.commit()
        await db.refresh(new_item, ["group", "subject", "teacher", "second_teacher"])
        res_item = new_item
    else:
        # In-place update if created for current week
        item.group_id = target_group_id
        item.subject_id = target_subject_id
        item.teacher_id = target_teacher_id
        item.second_teacher_id = target_second_teacher_id
        item.day_of_week = target_day
        item.lesson_number = target_lesson_num
        item.week_type = target_week_type
        item.room_override = target_room
        await db.commit()
        await db.refresh(item, ["group", "subject", "teacher", "second_teacher"])
        res_item = item

    affected = await find_affected_dates(db, target_group_id, current_monday)
    bell_t = await get_bell_times(db)
    serialized = to_item(res_item, res_item.week_type, current_monday, bell_t)

    return {"lesson": serialized.model_dump(), "affected_dates": affected}


@router.delete("/lesson/{lesson_id}", response_model=dict)
async def delete_template_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    await lock_versions(db)
    item = await db.get(Schedule, lesson_id)
    if not item or not item.is_active:
        raise HTTPException(404, "Заняття не знайдено")

    await authorize_group(db, current_user, item.group_id)
    current_monday = get_current_monday()
    group_id = item.group_id

    if item.effective_from is None or item.effective_from < current_monday:
        item.effective_until = current_monday - timedelta(days=1)
    else:
        item.is_active = False

    await db.commit()
    affected = await find_affected_dates(db, group_id, current_monday)
    return {"status": "deleted", "affected_dates": affected}


@router.post("/copy", response_model=dict)
async def copy_template_lesson(
    payload: TemplateCopyPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    await lock_versions(db)
    source = await db.get(Schedule, payload.source_lesson_id)
    if not source or not source.is_active:
        raise HTTPException(404, "Вихідне заняття не знайдено")

    await authorize_group(db, current_user, source.group_id)
    current_monday = get_current_monday()

    # Check conflicts
    conflict = await conflicting_lesson(
        db,
        group_id=source.group_id,
        day_of_week=payload.target_day_of_week,
        lesson_number=payload.target_lesson_number,
        week_type=payload.target_week_type,
        teacher_id=source.teacher_id,
        second_teacher_id=source.second_teacher_id,
        subject_id=source.subject_id,
        version_id=payload.version_id,
        effective_date=current_monday,
    )
    if conflict:
        d_name = DAY_NAMES.get(payload.target_day_of_week, str(payload.target_day_of_week))
        if conflict.group_id != source.group_id:
            g_name = conflict.group.name if conflict.group else "???"
            raise HTTPException(409, f"Викладач уже веде заняття в цей час (група {g_name})")
        raise HTTPException(409, f"Неможливо скопіювати: на {d_name} ({payload.target_lesson_number}-а пара) вже призначене заняття.")

    new_item = Schedule(
        version_id=payload.version_id,
        group_id=source.group_id,
        subject_id=source.subject_id,
        teacher_id=source.teacher_id,
        second_teacher_id=source.second_teacher_id,
        day_of_week=payload.target_day_of_week,
        lesson_number=payload.target_lesson_number,
        week_type=payload.target_week_type,
        room_override=source.room_override,
        effective_from=current_monday,
        is_active=True,
    )
    db.add(new_item)
    await db.commit()
    await db.refresh(new_item, ["group", "subject", "teacher", "second_teacher"])

    affected = await find_affected_dates(db, source.group_id, current_monday)
    bell_t = await get_bell_times(db)
    serialized = to_item(new_item, new_item.week_type, current_monday, bell_t)

    return {"lesson": serialized.model_dump(), "affected_dates": affected}


@router.post("/move", response_model=dict)
async def move_template_lesson(
    payload: TemplateMovePayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    await lock_versions(db)
    source = await db.get(Schedule, payload.source_lesson_id)
    if not source or not source.is_active:
        raise HTTPException(404, "Вихідне заняття не знайдено")

    await authorize_group(db, current_user, source.group_id)
    current_monday = get_current_monday()

    conflict = await conflicting_lesson(
        db,
        group_id=source.group_id,
        day_of_week=payload.target_day_of_week,
        lesson_number=payload.target_lesson_number,
        week_type=payload.target_week_type,
        teacher_id=source.teacher_id,
        second_teacher_id=source.second_teacher_id,
        subject_id=source.subject_id,
        version_id=payload.version_id,
        exclude_id=source.id,
        effective_date=current_monday,
    )
    if conflict:
        d_name = DAY_NAMES.get(payload.target_day_of_week, str(payload.target_day_of_week))
        if conflict.group_id != source.group_id:
            g_name = conflict.group.name if conflict.group else "???"
            raise HTTPException(409, f"Викладач уже веде заняття в цей час (група {g_name})")
        raise HTTPException(409, f"Неможливо перенести: на {d_name} ({payload.target_lesson_number}-а пара) вже призначене заняття.")

    # Archive source
    if source.effective_from is None or source.effective_from < current_monday:
        source.effective_until = current_monday - timedelta(days=1)
    else:
        source.is_active = False

    new_item = Schedule(
        version_id=payload.version_id,
        group_id=source.group_id,
        subject_id=source.subject_id,
        teacher_id=source.teacher_id,
        second_teacher_id=source.second_teacher_id,
        day_of_week=payload.target_day_of_week,
        lesson_number=payload.target_lesson_number,
        week_type=payload.target_week_type,
        room_override=source.room_override,
        effective_from=current_monday,
        is_active=True,
    )
    db.add(new_item)
    await db.commit()
    await db.refresh(new_item, ["group", "subject", "teacher", "second_teacher"])

    affected = await find_affected_dates(db, source.group_id, current_monday)
    bell_t = await get_bell_times(db)
    serialized = to_item(new_item, new_item.week_type, current_monday, bell_t)

    return {"lesson": serialized.model_dump(), "affected_dates": affected}


@router.post("/swap", response_model=dict)
async def swap_template_lessons(
    payload: TemplateSwapPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    await lock_versions(db)
    l1 = await db.get(Schedule, payload.first_lesson_id)
    l2 = await db.get(Schedule, payload.second_lesson_id)
    if not l1 or not l2 or not l1.is_active or not l2.is_active:
        raise HTTPException(404, "Одне з занять для обміну не знайдено")

    await authorize_group(db, current_user, l1.group_id)
    if l2.group_id != l1.group_id:
        await authorize_group(db, current_user, l2.group_id)
    current_monday = get_current_monday()

    # Swap slots
    d1, n1, w1 = l1.day_of_week, l1.lesson_number, l1.week_type
    d2, n2, w2 = l2.day_of_week, l2.lesson_number, l2.week_type

    # If effective before current_monday, clone both with swapped slots
    for item, new_d, new_n, new_w in [(l1, d2, n2, w2), (l2, d1, n1, w1)]:
        if item.effective_from is None or item.effective_from < current_monday:
            item.effective_until = current_monday - timedelta(days=1)
            new_item = Schedule(
                version_id=item.version_id,
                group_id=item.group_id,
                subject_id=item.subject_id,
                teacher_id=item.teacher_id,
                second_teacher_id=item.second_teacher_id,
                day_of_week=new_d,
                lesson_number=new_n,
                week_type=new_w,
                room_override=item.room_override,
                effective_from=current_monday,
                is_active=True,
            )
            db.add(new_item)
        else:
            item.day_of_week = new_d
            item.lesson_number = new_n
            item.week_type = new_w

    await db.commit()
    affected = await find_affected_dates(db, l1.group_id, current_monday)
    return {"status": "swapped", "affected_dates": affected}


@router.post("/day-action", response_model=dict)
async def day_action_template(
    payload: TemplateDayActionPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor")),
):
    await authorize_group(db, current_user, payload.group_id)
    await lock_versions(db)
    current_monday = get_current_monday()

    # Query all active lessons on source day
    stmt = select(Schedule).where(
        Schedule.version_id == payload.version_id,
        Schedule.group_id == payload.group_id,
        Schedule.day_of_week == payload.source_day_of_week,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", payload.source_week_type)),
        or_(Schedule.effective_from.is_(None), Schedule.effective_from <= current_monday),
        or_(Schedule.effective_until.is_(None), Schedule.effective_until >= current_monday),
    )
    source_lessons = (await db.scalars(stmt)).all()
    if not source_lessons:
        raise HTTPException(404, "На вихідному дні немає занять")

    # Check that target day slots do not conflict
    for l in source_lessons:
        conflict = await conflicting_lesson(
            db,
            group_id=payload.group_id,
            day_of_week=payload.target_day_of_week,
            lesson_number=l.lesson_number,
            week_type=payload.target_week_type,
            teacher_id=l.teacher_id,
            second_teacher_id=l.second_teacher_id,
            subject_id=l.subject_id,
            version_id=payload.version_id,
            exclude_id=l.id if payload.action == "move" else None,
            effective_date=current_monday,
        )
        if conflict:
            d_name = DAY_NAMES.get(payload.target_day_of_week, str(payload.target_day_of_week))
            raise HTTPException(409, f"Конфлікт на {d_name} (#{l.lesson_number} пара): слот зайнятий.")

    for l in source_lessons:
        if payload.action == "move":
            if l.effective_from is None or l.effective_from < current_monday:
                l.effective_until = current_monday - timedelta(days=1)
            else:
                l.is_active = False

        new_item = Schedule(
            version_id=payload.version_id,
            group_id=payload.group_id,
            subject_id=l.subject_id,
            teacher_id=l.teacher_id,
            second_teacher_id=l.second_teacher_id,
            day_of_week=payload.target_day_of_week,
            lesson_number=l.lesson_number,
            week_type=payload.target_week_type,
            room_override=l.room_override,
            effective_from=current_monday,
            is_active=True,
        )
        db.add(new_item)

    await db.commit()
    affected = await find_affected_dates(db, payload.group_id, current_monday)
    return {"status": "ok", "action": payload.action, "count": len(source_lessons), "affected_dates": affected}
