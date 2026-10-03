from fastapi import Request
from app.config import settings
import asyncio
import httpx
import hashlib
import json
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security.api_key import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.security import require_roles
from app.core.time import now_local
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.differ import ScheduleDiffer
from app.models import ScheduleDraft, ScheduleSlot, Curriculum
import traceback

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

def hash_payload(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

@router.post("/import")
async def trigger_import(
    request: Request,
    weeks: int = Query(2, description="Number of weeks to fetch"),
    db: AsyncSession = Depends(get_db),
):
    # Check auth
    cron_secret = request.headers.get("Authorization")
    if cron_secret and cron_secret.startswith("Bearer "):
        cron_secret = cron_secret.split(" ")[1]
    
    # We should allow if cron_secret matches WIPE_SECRET or some other secret
    is_cron = cron_secret == getattr(settings, "WIPE_SECRET", None)
    if not is_cron:
        if not cron_secret:
            raise HTTPException(status_code=401, detail="No authorization token")
        # Check standard admin token
        from app.core.security import get_current_user
        from fastapi.security import HTTPAuthorizationCredentials
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=cron_secret)
        user = await get_current_user(credentials=credentials, db=db)
        if not user or user.role != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
    
    fetcher = ScheduleFetcher()
    parser = KREParser()
    try:
        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        differ = ScheduleDiffer(db, normalizer)

        group_ids = await fetcher.get_all_group_ids()
        
        aggregated_unresolved = {}
        aggregated_unresolved_subs = []
        aggregated_substitutions = []
        aggregated_cancelled = []
        aggregated_base_slots = []
        errors = []
        
        semaphore = asyncio.Semaphore(5)
        
        async def fetch_and_parse(client, g_id):
            async with semaphore:
                parsed_results = []
                url = f"{fetcher.base_url}?group={g_id}"
                
                for _ in range(weeks):
                    try:
                        html = await fetcher.fetch_html(client, url)
                        parsed = parser.parse(html)
                        parsed_results.append(parsed)
                        
                        # Find next week link
                        from selectolax.parser import HTMLParser
                        tree = HTMLParser(html)
                        next_week_node = tree.css_first("a[aria-label='Наступний тиждень']")
                        if next_week_node:
                            href = next_week_node.attributes.get("href")
                            if href:
                                if not href.startswith("http"):
                                    href = "https://kre.dp.ua" + (href if href.startswith("/") else f"/{href}")
                                url = href
                            else:
                                break
                        else:
                            break
                    except Exception as e:
                        logger.error(f"Error parsing group {g_id} at {url}: {e}")
                        errors.append({"group": g_id, "url": url, "error": str(e)})
                        break
                        
                return parsed_results

        async with httpx.AsyncClient(timeout=20.0) as client:
            tasks = [fetch_and_parse(client, g_id) for g_id in group_ids]
            parsed_weeks = await asyncio.gather(*tasks, return_exceptions=True)
            
            for g_idx, parsed_week_list in enumerate(parsed_weeks):
                if isinstance(parsed_week_list, Exception):
                    errors.append({"group": group_ids[g_idx], "error": str(parsed_week_list)})
                    continue
                for parsed_week in parsed_week_list:
                    diff_report = await differ.diff(parsed_week)
                    for item in diff_report["unresolved"]:
                        key = f"{item['type']}_{item['raw']}"
                        aggregated_unresolved[key] = item
                    aggregated_substitutions.extend(diff_report["substitutions"])
                    aggregated_unresolved_subs.extend(diff_report["unresolved_substitutions"])
                    aggregated_cancelled.extend(diff_report["cancelled"])
                    aggregated_base_slots.extend(diff_report["base_slots"])
                
        # Deduplicate base slots
        unique_slots = {}
        for s in aggregated_base_slots:
            k = (s["group_id"], s["subject_id"], s["teacher_id"], s.get("second_teacher_id"), s["day_of_week"], s["lesson_number"], s["room"])
            if k in unique_slots:
                existing = unique_slots[k]
                if existing["week_type"] != s["week_type"]:
                    existing["week_type"] = "both"
            else:
                unique_slots[k] = s
        aggregated_base_slots = list(unique_slots.values())
        
        # Prepare payload for Draft Data
        payload = {
            "substitutions": aggregated_substitutions,
            "cancelled": aggregated_cancelled,
        }
        payload_hash = hash_payload(payload)
        
        # Check if identical draft exists
        stmt = select(ScheduleDraft).where(ScheduleDraft.status == "pending").order_by(ScheduleDraft.id.desc()).limit(1)
        last_draft = await db.scalar(stmt)
        if last_draft and hash_payload(last_draft.data or {}) == payload_hash:
            logger.info("Import payload identical to last pending draft. Skipping creation.")
            draft_id = last_draft.id
        else:
            draft_name = f"Імпорт {now_local().strftime('%Y-%m-%d %H:%M')}"
            draft = ScheduleDraft(name=draft_name, status="pending", data=payload)
            db.add(draft)
            await db.flush()
            draft_id = draft.id
            
            # Save Base Slots
            for slot in aggregated_base_slots:
                stmt_c = select(Curriculum).where(
                    Curriculum.group_id == slot["group_id"],
                    Curriculum.subject_id == slot["subject_id"]
                )
                if slot["teacher_id"]:
                    stmt_c = stmt_c.where(Curriculum.teacher_id == slot["teacher_id"])
                if slot.get("second_teacher_id"):
                    stmt_c = stmt_c.where(Curriculum.second_teacher_id == slot["second_teacher_id"])
                
                curr = await db.scalar(stmt_c)
                if not curr:
                    curr = Curriculum(
                        group_id=slot["group_id"],
                        subject_id=slot["subject_id"],
                        teacher_id=slot["teacher_id"] or 1,
                        second_teacher_id=slot.get("second_teacher_id"),
                        pairs_per_2_weeks=2,
                        total_hours=0
                    )
                    db.add(curr)
                    await db.flush()
                
                db_slot = ScheduleSlot(
                    draft_id=draft.id,
                    curriculum_id=curr.id,
                    day_of_week=slot["day_of_week"],
                    lesson_number=slot["lesson_number"],
                    room_override=slot["room"],
                    week_type=slot.get("week_type", "both")
                )
                db.add(db_slot)
                
            await db.commit()
            
        return {
            "status": "success", 
            "groups_processed": len(group_ids),
            "groups_ok": len(group_ids) - len(set(e["group"] for e in errors)),
            "groups_failed": len(set(e["group"] for e in errors)),
            "substitutions_found": len(aggregated_substitutions) + len(aggregated_unresolved_subs),
            "substitutions_saved": len(aggregated_substitutions),
            "substitutions_updated": 0, # Pending draft stores them
            "substitutions_unresolved": len(aggregated_unresolved_subs),
            "substitutions_orphaned": 0,
            "errors": errors,
            "report": {
                "unresolved": list(aggregated_unresolved.values()),
                "unresolved_substitutions": aggregated_unresolved_subs,
            },
            "meta": {
                "draft_created": draft_id,
            }
        }
    except Exception as e:
        logger.error(f"Import error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
