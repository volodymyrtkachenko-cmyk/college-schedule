from datetime import date
from app.services.week import get_week_type

def test_semester_start_is_numerator():
    assert get_week_type(date(2025, 9, 1), date(2025, 9, 1)) == "numerator"
def test_second_week_is_denominator():
    assert get_week_type(date(2025, 9, 8), date(2025, 9, 1)) == "denominator"
def test_two_weeks_is_numerator():
    assert get_week_type(date(2025, 9, 15), date(2025, 9, 1)) == "numerator"
def test_before_start_uses_previous_week_parity():
    assert get_week_type(date(2025, 8, 25), date(2025, 9, 1)) == "denominator"

def test_sept_1_not_monday():
    # Sept 1, 2026 is Tuesday.
    # Monday Aug 31 should be in the SAME week, therefore also "numerator".
    assert get_week_type(date(2026, 8, 31), date(2026, 9, 1)) == "numerator"
    # Tuesday Sept 1 is "numerator".
    assert get_week_type(date(2026, 9, 1), date(2026, 9, 1)) == "numerator"
    # Sunday Sept 6 is "numerator".
    assert get_week_type(date(2026, 9, 6), date(2026, 9, 1)) == "numerator"
    # Monday Sept 7 is the next week -> "denominator".
    assert get_week_type(date(2026, 9, 7), date(2026, 9, 1)) == "denominator"
