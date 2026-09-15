from datetime import date

def get_week_type(target_date: date, semester_start: date) -> str:
    """Return numerator for odd semester weeks and denominator for even weeks."""
    return "numerator" if ((target_date - semester_start).days // 7) % 2 == 0 else "denominator"
