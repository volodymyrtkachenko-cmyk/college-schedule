import pytest
from pydantic import ValidationError

from app.schemas import LessonMutation
from app.services.schedule import week_types_overlap


def test_week_type_overlap_rules():
    assert week_types_overlap("numerator", "both")
    assert week_types_overlap("denominator", "both")
    assert week_types_overlap("numerator", "numerator")
    assert not week_types_overlap("numerator", "denominator")


@pytest.mark.parametrize(
    "payload",
    [
        {"day_of_week": 0},
        {"day_of_week": 8},
        {"lesson_number": 0},
        {"week_type": "weekly"},
        {"start_time": "10:00", "end_time": "09:00"},
    ],
)
def test_lesson_mutation_validation(payload):
    with pytest.raises(ValidationError):
        LessonMutation(**payload)


def test_lesson_mutation_accepts_valid_values():
    lesson = LessonMutation(
        group_id=1,
        subject_id=2,
        day_of_week=1,
        lesson_number=1,
        start_time="09:00",
        end_time="10:00",
        week_type="numerator",
    )
    assert lesson.day_of_week == 1
