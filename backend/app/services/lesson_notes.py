"""Note writes join the same transaction/lock as schedule mutations."""
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import select
from app.models import (Group, User, Schedule, ScheduleVersion, ScheduleOverride,
                        ImportedScheduleChange, SchedulePeriodSlot, LessonOccurrenceNote, LessonNoteRevision)
from app.models.lesson_notes import utcnow
from app.services.schedule import fetch_schedule
from app.services.settings import settings_service
from app.services.week import get_week_type


def reject(code, message, status=409):
    raise HTTPException(status, detail={"code": code, "msg": message})


async def authorize_group(db, user, group_id):
    if user.role == "admin":
        return
    if user.role != "editor":
        reject("note_forbidden", "Недостатньо прав", 403)
    allowed = await db.scalar(select(Group.id).join(Group.managers).where(Group.id == group_id, User.id == user.id))
    if allowed is None:
        reject("note_group_forbidden", "Немає доступу до цієї групи", 403)


async def active_note(db, group_id, note_date, lesson_number):
    return await db.scalar(select(LessonOccurrenceNote).where(
        LessonOccurrenceNote.group_id == group_id,
        LessonOccurrenceNote.note_date == note_date,
        LessonOccurrenceNote.lesson_number == lesson_number,
        LessonOccurrenceNote.archived.is_(False),
    ).with_for_update())


async def occurrence(db, group_id, note_date, lesson_number):
    if note_date.isoweekday() > 5:
        reject("note_weekday_invalid", "Примітки доступні для навчальних днів", 422)
    _, lessons = await fetch_schedule(db, note_date, group_id=group_id)
    matches = [item for item in lessons if item.lesson_number == lesson_number]
    if len(matches) != 1:
        reject("note_occurrence_missing_or_ambiguous", "Заняття відсутнє або неоднозначне. Оновіть розклад.")
    item = matches[0]
    if isinstance(item, Schedule):
        override = await db.scalar(select(ScheduleOverride).where(
            ScheduleOverride.schedule_id == item.id, ScheduleOverride.date == note_date))
        if override and override.subject_id is not None and override.subject_id != item.subject_id:
            reject("note_override_requires_projection", "Примітка до ручної заміни потребує узгодженого відображення предмета.")
    return item


async def snapshot_revision(db, row, event, actor_id):
    await db.flush()
    actor = await db.get(User, actor_id) if actor_id is not None else None
    db.add(LessonNoteRevision(
        note_id=row.id, revision=row.revision, group_id=row.group_id,
        note_date=row.note_date, lesson_number=row.lesson_number, event=event,
        actor_id=actor_id, snapshot={
            "group_id": row.group_id, "note_date": row.note_date.isoformat(),
            "lesson_number": row.lesson_number, "subject_id": row.subject_id,
            "subject_name": row.subject_name, "note": row.note, "archived": row.archived,
            "actor_id": actor_id, "actor_name": actor.name if actor else None,
        },
    ))


async def archive_note(db, row, event, actor_id):
    row.archived = True
    row.revision += 1
    row.updated_by = actor_id
    row.updated_at = utcnow()
    await snapshot_revision(db, row, event, actor_id)


async def write_note(db, user, group_id, note_date, lesson_number, payload):
    await authorize_group(db, user, group_id)
    item = await occurrence(db, group_id, note_date, lesson_number)
    if item.subject_id != payload.subject_id:
        reject("note_subject_changed", "Предмет змінився. Оновіть розклад перед збереженням.")
    current = await active_note(db, group_id, note_date, lesson_number)
    matching = current is not None and current.subject_id == item.subject_id
    revision = current.revision if matching else 0
    if payload.expected_revision != revision:
        reject("note_revision_changed", "Примітку вже змінили. Ваш текст не втрачено; оновіть розклад.")
    if current and not matching:
        await archive_note(db, current, "subject_changed", user.id)
        await db.flush()
        current = None
    if current is None:
        kind = "imported" if isinstance(item, ImportedScheduleChange) else "period" if isinstance(item, SchedulePeriodSlot) else "schedule"
        current = LessonOccurrenceNote(
            group_id=group_id, note_date=note_date, lesson_number=lesson_number,
            subject_id=item.subject_id, subject_name=item.subject.name,
            note=payload.note, revision=1, archived=False,
            origin_kind=kind, origin_id=item.id, created_by=user.id, updated_by=user.id,
        )
        db.add(current)
        event = "created"
    else:
        current.note = payload.note
        current.revision += 1
        current.updated_by = user.id
        current.updated_at = utcnow()
        event = "updated"
    await snapshot_revision(db, current, event, user.id)
    return current


