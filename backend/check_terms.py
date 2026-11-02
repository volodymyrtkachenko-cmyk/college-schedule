import asyncio
from app.database import async_session
import sqlalchemy as sa

async def main():
    async with async_session() as s:
        terms = (await s.execute(sa.text("SELECT id, name, is_current, total_weeks, status FROM academic_terms"))).fetchall()
        print("TERMS:", terms)
        courses = (await s.execute(sa.text("SELECT course, theory_weeks, practice_weeks, practice_timing FROM term_course_schedules ORDER BY course"))).fetchall()
        print("COURSES:", courses)
        currs = (await s.execute(sa.text("SELECT count(*), count(term_id) FROM curriculums"))).fetchall()
        print("CURRICULUMS:", currs)
        drafts = (await s.execute(sa.text("SELECT count(*), count(term_id) FROM schedule_drafts"))).fetchall()
        print("DRAFTS:", drafts)

if __name__ == "__main__":
    asyncio.run(main())