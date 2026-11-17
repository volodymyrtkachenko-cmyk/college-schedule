"""Classroom access verification and schedule content sanitization."""
import logging
import re
import secrets
from typing import Optional, Sequence
from fastapi import Request
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import ClassroomCredential, GroupStudent, User
from app.core.security import decode_token, verify_classroom_session_token

import time as _time

logger = logging.getLogger(__name__)

# Regex to match video conference and classroom URLs in note/room
MEETING_URL_RE = re.compile(
    r"https?://(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)/[^\s<>\"')|]+",
    re.IGNORECASE,
)
ZOOM_PASS_RE = re.compile(
    r"(?:Код(?:\s+доступ[уае]|\s+конференці[їі])?|Passcode|Пароль(?:\s+конференці[їі])?)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)",
    re.IGNORECASE,
)

_ACCESS_CACHE: dict[tuple, tuple[float, bool]] = {}
_ACCESS_CACHE_TTL = 300.0  # 5 minutes
_ACCESS_CACHE_MAX = 1000


def invalidate_classroom_access_cache(group_id: Optional[int] = None) -> None:
    if group_id is None:
        _ACCESS_CACHE.clear()
        return
    stale = [k for k in _ACCESS_CACHE if k[0] == group_id]
    for k in stale:
        _ACCESS_CACHE.pop(k, None)


async def check_teacher_access(
    db: AsyncSession,
    request: Optional[Request] = None,
) -> bool:
    """
    Checks if the requester is an authorized teacher or admin:
    - User has admin or editor JWT role
    - Request carries valid X-Teacher-Pin or query param teacher_pin matching configured teacher PIN
    """
    if request is None:
        return False

    # 1. Staff / Admin JWT
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            payload = decode_token(token, "access")
            role = payload.get("role")
            if role in ("admin", "editor", "teacher"):
                return True
        except Exception:
            pass

    # 2. Teacher PIN
    provided_pin = (
        request.headers.get("x-teacher-pin")
        or request.query_params.get("teacher_pin")
    )
    if provided_pin:
        from app.services.settings import settings_service
        expected_pin = (await settings_service.get_teacher_pin(db) or "").strip()
        if expected_pin and secrets.compare_digest(provided_pin.strip(), expected_pin):
            return True

    return False


async def _lookup_member_in_group(
    db: AsyncSession,
    group_id: int,
    classroom_uid: Optional[str],
    classroom_email: Optional[str],
) -> bool:
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


async def check_classroom_group_access(
    db: AsyncSession,
    group_id: int | None,
    request: Optional[Request] = None,
) -> bool:
    """
    Checks if the requester has authorized access to group_id's online meetings and classroom tasks.
    Returns True if:
    - User is an authorized teacher or admin (via Teacher PIN or JWT)
    - Request carries a valid signed X-Classroom-Session (or classroom_session query param) belonging to group_id
    - (When CLASSROOM_LEGACY_AUTH=true) Request carries legacy X-Classroom-User-Id or X-Classroom-Email
      that belongs to group_id in ClassroomCredential or GroupStudent (logged at WARNING level)
    """
    if request is None:
        return False

    # 1. Check for teacher PIN or staff / admin JWT
    if await check_teacher_access(db, request):
        return True

    if not group_id:
        return False

    now_mono = _time.monotonic()

    # 2. Check signed Classroom session token (verified identity)
    raw_session_token = (
        request.headers.get("x-classroom-session")
        or request.query_params.get("classroom_session")
    )
    if raw_session_token:
        verified = verify_classroom_session_token(raw_session_token)
        if verified:
            v_uid = verified.get("google_user_id")
            v_email = verified.get("email")
            v_gid = verified.get("group_id")
            cache_key = (group_id, v_uid, v_email, "verified")
            cached = _ACCESS_CACHE.get(cache_key)
            if cached is not None and (now_mono - cached[0]) < _ACCESS_CACHE_TTL:
                return cached[1]

            is_member = await _lookup_member_in_group(db, group_id, v_uid, v_email)
            if not is_member and v_gid is not None and int(v_gid) == int(group_id) and (v_uid or v_email):
                is_member = True

            if len(_ACCESS_CACHE) >= _ACCESS_CACHE_MAX:
                _ACCESS_CACHE.clear()
            _ACCESS_CACHE[cache_key] = (now_mono, is_member)
            if is_member:
                return True

    # 3. Legacy fallback: unverified X-Classroom-User-Id / X-Classroom-Email
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

    if not settings.classroom_legacy_auth:
        logger.warning(
            "Classroom legacy auth rejected (CLASSROOM_LEGACY_AUTH=false): group_id=%s uid=%s email=%s",
            group_id,
            classroom_uid,
            classroom_email,
        )
        return False

    logger.warning(
        "Classroom legacy auth used (unverified header/query): group_id=%s uid=%s email=%s",
        group_id,
        classroom_uid,
        classroom_email,
    )

    cache_key = (group_id, classroom_uid, classroom_email)
    cached = _ACCESS_CACHE.get(cache_key)
    if cached is not None and (now_mono - cached[0]) < _ACCESS_CACHE_TTL:
        return cached[1]

    result = await _lookup_member_in_group(db, group_id, classroom_uid, classroom_email)
    if len(_ACCESS_CACHE) >= _ACCESS_CACHE_MAX:
        _ACCESS_CACHE.clear()
    _ACCESS_CACHE[cache_key] = (now_mono, result)
    return result


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
            line = ZOOM_PASS_RE.sub("", line)
            line = re.sub(r"\|\s*\|", "|", line)
            line = re.sub(r"^\s*[|—–-]+\s*|\s*[|—–-]+\s*$", "", line)
            line = re.sub(r"\s{2,}", " ", line).strip()
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
