import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.database import async_session_factory
from app.models.entities import ScheduleDraft


async def main():
    async with async_session_factory() as db:
        drafts = (
            await db.scalars(
                select(ScheduleDraft)
                .order_by(ScheduleDraft.id.desc())
                .limit(10)
            )
        ).all()
        for d in drafts:
            gen = d.data.get("generation", {}) if d.data else {}
            q = gen.get("quality", {})
            print(f"Draft #{d.id} ({d.draft_type}): status={d.status}, score={q.get('quality_score')}, hints={gen.get('hints_used')}, time={gen.get('elapsed_seconds')}s")
            print(f"   Quality: sym={q.get('symmetry_percent')}%, start1st={q.get('first_lesson_start_percent')}%, win={len(q.get('teacher_windows', []))}, single={len(q.get('teacher_single_pair_days', []))}")


if __name__ == "__main__":
    asyncio.run(main())

