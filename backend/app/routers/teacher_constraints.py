from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import TeacherConstraint, Teacher
from app.schemas.constraint import TeacherConstraintCreate, TeacherConstraintUpdate, TeacherConstraintResponse
from app.core.security import require_roles

router = APIRouter(prefix="/teacher-constraints", tags=["Teacher Constraints"])

@router.get("/", response_model=list[TeacherConstraintResponse])
async def list_constraints(
    teacher_id: int = None,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    query = select(TeacherConstraint).options(
        selectinload(TeacherConstraint.teacher)
    )
    if teacher_id:
        query = query.where(TeacherConstraint.teacher_id == teacher_id)
    
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/", response_model=TeacherConstraintResponse)
async def create_constraint(
    payload: TeacherConstraintCreate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    teacher = await db.get(Teacher, payload.teacher_id)
    if not teacher or not teacher.is_active:
        raise HTTPException(status_code=400, detail="Teacher not found")
    duplicate = await db.scalar(select(TeacherConstraint).where(
        TeacherConstraint.teacher_id == payload.teacher_id,
        TeacherConstraint.day_of_week == payload.day_of_week,
        TeacherConstraint.lesson_number == payload.lesson_number,
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="Це обмеження для викладача вже існує")
        
    db_item = TeacherConstraint(**payload.model_dump())
    db.add(db_item)
    await db.commit()
    await db.refresh(db_item)
    
    query = select(TeacherConstraint).options(
        selectinload(TeacherConstraint.teacher)
    ).where(TeacherConstraint.id == db_item.id)
    res = await db.execute(query)
    return res.scalars().first()

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_constraint(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    db_item = await db.get(TeacherConstraint, id)
    if not db_item:
        raise HTTPException(status_code=404, detail="Constraint not found")
    await db.delete(db_item)
    await db.commit()
    return None
