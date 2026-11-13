"""Thin HTTP router for schedule import, settings, permanent sync, and Neon migration."""

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.rate_limit import limiter
from app.core.security import require_roles
from app.database import get_db
from app.schemas.admin_import import MigrateRequest, PermanentSyncRequest
from app.services.importer.differ import ScheduleDiffer
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.hashing import (
    canonical_change_records as _canonical_change_records,
    import_changes_hash,
    import_payload_hash,
)
from app.services.importer.migration import migrate_from_neon_db, sync_permanent_schedule
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.orchestrator import (
    IMPORT_PAGE_RETRIES,
    _do_import,
    dismiss_import_notification,
    execute_import_logic,
    get_import_status_summary,
    update_import_settings_values,
)
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.validation import (
    _cancellation_matches_schedule,
    _deduplicate_import_changes,
    _substitution_matches_schedule,
    annotate_substitutions_and_swaps,
    get_import_settings,
    matches_published_schedule,
    validate_and_sanitize_import_items,
)
from app.services.importer.worker import (
    get_next_auto_import_delay_seconds,
    get_next_auto_import_target,
    prune_stale_data,
    schedule_auto_import_loop,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

__all__ = [
    "IMPORT_PAGE_RETRIES",
    "MigrateRequest",
    "PermanentSyncRequest",
    "router",
    "ScheduleFetcher",
    "KREParser",
    "EntityNormalizer",
    "ScheduleDiffer",
    "_canonical_change_records",
    "_cancellation_matches_schedule",
    "_deduplicate_import_changes",
    "_substitution_matches_schedule",
    "annotate_substitutions_and_swaps",
    "get_import_settings",
    "import_changes_hash",
    "import_payload_hash",
    "matches_published_schedule",
    "validate_and_sanitize_import_items",
    "execute_import_logic",
    "_do_import",
    "get_next_auto_import_target",
    "get_next_auto_import_delay_seconds",
    "prune_stale_data",
    "schedule_auto_import_loop",
]


@router.post("/import")
async def trigger_import(
    request: Request,
    weeks: int = Query(1, ge=1, le=4, description="Number of weeks to fetch"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin")),
):
    logger.info("Manual import accepted: actor=%s weeks=%s", user.id, weeks)
    return await execute_import_logic(db, weeks, actor_id=user.id)


@router.get("/import/status")
async def get_import_status_endpoint(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin", "editor")),
):
    return await get_import_status_summary(db)


@router.get("/import/settings")
async def get_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin")),
):
    return await get_import_settings(db)


@router.put("/import/settings")
async def update_settings_endpoint(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin")),
):
    return await update_import_settings_values(db, payload)


@router.post("/import/notification/dismiss")
async def dismiss_notification_endpoint(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin", "editor")),
):
    return await dismiss_import_notification(db)


@router.post("/import/cron")
@limiter.limit("3/hour")
async def import_data_cron(
    request: Request,
    db: AsyncSession = Depends(get_db),
    cron_key: str | None = Header(None, alias="X-Cron-Key"),
):
    import_secret = getattr(settings, "IMPORT_CRON_SECRET", None)
    if not import_secret or not cron_key:
        logger.warning("Cron import denied: missing configuration or key")
        raise HTTPException(status_code=401, detail="Unauthorized cron")

    if not hmac.compare_digest(cron_key.encode(), import_secret.encode()):
        logger.warning("Cron import denied: invalid key")
        raise HTTPException(status_code=401, detail="Unauthorized cron")

    logger.info("Cron import accepted")
    return await execute_import_logic(db, 2, actor_id=None)


@router.post("/sync-permanent-schedule")
async def sync_permanent_schedule_endpoint(
    payload: PermanentSyncRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    return await sync_permanent_schedule(db, payload)


@router.post("/migrate-from-neon")
async def migrate_from_neon(
    payload: MigrateRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    return await migrate_from_neon_db(db, payload)
