from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import date
from typing import Optional, List

from app.database import get_db
from app.models import ScheduleOverride, User, Group, Subject, Teacher, LessonOccurrenceNote, ImportedScheduleChange
from app.routers.auth import get_current_user

from app.routers.schedule_versions import lock_versions
from app.services.lesson_notes import active_note, archive_note, authorize_group
from app.services.projection import build_projection


router = APIRouter(prefix="/api/schedule/dated", tags=["Dated Actions"])

def require_editor(user: User = Depends(get_current_user)):
    if user.role not in ("admin", "editor"):
        raise HTTPException(403, "Not enough permissions")
    return user


class DatedMovePayload(BaseModel):
    source_group_id: int
    source_date: date
    source_lesson_number: int
    target_group_id: int
    target_date: date
    target_lesson_number: int
    expected_note_revision: Optional[int] = None
    reason: Optional[str] = None
    idempotency_key: Optional[str] = None

class DatedCancelPayload(BaseModel):
    group_id: int
    date: date
    lesson_number: int

class DatedReplacePayload(BaseModel):
    group_id: int
    date: date
    lesson_number: int
    subject_id: Optional[int] = None
    teacher_id: Optional[int] = None
    second_teacher_id: Optional[int] = None
    room: Optional[str] = None
    stream_id: Optional[str] = None

class DatedCopyPayload(BaseModel):
    source_group_id: int
    source_date: date
    source_lesson_number: int
    target_group_id: int
    target_date: date
    target_lesson_number: int

class DatedSwapPayload(BaseModel):
    first_group_id: int
    first_date: date
    first_lesson_number: int
    second_group_id: int
    second_date: date
    second_lesson_number: int

class DatedBatchItem(BaseModel):
    source_group_id: int
    source_date: date
    source_lesson_number: int
    target_group_id: int
    target_date: date
    target_lesson_number: int

class DatedBatchPayload(BaseModel):
    action: str  # "copy" or "move"
    items: List[DatedBatchItem]
    skip_conflicts: Optional[bool] = False

@router.post("/cancel")
async def cancel_dated_lesson(
    payload: DatedCancelPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor),
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.group_id)

    note = await active_note(db, payload.group_id, payload.date, payload.lesson_number)
    if note:
        await archive_note(db, note, "lesson_deleted", actor.id)

    existing = await db.scalar(
        select(ScheduleOverride).where(
            ScheduleOverride.group_id == payload.group_id,
            ScheduleOverride.date == payload.date,
            ScheduleOverride.lesson_number == payload.lesson_number,
        )
    )

    # Check if there is a base lesson in this slot on this date
    projection = await build_projection(db, payload.date, group_id=payload.group_id, include_cancelled=True)
    slot_items = [item for item in projection if item.lesson_number == payload.lesson_number]
    has_base_template = any(getattr(item, "has_template", False) or item.source_kind == "base" for item in slot_items)

    # If there is no base lesson in this slot (e.g. a moved-in or one-off added lesson),
    # deleting/cancelling it should completely clear the slot instead of leaving a 'Скасована пара' stub!
    if existing and not has_base_template:
        # Also clear moved_to_date / moved_to_lesson on the source override if this was a moved lesson
        source_moved = (await db.scalars(
            select(ScheduleOverride).where(
                ScheduleOverride.group_id == payload.group_id,
                ScheduleOverride.moved_to_date == payload.date,
                ScheduleOverride.moved_to_lesson == payload.lesson_number,
            )
        )).all()
        for src in source_moved:
            if src.subject_id is None and not any(
                b.lesson_number == src.lesson_number
                for b in await build_projection(db, src.date, group_id=payload.group_id, include_cancelled=True)
                if getattr(b, "has_template", False) or b.source_kind == "base"
            ):
                await db.delete(src)
            else:
                src.cancelled = False
                src.moved_to_date = None
                src.moved_to_lesson = None
                if src.subject_id is None:
                    await db.delete(src)

        await db.delete(existing)
        await db.commit()
        from app.services.projection import invalidate_projection_cache
        from app.services import cache_rev
        invalidate_projection_cache(payload.group_id)
        cache_rev.bump([payload.group_id])
        return {"status": "removed"}

    if existing:
        existing.cancelled = True
    else:
        db.add(
            ScheduleOverride(
                group_id=payload.group_id,
                date=payload.date,
                lesson_number=payload.lesson_number,
                cancelled=True,
            )
        )
    await db.commit()
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.group_id)
    cache_rev.bump([payload.group_id])
    return {"status": "cancelled"}


