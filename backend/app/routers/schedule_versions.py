from datetime import date, datetime
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError, model_validator
from sqlalchemy import select, insert, update, delete, func, text
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
    user: User = Depends(require_roles("admin", "editor")),
):
    from sqlalchemy.orm import selectinload
    from app.models.entities import (
        SchedulePublication,
        SchedulePublicationSnapshot,
        ImportedScheduleChange,
        Schedule,
    )
    from app.services.notes_reconciliation import reconcile_notes_after_publish
    import json

    await lock_versions(db)
    pub = await db.get(SchedulePublication, publication_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Публікацію не знайдено")
    if pub.is_reverted:
        raise HTTPException(status_code=400, detail="Ця публікація вже скасована")

    # Забороняємо відкат старої публікації, якщо після неї є новіші активні публікації в цій же версії
    newer_active = await db.scalar(
        select(SchedulePublication.id)
        .where(
            SchedulePublication.version_id == pub.version_id
            if pub.version_id is not None
            else SchedulePublication.version_id.is_(None),
            SchedulePublication.is_reverted.is_(False),
            SchedulePublication.id > pub.id,
        )
        .limit(1)
    )
    if newer_active is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Спочатку скасуйте новішу публікацію (#{newer_active}). Відкат можливий лише послідовно.",
        )

    snapshots = (
        await db.scalars(
            select(SchedulePublicationSnapshot).where(
                SchedulePublicationSnapshot.publication_id == publication_id
            )
        )
    ).all()
    group_ids = [snap.group_id for snap in snapshots]

    if user.role == "editor":
        u = await db.scalar(
            select(User).options(selectinload(User.allowed_groups)).where(User.id == user.id)
        )
        allowed = {g.id for g in u.allowed_groups} if u else set()
        if not set(group_ids).issubset(allowed):
            raise HTTPException(status_code=403, detail="Немає доступу до груп цієї публікації")

    pub.is_reverted = True

    await db.execute(
        update(ImportedScheduleChange)
        .where(ImportedScheduleChange.publication_id == publication_id)
        .values(is_published=False)
    )

    slot_snapshots = [s for s in snapshots if s.before_data and '"slots"' in s.before_data]
    if slot_snapshots:
        version_cond = (
            Schedule.version_id == pub.version_id
            if pub.version_id is not None
            else Schedule.version_id.is_(None)
        )
        await db.execute(
            delete(Schedule).where(Schedule.group_id.in_(group_ids), version_cond)
        )

        for snap in slot_snapshots:
            before = json.loads(snap.before_data)
            for slot in before.get("slots", []):
                if not slot.get("subject_id"):
                    continue
                db.add(
                    Schedule(
                        group_id=snap.group_id,
                        day_of_week=slot["day_of_week"],
                        lesson_number=slot["lesson_number"],
                        week_type=slot["week_type"],
                        subject_id=slot["subject_id"],
                        teacher_id=slot.get("teacher_id"),
                        second_teacher_id=slot.get("second_teacher_id"),
                        stream_id=slot.get("stream_id"),
                        is_replacement=slot.get("is_replacement", False),
                        room_override=slot.get("room"),
                        version_id=pub.version_id,
                        is_active=True,
                    )
                )
        await db.flush()
        await reconcile_notes_after_publish(db, set(group_ids), user.id)

    # Dismiss notification if it was for this publication
    try:
        from app.services.settings import settings_service
        notif_raw = await settings_service.get(db, "import_latest_notification")
        if notif_raw:
            notif = json.loads(notif_raw)
            if notif.get("publication_id") == publication_id:
                notif["dismissed"] = True
                await settings_service.set(db, "import_latest_notification", json.dumps(notif))
    except Exception:
        pass

    await db.commit()
    return {"message": "Публікацію успішно скасовано"}

from typing import List

class PublicationResponse(BaseModel):
    id: int
    version_id: int | None
    actor_id: int | None
    timestamp: datetime
    scope_manifest: str
    is_reverted: bool
    source: str = "manual"
    changes_count: int = 0

@router.get("/publications", response_model=List[PublicationResponse])
async def get_publications(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "editor"))
):
    from app.models.entities import SchedulePublication
    import json
    publications = (await db.scalars(
        select(SchedulePublication)
        .order_by(SchedulePublication.timestamp.desc())
        .limit(limit)
    )).all()
    
    result = []
    for p in publications:
        source = "manual"
        changes_count = 0
        try:
            scope = json.loads(p.scope_manifest or "{}")
            source = scope.get("source") or ("auto" if p.actor_id is None else "manual")
            changes_count = int(scope.get("changes_count") or 0)
        except Exception:
            source = "auto" if p.actor_id is None else "manual"
        result.append(
            PublicationResponse(
                id=p.id,
                version_id=p.version_id,
                actor_id=p.actor_id,
                timestamp=p.timestamp,
                scope_manifest=p.scope_manifest,
                is_reverted=p.is_reverted,
                source=source,
                changes_count=changes_count,
            )
        )
    return result

