from datetime import date
from typing import Optional

from pydantic import BaseModel


class ClassroomSyncRequest(BaseModel):
    code: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    google_user_id: Optional[str] = None
    email: Optional[str] = None
    group_id: Optional[int] = None
    week_start: Optional[date] = None


class ClassroomDisconnectRequest(BaseModel):
    group_id: Optional[int] = None
    google_user_id: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None


class ClassroomUserSubmissionsRequest(BaseModel):
    group_id: Optional[int] = None
    google_user_id: Optional[str] = None
    email: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None


class BulkStudentsPayload(BaseModel):
    raw_text: str
    replace_existing: bool = False