@router.post("/restore")
async def restore_dated_lesson(
    payload: DatedCancelPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor),
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.group_id)

    existing = await db.scalar(
        select(ScheduleOverride).where(
            ScheduleOverride.group_id == payload.group_id,
            ScheduleOverride.date == payload.date,
            ScheduleOverride.lesson_number == payload.lesson_number,
        )
    )
    if existing:
        if getattr(existing, "moved_to_date", None) and getattr(existing, "moved_to_lesson", None):
            target_ovr = await db.scalar(
                select(ScheduleOverride).where(
                    ScheduleOverride.group_id == payload.group_id,
                    ScheduleOverride.date == existing.moved_to_date,
                    ScheduleOverride.lesson_number == existing.moved_to_lesson,
                )
            )
            if target_ovr:
                await db.delete(target_ovr)
        if existing.subject_id is None:
            await db.delete(existing)
        else:
            existing.cancelled = False
            existing.moved_to_date = None
            existing.moved_to_lesson = None
        await db.commit()
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.group_id)
    cache_rev.bump([payload.group_id])
    return {"status": "restored"}


@router.post("/replace")
async def replace_dated_lesson(
    payload: DatedReplacePayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor),
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.group_id)

    projection = await build_projection(db, payload.date, group_id=payload.group_id)
    matches = [item for item in projection if item.lesson_number == payload.lesson_number]

    note = await active_note(db, payload.group_id, payload.date, payload.lesson_number)
    if note:
        if not matches or matches[0].subject_id != payload.subject_id:
            await archive_note(db, note, "subject_changed", actor.id)

    existing = await db.scalar(
        select(ScheduleOverride).where(
            ScheduleOverride.group_id == payload.group_id,
            ScheduleOverride.date == payload.date,
            ScheduleOverride.lesson_number == payload.lesson_number,
        )
    )
    if existing:
        existing.subject_id = payload.subject_id
        existing.teacher_id = payload.teacher_id
        existing.second_teacher_id = payload.second_teacher_id
        existing.room = payload.room
        existing.stream_id = payload.stream_id
        existing.cancelled = False
    else:
        db.add(
            ScheduleOverride(
                group_id=payload.group_id,
                date=payload.date,
                lesson_number=payload.lesson_number,
                subject_id=payload.subject_id,
                teacher_id=payload.teacher_id,
                second_teacher_id=payload.second_teacher_id,
                room=payload.room,
                stream_id=payload.stream_id,
                cancelled=False,
            )
        )
    imported_changes = (await db.scalars(
        select(ImportedScheduleChange).where(
            ImportedScheduleChange.group_id == payload.group_id,
            ImportedScheduleChange.date == payload.date,
            ImportedScheduleChange.lesson_number == payload.lesson_number,
        )
    )).all()
    for imp in imported_changes:
        imp.manually_edited = True

    await db.commit()
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.group_id)
    cache_rev.bump([payload.group_id])
    return {"status": "replaced"}


