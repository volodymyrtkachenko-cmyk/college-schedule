from datetime import date, timedelta

def get_week_type(target_date: date, semester_start: date) -> str:
    """Return numerator for odd semester weeks and denominator for even weeks.
    The week changes on Monday, regardless of what day of the week semester_start falls on.
    """
    start_monday = semester_start - timedelta(days=semester_start.weekday())
    target_monday = target_date - timedelta(days=target_date.weekday())
    
    weeks_diff = (target_monday - start_monday).days // 7
    return "numerator" if weeks_diff % 2 == 0 else "denominator"
