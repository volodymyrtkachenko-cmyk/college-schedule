import re

# 1. Update config.py
with open("backend/app/config.py", "r") as f:
    config_text = f.read()

config_text = config_text.replace(
    '    semester_start: str = "2025-09-01"',
    '    semester_start: str = "2025-09-01"\n    wipe_secret: str | None = None'
)

with open("backend/app/config.py", "w") as f:
    f.write(config_text)


# 2. Update schedule.py
wipe_code = """
from pydantic import BaseModel
from app.config import settings
from app.models import LessonNote

class WipeRequest(BaseModel):
    secret: str

@router.post("/wipe")
async def wipe_all_schedule(
    payload: WipeRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_roles(["admin"]))
):
    if not settings.wipe_secret:
        raise HTTPException(status_code=403, detail="WIPE_SECRET is not configured on the server.")
    
    if payload.secret != settings.wipe_secret:
        raise HTTPException(status_code=403, detail="Невірний пароль для очищення.")
        
    try:
        await db.execute(delete(LessonNote))
        await db.execute(delete(Schedule))
        await db.commit()
        return {"message": "Розклад та нотатки успішно очищено."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
"""

with open("backend/app/routers/schedule.py", "a") as f:
    f.write(wipe_code)