@router.post("/remove-replacement")
async def remove_dated_replacement(
    payload: DatedCancelPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor),
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.group_id)

    ovr = await db.scalar(
        select(ScheduleOverride).where(
            ScheduleOverride.group_id == payload.group_id,
            ScheduleOverride.date == payload.date,
            ScheduleOverride.lesson_number == payload.lesson_number,
        )
    )
    if ovr:
        # If this override had moved a lesson to another slot, also delete that target slot override
        if getattr(ovr, "moved_to_date", None) and getattr(ovr, "moved_to_lesson", None):
            target_ovr = await db.scalar(
                select(ScheduleOverride).where(
                    ScheduleOverride.group_id == payload.group_id,
                    ScheduleOverride.date == ovr.moved_to_date,
                    ScheduleOverride.lesson_number == ovr.moved_to_lesson,
                )
            )
            if target_ovr:
                await db.delete(target_ovr)

        # If this override was the target of a move from another slot, restore the source slot
        source_moved = (await db.scalars(
            select(ScheduleOverride).where(
                ScheduleOverride.group_id == payload.group_id,
                ScheduleOverride.moved_to_date == payload.date,
                ScheduleOverride.moved_to_lesson == payload.lesson_number,
            )
        )).all()
        for src in source_moved:
            if src.subject_id is None:
                await db.delete(src)
            else:
                src.cancelled = False
                src.moved_to_date = None
                src.moved_to_lesson = None

        await db.delete(ovr)

    imported_list = (await db.scalars(
        select(ImportedScheduleChange).where(
            ImportedScheduleChange.group_id == payload.group_id,
            ScheduleOverride.date == payload.date if False else ImportedScheduleChange.date == payload.date,
            ImportedScheduleChange.lesson_number == payload.lesson_number,
            ImportedScheduleChange.is_published.is_(True),
        )
    )).all()
    for imp in imported_list:
        imp.is_published = False

    await db.commit()
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.group_id)
    cache_rev.bump([payload.group_id])
    return {"status": "removed"}


from app.services.lesson_notes import snapshot_revision
from app.models.lesson_notes import utcnow

@router.post("/move")
async def move_dated_lesson(
    payload: DatedMovePayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.source_group_id)
    if payload.source_group_id != payload.target_group_id:
        await authorize_group(db, actor, payload.target_group_id)
        
    # Read projection for source and target
    source_proj = await build_projection(db, payload.source_date, group_id=payload.source_group_id)
    target_proj = await build_projection(db, payload.target_date, group_id=payload.target_group_id)
    
    source_matches = [item for item in source_proj if item.lesson_number == payload.source_lesson_number and not getattr(item, 'is_cancelled', False)]
    target_matches = [item for item in target_proj if item.lesson_number == payload.target_lesson_number and not getattr(item, 'is_cancelled', False)]
    
    if not source_matches:
        raise HTTPException(404, "Заняття для перенесення не знайдено (або воно вже скасоване)")
    if target_matches:
        raise HTTPException(409, "У цільовій парі вже є заняття")
        
    source_item = source_matches[0]
    
    note = await active_note(db, payload.source_group_id, payload.source_date, payload.source_lesson_number)
    if note and payload.expected_note_revision is not None and note.revision != payload.expected_note_revision:
        raise HTTPException(409, "Примітку вже змінили. Оновіть розклад.")
        
    ovr_cancel = ScheduleOverride(
        group_id=payload.source_group_id,
        date=payload.source_date,
        lesson_number=payload.source_lesson_number,
        cancelled=True,
        moved_to_date=payload.target_date,
        moved_to_lesson=payload.target_lesson_number,
    )
    db.add(ovr_cancel)
    
    ovr_replace = ScheduleOverride(
        group_id=payload.target_group_id,
        date=payload.target_date,
        lesson_number=payload.target_lesson_number,
        subject_id=source_item.subject_id,
        teacher_id=source_item.teacher_id,
        second_teacher_id=source_item.second_teacher_id,
        room=source_item.room,
        stream_id=source_item.stream_id,
        cancelled=False
    )
    db.add(ovr_replace)
    
    if note:
        note.group_id = payload.target_group_id
        note.note_date = payload.target_date
        note.lesson_number = payload.target_lesson_number
        note.revision += 1
        note.updated_by = actor.id
        note.updated_at = utcnow()
        await snapshot_revision(db, note, "moved", actor.id)
        
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Помилка перенесення: конфлікт збереження")
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.source_group_id)
    if payload.target_group_id != payload.source_group_id:
        invalidate_projection_cache(payload.target_group_id)
    cache_rev.bump({payload.source_group_id, payload.target_group_id})
    return {"status": "moved"}


