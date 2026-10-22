"""Classroom access verification and schedule content sanitization."""
import re
from typing import Optional, Sequence
from fastapi import Request
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClassroomCredential, GroupStudent, User
from app.core.security import decode_token

# Regex to match video conference and classroom URLs in note/room
MEETING_URL_RE = re.compile(
    r"https?://(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)/[^\s<>\"')|]+",
    re.IGNORECASE,
)
ZOOM_PASS_RE = re.compile(
    r"(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)",
    re.IGNORECASE,
)


async def check_classroom_group_access(
    db: AsyncSession,
    group_id: int | None,
    request: Optional[Request] = None,
) -> bool:
    """
    Checks if the requester has authorized access to group_id's online meetings and classroom tasks.
    Returns True if:
    - group_id is None (e.g. general query)
    - User is an admin or editor (via Authorization Bearer JWT)
    - Request carries X-Classroom-User-Id or X-Classroom-Email that belongs to group_id in ClassroomCredential or GroupStudent
    """
    if not group_id:
        return True
    if request is None:
        return True

    # 1. Check for staff / admin JWT
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            payload = decode_token(token, "access")
            role = payload.get("role")
            if role in ("admin", "editor"):
                return True
        except Exception:
            pass

    # 2. Extract client-provided classroom credentials
    classroom_uid = (
        request.headers.get("x-classroom-user-id")
        or request.query_params.get("classroom_user_id")
    )
    classroom_email = (
        request.headers.get("x-classroom-email")
        or request.query_params.get("classroom_email")
    )
    if classroom_email:
        classroom_email = classroom_email.strip().lower()
    if classroom_uid:
        classroom_uid = classroom_uid.strip()

    if not classroom_uid and not classroom_email:
        return False

    # 3. Check ClassroomCredential table
    cred_conditions = [ClassroomCredential.group_id == group_id, ClassroomCredential.is_active.is_(True)]
    match_conditions = []
    if classroom_uid:
        match_conditions.append(ClassroomCredential.google_user_id == classroom_uid)
    if classroom_email and classroom_email != "підключено":
        match_conditions.append(func.lower(ClassroomCredential.email) == classroom_email)

    if match_conditions:
        cred = await db.scalar(
            select(ClassroomCredential.id).where(
                *cred_conditions,
                or_(*match_conditions)
            ).limit(1)
        )
        if cred:
            return True

    # 4. Check GroupStudent table
    student_conditions = [GroupStudent.group_id == group_id]
    student_match = []
    if classroom_uid:
        student_match.append(GroupStudent.classroom_user_id == classroom_uid)
    if classroom_email and classroom_email != "підключено":
        student_match.append(func.lower(GroupStudent.email) == classroom_email)

    if student_match:
        student = await db.scalar(
            select(GroupStudent.id).where(
                *student_conditions,
                or_(*student_match)
            ).limit(1)
        )
        if student:
            return True

    return False


def sanitize_note_for_guest(note: Optional[str]) -> tuple[Optional[str], bool]:
    """
    Strips raw meeting URLs, passwords, and [TASK] lines from note for unauthorized users,
    replacing meeting URLs with a protected marker [🔒 Онлайн].
    Returns (sanitized_note, had_meeting).
    """
    if not note:
        return None, False

    lines = note.split("\n")
    sanitized_lines = []
    had_meeting = False

    for line in lines:
        stripped = line.strip()
        # Remove [TASK] lines for guests
        if stripped.startswith("[TASK]"):
            continue
        # Check meeting URLs
        if MEETING_URL_RE.search(line):
            had_meeting = True
            def _sub_repl(match: re.Match) -> str:
                target_url = match.group(0).lower()
                if "meet.google.com" in target_url:
                    return "[🔒 Онлайн: Meet]"
                elif "zoom.us" in target_url:
                    return "[🔒 Онлайн: Zoom]"
                elif "teams." in target_url:
                    return "[🔒 Онлайн: Teams]"
                return "[🔒 Онлайн]"
            line = MEETING_URL_RE.sub(_sub_repl, line)
        # Remove zoom passcode lines
        if ZOOM_PASS_RE.search(line):
            line = ZOOM_PASS_RE.sub("", line).strip()
        if line.strip():
            sanitized_lines.append(line)

    result = "\n".join(sanitized_lines).strip()
    return (result if result else None), had_meeting


def sanitize_room_for_guest(room: Optional[str]) -> tuple[Optional[str], bool]:
    """If room contains meeting URL, replace it with 'Онлайн'."""
    if not room:
        return None, False
    if MEETING_URL_RE.search(room):
        return "Онлайн", True
    return room, False
