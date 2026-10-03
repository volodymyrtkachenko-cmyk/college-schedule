from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, and_, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ScheduleDraft, ScheduleSlot, Curriculum, Schedule, Group, Subject, Teacher
from app.schemas.draft import ScheduleDraftResponse, ScheduleSlotResponse, SlotMoveRequest
from app.core.security import require_roles
from app.services.settings import settings_service
from app.services.week import get_week_type
from datetime import datetime as _dt

router = APIRouter(prefix="/drafts", tags=["Drafts"])

@router.get("/", response_model=list[ScheduleDraftResponse])
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    query = select(ScheduleDraft).order_by(ScheduleDraft.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{id}", response_model=ScheduleDraftResponse)
async def get_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    await db.execute(delete(ScheduleSlot).where(ScheduleSlot.draft_id == id))
    await db.delete(draft)
    await db.commit()
    return None

@router.get("/{id}/substitutions")
async def list_draft_substitutions(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    """Заміни та скасовані пари, знайдені імпортом (зберігаються в draft.data, не в слотах)."""
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    data = draft.data or {}
    subs = data.get("substitutions", [])
    cancelled = data.get("cancelled", [])
    if not subs and not cancelled:
        return []

    semester_start = await settings_service.get_semester_start(db)
    groups = {g.id: g.name for g in (await db.scalars(select(Group))).all()}
    subjects = {s.id: s.name for s in (await db.scalars(select(Subject))).all()}
    teachers = {t.id: t.name for t in (await db.scalars(select(Teacher))).all()}

    def to_date(value):
        return _dt.strptime(value, "%Y-%m-%d").date() if isinstance(value, str) else value

    result = []
    for item in subs:
        d = to_date(item["date"])
        result.append({
            "kind": "substitution",
            "date": d.isoformat(),
            "day_of_week": d.isoweekday(),
            "week_type": get_week_type(d, semester_start),
            "lesson_number": item["lesson_number"],
            "group_id": item["group_id"],
            "group_name": groups.get(item["group_id"]),
            "subject_name": subjects.get(item["subject_id"]),
            "teacher_name": " / ".join(
                t for t in (teachers.get(item.get("teacher_id")), teachers.get(item.get("second_teacher_id"))) if t
            ) or None,
            "room": item.get("room"),
            "teacher_id": item.get("teacher_id"),
            "second_teacher_id": item.get("second_teacher_id"),
        })
    for item in cancelled:
        d = to_date(item["date"])
        result.append({
            "kind": "cancelled",
            "date": d.isoformat(),
            "day_of_week": d.isoweekday(),
            "week_type": get_week_type(d, semester_start),
            "lesson_number": item["lesson_number"],
            "group_id": item["group_id"],
            "group_name": groups.get(item["group_id"]),
            "subject_name": None,
            "teacher_name": None,
            "room": None,
            "teacher_id": None,
            "second_teacher_id": None,
        })
    result.sort(key=lambda x: (x["date"], x["lesson_number"], x["group_name"] or ""))
    return result

@router.get("/{id}/slots", response_model=list[ScheduleSlotResponse])
async def list_draft_slots(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    query = (
        select(ScheduleSlot)
        .where(ScheduleSlot.draft_id == id)
        .options(
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.group),
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.subject),
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.teacher),
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.second_teacher)
        )
    )
    res = await db.execute(query)
    return res.scalars().all()

@router.patch("/slots/{slot_id}", response_model=ScheduleSlotResponse)
async def move_slot(
    slot_id: int,
    payload: SlotMoveRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    slot = await db.get(ScheduleSlot, slot_id, options=[selectinload(ScheduleSlot.curriculum)])
    if not slot:
        raise HTTPException(404, "Slot not found")
        
    c = slot.curriculum
    # Check for conflicts in the same draft at the target time
    # Week type overlap: if moving to 'numerator', check 'both' or 'numerator'.
    # If moving to 'both', check any.
    week_overlap = ["both", payload.week_type] if payload.week_type != "both" else ["numerator", "denominator", "both"]
    
    conflict_query = (
        select(ScheduleSlot)
        .join(Curriculum)
        .where(
            ScheduleSlot.draft_id == slot.draft_id,
            ScheduleSlot.id != slot_id,
            ScheduleSlot.day_of_week == payload.day_of_week,
            ScheduleSlot.lesson_number == payload.lesson_number,
            ScheduleSlot.week_type.in_(week_overlap),
            or_(
                Curriculum.group_id == c.group_id,
                Curriculum.teacher_id == c.teacher_id,
                and_(c.second_teacher_id != None, Curriculum.teacher_id == c.second_teacher_id),
                and_(Curriculum.second_teacher_id != None, Curriculum.second_teacher_id == c.teacher_id),
                and_(c.second_teacher_id != None, Curriculum.second_teacher_id != None, Curriculum.second_teacher_id == c.second_teacher_id)
            )
        )
    )
    conflicts = (await db.scalars(conflict_query)).all()
    if conflicts:
        raise HTTPException(status_code=409, detail="Переміщення створює накладку для групи або викладача")
        
    slot.day_of_week = payload.day_of_week
    slot.lesson_number = payload.lesson_number
    slot.week_type = payload.week_type
    
    await db.commit()
    await db.refresh(slot, ["curriculum"])
    
    # Needs full join reloading for response
    refreshed = (await db.execute(
        select(ScheduleSlot)
        .where(ScheduleSlot.id == slot.id)
        .options(
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.group),
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.subject),
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.teacher),
            selectinload(ScheduleSlot.curriculum).selectinload(Curriculum.second_teacher)
        )
    )).scalars().first()
    return refreshed

