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
from app.routers import schedule_versions, lesson_notes, terms as terms_router
from app.routers import (
    admin_import, aliases, auth, curriculums, directory, drafts, educational_process, generator,
    health, schedule, schedule_periods, statistics, settings as settings_router, teacher_constraints, users,
    schedule_dated, schedule_template,
)
from app.routers.classroom import router as classroom_router
from app.routers.events import router as events_router
from app.routers.schedule_now import router as schedule_now_router

from app.routers.classroom import classroom_auto_sync_loop
from app.routers.admin_import import schedule_auto_import_loop

@asynccontextmanager
async def lifespan(_: FastAPI):
    import os
    import secrets
    import logging
    from sqlalchemy import text

    logger = logging.getLogger("app")
    run_cron = os.environ.get("RUN_CRON", "true").strip().lower() not in ("false", "0", "no")
    classroom_sync_task = asyncio.create_task(classroom_auto_sync_loop()) if run_cron else None
    auto_import_task = asyncio.create_task(schedule_auto_import_loop()) if run_cron else None

    # Schema evolution is managed exclusively via Alembic migrations (`alembic upgrade head`).
    # Optional table bootstrap is supported only for ephemeral in-memory test databases when RUN_SCHEMA_BOOTSTRAP=true.
    run_bootstrap = settings.run_schema_bootstrap or os.environ.get("RUN_SCHEMA_BOOTSTRAP", "").strip().lower() in ("true", "1", "yes")
    async with engine.begin() as conn:
        if run_bootstrap:
            try:
                from app.database import Base
                await conn.run_sync(Base.metadata.create_all, checkfirst=True)
            except Exception:
                logger.warning("Schema bootstrap error during startup", exc_info=True)

        # Operational data updates (always run)
        try:
            if conn.dialect.name == "postgresql":
                # Archive stale pending import drafts older than 12 hours
                await conn.execute(text(
                    "UPDATE schedule_drafts SET status = 'archived' "
                    "WHERE draft_type = 'import' AND status = 'pending' AND created_at < NOW() - INTERVAL '12 hours'"
                ))
            await conn.execute(text(
                "UPDATE schedule_drafts SET status = 'TIMEOUT' "
                "WHERE status = 'GENERATING'"
            ))
            # Sync postgres sequences in a single round-trip to avoid duplicate key violations after migrations/restores
            if conn.dialect.name == "postgresql":
                await conn.execute(text("""
                    DO $$
                    DECLARE
                        tbl text;
                        seq_name text;
                        max_id bigint;
                    BEGIN
                        FOREACH tbl IN ARRAY ARRAY[
                            'schedule_publications',
                            'schedule_publication_snapshots',
                            'imported_schedule_changes',
                            'schedule_drafts',
                            'schedule_slots',
                            'schedule_override',
                            'schedule',
                            'curriculums',
                            'groups',
                            'teachers',
                            'subjects'
                        ] LOOP
                            seq_name := pg_get_serial_sequence(tbl, 'id');
                            IF seq_name IS NOT NULL THEN
                                EXECUTE format('SELECT COALESCE(MAX(id), 1) FROM %I', tbl) INTO max_id;
                                PERFORM setval(seq_name, max_id);
                            END IF;
                        END LOOP;
                    END $$;
                """))
        except Exception:
            logger.warning("Data housekeeping error during startup", exc_info=True)

    try:
        from app.database import async_session_factory
        from app.models import User, Schedule
        from app.core.security import hash_password
        from sqlalchemy import select, func
        async with async_session_factory() as db:
            admin_user = await db.scalar(select(User).where(User.username == "admin"))
            if not admin_user:
                admin_pw = settings.admin_password or os.environ.get("ADMIN_PASSWORD")
                if not admin_pw:
                    if settings.environment.lower() == "production":
                        logger.error(
                            "ADMIN_PASSWORD is not set in production. Skipping default admin creation for security."
                        )
                        admin_pw = None
                    else:
                        admin_pw = secrets.token_urlsafe(16)
                        logger.warning(
                            "No ADMIN_PASSWORD provided. Generated temporary admin password for 'admin': %s",
                            admin_pw,
                        )

                if admin_pw:
                    db.add(User(
                        username="admin",
                        name="Адміністратор",
                        password_hash=hash_password(admin_pw),
                        role="admin",
                        is_active=True,
                    ))
                    await db.commit()
                    logger.info("Default admin user created successfully.")

            schedule_count = await db.scalar(select(func.count()).select_from(Schedule))
            if not schedule_count:
                from scripts.apply_schedule_json import run, DEFAULT_FILE
                if DEFAULT_FILE.exists():
                    await run(DEFAULT_FILE, version_id=None, apply=True)
    except Exception as seed_exc:
        logger.warning("Initial auto-seed skipped: %s", seed_exc, exc_info=True)

    try:
        yield
    finally:
        if classroom_sync_task:
            classroom_sync_task.cancel()
        if auto_import_task:
            auto_import_task.cancel()
        await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Backend API for the College Schedule project.",
    lifespan=lifespan,
)

from app.routers.auth import limiter
from fastapi.responses import JSONResponse
import traceback
import logging

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.getLogger("app").error(
        f"Unhandled exception on {request.method} {request.url}",
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутрішня помилка сервера"},
    )

app.add_middleware(
    GZipMiddleware,
    minimum_size=1000,
    compresslevel=5,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://college-schedule.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=86400,
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
app.include_router(terms_router.router, prefix="/api")
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


