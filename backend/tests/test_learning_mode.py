from datetime import date

from app.schemas import LearningModeConfig, LearningModeOverride
from app.services.learning_mode import course_for_date, resolve_learning_mode

CONFIG = LearningModeConfig(cycle_start=date(2026, 9, 1))


def test_course_for_date_maps_admission_year_to_course():
    assert course_for_date(2026, date(2026, 10, 20)) == 1
    assert course_for_date(2025, date(2026, 10, 20)) == 2
    assert course_for_date(2024, date(2026, 10, 20)) == 3
    assert course_for_date(2023, date(2026, 10, 20)) == 4


def test_course_for_date_returns_none_outside_range():
    assert course_for_date(2030, date(2026, 10, 20)) is None
    assert course_for_date(2010, date(2026, 10, 20)) is None


def test_first_phase_offline_for_courses_one_and_three():
    assert resolve_learning_mode(CONFIG, 1, date(2026, 9, 1)) == "offline"
    assert resolve_learning_mode(CONFIG, 3, date(2026, 9, 8)) == "offline"
    assert resolve_learning_mode(CONFIG, 2, date(2026, 9, 1)) == "online"
    assert resolve_learning_mode(CONFIG, 4, date(2026, 9, 8)) == "online"


def test_phases_swap_after_two_weeks():
    assert resolve_learning_mode(CONFIG, 1, date(2026, 9, 15)) == "online"
    assert resolve_learning_mode(CONFIG, 2, date(2026, 9, 15)) == "offline"
    assert resolve_learning_mode(CONFIG, 1, date(2026, 9, 28)) == "offline"


def test_mode_is_same_for_whole_week():
    assert resolve_learning_mode(CONFIG, 1, date(2026, 9, 7)) == "offline"
    assert resolve_learning_mode(CONFIG, 1, date(2026, 9, 11)) == "offline"


def test_no_mode_before_cycle_start_or_without_cycle():
    assert resolve_learning_mode(CONFIG, 1, date(2026, 8, 24)) is None
    assert resolve_learning_mode(LearningModeConfig(), 1, date(2026, 9, 1)) is None


def test_override_for_all_courses_beats_cycle():
    config = LearningModeConfig(
        cycle_start=date(2026, 9, 1),
        overrides=[LearningModeOverride(start=date(2026, 10, 20), end=date(2026, 10, 21), mode="offline")],
    )
    assert resolve_learning_mode(config, 1, date(2026, 10, 20)) == "offline"
    assert resolve_learning_mode(config, 4, date(2026, 10, 21)) == "offline"
    assert resolve_learning_mode(config, 1, date(2026, 10, 22)) == "online"


def test_override_for_selected_courses_only():
    config = LearningModeConfig(
        cycle_start=date(2026, 9, 1),
        overrides=[
            LearningModeOverride(start=date(2026, 10, 20), end=date(2026, 10, 20), mode="offline", courses=[2]),
        ],
    )
    assert resolve_learning_mode(config, 2, date(2026, 10, 20)) == "offline"
    assert resolve_learning_mode(config, 1, date(2026, 10, 20)) == "online"


def test_override_rejects_reversed_range():
    try:
        LearningModeOverride(start=date(2026, 10, 21), end=date(2026, 10, 20), mode="online")
    except ValueError:
        return
    raise AssertionError("reversed range must be rejected")


def test_config_rejects_invalid_course():
    try:
        LearningModeConfig(first_phase_offline_courses=[6])
    except ValueError:
        return
    raise AssertionError("course 6 must be rejected")