@router.post("/{id}/publish")
async def publish_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
        
    if draft.status in ("GENERATING", "FAILED", "INFEASIBLE", "TIMEOUT"):
        raise HTTPException(status_code=400, detail="Цей розклад ще не готовий або не був успішно створений, тому його не можна опублікувати.")
    slot_count = await db.scalar(select(func.count()).select_from(ScheduleSlot).where(ScheduleSlot.draft_id == id))
    if not slot_count:
        raise HTTPException(
            status_code=400,
            detail="У цьому розкладі немає жодного заняття. Публікація стерла б поточний розклад, тому її заблоковано.",
        )

    # Mark old published as archived
    await db.execute(update(ScheduleDraft).where(ScheduleDraft.status == "published").values(status="archived"))
    
    # Delete ALL current schedules
    await db.execute(delete(Schedule))
    
    # Insert new schedules from slots
    slots = (await db.scalars(
        select(ScheduleSlot)
        .where(ScheduleSlot.draft_id == id)
        .options(selectinload(ScheduleSlot.curriculum))
    )).all()
    
    new_schedules = []
    for s in slots:
        c = s.curriculum
        new_schedules.append(
            Schedule(
                group_id=c.group_id,
                subject_id=c.subject_id,
                teacher_id=c.teacher_id,
                second_teacher_id=c.second_teacher_id,
                stream_id=c.stream_id if c.is_stream else None,
                day_of_week=s.day_of_week,
                lesson_number=s.lesson_number,
                week_type=s.week_type,
                room_override=s.room_override,
                is_active=True
            )
        )
    
    if new_schedules:
        db.add_all(new_schedules)
        await db.flush()
        
    # Process substitutions if draft.data exists
    if draft.data:
        from app.models.entities import SchedulePeriod, SchedulePeriodSlot, ScheduleOverride
        from datetime import datetime
        substitutions = draft.data.get("substitutions", [])
        cancelled_lessons = draft.data.get("cancelled", [])
        
        # 0. Wipe old imported substitutions
        await db.execute(delete(SchedulePeriodSlot).where(SchedulePeriodSlot.source == "import"))
        # Also wipe cancelled overrides? We can wipe all ScheduleOverride because we just deleted Schedule anyway!
        # wait! `delete(Schedule)` cascades to `ScheduleOverride`? If it does, they are already wiped!
        
        # 1. Process Substitutions
        for sub in substitutions:
            d_str = sub["date"]
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date() if isinstance(d_str, str) else d_str
            
            # Find/Create period
            stmt_p = select(SchedulePeriod).where(
                SchedulePeriod.start_date == d_obj,
                SchedulePeriod.end_date == d_obj,
                SchedulePeriod.period_type == "substitution"
            )
            period = await db.scalar(stmt_p)
            if not period:
                period = SchedulePeriod(name=f"Заміни на {d_obj.strftime('%d.%m.%Y')}", period_type="substitution", start_date=d_obj, end_date=d_obj)
                db.add(period)
                await db.flush()
                
            # Upsert SchedulePeriodSlot
            stmt_slot = select(SchedulePeriodSlot).where(
                SchedulePeriodSlot.period_id == period.id,
                SchedulePeriodSlot.group_id == sub["group_id"],
                SchedulePeriodSlot.lesson_number == sub["lesson_number"]
            )
            slot = await db.scalar(stmt_slot)
            if slot:
                if slot.source == "import":
                    slot.subject_id = sub["subject_id"]
                    slot.teacher_id = sub["teacher_id"] or 1
                    slot.second_teacher_id = sub.get("second_teacher_id")
                    slot.room_override = sub["room"]
            else:
                slot = SchedulePeriodSlot(
                    period_id=period.id,
                    group_id=sub["group_id"],
                    subject_id=sub["subject_id"],
                    teacher_id=sub["teacher_id"] or 1,
                    second_teacher_id=sub.get("second_teacher_id"),
                    day_of_week=d_obj.isoweekday(),
                    lesson_number=sub["lesson_number"],
                    room_override=sub["room"],
                    source="import"
                )
                db.add(slot)
                
            # Create override to hide base class if exists
            stmt_s = select(Schedule).where(
                Schedule.group_id == sub["group_id"],
                Schedule.day_of_week == d_obj.isoweekday(),
                Schedule.lesson_number == sub["lesson_number"],
                Schedule.is_active == True
            )
            base_schedules = (await db.scalars(stmt_s)).all()
            for sch in base_schedules:
                override_chk = select(ScheduleOverride).where(
                    ScheduleOverride.schedule_id == sch.id,
                    ScheduleOverride.date == d_obj
                )
                if not await db.scalar(override_chk):
                    db.add(ScheduleOverride(schedule_id=sch.id, date=d_obj, cancelled=True))
                    
        # 2. Process Cancelled lessons
        for canc in cancelled_lessons:
            d_str = canc["date"]
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date() if isinstance(d_str, str) else d_str
            stmt_s = select(Schedule).where(
                Schedule.group_id == canc["group_id"],
                Schedule.day_of_week == d_obj.isoweekday(),
                Schedule.lesson_number == canc["lesson_number"],
                Schedule.is_active == True
            )
            base_schedules = (await db.scalars(stmt_s)).all()
            for sch in base_schedules:
                override_chk = select(ScheduleOverride).where(
                    ScheduleOverride.schedule_id == sch.id,
                    ScheduleOverride.date == d_obj
                )
                if not await db.scalar(override_chk):
                    db.add(ScheduleOverride(schedule_id=sch.id, date=d_obj, cancelled=True))
        
    draft.status = "published"
    await db.commit()
    
    return {"message": "Розклад успішно опубліковано"}