async def attach_notes(db, target_date, items):
    if not items:
        return items
    rows = (await db.scalars(select(LessonOccurrenceNote).where(
        LessonOccurrenceNote.note_date == target_date,
        LessonOccurrenceNote.group_id.in_({item.group_id for item in items}),
        LessonOccurrenceNote.archived.is_(False),
    ))).all()
    indexed = {(row.group_id, row.lesson_number, row.subject_id): row for row in rows}
    # Never expose the old subject's text when an unapplied legacy override changes it.
    ordinary = [item.id for item in items if item.id > 0 and not item.is_replacement]
    overrides = (await db.scalars(select(ScheduleOverride).where(
        ScheduleOverride.date == target_date, ScheduleOverride.schedule_id.in_(ordinary),
        ScheduleOverride.subject_id.is_not(None),
    ))).all() if ordinary else []
    changed = {o.schedule_id: o.subject_id for o in overrides}
    for item in items:
        row = indexed.get((item.group_id, item.lesson_number, item.subject_id))
        if row and changed.get(item.id, item.subject_id) == item.subject_id:
            item.note, item.note_id, item.note_revision = row.note, row.id, row.revision
            item.note_date = target_date
    return items


async def reconcile_template_notes(db, item, *, group_id, subject_id, day, lesson_number, week_type, actor_id):
    """Current PATCH edits a recurring template; move its dated notes within each week.

    Date-only moves and publish mapping remain a separate reviewed 2B step.
    """
    geometry_changed = (group_id, day, lesson_number) != (item.group_id, item.day_of_week, item.lesson_number)
    if not geometry_changed and subject_id == item.subject_id and week_type == item.week_type:
        return
    from app.services.import_slot_safety import version_for_date, coverage
    candidates = (await db.scalars(select(LessonOccurrenceNote).where(
        LessonOccurrenceNote.group_id == item.group_id,
        LessonOccurrenceNote.lesson_number == item.lesson_number,
        LessonOccurrenceNote.subject_id == item.subject_id,
        LessonOccurrenceNote.origin_kind == "schedule",
        LessonOccurrenceNote.archived.is_(False),
    ).with_for_update())).all()
    start = await settings_service.get_semester_start(db)
    for row in candidates:
        if row.note_date.isoweekday() != item.day_of_week:
            continue
        if await version_for_date(db, row.note_date) != item.version_id:
            continue
        week = get_week_type(row.note_date, start)
        if week not in coverage(item.week_type):
            continue
        if subject_id != item.subject_id:
            await archive_note(db, row, "subject_changed", actor_id)
        elif week not in coverage(week_type):
            await archive_note(db, row, "week_changed", actor_id)
        elif geometry_changed:
            destination = row.note_date + timedelta(days=day-item.day_of_week)
            if await version_for_date(db, destination) != item.version_id:
                reject("note_move_outside_version", "Нова дата виходить за межі версії розкладу. Перенесення не виконано.")
            occupied = await active_note(db, group_id, destination, lesson_number)
            if occupied and occupied.id != row.id:
                reject("note_destination_occupied", "У цільовій парі вже є примітка. Перенесення не виконано.")
            row.group_id, row.note_date, row.lesson_number = group_id, destination, lesson_number
            row.revision += 1
            row.updated_by, row.updated_at = actor_id, utcnow()
            await snapshot_revision(db, row, "moved", actor_id)


async def archive_template_notes(db, item, actor_id):
    from app.services.import_slot_safety import version_for_date, coverage
    rows = (await db.scalars(select(LessonOccurrenceNote).where(
        LessonOccurrenceNote.group_id == item.group_id,
        LessonOccurrenceNote.lesson_number == item.lesson_number,
        LessonOccurrenceNote.subject_id == item.subject_id,
        LessonOccurrenceNote.origin_kind == "schedule",
        LessonOccurrenceNote.archived.is_(False),
    ).with_for_update())).all()
    start = await settings_service.get_semester_start(db)
    for row in rows:
        if (row.note_date.isoweekday() == item.day_of_week
                and await version_for_date(db, row.note_date) == item.version_id
                and get_week_type(row.note_date, start) in coverage(item.week_type)):
            await archive_note(db, row, "lesson_deleted", actor_id)
