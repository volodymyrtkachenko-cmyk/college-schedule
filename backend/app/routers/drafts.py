from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, and_
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ScheduleDraft, ScheduleSlot, Curriculum, Schedule
from app.schemas.draft import ScheduleDraftResponse, ScheduleSlotResponse, SlotMoveRequest
from app.core.security import require_roles

router = APIRouter(prefix="/drafts", tags=["Drafts"])

@router.get("/", response_model=list[ScheduleDraftResponse])
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    query = select(ScheduleDraft).order_by(ScheduleDraft.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    await db.delete(draft)
    await db.commit()
    return None

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
        raise HTTPException(code=404, detail="Draft not found")
        
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
                day_of_week=s.day_of_week,
                lesson_number=s.lesson_number,
                week_type=s.week_type,
                room_override=s.room_override,
                is_active=True
            )
        )
    
    if new_schedules:
        db.add_all(new_schedules)
        
    draft.status = "published"
    await db.commit()
    
    return {"message": "Розклад успішно опубліковано"}
