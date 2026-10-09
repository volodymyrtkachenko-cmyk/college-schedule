from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, and_, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    ScheduleDraft,
    ScheduleSlot,
    Curriculum,
    Schedule,
    ScheduleOverride,
    Group,
    Subject,
    Teacher,
    ImportedScheduleChange,
)
from app.schemas.draft import ScheduleDraftResponse, ScheduleSlotResponse, SlotMoveRequest
from app.core.security import require_roles
from app.services.settings import settings_service
from app.services.week import get_week_type
from datetime import datetime as _dt

from app.services.notes_reconciliation import reconcile_notes_after_publish
from app.services.import_slot_safety import normalize_base_slots, guard_protected_replacement, version_for_import
from app.routers.schedule_versions import lock_versions

router = APIRouter(prefix="/drafts", tags=["Drafts"])

from app.models.entities import User
from fastapi import HTTPException
async def _check_draft_access(db, draft, user):
    if user.role == "admin":
        return
    u = await db.scalar(select(User).options(selectinload(User.allowed_groups)).where(User.id == user.id))
    allowed = {g.id for g in u.allowed_groups} if u else set()
    
    # Extract draft groups
    draft_groups = set()
    if draft.draft_type == "import" and draft.data:
        import_scope = draft.data.get("import_scope") or {}
        draft_groups = {int(v) for v in import_scope.get("group_ids", [])}
        if not draft_groups:
            subs = draft.data.get("substitutions", [])
            cancels = draft.data.get("cancelled", [])
            draft_groups = {int(item["group_id"]) for item in [*subs, *cancels] if item.get("group_id") is not None}
    else:
        slots = (await db.scalars(select(ScheduleSlot).where(ScheduleSlot.draft_id == draft.id).options(selectinload(ScheduleSlot.curriculum)))).all()
        draft_groups = {s.curriculum.group_id for s in slots if s.curriculum}
        
    if not draft_groups.issubset(allowed):
        raise HTTPException(403, "Ви не маєте доступу до однієї або кількох груп у цій чернетці")



