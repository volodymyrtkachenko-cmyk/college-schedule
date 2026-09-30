from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Curriculum, Group, Subject, Teacher
from app.schemas.curriculum import CurriculumCreate, CurriculumUpdate, CurriculumResponse
from app.security import get_current_admin_user

router = APIRouter(prefix="/api/curriculums", tags=["Curriculums"])

@router.get("/", response_model=list[CurriculumResponse])
async def list_curriculums(
    group_id: int = None,
    teacher_id: int = None,
    db: AsyncSession = Depends(get_db),
    admin=Depends(get_current_admin_user)
):
    query = select(Curriculum).options(
        selectinload(Curriculum.group),
        selectinload(Curriculum.subject),
        selectinload(Curriculum.teacher),
        selectinload(Curriculum.second_teacher),
    )
    if group_id:
        query = query.where(Curriculum.group_id == group_id)
    if teacher_id:
        query = query.where((Curriculum.teacher_id == teacher_id) | (Curriculum.second_teacher_id == teacher_id))
    
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/", response_model=CurriculumResponse)
async def create_curriculum(
    payload: CurriculumCreate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(get_current_admin_user)
):
    # Verify relations exist
    for model, id_val, name in [
        (Group, payload.group_id, "Group"),
        (Subject, payload.subject_id, "Subject"),
        (Teacher, payload.teacher_id, "Teacher"),
    ]:
        if not await db.get(model, id_val):
            raise HTTPException(status_code=400, detail=f"{name} with id {id_val} does not exist.")
            
    if payload.second_teacher_id:
        if not await db.get(Teacher, payload.second_teacher_id):
            raise HTTPException(status_code=400, detail=f"Second Teacher with id {payload.second_teacher_id} does not exist.")

    if payload.is_stream and not payload.stream_id:
        # Generate stream_id
        payload.stream_id = f"stream_{payload.subject_id}_{payload.teacher_id}"
        
    db_item = Curriculum(**payload.model_dump())
    db.add(db_item)
    await db.commit()
    await db.refresh(db_item)
    
    # Reload with relations for response
    query = select(Curriculum).options(
        selectinload(Curriculum.group),
        selectinload(Curriculum.subject),
        selectinload(Curriculum.teacher),
        selectinload(Curriculum.second_teacher),
    ).where(Curriculum.id == db_item.id)
    
    res = await db.execute(query)
    return res.scalars().first()

@router.patch("/{id}", response_model=CurriculumResponse)
async def update_curriculum(
    id: int, 
    payload: CurriculumUpdate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(get_current_admin_user)
):
    db_item = await db.get(Curriculum, id)
    if not db_item:
        raise HTTPException(status_code=404, detail="Curriculum not found")
        
    update_data = payload.model_dump(exclude_unset=True)
    
    # Perform cross-checks if only one teacher field is updated
    new_t = update_data.get("teacher_id", db_item.teacher_id)
    new_st = update_data.get("second_teacher_id", db_item.second_teacher_id)
    
    if new_st and new_t == new_st:
        raise HTTPException(status_code=400, detail="Вчитель та другий вчитель не можуть бути однією особою")

    for key, value in update_data.items():
        setattr(db_item, key, value)
        
    # Re-evaluate stream_id logic
    if "is_stream" in update_data:
        if db_item.is_stream and not db_item.stream_id:
            db_item.stream_id = f"stream_{db_item.subject_id}_{db_item.teacher_id}"
        elif not db_item.is_stream:
            db_item.stream_id = None
            
    await db.commit()
    await db.refresh(db_item)
    
    query = select(Curriculum).options(
        selectinload(Curriculum.group),
        selectinload(Curriculum.subject),
        selectinload(Curriculum.teacher),
        selectinload(Curriculum.second_teacher),
    ).where(Curriculum.id == db_item.id)
    
    res = await db.execute(query)
    return res.scalars().first()

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_curriculum(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(get_current_admin_user)
):
    db_item = await db.get(Curriculum, id)
    if not db_item:
        raise HTTPException(status_code=404, detail="Curriculum not found")
    await db.delete(db_item)
    await db.commit()
    return None
