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
    Test endpoint for parsing the schedule. 
    It fetches live data, parses it, normalizes, and compares against the database defaults.
    """
    fetcher = ScheduleFetcher("https://kre.dp.ua/rozklad-zanyat?group=82")
    try:
        html, current_hash = await fetcher.fetch()
        
        parser = KREParser()
        parsed_week = parser.parse(html)
        
        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        
        differ = ScheduleDiffer(db, normalizer)
        diff_report = await differ.diff(parsed_week)
        
        return {
            "status": "success", 
            "content_hash": current_hash,
            "parsed_groups": parsed_week.groups,
            "report": diff_report
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
