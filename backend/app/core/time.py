from datetime import datetime, date
from zoneinfo import ZoneInfo
from app.config import settings

def get_tz():
    return ZoneInfo(getattr(settings, 'APP_TIMEZONE', 'Europe/Kyiv'))

def now_local() -> datetime:
    return datetime.now(get_tz())

def today_local() -> date:
    return now_local().date()
