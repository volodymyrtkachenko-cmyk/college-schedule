import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys


def test_preflight_is_read_only_and_does_not_print_note_text(tmp_path):
    path=tmp_path/'preflight.db'
    with sqlite3.connect(path) as conn:
        conn.executescript('''
        CREATE TABLE lesson_notes (id INTEGER PRIMARY KEY, note TEXT);
        INSERT INTO lesson_notes VALUES (1,'private-test-note-must-not-appear');
        CREATE TABLE alembic_version(version_num TEXT NOT NULL);
        INSERT INTO alembic_version VALUES ('20261004_add_schedule_versions');
        CREATE TABLE schedule_versions(id INTEGER PRIMARY KEY,name TEXT,valid_from TEXT,valid_until TEXT,is_active BOOLEAN);
        INSERT INTO schedule_versions VALUES (1,'Test','2026-10-01','2026-10-10',1);
        ''')
    before=path.read_bytes()
    backend=Path(__file__).resolve().parents[1]
    env={**os.environ,'DATABASE_URL':f'sqlite+aiosqlite:///{path}','RUN_CRON':'false','RUN_MIGRATIONS':'false'}
    result=subprocess.run([sys.executable,'-m','scripts.group2_preflight'],cwd=backend,env=env,capture_output=True,text=True,timeout=20)
    assert result.returncode==0, result.stderr
    assert 'private-test-note-must-not-appear' not in result.stdout+result.stderr
    report=json.loads(result.stdout)
    assert report['mode']=='read_only'
    assert report['lesson_notes_count']==1
    assert report['requires_legacy_notes_preservation'] is True
    assert report['approved_to_run_all_pending_migrations'] is False
    assert path.read_bytes()==before


def test_overlap_preflight_fails_closed(tmp_path):
    path=tmp_path/'overlap.db'
    with sqlite3.connect(path) as conn:
        conn.executescript('''
        CREATE TABLE schedule_versions(id INTEGER PRIMARY KEY,name TEXT,valid_from TEXT,valid_until TEXT,is_active BOOLEAN);
        INSERT INTO schedule_versions VALUES (1,'A','2026-10-01','2026-10-10',1);
        INSERT INTO schedule_versions VALUES (2,'B','2026-10-10','2026-10-20',1);
        ''')
    env={**os.environ,'DATABASE_URL':f'sqlite+aiosqlite:///{path}','RUN_CRON':'false','RUN_MIGRATIONS':'false'}
    result=subprocess.run([sys.executable,'-m','scripts.group2_preflight'],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=20)
    assert result.returncode==2
    report=json.loads(result.stdout)
    assert report['active_overlap_pairs']==[[1,2]]
    assert report['ready_for_version_constraints'] is False
