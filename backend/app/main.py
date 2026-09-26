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


@asynccontextmanager
async def lifespan(_: FastAPI):
    import os
    import subprocess; subprocess.run("cd backend 2>/dev/null || true; alembic upgrade head", shell=True)
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
    # Відстежуємо всі запити до API для загальної аналітики активності
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
