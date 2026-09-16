import subprocess
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter()

@router.get("/health")
def health_check():
    return {"status": "ok"}

@router.get("/health/migrate")
def force_migrate():
    try:
        result = subprocess.run(["alembic", "upgrade", "head"], capture_output=True, text=True, check=True)
        return PlainTextResponse(f"Success!\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}")
    except subprocess.CalledProcessError as e:
        return PlainTextResponse(f"Failed!\n\nExit Code: {e.returncode}\n\nSTDOUT:\n{e.stdout}\n\nSTDERR:\n{e.stderr}", status_code=500)
    except Exception as e:
        return PlainTextResponse(f"Error:\n{e}", status_code=500)

@router.get("/health/seed")
def force_seed():
    try:
        result = subprocess.run(["python", "restore_remote.py"], capture_output=True, text=True, check=True)
        return PlainTextResponse(f"Успіх! Базу наповнено.\n\nЛогін: admin\nПароль: admin123\n\nSTDOUT:\n{result.stdout}")
    except subprocess.CalledProcessError as e:
        return PlainTextResponse(f"Failed!\n\nExit Code: {e.returncode}\n\nSTDOUT:\n{e.stdout}\n\nSTDERR:\n{e.stderr}", status_code=500)
