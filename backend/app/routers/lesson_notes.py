from datetime import date
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import require_roles
from app.database import get_db
from app.models import LessonOccurrenceNote, LessonNoteRevision, User, Group
from app.routers.schedule_versions import lock_versions
from app.schemas.lesson_notes import NoteWrite, NoteResponse, NoteRevisionResponse
from app.services.lesson_notes import authorize_group, active_note, archive_note, write_note, reject

router = APIRouter(prefix="/lesson-notes", tags=["lesson-notes"])


@router.put("/{group_id}/{note_date}/{lesson_number}", response_model=NoteResponse)
async def put_note(group_id: int, note_date: date, lesson_number: int, payload: NoteWrite,
                   response: Response, db: AsyncSession = Depends(get_db),
                   user: User = Depends(require_roles("admin", "editor"))):
    if group_id < 1 or lesson_number not in range(1, 5):
        reject("note_anchor_invalid", "Некоректна група або номер пари", 422)
    # Reject out-of-scope requests before acquiring the shared writer lock.
    # write_note rechecks access after the lock to avoid relying on stale rights.
    await authorize_group(db, user, group_id)
    await lock_versions(db)
    try:
        row = await write_note(db, user, group_id, note_date, lesson_number, payload)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        reject("note_concurrent_write", "Примітку вже змінили. Оновіть розклад.")
    response.headers["Cache-Control"] = "no-store"
    return row


@router.delete("/{group_id}/{note_date}/{lesson_number}", status_code=204)
async def delete_note(group_id: int, note_date: date, lesson_number: int,
                      subject_id: int = Query(gt=0), expected_revision: int = Query(ge=1),
                      db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_roles("admin", "editor"))):
    # Check before waiting for the shared lock, then recheck inside it.
    await authorize_group(db, user, group_id)
    await lock_versions(db)
    await authorize_group(db, user, group_id)
    row = await active_note(db, group_id, note_date, lesson_number)
    if row is None or row.subject_id != subject_id:
        reject("note_not_found", "Примітку не знайдено", 404)
    if row.revision != expected_revision:
        reject("note_revision_changed", "Примітку вже змінили. Оновіть розклад.")
    await archive_note(db, row, "deleted", user.id)
    await db.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/{group_id}/{note_date}/{lesson_number}/history", response_model=list[NoteRevisionResponse])
async def history(group_id: int, note_date: date, lesson_number: int, response: Response,
                  db: AsyncSession = Depends(get_db),
                  user: User = Depends(require_roles("admin", "editor"))):
    await authorize_group(db, user, group_id)
    note_ids = select(LessonOccurrenceNote.id).where(
        LessonOccurrenceNote.group_id == group_id,
        LessonOccurrenceNote.note_date == note_date,
        LessonOccurrenceNote.lesson_number == lesson_number,
    )
    query = select(LessonNoteRevision).where(or_(
        LessonNoteRevision.note_id.in_(note_ids),
        (LessonNoteRevision.group_id == group_id) &
        (LessonNoteRevision.note_date == note_date) &
        (LessonNoteRevision.lesson_number == lesson_number),
    )).order_by(LessonNoteRevision.id.desc()).limit(100)
    if user.role != "admin":
        allowed = select(Group.id).join(
            Group.managers).where(User.id == user.id)
        query = query.where(LessonNoteRevision.group_id.in_(allowed))
    response.headers["Cache-Control"] = "no-store"
    return (await db.scalars(query)).all()
