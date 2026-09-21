import re

with open("backend/app/routers/schedule.py", "r") as f:
    text = f.read()

text = re.sub(r'from pydantic import BaseModel\nfrom app\.config import settings\nfrom app\.models import LessonNote\n\nclass WipeRequest\(BaseModel\):\n    secret: str\n\n@router\.post\("\/wipe"\)\nasync def wipe_all_schedule\([\s\S]*?raise HTTPException\(status_code=500, detail=str\(e\)\)\n', '', text)

with open("backend/app/routers/schedule.py", "w") as f:
    f.write(text)
