import asyncio
import httpx
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.security import require_roles
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.differ import ScheduleDiffer
import traceback

router = APIRouter(prefix="/admin", tags=["admin"])

@router.post("/import")
async def trigger_import(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin"))
):
    """
    Parses the schedule for ALL groups on the site.
    Returns aggregated JSON for unresolved elements, new substitutions, and base slots.
    """
    fetcher = ScheduleFetcher()
    parser = KREParser()
    
    try:
        # Load aliases & DB dictionaries once
        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        differ = ScheduleDiffer(db, normalizer)

        group_ids = await fetcher.get_all_group_ids()
        
        aggregated_unresolved = {}
        aggregated_substitutions = []
        aggregated_base_slots = []
        
        # We will limit concurrency so we don't spam the college site too hard
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
                    print(f"Error parsing a group: {parsed_week}")
                    continue
                    
                diff_report = await differ.diff(parsed_week)
                
                # Aggregate unresolved uniquely
                for item in diff_report["unresolved"]:
                    key = f"{item['type']}_{item['raw']}"
                    aggregated_unresolved[key] = item
                
                aggregated_substitutions.extend(diff_report["substitutions"])
                aggregated_base_slots.extend(diff_report["base_slots"])
                
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