@router.get("/publications/{publication_id}/changes")
async def get_publication_changes(
    publication_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "editor")),
):
    from app.models.entities import (
        SchedulePublication,
        SchedulePublicationSnapshot,
        ImportedScheduleChange,
        Group,
    )
    from sqlalchemy.orm import joinedload
    import json

    pub = await db.get(SchedulePublication, publication_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Публікацію не знайдено")

    snapshots = (await db.scalars(
        select(SchedulePublicationSnapshot)
        .where(SchedulePublicationSnapshot.publication_id == publication_id)
        .order_by(SchedulePublicationSnapshot.date, SchedulePublicationSnapshot.lesson_number)
    )).all()

    groups = {g.id: g.name for g in (await db.scalars(select(Group))).all()}
    changes = []

    for s in snapshots:
        group_name = groups.get(s.group_id, f"Група #{s.group_id}")
        before_obj = json.loads(s.before_data or "{}")
        after_obj = json.loads(s.after_data or "{}")

        if s.date is not None:
            changes.append({
                "group_id": s.group_id,
                "group_name": group_name,
                "date": s.date.isoformat(),
                "lesson_number": s.lesson_number,
                "kind": after_obj.get("kind", "substitution"),
                "before": before_obj.get("summary") or before_obj.get("text") or "—",
                "after": after_obj.get("summary") or after_obj.get("text") or "—",
            })
        elif "slots" in before_obj or "slots" in after_obj:
            b_slots = before_obj.get("slots", [])
            a_slots = after_obj.get("slots", [])
            changes.append({
                "group_id": s.group_id,
                "group_name": group_name,
                "date": None,
                "lesson_number": None,
                "kind": "base_slots",
                "before": f"{len(b_slots)} пар у базовому розкладі",
                "after": f"{len(a_slots)} пар у новому розкладі",
            })

    if not changes:
        # Fallback to ImportedScheduleChange
        import_changes = (await db.scalars(
            select(ImportedScheduleChange)
            .where(ImportedScheduleChange.publication_id == publication_id)
            .options(
                joinedload(ImportedScheduleChange.subject),
                joinedload(ImportedScheduleChange.teacher),
            )
            .order_by(ImportedScheduleChange.date, ImportedScheduleChange.lesson_number)
        )).all()
        for ic in import_changes:
            group_name = groups.get(ic.group_id, f"Група #{ic.group_id}")
            subj_name = ic.subject.name if ic.subject else ""
            teach_name = ic.teacher.name if ic.teacher else ""
            room_str = f", ауд. {ic.room_override}" if ic.room_override else ""
            after_str = "Скасовано" if ic.kind == "cancelled" else f"{subj_name} ({teach_name}{room_str})".strip()
            changes.append({
                "group_id": ic.group_id,
                "group_name": group_name,
                "date": ic.date.isoformat(),
                "lesson_number": ic.lesson_number,
                "kind": ic.kind,
                "before": "Базовий розклад",
                "after": after_str,
            })

    return changes
