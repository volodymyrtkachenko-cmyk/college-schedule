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
