import re
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson_notes import LessonOccurrenceNote
from app.services.classroom.parser import URL_RE, _link_line_prefix


async def ensure_known_online_links(db: AsyncSession) -> None:
    return None


async def _save_link_to_slot(
    db: AsyncSession,
    target_date: date,
    group_id: int,
    lesson,
    url_line: str,
    matched_prefix: Optional[str] = None,
    notes_by_slot: Optional[dict] = None,
) -> None:
    if not lesson or not getattr(lesson, "subject_id", None):
        return
    if not (1 <= getattr(lesson, "lesson_number", 0) <= 4):
        return

    slot_key = (target_date, lesson.lesson_number)
    if notes_by_slot is not None:
        cached_row = notes_by_slot.get(slot_key)
        active_row = cached_row if (cached_row is not None and not cached_row.archived) else None
    else:
        active_row = (
            await db.scalars(
                select(LessonOccurrenceNote)
                .where(
                    LessonOccurrenceNote.note_date == target_date,
                    LessonOccurrenceNote.group_id == group_id,
                    LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                    LessonOccurrenceNote.archived.is_(False),
                )
                .order_by(LessonOccurrenceNote.id.desc())
                .limit(1)
            )
        ).first()

    if active_row:
        raw_lines = [l.strip() for l in active_row.note.split("\n") if l.strip()]
        if url_line.strip() in raw_lines:
            return

        kept_lines = []
        for line in active_row.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if l_str.startswith("[TASK"):
                kept_lines.append(l_str)
            elif URL_RE.search(l_str):
                existing_prefix = _link_line_prefix(l_str)
                if matched_prefix:
                    if not l_str.lower().startswith(matched_prefix.lower()):
                        kept_lines.append(l_str)
                else:
                    if existing_prefix:
                        kept_lines.append(l_str)
            else:
                kept_lines.append(l_str)

        active_row.note = (
            f"{url_line}\n{chr(10).join(kept_lines)}"[:9500]
            if kept_lines
            else url_line[:9500]
        )
        active_row.subject_id = lesson.subject_id
        active_row.subject_name = (lesson.subject_name or active_row.subject_name)[:255]
        active_row.revision += 1
        active_row.updated_at = datetime.now(timezone.utc)
        if notes_by_slot is None:
            await db.flush()
    else:
        if notes_by_slot is not None:
            cached_row = notes_by_slot.get(slot_key)
            existing_row = cached_row if (cached_row is not None and cached_row.archived) else None
        else:
            existing_row = (
                await db.scalars(
                    select(LessonOccurrenceNote)
                    .where(
                        LessonOccurrenceNote.note_date == target_date,
                        LessonOccurrenceNote.group_id == group_id,
                        LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                        LessonOccurrenceNote.archived.is_(True),
                    )
                    .order_by(LessonOccurrenceNote.id.desc())
                    .limit(1)
                )
            ).first()

        if existing_row:
            existing_row.note = url_line[:9500]
            existing_row.subject_id = lesson.subject_id
            existing_row.subject_name = (lesson.subject_name or "")[:255]
            existing_row.archived = False
            existing_row.revision += 1
            existing_row.updated_at = datetime.now(timezone.utc)
            if notes_by_slot is None:
                await db.flush()
        else:
            new_row = LessonOccurrenceNote(
                note_date=target_date,
                group_id=group_id,
                lesson_number=lesson.lesson_number,
                subject_id=lesson.subject_id,
                subject_name=(lesson.subject_name or "")[:255],
                note=url_line[:9500],
                revision=1,
                archived=False,
                origin_kind="classroom",
                origin_id=0,
            )
            db.add(new_row)
            if notes_by_slot is not None:
                notes_by_slot[slot_key] = new_row
            else:
                await db.flush()


async def _upsert_task_line(
    db: AsyncSession,
    target_date: date,
    group_id: int,
    lesson,
    task_line: str,
    unique_link: str,
    notes_by_slot: Optional[dict] = None,
) -> bool:
    if not lesson or not getattr(lesson, "subject_id", None):
        return False
    if not (1 <= getattr(lesson, "lesson_number", 0) <= 4):
        return False

    task_line = re.sub(r"[\r\n]+", " ", task_line).strip()
    slot_key = (target_date, lesson.lesson_number)

    if notes_by_slot is not None:
        cached_row = notes_by_slot.get(slot_key)
        existing = cached_row if (cached_row is not None and not cached_row.archived) else None
    else:
        existing = (
            await db.scalars(
                select(LessonOccurrenceNote)
                .where(
                    LessonOccurrenceNote.note_date == target_date,
                    LessonOccurrenceNote.group_id == group_id,
                    LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                    LessonOccurrenceNote.archived.is_(False),
                )
                .order_by(LessonOccurrenceNote.id.desc())
                .limit(1)
            )
        ).first()

    if existing:
        clean_note = "\n".join(
            line for line in existing.note.split("\n")
            if line.strip()
            and not line.strip().startswith("[TASKS_COMPLETED]")
            and not (not line.strip().startswith("[TASK") and "classroom.google.com/" in line.lower())
        )
        if unique_link not in clean_note:
            existing.note = f"{clean_note}\n{task_line}".strip()[:9500]
            existing.subject_id = lesson.subject_id
            existing.subject_name = (lesson.subject_name or existing.subject_name)[:255]
            existing.revision += 1
            existing.updated_at = datetime.now(timezone.utc)
            if notes_by_slot is None:
                await db.flush()
            return True
        return False
    else:
        if notes_by_slot is not None:
            cached_row = notes_by_slot.get(slot_key)
            archived_row = cached_row if (cached_row is not None and cached_row.archived) else None
        else:
            archived_row = (
                await db.scalars(
                    select(LessonOccurrenceNote)
                    .where(
                        LessonOccurrenceNote.note_date == target_date,
                        LessonOccurrenceNote.group_id == group_id,
                        LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                        LessonOccurrenceNote.archived.is_(True),
                    )
                    .order_by(LessonOccurrenceNote.id.desc())
                    .limit(1)
                )
            ).first()

        if archived_row:
            archived_row.note = task_line[:9500]
            archived_row.subject_id = lesson.subject_id
            archived_row.subject_name = (lesson.subject_name or "")[:255]
            archived_row.archived = False
            archived_row.revision += 1
            archived_row.updated_at = datetime.now(timezone.utc)
            if notes_by_slot is None:
                await db.flush()
            return True
        else:
            new_row = LessonOccurrenceNote(
                note_date=target_date,
                group_id=group_id,
                lesson_number=lesson.lesson_number,
                subject_id=lesson.subject_id,
                subject_name=(lesson.subject_name or "")[:255],
                note=task_line[:9500],
                revision=1,
                archived=False,
                origin_kind="classroom",
                origin_id=0,
            )
            db.add(new_row)
            if notes_by_slot is not None:
                notes_by_slot[slot_key] = new_row
            else:
                await db.flush()
            return True
