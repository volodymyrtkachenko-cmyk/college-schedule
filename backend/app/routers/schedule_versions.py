from datetime import date
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError, model_validator
from sqlalchemy import select, insert, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.entities import ScheduleVersion, Schedule, User
from app.core.security import require_roles

router = APIRouter(prefix="/schedule-versions", tags=["Schedule Versions"])
VersionName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]

class ScheduleVersionBase(BaseModel):
    name: VersionName
    valid_from: date
    valid_until: date
    is_active: bool = True

    @model_validator(mode="after")
    def valid_dates(self):
        if self.valid_from > self.valid_until:
            raise ValueError("valid_from must not be after valid_until")
        return self

class ScheduleVersionCreate(ScheduleVersionBase):
    pass

class ScheduleVersionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: VersionName | None = None
    valid_from: date | None = None
    valid_until: date | None = None
    is_active: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value):
        if isinstance(value, dict):
            for key in ("name", "valid_from", "valid_until", "is_active"):
                if key in value and value[key] is None:
                    raise ValueError(f"{key} must not be null")
        return value

class ScheduleVersionResponse(ScheduleVersionBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

async def lock_versions(db: AsyncSession):
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(424243)"))

async def require_no_overlap(db: AsyncSession, data: ScheduleVersionBase, exclude_id=None):
    if not data.is_active:
        return
    query = select(ScheduleVersion.id).where(
        ScheduleVersion.is_active.is_(True),
        ScheduleVersion.valid_from <= data.valid_until,
        ScheduleVersion.valid_until >= data.valid_from,
    )
    if exclude_id is not None:
        query = query.where(ScheduleVersion.id != exclude_id)
    overlap = await db.scalar(query.limit(1))
    if overlap is not None:
        raise HTTPException(409, detail={"code": "active_version_overlap", "version_id": overlap})

async def commit_version_change(db: AsyncSession):
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, detail={"code": "version_constraint_conflict"}) from exc

@router.get("", response_model=list[ScheduleVersionResponse])
async def list_versions(db: AsyncSession = Depends(get_db)):
    return list((await db.scalars(select(ScheduleVersion).order_by(
        ScheduleVersion.valid_from.desc(), ScheduleVersion.id.desc()
    ))).all())

@router.post("", response_model=ScheduleVersionResponse, status_code=201)
async def create_version(data: ScheduleVersionCreate, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_roles("admin"))):
    await lock_versions(db)
    await require_no_overlap(db, data)
    version = ScheduleVersion(**data.model_dump())
    db.add(version)
    await commit_version_change(db)
    await db.refresh(version)
    return version

@router.patch("/{version_id}", response_model=ScheduleVersionResponse)
async def update_version(version_id: int, data: ScheduleVersionUpdate,
                         db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_roles("admin"))):
    await lock_versions(db)
    version = await db.scalar(select(ScheduleVersion).where(
        ScheduleVersion.id == version_id
    ).with_for_update())
    if version is None:
        raise HTTPException(404, "Версію розкладу не знайдено")
    merged = {key: getattr(version, key) for key in ("name", "valid_from", "valid_until", "is_active")}
    merged.update(data.model_dump(exclude_unset=True))
    try:
        validated = ScheduleVersionBase.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(422, detail=exc.errors(include_input=False, include_context=False)) from exc
    await require_no_overlap(db, validated, exclude_id=version.id)
    for key, value in validated.model_dump().items():
        setattr(version, key, value)
    await commit_version_change(db)
    await db.refresh(version)
    return version

@router.delete("/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(version_id: int, db: AsyncSession = Depends(get_db),
                         _: User = Depends(require_roles("admin"))):
    await lock_versions(db)
    version = await db.get(ScheduleVersion, version_id)
    if version is None:
        raise HTTPException(404, "Версію розкладу не знайдено")
    has_rows = await db.scalar(select(func.count()).select_from(Schedule).where(Schedule.version_id == version_id))
    if version.is_active or has_rows:
        raise HTTPException(409, detail={
            "code": "version_delete_requires_data_policy",
            "msg": "Активну або заповнену версію не можна видалити цією операцією. Спочатку деактивуйте її; дані та історія мають зберігатися.",
        })
    await db.delete(version)
    await commit_version_change(db)

