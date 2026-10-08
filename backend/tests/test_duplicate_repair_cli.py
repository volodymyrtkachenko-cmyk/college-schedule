import os,json,sqlite3,subprocess,sys
from pathlib import Path

def create_file(path):
    with sqlite3.connect(path) as c:
        c.executescript('''CREATE TABLE schedule(id INTEGER PRIMARY KEY,group_id INTEGER,teacher_id INTEGER,second_teacher_id INTEGER,subject_id INTEGER,stream_id TEXT,day_of_week INTEGER,lesson_number INTEGER,week_type TEXT,is_active BOOLEAN,is_replacement BOOLEAN,room_override TEXT,version_id INTEGER);
        CREATE TABLE schedule_versions(id INTEGER PRIMARY KEY,name TEXT,valid_from DATE,valid_until DATE,is_active BOOLEAN);''')
        for i in range(1,34):c.execute("INSERT INTO schedule VALUES(?,1,1,NULL,1,NULL,2,4,'denominator',1,0,'212',NULL)",(i,))

def run(path,args):
    env={**os.environ,'DATABASE_URL':f'sqlite+aiosqlite:///{path}','RUN_MIGRATIONS':'false','RUN_CRON':'false'}
    return subprocess.run([sys.executable,'-m','scripts.repair_exact_duplicates',*args],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=20)

def test_cli_plan_is_read_only(tmp_path):
    path=tmp_path/'existing.db';out=tmp_path/'plan.json';create_file(path);before=path.read_bytes()
    result=run(path,['--output',str(out),'--expected-active-count','33','--expected-set-count','1'])
    assert result.returncode==0,result.stdout+result.stderr
    plan=json.loads(out.read_text())
    assert plan['status']=='plan_only' and plan['approved_to_apply'] is False
    assert plan['deactivate_count']==32
    assert path.read_bytes()==before

def test_cli_sqlite_apply_still_forbidden_with_all_flags(tmp_path):
    path=tmp_path/'existing.db';out=tmp_path/'plan.json';receipt=tmp_path/'receipt.json';create_file(path)
    assert run(path,['--output',str(out)]).returncode==0
    plan=json.loads(out.read_text());before=path.read_bytes()
    result=run(path,['--apply','--plan',str(out),'--approve-plan-hash',plan['plan_hash'],'--backup-confirmed','--output',str(receipt)])
    assert result.returncode==1
    assert json.loads(receipt.read_text())['code']=='apply_requires_postgresql'
    assert path.read_bytes()==before
