import asyncio
import httpx
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.security import require_roles
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.differ import ScheduleDiffer
from app.models import ScheduleDraft, ScheduleSlot, Schedule, ScheduleOverride, Curriculum
import traceback

router = APIRouter(prefix="/admin", tags=["admin"])

@router.post("/import")
async def trigger_import(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin"))
):
    fetcher = ScheduleFetcher()
    parser = KREParser()
    try:
        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        differ = ScheduleDiffer(db, normalizer)

        group_ids = await fetcher.get_all_group_ids()
        
        aggregated_unresolved = {}
        aggregated_substitutions = []
        aggregated_base_slots = []
        
        semaphore = asyncio.Semaphore(5)
        
        async def fetch_and_parse(client, g_id):
            async with semaphore:
                url = f"{fetcher.base_url}?group={g_id}"
                html = await fetcher.fetch_html(client, url)
                parsed_results = [parser.parse(html)]
                
                # Fetch next week
                from selectolax.parser import HTMLParser
                tree = HTMLParser(html)
                next_week_node = tree.css_first("a[aria-label='Наступний тиждень']")
                if next_week_node:
                    href = next_week_node.attributes.get("href")
                    if href:
                        if not href.startswith("http"):
                            href = "https://kre.dp.ua" + (href if href.startswith("/") else f"/{href}")
                        try:
                            html2 = await fetcher.fetch_html(client, href)
                            parsed_results.append(parser.parse(html2))
                        except Exception as e:
                            print(f"Failed to fetch next week for group {g_id}: {e}")
                
                return parsed_results

        async with httpx.AsyncClient(timeout=20.0) as client:
            tasks = [fetch_and_parse(client, g_id) for g_id in group_ids]
            parsed_weeks = await asyncio.gather(*tasks, return_exceptions=True)
            
            for parsed_week_list in parsed_weeks:
                if isinstance(parsed_week_list, Exception):
                    continue
                for parsed_week in parsed_week_list:
                    diff_report = await differ.diff(parsed_week)
                    for item in diff_report["unresolved"]:
                        key = f"{item['type']}_{item['raw']}"
                        aggregated_unresolved[key] = item
                    aggregated_substitutions.extend(diff_report["substitutions"])
                    aggregated_base_slots.extend(diff_report["base_slots"])
                
        if len(aggregated_unresolved) == 0:
            # Deduplicate base slots (since we fetch 2 weeks, same lesson might repeat)
            unique_slots = {}
            for s in aggregated_base_slots:
                k = (s["group_id"], s["subject_id"], s["teacher_id"], s["day_of_week"], s["lesson_number"])
                unique_slots[k] = s
            aggregated_base_slots = list(unique_slots.values())
            
            # CREATE DRAFT SCHEDULE
            draft_name = f"Імпорт {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            draft = ScheduleDraft(name=draft_name)
            db.add(draft)
            await db.flush()
            
            # Save Base Slots
            for slot in aggregated_base_slots:
                # 1. Ensure Curriculum exists
                stmt_c = select(Curriculum).where(
                    Curriculum.group_id == slot["group_id"],
                    Curriculum.subject_id == slot["subject_id"]
                )
                if slot["teacher_id"]:
                    stmt_c = stmt_c.where(Curriculum.teacher_id == slot["teacher_id"])
                
                curr = await db.scalar(stmt_c)
                if not curr:
                    curr = Curriculum(
                        group_id=slot["group_id"],
                        subject_id=slot["subject_id"],
                        teacher_id=slot["teacher_id"] or 1, # fallback if null
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
                    room_override=slot["room"]
                )
                db.add(db_slot)
                
            # Save Substitutions (only applied if standard schedule actually exists active)
            # Or if it doesn't exist, we will just save them and they apply when the admin publishes
            inserted_subs = 0
            for sub in aggregated_substitutions:
                stmt_s = select(Schedule).where(
                    Schedule.group_id == sub["group_id"],
                    Schedule.day_of_week == sub["date"].isoweekday(),
                    Schedule.lesson_number == sub["lesson_number"],
                    Schedule.is_active == True
                )
                sch = await db.scalar(stmt_s)
                if sch:
                    override_chk = select(ScheduleOverride).where(
                        ScheduleOverride.schedule_id == sch.id,
                        ScheduleOverride.date == sub["date"]
                    )
                    if not await db.scalar(override_chk):
                        db_sub = ScheduleOverride(
                            schedule_id=sch.id,
                            date=sub["date"],
                            teacher_id=sub["teacher_id"],
                            subject_id=sub["subject_id"],
                            room=sub["room"]
                        )
                        db.add(db_sub)
                        inserted_subs += 1
                        
            await db.commit()
            
            return {
                "status": "success", 
                "groups_processed": len(group_ids),
                "report": {
                    "unresolved": list(aggregated_unresolved.values()),
                    "substitutions": aggregated_substitutions,
                    "base_slots": aggregated_base_slots
                },
                "meta": {
                    "draft_created": draft.id,
                    "inserted_subs": inserted_subs
                }
            }

        return {
            "status": "success", 
            "groups_processed": len(group_ids),
            "report": {
                "unresolved": list(aggregated_unresolved.values()),
                "substitutions": aggregated_substitutions,
                "base_slots": aggregated_base_slots
            }
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
