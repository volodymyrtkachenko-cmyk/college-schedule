import os
from pathlib import Path
import subprocess
import pytest

@pytest.mark.parametrize("opt_in,expected", [(None,["migrations"]),("false",["migrations"]),("true",["migrations","eps"])])
def test_release_migrates_but_imports_only_with_explicit_opt_in(tmp_path,opt_in,expected):
    tools=tmp_path/"bin";tools.mkdir()
    for name,label in [("alembic","migrations"),("python","eps")]:
        p=tools/name;p.write_text(f'#!/bin/sh\nprintf "{label}\\n" >> "$EVENT_LOG"\n');p.chmod(0o755)
    log=tmp_path/"events"
    env={**os.environ,"PATH":str(tools)+":"+os.environ['PATH'],"EVENT_LOG":str(log)}
    env.pop('IMPORT_EPS_ON_RELEASE',None)
    if opt_in is not None: env['IMPORT_EPS_ON_RELEASE']=opt_in
    entry=Path(__file__).parents[1]/'entrypoint.sh'
    subprocess.run(['sh',str(entry),'release'],env=env,check=True,capture_output=True,text=True)
    assert log.read_text().splitlines()==expected
