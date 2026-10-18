from sqlalchemy import event, inspect as sa_inspect
from sqlalchemy.orm import Session
from sqlalchemy import update
from datetime import datetime, timezone
from app.models.entities import Schedule, ScheduleOverride, ImportedScheduleChange, Group, Teacher
from app.models.lesson_notes import LessonOccurrenceNote

# Tables whose rows are scoped to one group (have group_id). Notes are attached
# after projection, so they invalidate HTTP/ETag revisions but not the projection cache.
_GROUP_SCOPED_TABLES = {
    "schedule", "schedule_override", "imported_schedule_changes", "schedule_events",
    "lesson_occurrence_notes",
}
_NOTE_TABLES = {"lesson_occurrence_notes"}
# Tables that affect every group's schedule output.
_GLOBAL_TABLES = {
    "schedule_versions", "schedule_periods", "schedule_period_slots", "subjects",
    "teachers", "groups", "settings", "bell_schedule",
}
# Bulk UPDATEs on these tables come from the updated_at bump below; ORM edits are
# still caught via session.dirty.
_BULK_IGNORED_TABLES = {"groups", "teachers"}
_RELEVANT_BULK_TABLES = (_GROUP_SCOPED_TABLES | _GLOBAL_TABLES) - _BULK_IGNORED_TABLES


def _pending(session: Session) -> dict:
    return session.info.setdefault(
        "cache_rev_pending",
        {"groups": set(), "global": False, "projection_groups": set(), "projection_global": False},
    )


def _group_ids(obj) -> set[int]:
    ids = set()
    if getattr(obj, "group_id", None):
        ids.add(obj.group_id)
    try:
        hist = sa_inspect(obj).attrs.group_id.history
        ids.update(g for g in hist.deleted if g)  # lesson moved away from an old group
    except Exception:
        pass
    return ids


def bump_group_updated_at(session: Session, flush_context, instances):
    groups_to_bump = set()
    teachers_to_bump = set()
    pend = _pending(session)
    projection_dirty = False

    for obj in session.new.union(session.dirty).union(session.deleted):
        if isinstance(obj, Schedule):
            if getattr(obj, "group_id", None): groups_to_bump.add(obj.group_id)
            if getattr(obj, "teacher_id", None): teachers_to_bump.add(obj.teacher_id)
            if getattr(obj, "second_teacher_id", None): teachers_to_bump.add(obj.second_teacher_id)
        elif isinstance(obj, ScheduleOverride):
            if getattr(obj, "group_id", None): groups_to_bump.add(obj.group_id)
            if getattr(obj, "teacher_id", None): teachers_to_bump.add(obj.teacher_id)
            if getattr(obj, "second_teacher_id", None): teachers_to_bump.add(obj.second_teacher_id)
        elif isinstance(obj, ImportedScheduleChange):
            if getattr(obj, "group_id", None): groups_to_bump.add(obj.group_id)
            if getattr(obj, "teacher_id", None): teachers_to_bump.add(obj.teacher_id)
            if getattr(obj, "second_teacher_id", None): teachers_to_bump.add(obj.second_teacher_id)
        elif isinstance(obj, LessonOccurrenceNote):
            if getattr(obj, "group_id", None): groups_to_bump.add(obj.group_id)

        # Cache revision bookkeeping (applied after commit).
        table = getattr(obj, "__tablename__", None)
        if table in _GROUP_SCOPED_TABLES:
            gids = _group_ids(obj)
            if gids:
                pend["groups"].update(gids)
                if table not in _NOTE_TABLES:
                    pend["projection_groups"].update(gids)
                    projection_dirty = True
            elif table not in _NOTE_TABLES:
                pend["global"] = pend["projection_global"] = projection_dirty = True
        elif table in _GLOBAL_TABLES:
            pend["global"] = pend["projection_global"] = projection_dirty = True

    if groups_to_bump:
        session.execute(update(Group).where(Group.id.in_(groups_to_bump)).values(updated_at=datetime.now(timezone.utc)))
    if teachers_to_bump:
        session.execute(update(Teacher).where(Teacher.id.in_(teachers_to_bump)).values(updated_at=datetime.now(timezone.utc)))
    if projection_dirty:
        # Keep read-your-writes inside the same session; the authoritative
        # invalidation happens again in after_commit (closes the stale-cache race).
        _invalidate_projection(pend)


def _mark_bulk_dml(orm_execute_state):
    """Core/bulk insert/update/delete bypass session.dirty — treat them as global changes."""
    if not (orm_execute_state.is_insert or orm_execute_state.is_update or orm_execute_state.is_delete):
        return
    table = getattr(getattr(orm_execute_state.statement, "table", None), "name", None)
    if table in _RELEVANT_BULK_TABLES:
        pend = _pending(orm_execute_state.session)
        pend["global"] = True
        if table not in _NOTE_TABLES:
            pend["projection_global"] = True


def _invalidate_projection(pend: dict) -> None:
    from app.services.projection import invalidate_projection_cache
    if pend["projection_global"]:
        invalidate_projection_cache()
    else:
        for gid in pend["projection_groups"]:
            invalidate_projection_cache(gid)


def _apply_after_commit(session: Session):
    pend = session.info.pop("cache_rev_pending", None)
    if not pend or not (pend["groups"] or pend["global"]):
        return
    from app.services import cache_rev
    _invalidate_projection(pend)
    cache_rev.bump(pend["groups"], global_=pend["global"])


def _on_soft_rollback(session: Session, previous_transaction):
    pend = session.info.get("cache_rev_pending")
    if not pend:
        return
    if pend["projection_groups"] or pend["projection_global"]:
        # Projection may have been cached from flushed-but-rolled-back state.
        _invalidate_projection(pend)
    if not session.in_transaction():
        # Outermost transaction is gone: nothing was committed, drop pending bumps.
        session.info.pop("cache_rev_pending", None)


event.listen(Session, "before_flush", bump_group_updated_at)
event.listen(Session, "do_orm_execute", _mark_bulk_dml)
event.listen(Session, "after_commit", _apply_after_commit)
event.listen(Session, "after_soft_rollback", _on_soft_rollback)