@router.post("/copy")
async def copy_dated_lesson(
    payload: DatedCopyPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.source_group_id)
    if payload.source_group_id != payload.target_group_id:
        await authorize_group(db, actor, payload.target_group_id)

    source_proj = await build_projection(db, payload.source_date, group_id=payload.source_group_id)
    target_proj = await build_projection(db, payload.target_date, group_id=payload.target_group_id)

    source_matches = [item for item in source_proj if item.lesson_number == payload.source_lesson_number and not getattr(item, 'is_cancelled', False)]
    target_matches = [item for item in target_proj if item.lesson_number == payload.target_lesson_number and not getattr(item, 'is_cancelled', False)]

    if not source_matches:
        raise HTTPException(404, "Заняття для копіювання не знайдено (або воно вже скасоване)")
    if target_matches:
        raise HTTPException(409, "У цільовій парі вже є заняття")

    source_item = source_matches[0]

    existing_target_ovr = await db.scalar(
        select(ScheduleOverride).where(
            ScheduleOverride.group_id == payload.target_group_id,
            ScheduleOverride.date == payload.target_date,
            ScheduleOverride.lesson_number == payload.target_lesson_number,
        )
    )
    if existing_target_ovr:
        existing_target_ovr.subject_id = source_item.subject_id
        existing_target_ovr.teacher_id = source_item.teacher_id
        existing_target_ovr.second_teacher_id = source_item.second_teacher_id
        existing_target_ovr.room = source_item.room
        existing_target_ovr.stream_id = source_item.stream_id
        existing_target_ovr.cancelled = False
    else:
        db.add(
            ScheduleOverride(
                group_id=payload.target_group_id,
                date=payload.target_date,
                lesson_number=payload.target_lesson_number,
                subject_id=source_item.subject_id,
                teacher_id=source_item.teacher_id,
                second_teacher_id=source_item.second_teacher_id,
                room=source_item.room,
                stream_id=source_item.stream_id,
                cancelled=False
            )
        )

    # Duplicate note if present
    source_note = await active_note(db, payload.source_group_id, payload.source_date, payload.source_lesson_number)
    if source_note and source_note.note:
        copied_note = LessonOccurrenceNote(
            group_id=payload.target_group_id,
            note_date=payload.target_date,
            lesson_number=payload.target_lesson_number,
            subject_id=source_note.subject_id,
            subject_name=source_note.subject_name,
            note=source_note.note,
            origin_kind=source_note.origin_kind,
            origin_id=source_note.origin_id,
            created_by=actor.id,
            updated_by=actor.id,
            revision=1,
            archived=False,
        )
        db.add(copied_note)
        await snapshot_revision(db, copied_note, "copied", actor.id)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Помилка копіювання: конфлікт збереження")
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.target_group_id)
    cache_rev.bump([payload.target_group_id])
    return {"status": "copied"}


