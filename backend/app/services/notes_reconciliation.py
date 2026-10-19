import logging
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson_notes import LessonOccurrenceNote
from app.services.lesson_notes import archive_note
from app.services.projection import build_projection

logger = logging.getLogger(__name__)

MASS_ARCHIVE_COUNT_THRESHOLD = 10
MASS_ARCHIVE_PERCENT_THRESHOLD = 0.20

async def reconcile_notes_after_publish(db: AsyncSession, group_ids: list[int], actor_id: int):
    """
    Called after publish to archive active notes if their target lesson was deleted or changed subject.
    Protects against mass archiving due to import/resolver anomalies.
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
        
    # Group notes by (group_id, date) to minimize build_projection calls
    notes_by_group_date = {}
    for note in active_notes:
        key = (note.group_id, note.note_date)
        if key not in notes_by_group_date:
            notes_by_group_date[key] = []
        notes_by_group_date[key].append(note)
        
    planned_deletions = []
    planned_subject_changes = []

    for (gid, d), notes in notes_by_group_date.items():
        proj = await build_projection(db, d, group_id=gid)
        
        for note in notes:
            # Find the effective lesson in the projection
            matches = [p for p in proj if p.lesson_number == note.lesson_number and not getattr(p, 'is_cancelled', False)]
            
            if not matches:
                planned_deletions.append(note)
            else:
                effective_lesson = matches[0]
                if effective_lesson.subject_id != note.subject_id:
                    planned_subject_changes.append((note, effective_lesson))

    # Mass archive safeguard: do not mass-archive if more than 10 or >20% would be deleted
    total_active = len(active_notes)
    deleted_count = len(planned_deletions)
    
    if deleted_count > MASS_ARCHIVE_COUNT_THRESHOLD or (total_active > 0 and (deleted_count / total_active) > MASS_ARCHIVE_PERCENT_THRESHOLD):
        logger.warning(
            f"MASS NOTE ARCHIVING BLOCKED: {deleted_count} of {total_active} active notes "
            f"would be archived with 'lesson_deleted'. Aborting deletion archiving to protect user data."
        )
    else:
        for note in planned_deletions:
            await archive_note(db, note, "lesson_deleted", actor_id)

    for note, effective_lesson in planned_subject_changes:
        await archive_note(db, note, "subject_changed", actor_id)


