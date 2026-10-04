from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, insert, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.entities import ScheduleVersion, Schedule, User
from app.routers.auth import require_admin_or_manager

router = APIRouter(prefix="/schedule-versions", tags=["Schedule Versions"])

class ScheduleVersionBase(BaseModel):
    name: str
    valid_from: date
    valid_until: date
    is_active: bool = True

class ScheduleVersionCreate(ScheduleVersionBase):
    pass

class ScheduleVersionUpdate(BaseModel):
    name: Optional[str] = None
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    is_active: Optional[bool] = None

class ScheduleVersionResponse(ScheduleVersionBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

@router.get("", response_model=List[ScheduleVersionResponse])
async def list_versions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ScheduleVersion).order_by(ScheduleVersion.valid_from.desc()))
    return result.scalars().all()

@router.post("", response_model=ScheduleVersionResponse)
async def create_version(data: ScheduleVersionCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_admin_or_manager)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage schedule versions")
    version = ScheduleVersion(**data.model_dump())
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version

@router.patch("/{version_id}", response_model=ScheduleVersionResponse)
async def update_version(version_id: int, data: ScheduleVersionUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_admin_or_manager)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage schedule versions")
    version = await db.get(ScheduleVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(version, k, v)
        
    await db.commit()
    await db.refresh(version)
    return version

@router.delete("/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(version_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_admin_or_manager)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage schedule versions")
    version = await db.get(ScheduleVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    await db.delete(version)
    await db.commit()

@router.post("/{version_id}/clone-from/{source_version_id}")
async def clone_version_schedule(version_id: int, source_version_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_admin_or_manager)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage schedule versions")
    
    target_version = await db.get(ScheduleVersion, version_id)
    if not target_version:
        raise HTTPException(status_code=404, detail="Target version not found")
        
    # Get all schedules from source (or default if source_version_id is 0)
    source_filter = Schedule.version_id == source_version_id if source_version_id > 0 else Schedule.version_id.is_(None)
    schedules = (await db.scalars(select(Schedule).where(source_filter))).all()
    
    # Delete existing schedules in target to avoid duplicates
    await db.execute(delete(Schedule).where(Schedule.version_id == version_id))
    
    # Insert new
    if schedules:
        new_schedules = []
        for s in schedules:
            new_schedules.append({
                "group_id": s.group_id,
                "teacher_id": s.teacher_id,
                "second_teacher_id": s.second_teacher_id,
                "subject_id": s.subject_id,
                "stream_id": s.stream_id,
                "day_of_week": s.day_of_week,
                "lesson_number": s.lesson_number,
                "week_type": s.week_type,
                "is_active": s.is_active,
                "is_replacement": s.is_replacement,
                "room_override": s.room_override,
                "version_id": version_id
            })
        await db.execute(insert(Schedule).values(new_schedules))
        
    await db.commit()
    return {"status": "cloned", "count": len(schedules)}
