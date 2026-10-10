import json
from pathlib import Path

from scripts.apply_schedule_json import DEFAULT_FILE, normalize_subject, split_teachers, teacher_key


def test_schedule_file_is_valid():
    data = json.loads(Path(DEFAULT_FILE).read_text(encoding="utf-8"))
    assert len(data["groups"]) == 25
    for group, days in data["groups"].items():
        assert set(days) == {"1", "2", "3", "4", "5"}, group
        for day, lessons in days.items():
            pairs = [lesson[0] for lesson in lessons]
            assert all(1 <= p <= 4 for p in pairs), (group, day)
            assert len(pairs) == len(set(pairs)), (group, day)
            assert all(lesson[1] for lesson in lessons)


def test_name_helpers():
    assert normalize_subject("Інформатика*") == normalize_subject("інформатика")
    assert teacher_key("Криволап Віктор Васильович") == teacher_key("Криволап В.В.")
    assert split_teachers("Токарєва О.В., Гребенюк А.А.") == ["Токарєва О.В.", "Гребенюк А.А."]
    assert split_teachers(None) == []
