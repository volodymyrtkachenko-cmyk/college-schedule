from sqlalchemy import event
from sqlalchemy.orm import Session
from sqlalchemy import update
from datetime import datetime, timezone
from app.models.entities import Schedule, ScheduleOverride, ImportedScheduleChange, Group, Teacher
from app.models.lesson_notes import LessonOccurrenceNote

def bump_group_updated_at(session: Session, flush_context, instances):
    groups_to_bump = set()
    teachers_to_bump = set()
    
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
            
    if groups_to_bump:
        session.execute(update(Group).where(Group.id.in_(groups_to_bump)).values(updated_at=datetime.now(timezone.utc)))
    if teachers_to_bump:
        session.execute(update(Teacher).where(Teacher.id.in_(teachers_to_bump)).values(updated_at=datetime.now(timezone.utc)))

event.listen(Session, "before_flush", bump_group_updated_at)
