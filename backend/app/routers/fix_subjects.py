from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.database import get_db
from app.models import Schedule, Subject, Group

router = APIRouter()

@router.get("/fix-subjects")
async def fix_subjects(db: AsyncSession = Depends(get_db)):
    # 1. Get all involved subjects
    subjects = await db.scalars(select(Subject))
    sub_map = {s.name: s.id for s in subjects}
    
    eng_old = sub_map.get("Іноземна мова")
    eng_new = sub_map.get("Іноземна мова (за професійним спрямуванням)")
    
    ukr_old = sub_map.get("Українська мова")
    ukr_new = sub_map.get("Українська мова (за професійним спрямуванням)")
    
    if not all([eng_old, eng_new, ukr_old, ukr_new]):
        return {"error": "Some subjects not found in DB"}
        
    # 2. Get target group IDs
    target_names = [str(i) for i in range(75, 87)]
    groups = await db.scalars(select(Group).where(Group.name.in_(target_names)))
    group_ids = [g.id for g in groups]
    
    # 3. Update 'Іноземна мова'
    res_eng = await db.execute(
        update(Schedule)
        .where(Schedule.group_id.in_(group_ids), Schedule.subject_id == eng_old)
        .values(subject_id=eng_new)
    )
    
    # 4. Update 'Українська мова'
    res_ukr = await db.execute(
        update(Schedule)
        .where(Schedule.group_id.in_(group_ids), Schedule.subject_id == ukr_old)
        .values(subject_id=ukr_new)
    )
    
    await db.commit()
    
    return {
        "message": "Success",
        "groups_affected": len(group_ids),
        "english_updates": res_eng.rowcount,
        "ukrainian_updates": res_ukr.rowcount
    }
