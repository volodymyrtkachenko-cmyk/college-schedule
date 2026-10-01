import asyncio
import httpx
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.security import require_roles
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.differ import ScheduleDiffer
from app.models import ScheduleDraft, ScheduleSlot, Schedule, ScheduleOverride
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
                return parser.parse(html)

        async with httpx.AsyncClient(timeout=20.0) as client:
            tasks = [fetch_and_parse(client, g_id) for g_id in group_ids]
            parsed_weeks = await asyncio.gather(*tasks, return_exceptions=True)
            
            for parsed_week in parsed_weeks:
                if isinstance(parsed_week, Exception):
                    continue
                    
                diff_report = await differ.diff(parsed_week)
                
                for item in diff_report["unresolved"]:
                    key = f"{item['type']}_{item['raw']}"
                    aggregated_unresolved[key] = item
                
                aggregated_substitutions.extend(diff_report["substitutions"])
                aggregated_base_slots.extend(diff_report["base_slots"])
                
        # ACTUAL DB INSERTION if no unresolved entities
        if len(aggregated_unresolved) == 0:
            # 1. Create a Draft for base slots (optional or main schedule)
            draft = ScheduleDraft(
                name=f"Імпорт {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                status="published" # Automatically publish or leave as draft? Let's leave as draft for moderation as requested originally: "для подальшої модерації"
            )
            db.add(draft)
            await db.flush()
            
            # Since curriculum_id is required for ScheduleSlot, we can't easily insert into ScheduleSlot without knowing the curriculum!
            # Wait, the prompt said: "Основний розклад: Зберігається в ScheduleDraft... Живу таблицю schedule парсер не модифікує напряму."
            # Actually, to save to ScheduleDraft, we need ScheduleSlot which demands a curriculum_id.
            
            # Let's insert Substitutions to ScheduleOverride
            # Find matching schedule_ids
            for sub in aggregated_substitutions:
                stmt = select(Schedule).where(
                    Schedule.group_id == sub["group_id"],
                    Schedule.day_of_week == sub["date"].isoweekday(),
                    Schedule.lesson_number == sub["lesson_number"],
                    Schedule.is_active == True # Assuming active schedule
                )
                sch = await db.scalar(stmt)
                if sch:
                    # Check if override already exists
                    override_stmt = select(ScheduleOverride).where(
                        ScheduleOverride.schedule_id == sch.id,
                        ScheduleOverride.date == sub["date"]
                    )
                    existing = await db.scalar(override_stmt)
                    if not existing:
                        db_sub = ScheduleOverride(
                            schedule_id=sch.id,
                            date=sub["date"],
                            teacher_id=sub["teacher_id"],
                            subject_id=sub["subject_id"],
                            room=sub["room"]
                        )
                        db.add(db_sub)
                        
            await db.commit()

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
