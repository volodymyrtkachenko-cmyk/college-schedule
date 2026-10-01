from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import require_roles
from app.database import get_db
from app.models import (
    Group,
    Schedule,
    SchedulePeriod,
    SchedulePeriodSlot,
    Subject,
    Teacher,
    TeacherConstraint,
)
from app.schemas.schedule_period import SchedulePeriodCreate, SchedulePeriodResponse

router = APIRouter(prefix="/calendar-periods", tags=["Calendar periods"])


def _period_options():
    return (
        selectinload(SchedulePeriod.groups),
        selectinload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.group),
        selectinload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.subject),
        selectinload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.teacher),
        selectinload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.second_teacher),
    )


async def _get_period(db: AsyncSession, period_id: int) -> SchedulePeriod:
    period = await db.scalar(
        select(SchedulePeriod)
        .where(SchedulePeriod.id == period_id)
        .options(*_period_options())
    )
    if period is None:
        raise HTTPException(status_code=404, detail="Період не знайдено")
    return period


def _teacher_ids(slot: SchedulePeriodSlot | object) -> set[int]:
    return {
        teacher_id
        for teacher_id in (
            getattr(slot, "teacher_id", None),
            getattr(slot, "second_teacher_id", None),
        )
        if teacher_id is not None
    }


def _same_shared_class(left, right) -> bool:
    return (
        left.subject_id == right.subject_id
        and left.teacher_id == right.teacher_id
        and left.second_teacher_id == right.second_teacher_id
    )


async def _validate_references(db: AsyncSession, payload: SchedulePeriodCreate) -> list[Group]:
    groups = (
        await db.scalars(select(Group).where(Group.id.in_(payload.group_ids), Group.is_active.is_(True)))
    ).all()
    if len(groups) != len(payload.group_ids):
        raise HTTPException(status_code=400, detail="Одна або кілька вибраних груп не існують або неактивні")
    if payload.period_type == "holiday":
        return list(groups)

    subject_ids = {slot.subject_id for slot in payload.slots}
    subjects = (
        await db.scalars(select(Subject).where(Subject.id.in_(subject_ids), Subject.is_active.is_(True)))
    ).all()
    if len(subjects) != len(subject_ids):
        raise HTTPException(status_code=400, detail="Один або кілька предметів не існують або неактивні")

    teacher_ids = {
        teacher_id
        for slot in payload.slots
        for teacher_id in (slot.teacher_id, slot.second_teacher_id)
        if teacher_id is not None
    }
    teachers = (
        await db.scalars(select(Teacher).where(Teacher.id.in_(teacher_ids), Teacher.is_active.is_(True)))
    ).all()
    if len(teachers) != len(teacher_ids):
        raise HTTPException(status_code=400, detail="Один або кілька викладачів не існують або неактивні")
    return list(groups)


async def _validate_conflicts(
    db: AsyncSession,
    payload: SchedulePeriodCreate,
    exclude_period_id: int | None = None,
) -> None:
    if payload.period_type != "practice":
        return

    group_ids = set(payload.group_ids)
    overlapping_periods_query = (
        select(SchedulePeriod)
        .where(
            SchedulePeriod.period_type == "practice",
            SchedulePeriod.start_date <= payload.end_date,
            SchedulePeriod.end_date >= payload.start_date,
        )
        .options(*_period_options())
    )
    if exclude_period_id is not None:
        overlapping_periods_query = overlapping_periods_query.where(SchedulePeriod.id != exclude_period_id)
    existing_periods = (await db.scalars(overlapping_periods_query)).unique().all()

    for period in existing_periods:
        existing_groups = {group.id for group in period.groups}
        if group_ids & existing_groups:
            raise HTTPException(
                status_code=409,
                detail=f"Період практики «{period.name}» уже охоплює одну з вибраних груп у ці дати",
            )

    for index, slot in enumerate(payload.slots):
        moving_teachers = {slot.teacher_id}
        if slot.second_teacher_id:
            moving_teachers.add(slot.second_teacher_id)

        unavailable = await db.scalar(
            select(TeacherConstraint.id).where(
                TeacherConstraint.teacher_id.in_(moving_teachers),
                TeacherConstraint.day_of_week == slot.day_of_week,
                TeacherConstraint.lesson_number == slot.lesson_number,
                TeacherConstraint.is_hard_constraint.is_(True),
            ).limit(1)
        )
        if unavailable is not None:
            raise HTTPException(
                status_code=409,
                detail="Викладач недоступний у вибраний день і час",
            )

        for other in payload.slots[index + 1:]:
            if (slot.day_of_week, slot.lesson_number) != (other.day_of_week, other.lesson_number):
                continue
            other_teachers = {other.teacher_id}
            if other.second_teacher_id:
                other_teachers.add(other.second_teacher_id)
            if moving_teachers & other_teachers and not _same_shared_class(slot, other):
                raise HTTPException(status_code=409, detail="Викладач призначений на дві різні практики в один час")

        for period in existing_periods:
            for other in period.slots:
                if (slot.day_of_week, slot.lesson_number) != (other.day_of_week, other.lesson_number):
                    continue
                if moving_teachers & _teacher_ids(other) and not _same_shared_class(slot, other):
                    raise HTTPException(
                        status_code=409,
                        detail=f"Викладач уже призначений на заняття періоду «{period.name}» у цей час",
                    )

        regular_query = select(Schedule).where(
            Schedule.is_active.is_(True),
            Schedule.day_of_week == slot.day_of_week,
            Schedule.lesson_number == slot.lesson_number,
            Schedule.group_id.not_in(group_ids),
            or_(
                Schedule.teacher_id.in_(moving_teachers),
                Schedule.second_teacher_id.in_(moving_teachers),
            ),
        )
        for regular in (await db.scalars(regular_query)).all():
            if not _same_shared_class(slot, regular):
                raise HTTPException(
                    status_code=409,
                    detail="Викладач уже має звичайне заняття в іншої групи в цей день і час",
                )


async def _save_period(
    db: AsyncSession,
    payload: SchedulePeriodCreate,
    period: SchedulePeriod | None = None,
) -> SchedulePeriod:
    groups = await _validate_references(db, payload)
    await _validate_conflicts(db, payload, period.id if period else None)

    if period is None:
        period = SchedulePeriod()
        db.add(period)
    elif period.slots:
        period.slots.clear()
        await db.flush()

    period.name = payload.name.strip()
    period.period_type = payload.period_type
    period.start_date = payload.start_date
    period.end_date = payload.end_date
    period.groups = groups
    period.slots.extend(
        SchedulePeriodSlot(**slot.model_dump())
        for slot in payload.slots
    )
    await db.commit()
    return await _get_period(db, period.id)


@router.get("/", response_model=list[SchedulePeriodResponse])
async def list_schedule_periods(
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_roles("admin")),
):
    periods = await db.scalars(
        select(SchedulePeriod).options(*_period_options()).order_by(SchedulePeriod.start_date.desc())
    )
    return periods.unique().all()


@router.post("/", response_model=SchedulePeriodResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule_period(
    payload: SchedulePeriodCreate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_roles("admin")),
):
    return await _save_period(db, payload)


@router.put("/{period_id}", response_model=SchedulePeriodResponse)
async def update_schedule_period(
    period_id: int,
    payload: SchedulePeriodCreate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_roles("admin")),
):
    period = await _get_period(db, period_id)
    return await _save_period(db, payload, period)


@router.delete("/{period_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule_period(
    period_id: int,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_roles("admin")),
):
    period = await db.get(SchedulePeriod, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Період не знайдено")
    await db.delete(period)
    await db.commit()
