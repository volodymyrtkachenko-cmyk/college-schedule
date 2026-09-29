import asyncio
from sqlalchemy import select
from app.database import async_session_factory
from app.core.security import hash_password
from app.models.entities import User

async def main():
    async with async_session_factory() as db:
        admin = await db.scalar(select(User).where(User.username == "admin"))
        if admin:
            new_pass = "[REDACTED_PASSWORD]"
            admin.password_hash = hash_password(new_pass)
            await db.commit()
            print(f"Admin password changed to: {new_pass}")
        else:
            print("Admin user not found.")

if __name__ == "__main__":
    asyncio.run(main())
