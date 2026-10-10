"""Replace the active schedule version with the lessons from a compact JSON file.

Every lesson is stored with week_type="both" (identical for numerator and denominator).

Usage (from backend/):
    python -m scripts.apply_schedule_json                 # dry run, nothing is saved
    python -m scripts.apply_schedule_json --apply         # save changes
    python -m scripts.apply_schedule_json --file path.json --version-id 3 --apply

The database is taken from DATABASE_URL (same as the application).
"""
import argparse
import asyncio
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

from sqlalchemy import select, update, delete

from app.database import async_session_factory
from app.models import Group, Schedule, ScheduleVersion, Subject, Teacher
from app.models.entities import ScheduleOverride

DEFAULT_FILE = Path(__file__).parent / "data" / "schedule_2026_09_21.json"
MAX_LESSONS = 4


def normalize_subject(name: str) -> str:
    """'Інформатика*' and 'інформатика' are the same subject."""
    return re.sub(r"\s+", " ", name.replace("*", "")).strip().casefold()


def teacher_key(name: str) -> str:
    """'Криволап Віктор Васильович' / 'Криволап В.В.' -> 'криволап в.в.'"""
    parts = re.split(r"[\s.]+", name.strip())
    parts = [p for p in parts if p]
    if not parts:
        return ""
    initials = "".join(f"{p[0]}." for p in parts[1:])
    return f"{parts[0]} {initials}".casefold()


def split_teachers(value):
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()][:2]


class Resolver:
    def __init__(self, subjects, teachers):
        self.subjects = {normalize_subject(s.name): s for s in subjects}
        by_key = {}
        for teacher in teachers:
            by_key.setdefault(teacher_key(teacher.name), []).append(teacher)
        self.teachers = by_key
        self.created_subjects, self.created_teachers = [], []

    def subject(self, db, name):
        key = normalize_subject(name)
        if key not in self.subjects:
            subject = Subject(name=name.replace("*", "").strip())
            db.add(subject)
            self.subjects[key] = subject
            self.created_subjects.append(subject.name)
        return self.subjects[key]

    def teacher(self, db, name):
        key = teacher_key(name)
        matches = self.teachers.get(key, [])
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:  # ambiguous: prefer an active one
            return sorted(matches, key=lambda t: not t.is_active)[0]
        teacher = Teacher(name=name)
        db.add(teacher)
        self.teachers[key] = [teacher]
        self.created_teachers.append(name)
        return teacher


async def run(file: Path, version_id: int | None, apply: bool) -> None:
    data = json.loads(file.read_text(encoding="utf-8"))
    async with async_session_factory() as db:
        groups = {g.name: g for g in (await db.scalars(select(Group))).all()}
        missing = sorted(set(data["groups"]) - set(groups))
        if missing:
            raise SystemExit(f"Групи відсутні в БД: {', '.join(missing)}. Створіть їх і запустіть знову.")

        if version_id is not None:
            version = await db.get(ScheduleVersion, version_id)
            if version is None:
                raise SystemExit(f"Версію {version_id} не знайдено")
        else:
            today = date.today()
            versions = (await db.scalars(
                select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True))
                .order_by(ScheduleVersion.valid_from.desc())
            )).all()
            version = next((v for v in versions if v.valid_from <= today <= v.valid_until), None) or (versions[0] if versions else None)
        version_filter = Schedule.version_id == version.id if version else Schedule.version_id.is_(None)
        target = f"версія #{version.id} «{version.name}»" if version else "базовий розклад (без версії)"

        old_ids = (await db.scalars(select(Schedule.id).where(version_filter))).all()
        if old_ids:
            await db.execute(update(ScheduleOverride).where(ScheduleOverride.schedule_id.in_(old_ids)).values(schedule_id=None))
            await db.execute(delete(Schedule).where(Schedule.id.in_(old_ids)))

        resolver = Resolver((await db.scalars(select(Subject))).all(), (await db.scalars(select(Teacher))).all())
        created = 0
        per_group = Counter()
        for group_name, days in data["groups"].items():
            for day, lessons in days.items():
                seen = set()
                for pair, subject_name, teachers, room in lessons:
                    if not 1 <= pair <= MAX_LESSONS:
                        raise SystemExit(f"Група {group_name}, день {day}: пара {pair} поза межами 1-{MAX_LESSONS}")
                    if pair in seen:
                        raise SystemExit(f"Група {group_name}, день {day}: пара {pair} повторюється")
                    seen.add(pair)
                    names = split_teachers(teachers)
                    first = resolver.teacher(db, names[0]) if names else None
                    second = resolver.teacher(db, names[1]) if len(names) > 1 else None
                    subject = resolver.subject(db, subject_name)
                    await db.flush()
                    db.add(Schedule(
                        group_id=groups[group_name].id,
                        subject_id=subject.id,
                        teacher_id=first.id if first else None,
                        second_teacher_id=second.id if second else None,
                        day_of_week=int(day),
                        lesson_number=pair,
                        week_type="both",
                        is_active=True,
                        room_override=room,
                        version_id=version.id if version else None,
                    ))
                    created += 1
                    per_group[group_name] += 1

        print(f"Ціль: {target}")
        print(f"Видалено старих записів: {len(old_ids)}; створено нових: {created} ({len(per_group)} груп)")
        print(f"Нові предмети ({len(resolver.created_subjects)}): {sorted(set(resolver.created_subjects))}")
        print(f"Нові викладачі ({len(resolver.created_teachers)}): {sorted(set(resolver.created_teachers))}")
        if apply:
            await db.commit()
            print("Збережено.")
        else:
            await db.rollback()
            print("Dry run: зміни НЕ збережено. Додайте --apply, щоб записати.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--version-id", type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.file, args.version_id, args.apply))
