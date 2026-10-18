import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select

from app.analytics import track_request
from app.config import settings
from app.database import engine, async_session_factory
from app.routers import schedule_versions, lesson_notes
from app.routers import (
    admin_import, aliases, auth, curriculums, directory, drafts, educational_process, generator,
    health, schedule, schedule_periods, statistics, settings as settings_router, teacher_constraints, users,
    schedule_dated, schedule_template,
)
from app.models import AcademicEvent, GroupStudent, ClassroomGroupBinding
from app.routers.classroom import router as classroom_router
from app.routers.events import router as events_router
from app.routers.schedule_now import router as schedule_now_router

async def background_classroom_sync():
    """Фоновий воркер: кожні 15 хв оновлює Classroom для всіх підключених груп."""
    from app.routers.classroom import trigger_background_sync_if_needed
    import logging
    while True:
        await asyncio.sleep(900)  # 15 хвилин
        try:
            async with async_session_factory() as db:
                bindings = (await db.scalars(
                    select(ClassroomGroupBinding).where(ClassroomGroupBinding.is_active.is_(True))
                )).all()
                for binding in bindings:
                    await trigger_background_sync_if_needed(db, binding.group_id)
                    await asyncio.sleep(10)  # Пауза між групами, щоб не вибити ліміти Google API
        except asyncio.CancelledError:
            break
        except Exception as e:
            logging.getLogger(__name__).error(f"Global auto-sync error: {e}")

@asynccontextmanager
async def lifespan(_: FastAPI):
    sync_task = asyncio.create_task(background_classroom_sync())
    async with engine.begin() as conn:
        await conn.run_sync(AcademicEvent.__table__.create, checkfirst=True)
        await conn.run_sync(GroupStudent.__table__.create, checkfirst=True)
        await conn.run_sync(ClassroomGroupBinding.__table__.create, checkfirst=True)
        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS full_name VARCHAR(150)"))
            await conn.execute(text("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email VARCHAR(255)"))
            await conn.execute(text("ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS lesson_number INTEGER"))
            await conn.execute(text("ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS custom_subject VARCHAR(200)"))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_schedule_active_lookup "
                "ON schedule (version_id, is_active, day_of_week, group_id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_imp_changes_lookup "
                "ON imported_schedule_changes (date, is_published, group_id, lesson_number, version DESC)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_override_date_group "
                "ON schedule_override (date, group_id, lesson_number)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_notes_week_lookup "
                "ON lesson_occurrence_notes (note_date, group_id, archived)"
            ))
        except Exception:
            pass
    try:
        yield
    finally:
        sync_task.cancel()
        await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Backend API for the College Schedule project.",
    lifespan=lifespan,
)

from app.routers.auth import limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    GZipMiddleware,
    minimum_size=500
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS", "PUT"],
    allow_headers=["Content-Type", "Authorization", "Accept", "Origin"],
)

@app.middleware("http")
async def analytics_middleware(request: Request, call_next):
    from app.analytics import record_request_metrics
    import time
    start_time = time.time()
    try:
        track_request(request)
        response = await call_next(request)
        duration_ms = (time.time() - start_time) * 1000
        record_request_metrics(duration_ms, response.status_code >= 500)
        return response
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        record_request_metrics(duration_ms, True)
        raise e

from app.routers import schedule_dated

app.include_router(health.router, prefix="/api")
app.include_router(schedule_dated.router)
app.include_router(schedule_template.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(lesson_notes.router, prefix="/api")
app.include_router(schedule_now_router, prefix="/api/schedule")
app.include_router(directory.router, prefix="/api")
app.include_router(directory.admin_router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(curriculums.router, prefix="/api")
app.include_router(generator.router, prefix="/api")
app.include_router(drafts.router, prefix="/api")
app.include_router(educational_process.router, prefix="/api")
app.include_router(schedule_periods.router, prefix="/api")
app.include_router(schedule_versions.router, prefix="/api")
app.include_router(statistics.router, prefix="/api")
app.include_router(admin_import.router, prefix="/api")
app.include_router(aliases.router, prefix="/api")
app.include_router(teacher_constraints.router, prefix="/api")
app.include_router(events_router)
app.include_router(classroom_router)

@app.api_route("/api/ping", methods=["GET", "POST"])
async def ping(leave: int = 0):
    return {"status": "ok"}