@router.post("/swap")
async def swap_dated_lessons(
    payload: DatedSwapPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.first_group_id)
    if payload.first_group_id != payload.second_group_id:
        await authorize_group(db, actor, payload.second_group_id)

    proj_1 = await build_projection(db, payload.first_date, group_id=payload.first_group_id)
    proj_2 = await build_projection(db, payload.second_date, group_id=payload.second_group_id)

    m1 = [item for item in proj_1 if item.lesson_number == payload.first_lesson_number and not getattr(item, 'is_cancelled', False)]
    m2 = [item for item in proj_2 if item.lesson_number == payload.second_lesson_number and not getattr(item, 'is_cancelled', False)]

    if not m1 or not m2:
        raise HTTPException(404, "Одне з занять для обміну не знайдено або скасоване")

    item1, item2 = m1[0], m2[0]

    # Slot 1 gets item 2 details
    ovr1 = await db.scalar(select(ScheduleOverride).where(
        ScheduleOverride.group_id == payload.first_group_id,
        ScheduleOverride.date == payload.first_date,
        ScheduleOverride.lesson_number == payload.first_lesson_number,
    ))
    if ovr1:
        ovr1.subject_id = item2.subject_id
        ovr1.teacher_id = item2.teacher_id
        ovr1.second_teacher_id = item2.second_teacher_id
        ovr1.room = item2.room
        ovr1.stream_id = item2.stream_id
        ovr1.cancelled = False
    else:
        db.add(ScheduleOverride(
            group_id=payload.first_group_id,
            date=payload.first_date,
            lesson_number=payload.first_lesson_number,
            subject_id=item2.subject_id,
            teacher_id=item2.teacher_id,
            second_teacher_id=item2.second_teacher_id,
            room=item2.room,
            stream_id=item2.stream_id,
            cancelled=False
        ))

    # Slot 2 gets item 1 details
    ovr2 = await db.scalar(select(ScheduleOverride).where(
        ScheduleOverride.group_id == payload.second_group_id,
        ScheduleOverride.date == payload.second_date,
        ScheduleOverride.lesson_number == payload.second_lesson_number,
    ))
    if ovr2:
        ovr2.subject_id = item1.subject_id
        ovr2.teacher_id = item1.teacher_id
        ovr2.second_teacher_id = item1.second_teacher_id
        ovr2.room = item1.room
        ovr2.stream_id = item1.stream_id
        ovr2.cancelled = False
    else:
        db.add(ScheduleOverride(
            group_id=payload.second_group_id,
            date=payload.second_date,
            lesson_number=payload.second_lesson_number,
            subject_id=item1.subject_id,
            teacher_id=item1.teacher_id,
            second_teacher_id=item1.second_teacher_id,
            room=item1.room,
            stream_id=item1.stream_id,
            cancelled=False
        ))

    # Swap notes if present
    note1 = await active_note(db, payload.first_group_id, payload.first_date, payload.first_lesson_number)
    note2 = await active_note(db, payload.second_group_id, payload.second_date, payload.second_lesson_number)

    if note1 and note2:
        # Swap content and subject binding
        t1, s1, sn1 = note1.note, note1.subject_id, note1.subject_name
        note1.note = note2.note
        note1.subject_id = note2.subject_id
        note1.subject_name = note2.subject_name
        note1.revision += 1
        note1.updated_by = actor.id
        note1.updated_at = utcnow()
        await snapshot_revision(db, note1, "swapped", actor.id)

        note2.note = t1
        note2.subject_id = s1
        note2.subject_name = sn1
        note2.revision += 1
        note2.updated_by = actor.id
        note2.updated_at = utcnow()
        await snapshot_revision(db, note2, "swapped", actor.id)
    elif note1:
        note1.group_id = payload.second_group_id
        note1.note_date = payload.second_date
        note1.lesson_number = payload.second_lesson_number
        note1.revision += 1
        note1.updated_by = actor.id
        note1.updated_at = utcnow()
        await snapshot_revision(db, note1, "swapped", actor.id)
    elif note2:
        note2.group_id = payload.first_group_id
        note2.note_date = payload.first_date
        note2.lesson_number = payload.first_lesson_number
        note2.revision += 1
        note2.updated_by = actor.id
        note2.updated_at = utcnow()
        await snapshot_revision(db, note2, "swapped", actor.id)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Помилка обміну: конфлікт збереження")
    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    invalidate_projection_cache(payload.first_group_id)
    if payload.second_group_id != payload.first_group_id:
        invalidate_projection_cache(payload.second_group_id)
    cache_rev.bump({payload.first_group_id, payload.second_group_id})
    return {"status": "swapped"}


