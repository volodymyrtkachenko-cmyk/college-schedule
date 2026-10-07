from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.analytics import track_request
from app.config import settings
from app.database import engine
from app.routers import schedule_versions
from app.routers import (
    admin_import, aliases, auth, curriculums, directory, drafts, educational_process, generator,
    health, lesson_notes, schedule, schedule_periods, statistics,
    settings as settings_router, teacher_constraints, users,
)
from app.routers.schedule_now import router as schedule_now_router


import asyncio

import os

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Запуск міграцій автоматично на старті (важливо для Render, де entrypoint.sh може ігноруватися)
    # На Fly.io ми відключаємо це через змінну RUN_MIGRATIONS=false, бо там є release_command.
    if os.environ.get("RUN_MIGRATIONS", "true").lower() == "true" and not os.environ.get("FLY_REGION"):
        def run_migrations():
            from alembic.config import Config
            from alembic import command
            alembic_cfg = Config("alembic.ini")
            command.upgrade(alembic_cfg, "head")
            
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, run_migrations)
            print("Міграції успішно застосовано.")
        except Exception as e:
            print(f"Помилка при виконанні міграцій: {e}")

        
        # Запуск імпорту графіку освітнього процесу
        try:
            from scripts.import_eps import async_main as import_eps_main
            print("Імпорт Графіку освітнього процесу на 2026/2027...")
            await import_eps_main()
            print("Імпорт успішно завершено!")
        except Exception as e:
            print(f"Помилка імпорту: {e}")

    # --- Background Cron Job for Auto Import ---
    async def auto_import_loop():
        # Start the loop, wait a bit first so app can finish starting
        await asyncio.sleep(60)
        from app.routers.admin_import import trigger_import
        from app.database import async_session_factory
        from fastapi import Request
        class DummyRequest:
            headers = {}
        
        while True:
            try:
                async with async_session_factory() as db:
                    print("Запуск автоматичного імпорту замін...")
                    # Pass a dummy request without secret, but we bypass auth check because we will just patch it to accept an internal call
                    await trigger_import(request=DummyRequest(), weeks=2, db=db, _import_lock=None, internal_cron=True)
            except Exception as e:
                print(f"Помилка автоматичного імпорту: {e}")
            
            # Wait 1 hour
            await asyncio.sleep(3600)
    
    # Start background task if on Fly.io or RUN_CRON is set
    if os.environ.get("FLY_REGION") or os.environ.get("RUN_CRON") == "true":
        cron_task = asyncio.create_task(auto_import_loop())
    else:
        cron_task = None

    yield
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
    track_request(request)
    response = await call_next(request)
    return response

app.include_router(health.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(schedule_now_router, prefix="/api/schedule")
app.include_router(directory.router, prefix="/api")
app.include_router(directory.admin_router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(lesson_notes.router, prefix="/api")
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

@app.api_route("/api/ping", methods=["GET", "POST"])
async def ping(leave: int = 0):
    return {"status": "ok"}

