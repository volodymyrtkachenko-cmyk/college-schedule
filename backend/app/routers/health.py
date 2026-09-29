from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
@router.get("/")
async def health_check():
    return {"status": "ok"}

@router.get("/fix-db-force")
async def fix_db_force(db: AsyncSession = Depends(get_db)):
    statements = [
        # 1. token_blocklist
        """CREATE TABLE IF NOT EXISTS token_blocklist (
            id SERIAL PRIMARY KEY,
            jti VARCHAR(36) NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_token_blocklist_jti ON token_blocklist (jti)",
        
        # 2. bell_schedule
        """CREATE TABLE IF NOT EXISTS bell_schedule (
            id SERIAL PRIMARY KEY,
            lesson_number INTEGER NOT NULL UNIQUE,
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        )""",
        
        # Insert bell schedule if empty
        """INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active)
           SELECT 1, '09:00', '10:20', true
           WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 1)""",
        """INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active)
           SELECT 2, '10:40', '12:00', true
           WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 2)""",
        """INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active)
           SELECT 3, '12:30', '13:50', true
           WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 3)""",
        """INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active)
           SELECT 4, '14:00', '15:20', true
           WHERE NOT EXISTS (SELECT 1 FROM bell_schedule WHERE lesson_number = 4)""",
           
        # 3. schedule_override
        """CREATE TABLE IF NOT EXISTS schedule_override (
            id SERIAL PRIMARY KEY,
            schedule_id INTEGER NOT NULL REFERENCES schedule(id),
            date DATE NOT NULL,
            teacher_id INTEGER REFERENCES teachers(id),
            subject_id INTEGER REFERENCES subjects(id),
            room VARCHAR(100),
            cancelled BOOLEAN NOT NULL DEFAULT FALSE,
            CONSTRAINT uq_schedule_override_date UNIQUE(schedule_id, date)
        )""",
        
        # 4. Add missing columns safely
        "ALTER TABLE schedule ADD COLUMN IF NOT EXISTS room_override VARCHAR(100)",
        "ALTER TABLE schedule ADD COLUMN IF NOT EXISTS is_replacement BOOLEAN DEFAULT FALSE"
    ]
    
    results = []
    for stmt in statements:
        try:
            await db.execute(text(stmt))
            results.append({"stmt": stmt[:30], "status": "ok"})
        except Exception as e:
            results.append({"stmt": stmt[:30], "error": str(e)})
            
    await db.commit()
    
    import subprocess
    subprocess.run("alembic stamp head", shell=True)
    
    return {"results": results}
