from fastapi import APIRouter, Depends, HTTPException, status
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Curriculum, Group, Subject, Teacher
from app.schemas.curriculum import CurriculumCreate, CurriculumUpdate, CurriculumResponse
from app.core.security import require_roles

router = APIRouter(prefix="/curriculums", tags=["Curriculums"])


async def _validate_stream_membership(
    db: AsyncSession,
    *,
    stream_id: str | None,
    subject_id: int,
    teacher_id: int,
    second_teacher_id: int | None,
    exclude_id: int | None = None,
) -> None:
    if not stream_id:
        return
    query = select(Curriculum).where(
        Curriculum.stream_id == stream_id,
        Curriculum.is_stream.is_(True),
    )
    if exclude_id is not None:
        query = query.where(Curriculum.id != exclude_id)
    members = (await db.scalars(query)).all()
    if any(
        (item.subject_id, item.teacher_id, item.second_teacher_id)
        != (subject_id, teacher_id, second_teacher_id)
        for item in members
    ):
        raise HTTPException(
            status_code=409,
            detail="У потоці можуть бути лише записи з однаковими предметом і викладачами",
        )


@router.get("/", response_model=list[CurriculumResponse])
async def list_curriculums(
    group_id: int = None,
    teacher_id: int = None,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles('admin'))
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
    admin=Depends(require_roles('admin'))
):
    # Verify active relations and prevent duplicate assignments.
    for model, id_val, name in [
        (Group, payload.group_id, "Group"),
        (Subject, payload.subject_id, "Subject"),
        (Teacher, payload.teacher_id, "Teacher"),
    ]:
        entity = await db.get(model, id_val)
        if entity is None or not entity.is_active:
            raise HTTPException(status_code=400, detail=f"{name} with id {id_val} does not exist.")
            
    if payload.second_teacher_id:
        second = await db.get(Teacher, payload.second_teacher_id)
        if second is None or not second.is_active:
            raise HTTPException(status_code=400, detail=f"Second Teacher with id {payload.second_teacher_id} does not exist.")
    if payload.is_stream:
        payload.stream_id = payload.stream_id or f"stream_{uuid4().hex}"
    else:
        payload.stream_id = None
    duplicate = await db.scalar(select(Curriculum).where(
        Curriculum.group_id == payload.group_id,
        Curriculum.subject_id == payload.subject_id,
        Curriculum.teacher_id == payload.teacher_id,
        Curriculum.second_teacher_id == payload.second_teacher_id,
        Curriculum.is_stream.is_(payload.is_stream),
        Curriculum.stream_id == payload.stream_id,
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="Таке навантаження вже існує")
    await _validate_stream_membership(
        db,
        stream_id=payload.stream_id,
        subject_id=payload.subject_id,
        teacher_id=payload.teacher_id,
        second_teacher_id=payload.second_teacher_id,
    )
        
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
    admin=Depends(require_roles('admin'))
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

    stream_fields_changed = any(
        key in update_data and update_data[key] != getattr(db_item, key)
        for key in ("group_id", "subject_id", "teacher_id", "second_teacher_id")
    )
    for key, value in update_data.items():
        setattr(db_item, key, value)
        
    if not db_item.is_stream:
        db_item.stream_id = None
    elif stream_fields_changed or not db_item.stream_id:
        db_item.stream_id = f"stream_{uuid4().hex}"
    elif "stream_id" in update_data:
        db_item.stream_id = update_data["stream_id"] or f"stream_{uuid4().hex}"

    await _validate_stream_membership(
        db,
        stream_id=db_item.stream_id,
        subject_id=db_item.subject_id,
        teacher_id=db_item.teacher_id,
        second_teacher_id=db_item.second_teacher_id,
        exclude_id=db_item.id,
    )
            
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
    admin=Depends(require_roles('admin'))
):
    db_item = await db.get(Curriculum, id)
    if not db_item:
        raise HTTPException(status_code=404, detail="Curriculum not found")
    await db.delete(db_item)
    await db.commit()
    return None