@router.post("/batch")
async def batch_dated_lessons(
    payload: DatedBatchPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    await lock_versions(db)
    succeeded = 0
    verified_groups: set[int] = set()
    affected_groups: set[int] = set()
    projection_memo: dict[tuple[int, date], list] = {}

    async def get_cached_proj(g_id: int, d: date) -> list:
        key = (g_id, d)
        if key not in projection_memo:
            projection_memo[key] = await build_projection(db, d, group_id=g_id)
        return projection_memo[key]

    for item in payload.items:
        if item.source_group_id not in verified_groups:
            await authorize_group(db, actor, item.source_group_id)
            verified_groups.add(item.source_group_id)
        if item.target_group_id not in verified_groups:
            await authorize_group(db, actor, item.target_group_id)
            verified_groups.add(item.target_group_id)

        source_proj = await get_cached_proj(item.source_group_id, item.source_date)
        target_proj = await get_cached_proj(item.target_group_id, item.target_date)

        source_matches = [l for l in source_proj if l.lesson_number == item.source_lesson_number and not getattr(l, 'is_cancelled', False)]
        target_matches = [l for l in target_proj if l.lesson_number == item.target_lesson_number and not getattr(l, 'is_cancelled', False)]

        if not source_matches:
            if payload.skip_conflicts:
                continue
            raise HTTPException(404, f"Заняття {item.source_date} пара {item.source_lesson_number} не знайдено")

        if target_matches:
            if payload.skip_conflicts:
                continue
            raise HTTPException(409, f"У парі {item.target_date} #{item.target_lesson_number} вже є заняття")

        source_item = source_matches[0]

        # Apply target override
        existing_target_ovr = await db.scalar(
            select(ScheduleOverride).where(
                ScheduleOverride.group_id == item.target_group_id,
                ScheduleOverride.date == item.target_date,
                ScheduleOverride.lesson_number == item.target_lesson_number,
            )
        )
        if existing_target_ovr:
            existing_target_ovr.subject_id = source_item.subject_id
            existing_target_ovr.teacher_id = source_item.teacher_id
            existing_target_ovr.second_teacher_id = source_item.second_teacher_id
            existing_target_ovr.room = source_item.room
            existing_target_ovr.stream_id = source_item.stream_id
            existing_target_ovr.cancelled = False
        else:
            db.add(
                ScheduleOverride(
                    group_id=item.target_group_id,
                    date=item.target_date,
                    lesson_number=item.target_lesson_number,
                    subject_id=source_item.subject_id,
                    teacher_id=source_item.teacher_id,
                    second_teacher_id=source_item.second_teacher_id,
                    room=source_item.room,
                    stream_id=source_item.stream_id,
                    cancelled=False
                )
            )
        projection_memo.pop((item.target_group_id, item.target_date), None)
        affected_groups.add(item.target_group_id)

        # If move, cancel source
        if payload.action == "move":
            existing_src_ovr = await db.scalar(
                select(ScheduleOverride).where(
                    ScheduleOverride.group_id == item.source_group_id,
                    ScheduleOverride.date == item.source_date,
                    ScheduleOverride.lesson_number == item.source_lesson_number,
                )
            )
            if existing_src_ovr:
                existing_src_ovr.cancelled = True
                existing_src_ovr.moved_to_date = item.target_date
                existing_src_ovr.moved_to_lesson = item.target_lesson_number
            else:
                db.add(
                    ScheduleOverride(
                        group_id=item.source_group_id,
                        date=item.source_date,
                        lesson_number=item.source_lesson_number,
                        cancelled=True,
                        moved_to_date=item.target_date,
                        moved_to_lesson=item.target_lesson_number,
                    )
                )
            projection_memo.pop((item.source_group_id, item.source_date), None)
            affected_groups.add(item.source_group_id)

        # Handle notes
        note = await active_note(db, item.source_group_id, item.source_date, item.source_lesson_number)
        if note and note.note:
            if payload.action == "move":
                note.group_id = item.target_group_id
                note.note_date = item.target_date
                note.lesson_number = item.target_lesson_number
                note.revision += 1
                note.updated_by = actor.id
                note.updated_at = utcnow()
                await snapshot_revision(db, note, "moved", actor.id)
            else:
                copied_note = LessonOccurrenceNote(
                    group_id=item.target_group_id,
                    note_date=item.target_date,
                    lesson_number=item.target_lesson_number,
                    subject_id=note.subject_id,
                    subject_name=note.subject_name,
                    note=note.note,
                    origin_kind=note.origin_kind,
                    origin_id=note.origin_id,
                    created_by=actor.id,
                    updated_by=actor.id,
                    revision=1,
                    archived=False,
                )
                db.add(copied_note)
                await snapshot_revision(db, copied_note, "copied", actor.id)

        succeeded += 1

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Помилка пакетної операції: конфлікт збереження")

    from app.services.projection import invalidate_projection_cache
    from app.services import cache_rev
    for gid in affected_groups:
        invalidate_projection_cache(gid)
    if affected_groups:
        cache_rev.bump(affected_groups)

    return {
        "status": "ok",
        "action": payload.action,
        "total": len(payload.items),
        "succeeded": succeeded
    }
