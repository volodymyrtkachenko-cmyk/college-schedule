from logging.config import fileConfig
from alembic import context
from app.config import settings
from app.database import normalize_database_url
from app.database import Base
from app import models

config = context.config
database_url = normalize_database_url(settings.database_url)
if database_url.startswith("sqlite+aiosqlite://"):
    database_url = database_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
if config.config_file_name: fileConfig(config.config_file_name)
target_metadata = Base.metadata

def run_migrations_online():
    from sqlalchemy import engine_from_config, pool
    connectable = engine_from_config(config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction(): context.run_migrations()

run_migrations_online()
