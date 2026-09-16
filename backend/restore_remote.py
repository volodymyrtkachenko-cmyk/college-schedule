import asyncio
import json
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.config import settings
from app.database import normalize_database_url

async def restore_data():
    database_url = normalize_database_url(settings.database_url)
    engine = create_async_engine(database_url)
    
    with open("local_data.json", "r", encoding="utf-8") as f:
        data = json.load(f)
        
    tables = ['users', 'faculties', 'teachers', 'groups', 'subjects', 'schedule', 'lesson_notes']
    
    async with engine.begin() as conn:
        print("Truncating tables...")
        for table in tables[::-1]: # Reverse order because of foreign keys
            await conn.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
            
        print("Inserting records...")
        for table in tables:
            rows = data.get(table, [])
            if not rows:
                continue
                
            cols = list(rows[0].keys())
            cols_joined = ", ".join(cols)
            placeholders = ", ".join([f":{col}" for col in cols])
            
            query = text(f"INSERT INTO {table} ({cols_joined}) VALUES ({placeholders})")
            
            for row in rows:
                await conn.execute(query, row)
                
            print(f"Restored {len(rows)} records into {table}")
            
            # Reset sequences
            try:
                seq_name = f"{table}_id_seq"
                await conn.execute(text(f"SELECT setval('{seq_name}', (SELECT COALESCE(MAX(id), 1) FROM {table}))"))
            except Exception as e:
                pass

    print("Successfully restored database!")

if __name__ == "__main__":
    asyncio.run(restore_data())
