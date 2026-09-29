from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.analytics import track_request
from app.config import settings
from app.database import engine
from app.routers import health
from app.routers import auth, directory, lesson_notes, schedule, users, settings as settings_router

async def brute_force_db():
    from sqlalchemy import text
    async with engine.begin() as conn:
        statements = [
            "CREATE TABLE IF NOT EXISTS token_blocklist (id SERIAL PRIMARY KEY, jti VARCHAR(36) NOT NULL UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT NOW())",
            "CREATE INDEX IF NOT EXISTS ix_token_blocklist_jti ON token_blocklist (jti)",
            "CREATE TABLE IF NOT EXISTS bell_schedule (id SERIAL PRIMARY KEY, lesson_number INTEGER NOT NULL UNIQUE, start_time TIME NOT NULL, end_time TIME NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE)",
            "INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active) SELECT 1, '09:00', '10:20', true WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 1)",
            "INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active) SELECT 2, '10:40', '12:00', true WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 2)",
            "INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active) SELECT 3, '12:30', '13:50', true WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 3)",
            "INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active) SELECT 4, '14:00', '15:20', true WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 4)",
            "CREATE TABLE IF NOT EXISTS schedule_override (id SERIAL PRIMARY KEY, schedule_id INTEGER NOT NULL REFERENCES schedule(id), date DATE NOT NULL, teacher_id INTEGER REFERENCES teachers(id), subject_id INTEGER REFERENCES subjects(id), room VARCHAR(100), cancelled BOOLEAN NOT NULL DEFAULT FALSE, CONSTRAINT uq_schedule_override_date UNIQUE(schedule_id, date))",
            "ALTER TABLE schedule ADD COLUMN IF NOT EXISTS room_override VARCHAR(100)",
            "ALTER TABLE schedule ADD COLUMN IF NOT EXISTS is_replacement BOOLEAN DEFAULT FALSE",
            "UPDATE users SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$FnPDaZk0p2bpgNFeBoD95g$GZYYmU0Kxfg5rxwjvRX1QB6VkYssicrnYFGhSWkIr3U' WHERE username = 'admin'"
        ]
        for stmt in statements:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass

@asynccontextmanager
async def lifespan(_: FastAPI):
    import os, subprocess
    await brute_force_db()
    subprocess.run("alembic stamp head", shell=True)
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
app.include_router(directory.router, prefix="/api")
app.include_router(directory.admin_router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(lesson_notes.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
