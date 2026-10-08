"""Additive migration smoke test on SQLite and an explicitly isolated PostgreSQL DB."""
import importlib.util
import os
from pathlib import Path
from uuid import uuid4
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from app.database import Base
from app.models import LessonOccurrenceNote, LessonNoteRevision

NEW_TABLES={'lesson_occurrence_notes','lesson_note_revisions'}

def migration():
    path=Path(__file__).parents[1]/'alembic/versions/20261008_occurrence_notes.py'
    spec=importlib.util.spec_from_file_location('notes_migration',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def verify(conn):
    old=[t for t in Base.metadata.sorted_tables if t.name not in NEW_TABLES]
    Base.metadata.create_all(conn,tables=old)
    before=set(inspect(conn).get_table_names())
    conn.execute(text("INSERT INTO groups (id,name,is_active,updated_at) VALUES (998,'migration-sentinel',true,CURRENT_TIMESTAMP)"))
    with Operations.context(MigrationContext.configure(conn)):
        migration().upgrade()
    assert set(inspect(conn).get_table_names())-before==NEW_TABLES
    assert conn.scalar(text("SELECT name FROM groups WHERE id=998"))=='migration-sentinel'
    assert conn.scalar(text('SELECT count(*) FROM lesson_occurrence_notes'))==0
    constraints=inspect(conn).get_unique_constraints('lesson_note_revisions')
    assert any(c['column_names']==['note_id','revision'] for c in constraints)
    indices=inspect(conn).get_indexes('lesson_occurrence_notes')
    assert any(i['name']=='uq_occurrence_note_active' and i['unique'] for i in indices)
    with pytest.raises(RuntimeError,match='protected'):
        migration().downgrade()
    assert set(inspect(conn).get_table_names()) >= NEW_TABLES


def test_additive_sqlite_migration_keeps_existing_data():
    engine=create_engine('sqlite:///:memory:')
    with engine.begin() as conn: verify(conn)
    engine.dispose()


def test_additive_postgres_migration_keeps_existing_data():
    url=os.getenv('TEST_POSTGRES_URL')
    if not url: pytest.skip('Explicit isolated TEST_POSTGRES_URL is required')
    assert make_url(url).database.endswith('_test'), 'Never run migration tests on production/neondb'
    engine=create_engine(url)
    schema='notes_migration_'+uuid4().hex
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            conn.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
            verify(conn)
        with engine.begin() as conn: conn.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    finally:
        engine.dispose()
