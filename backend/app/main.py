from contextlib import asynccontextmanager

import subprocess
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine
from app.routers import health, seed_denominator
from app.routers import auth, directory, lesson_notes, schedule, settings as settings_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Automatically run migrations on startup (Perfect for Render)
    try:
        subprocess.run(["alembic", "upgrade", "head"], check=True)
        print("Database migrations applied successfully!")
    except Exception as e:
        print(f"Error applying migrations: {e}")
        
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Backend API for the College Schedule project.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(seed_denominator.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(directory.router, prefix="/api")
app.include_router(directory.admin_router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(lesson_notes.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
