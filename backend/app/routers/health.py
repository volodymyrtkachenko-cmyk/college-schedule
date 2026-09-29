from fastapi import APIRouter
from app.config import settings

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
@router.get("/")
async def health_check():
    return {"status": "ok"}

@router.get("/alembic")
async def run_alembic():
    import os, subprocess
    result = subprocess.run("alembic upgrade head", shell=True, capture_output=True, text=True)
    return {"stdout": result.stdout, "stderr": result.stderr, "cwd": os.getcwd()}