@router.post("/{version_id}/clone-from/{source_version_id}")
async def clone_version_schedule(version_id: int, source_version_id: int,
                                 db: AsyncSession = Depends(get_db),
                                 _: User = Depends(require_roles("admin"))):
    if source_version_id < 0:
        raise HTTPException(422, "source_version_id must be non-negative")
    if version_id == source_version_id:
        raise HTTPException(409, detail={"code": "clone_self"})
    await lock_versions(db)
    target = await db.get(ScheduleVersion, version_id)
    if target is None:
        raise HTTPException(404, "Цільову версію розкладу не знайдено")
    if source_version_id != 0 and await db.get(ScheduleVersion, source_version_id) is None:
        raise HTTPException(404, "Версію-джерело не знайдено")
    target_count = await db.scalar(select(func.count()).select_from(Schedule).where(Schedule.version_id == version_id))
    if target_count:
        raise HTTPException(409, detail={
            "code": "clone_target_not_empty",
            "msg": "Ціль містить заняття. Перезапис потребує preview та mapping ручних змін; мовчазне очищення заборонено.",
        })
    source_filter = Schedule.version_id == source_version_id if source_version_id else Schedule.version_id.is_(None)
    rows = list((await db.scalars(select(Schedule).where(source_filter))).all())
    if not rows:
        raise HTTPException(409, detail={"code": "clone_source_empty"})
    fields = ("group_id", "teacher_id", "second_teacher_id", "subject_id", "stream_id",
              "day_of_week", "lesson_number", "week_type", "is_active", "is_replacement", "room_override")
    values = [{**{key: getattr(row, key) for key in fields}, "version_id": version_id} for row in rows]
    await db.execute(insert(Schedule), values)
    await commit_version_change(db)
    return {"status": "cloned", "count": len(values)}

@router.post("/publications/{publication_id}/revert")
async def revert_publication(
    publication_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "editor"))
):
    from app.models.entities import SchedulePublication, SchedulePublicationSnapshot, ImportedScheduleChange, Schedule
    import json
    
    pub = await db.get(SchedulePublication, publication_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Публікацію не знайдено")
    if pub.is_reverted:
        raise HTTPException(status_code=400, detail="Ця публікація вже скасована")
        
    # Mark as reverted
    pub.is_reverted = True
    
    # Revert imported changes
    await db.execute(
        sa.update(ImportedScheduleChange)
        .where(ImportedScheduleChange.publication_id == publication_id)
        .values(is_published=False)
    )
    
    # Revert base schedule
    snapshots = (await db.scalars(
        select(SchedulePublicationSnapshot)
        .where(SchedulePublicationSnapshot.publication_id == publication_id)
    )).all()
    
    if snapshots:
        # We need to delete the current active slots for the groups in the scope and version
        group_ids = [snap.group_id for snap in snapshots]
        await db.execute(
            sa.delete(Schedule)
            .where(
                Schedule.group_id.in_(group_ids),
                Schedule.version_id == pub.version_id
            )
        )
        
        # Restore before_data
        for snap in snapshots:
            before = json.loads(snap.before_data)
            for slot in before.get("slots", []):
                db.add(Schedule(
                    group_id=snap.group_id,
                    day_of_week=slot["day_of_week"],
                    lesson_number=slot["lesson_number"],
                    week_type=slot["week_type"],
                    subject_id=slot.get("subject_id"),
                    teacher_id=slot.get("teacher_id"),
                    room_override=slot.get("room"),
                    version_id=pub.version_id,
                    is_active=True
                ))
    
    await db.commit()
    return {"message": "Публікацію успішно скасовано"}
