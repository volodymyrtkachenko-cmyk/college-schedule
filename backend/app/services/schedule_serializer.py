"""Serialization helpers from Schedule / EffectiveLesson models into ScheduleItem schemas."""
from datetime import date

from app.schemas import ScheduleItem
from app.services.projection import EffectiveLesson


def effective_to_item(
    item: EffectiveLesson,
    week_type: str,
    target_date: date,
    bell_times=None,
) -> ScheduleItem:
    if bell_times is None:
        bell_times = {}

    item_id = item.id
    time_val = item.time or (f"{b[0]}-{b[1]}" if (b := (bell_times or {}).get(item.lesson_number)) else "Невідомо")

    return ScheduleItem(
        id=item_id,
        group_id=item.group_id,
        subject_id=item.subject_id,
        teacher_id=item.teacher_id,
        second_teacher_id=item.second_teacher_id,
        day_of_week=target_date.isoweekday(),
        lesson_number=item.lesson_number,
        time=time_val,
        subject=item.subject_name or "Unknown",
        teacher=item.teacher_name,
        room=item.room,
        room_override=item.room,
        teacher_room=getattr(item, "teacher_room", None),
        second_teacher_room=getattr(item, "second_teacher_room", None),
        subject_name=item.subject_name or "Unknown",
        teacher_name=item.teacher_name,
        stream_id=item.stream_id,
        week_type=week_type,
        is_relevant_this_week=True,
        is_replacement=item.is_replacement,
        is_cancelled=getattr(item, "is_cancelled", False),
        group_name=item.group_name,
        note=item.note_text,
        note_id=item.note_id,
        note_revision=item.note_revision,
        event_type=item.event_type,
        event_title=item.event_title,
        custom_subject=item.custom_subject,
        event_id=item.event_id,
        moved_to_date=getattr(item, "moved_to_date", None),
        moved_to_lesson=getattr(item, "moved_to_lesson", None),
        has_template=getattr(item, "has_template", True),
    )


def to_item(item, week_type, target_date, bell_times=None, *, item_id=None, is_replacement=None):
    if bell_times is None:
        bell_times = {}

    matching_note = None
    t_names = []
    t_rooms = []
    if item.teacher:
        t_names.append(item.teacher.name)
        if item.teacher.room:
            t_rooms.append(item.teacher.room)
    if getattr(item, "second_teacher", None):
        t_names.append(item.second_teacher.name)
        if item.second_teacher.room:
            t_rooms.append(item.second_teacher.room)

    teacher_name = " / ".join(t_names) if t_names else None
    room_name = getattr(item, "room_override", None) or (" / ".join(t_rooms) if t_rooms else None)
    return ScheduleItem(
        id=item.id if item_id is None else item_id,
        group_id=item.group_id,
        subject_id=item.subject_id,
        teacher_id=item.teacher_id,
        second_teacher_id=item.second_teacher_id,
        day_of_week=item.day_of_week,
        lesson_number=item.lesson_number,
        time=f"{b[0]}-{b[1]}" if (b := (bell_times or {}).get(item.lesson_number)) else "",
        subject=item.subject.name,
        teacher=teacher_name,
        room=room_name,
        room_override=getattr(item, "room_override", None),
        teacher_room=(item.teacher.room or None) if item.teacher else None,
        second_teacher_room=(item.second_teacher.room or None) if getattr(item, "second_teacher", None) else None,
        subject_name=item.subject.name,
        teacher_name=teacher_name,
        stream_id=getattr(item, "stream_id", None),
        week_type=item.week_type,
        is_relevant_this_week=item.week_type in ("both", week_type),
        is_replacement=getattr(item, "is_replacement", False) if is_replacement is None else is_replacement,
        is_cancelled=getattr(item, "is_cancelled", False),
        group_name=getattr(item.group, "name", None),
        note=matching_note.note if matching_note else None,
        note_id=matching_note.id if matching_note else None,
    )


def serialize_schedule_items(lessons, week_type, target_date, bell_times):
    items = []
    for lesson in lessons:
        if isinstance(lesson, EffectiveLesson):
            item = effective_to_item(lesson, week_type, target_date, bell_times)
        else:
            is_replacement = (
                True
                if hasattr(lesson, "period_id") or hasattr(lesson, "is_published")
                else None
            )
            item = to_item(
                lesson,
                week_type,
                target_date,
                bell_times,
                is_replacement=is_replacement,
            )
        if item is not None:
            items.append(item)
    return sorted(items, key=lambda item: (item.lesson_number, item.group_name or "", item.id))