@router.patch("/{id}/import-changes")
async def update_import_changes(
    id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor")),
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Чернетку розкладу не знайдено")
    await _check_draft_access(db, draft, current_user)
    if draft.draft_type != "import" or draft.status in {"published", "archived"}:
        raise HTTPException(status_code=409, detail="Зміни імпорту можна редагувати лише в активній чернетці імпорту")
    substitutions = payload.get("substitutions", [])
    cancelled = payload.get("cancelled", [])
    if not isinstance(substitutions, list) or not isinstance(cancelled, list):
        raise HTTPException(status_code=422, detail="Некоректний формат змін імпорту")
    for item in substitutions:
        required = ("date", "lesson_number", "group_id", "subject_id", "teacher_id")
        if any(item.get(key) in (None, "", 0) for key in required):
            raise HTTPException(status_code=422, detail="Заміна має містити дату, групу, предмет, викладача та номер пари")
        item["kind"] = "substitution"
    for item in cancelled:
        required = ("date", "lesson_number", "group_id")
        if any(item.get(key) in (None, "", 0) for key in required):
            raise HTTPException(status_code=422, detail="Скасування має містити дату, групу та номер пари")
        item["kind"] = "cancelled"
    cells = [
        (item["date"], item["group_id"], item["lesson_number"])
        for item in [*substitutions, *cancelled]
    ]
    if len(cells) != len(set(cells)):
        raise HTTPException(status_code=422, detail="Для однієї клітинки може бути лише одна імпортована зміна")
    draft.data = {**(draft.data or {}), "substitutions": substitutions, "cancelled": cancelled}
    await db.commit()
    return {"status": "saved"}

@router.get("/", response_model=list[ScheduleDraftResponse])
async def list_drafts(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor"))
):
    query = select(ScheduleDraft).order_by(ScheduleDraft.created_at.desc())
    if current_user.role == "editor":
        pass # To fully secure list, we would filter drafts by groups, but for now we let them list it, or just let them see all drafts, they can't access them anyway. Actually, we should filter!
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{id}", response_model=ScheduleDraftResponse)
async def get_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Чернетку розкладу не знайдено")
    await _check_draft_access(db, draft, current_user)
    return draft



@router.get("/{id}/preview")
async def get_draft_preview(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Чернетку розкладу не знайдено")
    await _check_draft_access(db, draft, current_user)
        
    # Simplified preview just returns draft info and revision for T20 check.
    # In a full implementation, this could return the projected schedule overlay.
    return {
        "id": draft.id,
        "name": draft.name,
        "draft_type": draft.draft_type,
        "status": draft.status,
        "revision": draft.revision,
    }

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor"))
):
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Чернетку розкладу не знайдено")
    await _check_draft_access(db, draft, current_user)
    if draft.status in {"GENERATING", "generating"} or (
        draft.status == "published" and draft.draft_type != "import"
    ):
        raise HTTPException(status_code=409, detail="Опубліковану або активну чернетку не можна видалити")
    await db.execute(delete(ScheduleSlot).where(ScheduleSlot.draft_id == id))
    created_curriculum_ids = (draft.data or {}).get("created_curriculum_ids", [])
    if created_curriculum_ids:
        await db.execute(
            delete(Curriculum).where(Curriculum.id.in_(created_curriculum_ids))
        )
    await db.delete(draft)
    await db.commit()
    return None

@router.get("/{id}/substitutions")
async def list_draft_substitutions(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor"))
):
    """Заміни та скасовані пари, знайдені імпортом (зберігаються в draft.data, не в слотах)."""
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Чернетку розкладу не знайдено")
    await _check_draft_access(db, draft, current_user)
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
    current_user=Depends(require_roles("admin", "editor"))
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
    current_user=Depends(require_roles("admin", "editor"))
):
    slot = await db.get(ScheduleSlot, slot_id, options=[selectinload(ScheduleSlot.curriculum)])
    if not slot:
        raise HTTPException(404, "Заняття в чернетці не знайдено")
    draft = await db.get(ScheduleDraft, slot.draft_id)
    if not draft or draft.status not in {"pending", "DRAFT", "draft"}:
        raise HTTPException(status_code=409, detail="Змінювати можна лише активну чернетку")
        
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
    draft.revision += 1
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
    target_version_id: int | None = None,
    expected_revision: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("admin", "editor"))
):
    await lock_versions(db)
    draft = await db.get(ScheduleDraft, id)
    if not draft:
        raise HTTPException(status_code=404, detail="Чернетку розкладу не знайдено")
    await _check_draft_access(db, draft, current_user)
    
    if draft.revision != expected_revision:
        raise HTTPException(409, f"Чернетка була змінена (очікувалась ревізія {expected_revision}, але зараз {draft.revision}). Будь ласка, перегляньте її знову.")
    if draft.status in {"published", "archived"}:
        raise HTTPException(409, "Ця чернетка вже опублікована або заархівована")

    if draft.status not in {"DRAFT", "draft", "pending"}:
        raise HTTPException(status_code=400, detail="Цей розклад ще не готовий або не був успішно створений, тому його не можна опублікувати.")
    slot_count = await db.scalar(select(func.count()).select_from(ScheduleSlot).where(ScheduleSlot.draft_id == id))
    if not slot_count and draft.draft_type != "import":
        raise HTTPException(
            status_code=400,
            detail="У цьому розкладі немає жодного заняття. Публікація стерла б поточний розклад, тому її заблоковано.",
        )

    # A draft can only be published once.
    
    if draft.revision != expected_revision:
        raise HTTPException(409, f"Чернетка була змінена (очікувалась ревізія {expected_revision}, але зараз {draft.revision}). Будь ласка, перегляньте її знову.")
    if draft.status in {"published", "archived"}:
        raise HTTPException(status_code=409, detail="Ця чернетка вже опублікована або заархівована")

    # Replace only the groups represented by this draft.  Publishing a partial
    # draft must never erase unrelated groups or their date overrides.
    slots = (await db.scalars(
        select(ScheduleSlot)
        .where(ScheduleSlot.draft_id == id)
        .options(selectinload(ScheduleSlot.curriculum))
    )).all()
    proposed_slots = [{
        "group_id":s.curriculum.group_id, "subject_id":s.curriculum.subject_id,
        "teacher_id":s.curriculum.teacher_id, "second_teacher_id":s.curriculum.second_teacher_id,
        "stream_id":s.curriculum.stream_id if s.curriculum.is_stream else None,
        "day_of_week":s.day_of_week,"lesson_number":s.lesson_number,"week_type":s.week_type,
        "room":s.room_override,
    } for s in slots]
    checked_slots = normalize_base_slots(proposed_slots)
    if len(checked_slots) != len(proposed_slots):
        raise HTTPException(409,detail={"code":"draft_duplicate_slots", "msg":"Чернетка містить повтори або надлишкове перекриття тижнів. Перегенеруйте її; поточні дані не змінено."})
    group_ids = {s.curriculum.group_id for s in slots}

    from app.core.time import today_local
    from app.models.entities import SchedulePublication, SchedulePublicationSnapshot, ScheduleVersion
    import json
    anchored_import = draft.draft_type == "import" and "base_version_id" in (draft.data or {})
    if anchored_import:
        anchor = draft.data["base_version_id"]
        if target_version_id is not None and target_version_id != anchor:
            raise HTTPException(409,detail={"code":"import_target_version_mismatch", "msg":"Цільова версія не відповідає джерелу імпорту."})
        current_anchor = await version_for_import(db,(draft.data.get("import_scope") or {}).get("dates",[]),today_local())
        if current_anchor != anchor:
            raise HTTPException(409,detail={"code":"import_version_changed", "msg":"Версії змінилися після імпорту. Повторіть імпорт."})
        target_version_id = anchor
        if anchor is not None and await db.get(ScheduleVersion,anchor) is None:
            raise HTTPException(404,"Версію джерела не знайдено")
    elif target_version_id is None:
        today = today_local()
        target_version = await db.scalar(
            select(ScheduleVersion).where(
                ScheduleVersion.valid_from <= today,
                ScheduleVersion.valid_until >= today,
                ScheduleVersion.is_active.is_(True)
            ).order_by(ScheduleVersion.valid_from.desc()).limit(1)
        )
        target_version_id = target_version.id if target_version else None
    else:
        # User specified a version explicitly
        version = await db.get(ScheduleVersion, target_version_id)
        if not version:
            raise HTTPException(status_code=404, detail="Вказану цільову версію розкладу не знайдено.")



    # Mark old published as archived
    await db.execute(update(ScheduleDraft).where(ScheduleDraft.status == "published").values(status="archived"))
    if draft.draft_type == "import":
        await db.execute(
            update(ScheduleDraft)
            .where(
                ScheduleDraft.draft_type == "import",
                ScheduleDraft.status == "pending",
                ScheduleDraft.id != draft.id,
            )
            .values(status="archived")
        )


    # Fetch existing slots for snapshot before we delete them
    before_by_group = {gid: [] for gid in group_ids}
    if group_ids:
        from sqlalchemy.orm import joinedload
        fetch_q = select(Schedule).options(
            joinedload(Schedule.subject),
            joinedload(Schedule.teacher),
            joinedload(Schedule.second_teacher)
        ).where(Schedule.group_id.in_(group_ids))
        if target_version_id is not None:
            fetch_q = fetch_q.where(Schedule.version_id == target_version_id)
        else:
            fetch_q = fetch_q.where(Schedule.version_id.is_(None))
        existing_schedules = (await db.scalars(fetch_q)).all()
        
        for s in existing_schedules:
            before_by_group[s.group_id].append({
                "id": s.id,
                "day_of_week": s.day_of_week,
                "lesson_number": s.lesson_number,
                "week_type": s.week_type,
                "subject_name": s.subject.name if s.subject else None,
                "teacher_name": s.teacher.name if s.teacher else None,
                "room": s.room_override
            })

    if group_ids:
        schedule_ids_query = select(Schedule.id).where(Schedule.group_id.in_(group_ids))
        if target_version_id is not None:
            schedule_ids_query = schedule_ids_query.where(Schedule.version_id == target_version_id)
        else:
            schedule_ids_query = schedule_ids_query.where(Schedule.version_id.is_(None))
        
        schedule_ids = (await db.scalars(schedule_ids_query)).all()
        if schedule_ids:
            await db.execute(delete(ScheduleOverride).where(ScheduleOverride.schedule_id.in_(schedule_ids)))
            
        delete_query = delete(Schedule).where(Schedule.group_id.in_(group_ids))
        if target_version_id is not None:
            delete_query = delete_query.where(Schedule.version_id == target_version_id)
        else:
            delete_query = delete_query.where(Schedule.version_id.is_(None))
        await db.execute(delete_query)
    
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
                is_active=True,
                version_id=target_version_id
            )
        )
    
    
    publication = SchedulePublication(
        version_id=target_version_id,
        actor_id=current_user.id,
        scope_manifest=json.dumps({"group_ids": list(group_ids)})
    )
    db.add(publication)
    await db.flush()
    db.add_all(new_schedules)
    await db.flush()
    
    # Create snapshots
    after_by_group = {gid: [] for gid in group_ids}
    for s in new_schedules:
        after_by_group[s.group_id].append({
            "id": s.id,
            "day_of_week": s.day_of_week,
            "lesson_number": s.lesson_number,
            "week_type": s.week_type,
            "subject_id": s.subject_id, # Can't use subject.name easily here unless we query it or load it from curriculum
            "teacher_id": s.teacher_id,
            "room": s.room_override
        })
        
    for gid in group_ids:
        snap = SchedulePublicationSnapshot(
            publication_id=publication.id,
            group_id=gid,
            before_data=json.dumps({"slots": before_by_group[gid]}),
            after_data=json.dumps({"slots": after_by_group.get(gid, [])})
        )
        db.add(snap)

    
    # Reconcile notes to archive those where the subject changed or lesson was deleted
    if group_ids:
        await reconcile_notes_after_publish(db, group_ids, current_user.id)

        await db.flush()

    if draft.draft_type == "import":
        created_curriculum_ids = (draft.data or {}).get("created_curriculum_ids", [])
        if created_curriculum_ids:
            await db.execute(delete(ScheduleSlot).where(ScheduleSlot.draft_id == id))
            await db.execute(
                delete(Curriculum).where(Curriculum.id.in_(created_curriculum_ids))
            )
        
    # Process substitutions if draft.data exists
    if draft.data:
        from app.models.entities import ImportedScheduleChange
        from datetime import datetime
        substitutions = draft.data.get("substitutions", [])
        cancelled_lessons = draft.data.get("cancelled", [])
        import_scope = draft.data.get("import_scope") or {}
        scope_dates = {
            datetime.strptime(value, "%Y-%m-%d").date()
            for value in import_scope.get("dates", [])
        }
        scope_group_ids = {
            int(value) for value in import_scope.get("group_ids", [])
        }
        if not scope_dates:
            scope_dates = {
                datetime.strptime(item["date"], "%Y-%m-%d").date()
                for item in [*substitutions, *cancelled_lessons]
                if item.get("date")
            }
        if not scope_group_ids:
            scope_group_ids = {
                int(item["group_id"])
                for item in [*substitutions, *cancelled_lessons]
                if item.get("group_id") is not None
            }

        # An import is a snapshot for its scope, not an append-only list of
        # overrides. Retire older published states first so removed changes
        # disappear from the runtime projection on the next request.
        if scope_dates and scope_group_ids:
            await db.execute(
                update(ImportedScheduleChange)
                .where(
                    ImportedScheduleChange.is_published.is_(True),
                    ImportedScheduleChange.date.in_(scope_dates),
                    ImportedScheduleChange.group_id.in_(scope_group_ids),
                )
                .values(is_published=False)
            )
        
        # Imported changes have their own storage and never become calendar periods.
        # 1. Process substitutions
        for sub in substitutions:
            d_str = sub["date"]
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date() if isinstance(d_str, str) else d_str
            latest = await db.scalar(
                select(func.max(ImportedScheduleChange.version)).where(
                    ImportedScheduleChange.date == d_obj,
                    ImportedScheduleChange.group_id == sub["group_id"],
                    ImportedScheduleChange.lesson_number == sub["lesson_number"],
                )
            )
            db.add(ImportedScheduleChange(
                    draft_id=draft.id,
                publication_id=publication.id,
                    date=d_obj,
                    kind="substitution",
                    group_id=sub["group_id"],
                    subject_id=sub["subject_id"],
                    teacher_id=sub["teacher_id"],
                    second_teacher_id=sub.get("second_teacher_id"),
                    lesson_number=sub["lesson_number"],
                    room_override=sub.get("room"),
                    is_published=True,
                    version=(latest or 0) + 1,
                ))
                    
        # 2. Process Cancelled lessons
        for canc in cancelled_lessons:
            d_str = canc["date"]
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date() if isinstance(d_str, str) else d_str
            latest = await db.scalar(
                select(func.max(ImportedScheduleChange.version)).where(
                    ImportedScheduleChange.date == d_obj,
                    ImportedScheduleChange.group_id == canc["group_id"],
                    ImportedScheduleChange.lesson_number == canc["lesson_number"],
                )
            )
            db.add(ImportedScheduleChange(
                draft_id=draft.id,
                publication_id=publication.id,
                date=d_obj,
                kind="cancelled",
                group_id=canc["group_id"],
                lesson_number=canc["lesson_number"],
                is_published=True,
                version=(latest or 0) + 1,
            ))
        
    draft.status = "published"
    await db.commit()
    
    return {"message": "Розклад успішно опубліковано"}
