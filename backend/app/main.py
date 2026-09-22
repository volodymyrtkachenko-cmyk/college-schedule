from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.config import settings
from app.database import engine
from app.routers import health
from app.routers import auth, directory, lesson_notes, schedule, settings as settings_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Automatically run migrations on startup (Perfect for Render)
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Backend API for the College Schedule project.",
    lifespan=lifespan,
)

app.add_middleware(
    GZipMiddleware,
    minimum_size=500
)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import Request
from app.analytics import track_request

@app.middleware("http")
async def analytics_middleware(request: Request, call_next):
    # Only track API reads to avoid polling spam counting?
    # Actually just track everything to be safe and simple.
    track_request(request)
    response = await call_next(request)
    return response

app.include_router(health.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(directory.router, prefix="/api")
app.include_router(directory.admin_router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(lesson_notes.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
