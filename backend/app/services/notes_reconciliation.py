from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson_notes import LessonOccurrenceNote
from app.services.lesson_notes import archive_note
from app.services.projection import build_projection

async def reconcile_notes_after_publish(db: AsyncSession, group_ids: list[int], actor_id: int):
    """
    Called after publish to archive active notes if their target lesson was deleted or changed subject.
    """
    active_notes = (await db.scalars(
        select(LessonOccurrenceNote)
        .where(
            LessonOccurrenceNote.group_id.in_(group_ids),
            LessonOccurrenceNote.archived.is_(False)
        )
        .with_for_update()
    )).all()
    
    if not active_notes:
        return
        
    dates_to_check = {n.note_date for n in active_notes}
    
    # Group notes by (group_id, date) to minimize build_projection calls
    notes_by_group_date = {}
    for note in active_notes:
        key = (note.group_id, note.note_date)
        if key not in notes_by_group_date:
            notes_by_group_date[key] = []
        notes_by_group_date[key].append(note)
        
    for (gid, d), notes in notes_by_group_date.items():
        proj = await build_projection(db, d, group_id=gid)
        
        for note in notes:
            # Find the effective lesson in the projection
            matches = [p for p in proj if p.lesson_number == note.lesson_number and not getattr(p, 'is_cancelled', False)]
            
            if not matches:
                # The lesson was deleted
                await archive_note(db, note, "lesson_deleted", actor_id)
            else:
                effective_lesson = matches[0]
                if effective_lesson.subject_id != note.subject_id:
                    # The subject changed
                    await archive_note(db, note, "subject_changed", actor_id)

