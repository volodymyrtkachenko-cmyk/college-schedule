import asyncio

import httpx
from fastapi import APIRouter

from app.config import settings
from app.core.time import KYIV_TZ
from app.database import async_session_factory
from app.routers.classroom.accounts import (
    bulk_import_group_students,
    delete_classroom_credential,
    get_group_students,
    remove_group_student,
    router as accounts_router,
    sync_group_classroom_now,
)
from app.routers.classroom.diagnostics import (
    clear_all_classroom_data,
    get_classroom_credentials_diagnostics,
    get_classroom_group_status,
    get_classroom_status,
    router as diagnostics_router,
)
from app.routers.classroom.sync import (
    disconnect_classroom_account,
    get_user_submissions_get,
    get_user_submissions_post,
    manual_trigger_sync_all,
    router as sync_router,
    sync_from_classroom,
)
from app.schemas.classroom import (
    BulkStudentsPayload,
    ClassroomDisconnectRequest,
    ClassroomSyncRequest,
    ClassroomUserSubmissionsRequest,
)
from app.services.classroom.parser import (
    BELL_END_MINUTES,
    COMMON_FIRST_NAMES,
    IGNORE_ROSTER_LINES,
    STOP_WORDS,
    SUBJECT_RULES,
    URL_RE,
    _extract_group_from_course_name,
    _fold,
    _link_line_belongs_to_sync,
    _link_line_prefix,
    _matches_lesson,
    _norm,
    _parse_announcement,
    _resolve_matched_teacher_surname,
    _task_line_belongs_to_sync,
    _time_to_lesson_number,
    extract_surname,
    ukr_sort_key,
)
from app.services.classroom.state import (
    CACHE_TTL_TEACHERS_TOPICS,
    CLASSROOM_AUTO_SYNC_HEARTBEAT_KEY,
    MAX_ACCOUNTS_PER_CYCLE,
    _SYNC_LOCK_GROUPS,
    _course_teachers_cache,
    _course_topics_cache,
    _iso_utc,
    _last_request_trigger,
    _last_students_synced_at,
    _latest_group_tasks,
    _latest_scope_missing,
    _latest_unmapped_tasks,
    _read_classroom_heartbeat,
    _sync_backoff_state,
    _write_classroom_heartbeat,
)
from app.services.classroom.storage import (
    _save_link_to_slot,
    _upsert_task_line,
    ensure_known_online_links,
)
from app.services.classroom.sync import (
    _build_group_accounts_summary,
    _fetch_user_submissions,
    perform_course_sync,
)
from app.services.classroom.tokens import (
    DEFAULT_GOOGLE_CLIENT_ID,
    RECOMMENDED_CLASSROOM_SCOPES,
    REQUIRED_CLASSROOM_SCOPES,
    _apply_credential_backoff,
    _get_stable_fernet_keys,
    _is_permanent_courses_error,
    _is_permanent_token_error,
    _is_transient_recoverable_error,
    _refresh_google_token,
    _refresh_google_token_detailed,
    _sanitize_error_msg,
    decrypt_token,
    decrypt_token_detailed,
    encrypt_token,
    get_google_client_id,
    get_google_client_secret,
    rotate_token,
)
from app.services.classroom.worker import (
    _get_classroom_min_sync_gap_seconds,
    _get_classroom_sync_interval_seconds,
    classroom_auto_sync_loop,
    get_adaptive_classroom_sync_interval_seconds,
    perform_daily_credentials_health_check,
    run_background_sync_task,
    should_trigger_background_sync,
    sync_all_connected_groups_once,
    trigger_background_sync_if_needed,
)

router = APIRouter(prefix="/api/classroom", tags=["classroom"])
router.include_router(sync_router)
router.include_router(accounts_router)
router.include_router(diagnostics_router)
