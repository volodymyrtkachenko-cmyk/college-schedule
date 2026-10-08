import json,os,sqlite3,subprocess,sys
from pathlib import Path

DDL='''CREATE TABLE schedule(id INTEGER PRIMARY KEY,group_id INTEGER,version_id INTEGER,subject_id INTEGER,teacher_id INTEGER,second_teacher_id INTEGER,stream_id TEXT,day_of_week INTEGER,lesson_number INTEGER,week_type TEXT,room_override TEXT,is_replacement BOOLEAN,is_active BOOLEAN);'''

def run(path,output):
    env={**os.environ,'DATABASE_URL':f'sqlite+aiosqlite:///{path}','RUN_MIGRATIONS':'false','RUN_CRON':'false'}
    return subprocess.run([sys.executable,'-m','scripts.duplicate_diagnostics',str(output)],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=20)

def test_exact_duplicates_reported_without_writes_or_note_text(tmp_path):
    path=tmp_path/'existing.db';output=tmp_path/'report.json'
    with sqlite3.connect(path) as conn:
        conn.executescript(DDL+"CREATE TABLE lesson_notes(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO lesson_notes VALUES(1,'private-note-must-not-appear');")
        for i in range(1,21):
            conn.execute('INSERT INTO schedule VALUES(?,1,NULL,1,1,NULL,NULL,2,4,?,NULL,0,1)',(i,'denominator'))
    before=path.read_bytes();result=run(path,output)
    assert result.returncode==2
    report=json.loads(output.read_text())
    assert report['exact_duplicate_sets'][0]['count']==20
    assert report['exact_duplicate_sets'][0]['lesson_number']==4
    assert report['lesson_notes_count']==1
    assert report['overlapping_assignment_conflicts']==[]
    assert 'private-note-must-not-appear' not in result.stdout+result.stderr+output.read_text()
    assert path.read_bytes()==before

def test_missing_sqlite_file_not_created_and_failure_replaces_stale_report(tmp_path):
    path=tmp_path/'missing.db';output=tmp_path/'report.json';output.write_text('{"status":"old-success"}')
    result=run(path,output)
    assert result.returncode==1
    assert not path.exists()
    report=json.loads(output.read_text())
    assert report['status']=='failed'
    assert report['error_type']=='FileNotFoundError'

def test_distinct_week_assignments_are_not_false_conflicts(tmp_path):
    path=tmp_path/'separate.db';output=tmp_path/'report.json'
    with sqlite3.connect(path) as conn:
        conn.executescript(DDL)
        conn.execute("INSERT INTO schedule VALUES(1,1,NULL,1,1,NULL,NULL,2,4,'denominator',NULL,0,1)")
        conn.execute("INSERT INTO schedule VALUES(2,1,NULL,2,1,NULL,NULL,2,4,'numerator',NULL,0,1)")
    result=run(path,output)
    assert result.returncode==0
    report=json.loads(output.read_text())
    assert report['overlapping_assignment_conflicts']==[]
    assert report['exact_duplicate_sets']==[]
