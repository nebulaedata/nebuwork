import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import uuid

import pytest

from nebulae import Engine
from nebulae.environments import probe
from nebulae.store import Conflict
from test_core import engine, workflow, start, artifact, wait_for
from wheels import wheel


def select(engine, workflow_id="test", mode="isolated"):
    state = engine.environments.status(workflow_id)
    return engine.environments.select(workflow_id, mode, state["workflow_revision"])


def submit(engine, kind="create", workflow_id="test", **kwargs):
    return engine.environments.submit(workflow_id, kind, engine.environments.status(workflow_id)["version"],
                                      kwargs.pop("command_id", uuid.uuid4().hex), **kwargs)


def finish(engine, operation):
    engine.drain(timeout=120)
    result = engine.environments.operation(operation["id"])
    assert result["state"] == "succeeded", result
    return result


def test_shared_without_pip_and_mode_compatibility(engine, monkeypatch):
    workflow(engine, {"main.py": "def run(ctx):\n    import sys\n    ctx.task.save_text('python', sys.executable)\n"})
    shared = engine.environments.shared()
    assert shared["interpreter"] == os.path.abspath(sys.executable)
    assert any(p["name"].lower() == "pytest" for p in shared["packages"])
    assert engine.environments.status("test")["mode"] == "shared"
    task = start(engine)
    engine.drain()
    assert artifact(engine, task, "main", "python") == sys.executable
    state = engine.status(task)
    assert state["environment"]["id"] == state["steps"][0]["history"][0]["environment"]["id"]
    assert "return" not in [a["name"] for a in state["artifacts"]]


def test_independent_versions_fixed_round_and_rebuild(engine, monkeypatch):
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    source = "def run(ctx):\n    import nebulae_env_fixture\n    ctx.task.save_text('version', nebulae_env_fixture.VERSION)\n"
    first = workflow(engine, {"main.py": source}, {"a": {"code": "main.py:run"},
                     "b": {"code": "main.py:run", "needs": ["a"]}})
    second = workflow(engine, {"main.py": source}, workflow_id="second")
    one, two = wheel(first, "1.0"), wheel(second, "2.0")
    for name in ("test", "second"):
        select(engine, name)
        finish(engine, submit(engine, workflow_id=name))
    for name, package in (("test", one), ("second", two)):
        finish(engine, submit(engine, "install", name, packages=[package]))
    for name, expected in (("test", "1.0"), ("second", "2.0")):
        task = start(engine, name)
        engine.drain()
        assert artifact(engine, task, "a" if name == "test" else "main", "version") == expected
    assert not any(p["name"] == "pytest" for p in engine.environments.packages("test")["packages"])
    assert not any(p["name"] == "nebulae-env-fixture" for p in engine.environments.shared()["packages"])
    task = start(engine)
    bound = engine.status(task)["environment"]["id"]
    select(engine, mode="shared")
    with pytest.raises(Conflict, match="占用"):
        submit(engine, "install", packages=[one])
    engine.drain()
    assert all(s["history"][-1]["environment"]["id"] == bound for s in engine.status(task)["steps"])
    engine.control(task, "rerun", from_steps=["b"])
    engine.drain()
    assert engine.status(task)["state"] == "failed"  # shared env has no fixture package
    select(engine)
    engine.control(task, "resume")
    engine.drain()
    assert engine.status(task)["state"] == "succeeded"
    history = engine.status(task)["steps"][1]["history"]
    assert [a["environment"]["mode"] for a in history] == ["isolated", "shared", "isolated"]
    before = engine.environments.status("test")["current"]
    finish(engine, submit(engine, "rebuild"))
    after = engine.environments.status("test")["current"]
    assert before["generation"] != after["generation"]
    assert Path(before["interpreter"]).exists()
    assert not any(p["name"] == "nebulae-env-fixture" for p in after["packages"])
    engine.catalog.create("copy", copy_from="test")
    assert engine.environments.status("copy")["state"] == "not_created"
    assert engine.environments.status("copy")["mode"] == "isolated"
    # Shared query never needs pip, including a fresh venv where pip is removed manually.
    import subprocess
    subprocess.run([after["interpreter"], "-m", "pip", "uninstall", "-y", "pip"], check=True, capture_output=True)
    assert probe(after["interpreter"], isolated=True)["package_count"] == 0


def test_install_failure_requirements_snapshot_idempotency_and_repair(engine, monkeypatch):
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    root = workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
    finish(engine, submit(engine))
    select(engine)
    filename = wheel(root, "1.0")
    requirements = root / "requirements.txt"
    requirements.write_text("--no-index\n./" + filename + "\n", encoding="utf-8")
    version = engine.environments.status("test")["version"]
    op = submit(engine, "install", requirements=True, command_id="requirements-once")
    assert engine.environments.submit("test", "install", version, "requirements-once", requirements=True)["id"] == op["id"]
    with pytest.raises(Conflict):
        engine.environments.submit("test", "install", version, "requirements-once", packages=[filename])
    with pytest.raises(Conflict, match="未就绪"):
        start(engine)
    requirements.write_text("--no-index\nnot-a-real-package-anywhere==0\n", encoding="utf-8")
    succeeded = finish(engine, op)
    assert filename in succeeded["request"]["requirements_content"]
    assert succeeded["before_info"] is not None and succeeded["after_info"] is not None
    failed = submit(engine, "install", requirements=True)
    engine.drain(timeout=120)
    result = engine.environments.operation(failed["id"])
    assert result["state"] == "failed" and result["error"] and result["log"]
    assert engine.environments.status("test")["state"] == "needs_repair"
    task = engine.create_task("test")
    before = engine.status(task)
    with pytest.raises(Conflict, match="未就绪"):
        engine.control(task, "start")
    assert engine.status(task) == before
    repaired = finish(engine, submit(engine, "install", packages=[filename]))
    tail = engine.environments.operation(repaired["id"], repaired["cursor"])
    assert tail["log"] == ""
    conflicting = wheel(root, "2.0")
    conflict = submit(engine, "install", packages=[filename, conflicting])
    engine.drain(timeout=120)
    assert engine.environments.operation(conflict["id"])["state"] == "failed"
    assert engine.environments.status("test")["state"] == "needs_repair"
    finish(engine, submit(engine, "install", packages=[filename]))
    engine.control(task, "start")
    engine.drain()
    assert engine.status(task)["state"] == "succeeded"
    preview = engine.rerun_preview(task)
    select(engine, mode="shared")
    with pytest.raises(Conflict, match="变化"):
        engine.control(task, "rerun", expected_environment=preview["environment_token"])
    assert engine.status(task)["steps"][0]["successful_attempt"] == 1


def test_restart_does_not_continue_queued_or_running_environment_operations(tmp_path):
    for running in (False, True):
        project = tmp_path / str(running)
        with Engine(project) as engine:
            workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
            op = submit(engine)
            if running:
                engine.tick()
                assert engine.environments.active is not None
        with Engine(project) as restarted:
            restarted.tick()
            assert restarted.environments.operation(op["id"])["state"] == "interrupted"
            assert restarted.environments.status("test")["state"] == "needs_repair"
            assert restarted.environments.active is None
            assert not restarted.environments.pending()


def test_environment_selection_conflict_and_invalid_configuration(engine):
    workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
    state = engine.environments.status("test")
    select(engine)
    with pytest.raises(Conflict):
        engine.environments.select("test", "shared", state["workflow_revision"])
    with pytest.raises(ValueError):
        engine.environments.select("test", "unknown", state["workflow_revision"])
    with pytest.raises(ValueError):
        submit(engine, "install", packages=[" --target=elsewhere"])


def test_v1_migration_backups_and_legacy_attempts(tmp_path):
    from nebulae.store import Store
    with Engine(tmp_path) as engine:
        workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
        task = start(engine)
        engine.drain()
    path = engine.store.path
    # Reconstruct the actual previous schema using SQLite's supported column removal.
    with sqlite3.connect(path) as db:
        db.execute("ALTER TABLE tasks DROP COLUMN environment_revision")
        db.execute("ALTER TABLE attempts DROP COLUMN environment_revision")
        for table in ("environments", "environment_operations", "environment_revisions", "agent_calls", "agent_events", "agent_rounds", "agent_sessions", "agent_commands"):
            db.execute(f"DROP TABLE {table}")
        db.execute("PRAGMA user_version=1")
    upgraded = Engine(tmp_path)
    assert upgraded.status(task)["steps"][0]["history"][0]["environment"] is None
    backups = list(path.parent.glob("*.v1-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert db.execute("SELECT state FROM tasks WHERE id=?", (task,)).fetchone()[0] == "succeeded"
    assert upgraded.store.read("PRAGMA user_version")[0]["user_version"] == 3


def test_retry_occupancy_pause_then_install_and_missing_interpreter(engine, monkeypatch):
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    root = workflow(engine, {"main.py": "def run(ctx):\n    raise ValueError('retry me')\n"},
                    {"main": {"code": "main.py:run", "retries": 1, "retry_delay": 60}})
    package = wheel(root, "1.0")
    finish(engine, submit(engine))
    select(engine)
    task = start(engine)
    bound = engine.status(task)["environment"]["id"]
    wait_for(engine, task, lambda s: s["steps"][0]["state"] == "retry_wait")
    with pytest.raises(Conflict, match="占用"):
        submit(engine, "install", packages=[package])
    # A configuration change also leaves automatic retries on the original binding.
    select(engine, mode="shared")
    with engine.store.transaction() as db:
        db.execute("UPDATE steps SET next_at=0 WHERE task_id=?", (task,))
    engine.drain()
    assert all(a["environment"]["id"] == bound for a in engine.status(task)["steps"][0]["history"])
    select(engine)
    (root / "main.py").write_text("import time\ndef run(ctx):\n    time.sleep(.2)\n", encoding="utf-8")
    # Two steps are needed so pause leaves unfinished work after the active step finishes.
    raw = json.loads((root / "workflow.json").read_text())
    raw["steps"]["next"] = {"code": "main.py:run", "needs": ["main"]}
    (root / "workflow.json").write_text(json.dumps(raw))
    paused = start(engine)
    wait_for(engine, paused, lambda s: s["steps"][0]["state"] == "running")
    engine.control(paused, "pause")
    with pytest.raises(Conflict, match="占用"):
        submit(engine, "install", packages=[package])
    engine.drain()
    assert engine.status(paused)["state"] == "paused"
    finish(engine, submit(engine, "install", packages=[package]))
    engine.control(paused, "resume")
    engine.drain()
    history = engine.status(paused)["steps"]
    assert history[0]["history"][0]["environment"]["id"] != history[1]["history"][0]["environment"]["id"]
    current = engine.environments.status("test")["current"]
    interpreter = Path(current["interpreter"])
    # A missing executable must reject the whole command before invalidating artifacts.
    renamed = interpreter.with_name(interpreter.name + ".unavailable")
    interpreter.rename(renamed)
    try:
        before = engine.status(paused)
        with pytest.raises(Conflict, match="解释器不存在"):
            engine.control(paused, "rerun")
        assert engine.status(paused) == before
    finally:
        renamed.rename(interpreter)


def test_creation_failure_is_visible_and_manual_retry(engine, monkeypatch):
    import nebulae.environments as environments
    workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
    operation = submit(engine)
    with monkeypatch.context() as patch:
        def fail(*args, **kwargs):
            raise OSError("test creation error")
        patch.setattr(environments, "Child", fail)
        engine.drain()
    assert engine.environments.operation(operation["id"])["state"] == "failed"
    assert "test creation error" in engine.environments.status("test")["error"]
    for _ in range(3):
        engine.tick()
    assert engine.environments.status("test")["state"] == "needs_repair"
    retry = submit(engine)
    assert retry["id"] != operation["id"] and retry["state"] == "queued"


def test_environment_log_cursor_preserves_multibyte_characters(engine):
    workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
    op = submit(engine)
    row = engine.store.read("SELECT directory FROM environment_operations WHERE id=?", (op["id"],))[0]
    text = "中文日志🌏" * 20000
    (Path(row["directory"]) / "console.log").write_text(text, encoding="utf-8")
    with engine.store.transaction() as db:
        db.execute("UPDATE environment_operations SET state='failed' WHERE id=?", (op["id"],))
    result, cursor = "", 0
    while True:
        chunk = engine.environments.operation(op["id"], cursor)
        result += chunk["log"]
        cursor = chunk["cursor"]
        if not chunk["has_more"]:
            break
    assert result == text
    assert cursor == len(text.encode("utf-8"))


def test_installed_sdk_does_not_expose_service_site_packages(tmp_path):
    import shutil
    import subprocess
    import nebulae
    site = tmp_path / "service-site-packages"
    shutil.copytree(Path(nebulae.__file__).parent, site / "nebulae", ignore=shutil.ignore_patterns("web", "__pycache__"))
    (site / "shared_only_package.py").write_text("VALUE = 'must stay shared'\n")
    script = '''import json,sys,uuid
from pathlib import Path
import shared_only_package
from nebulae import Engine
with Engine(sys.argv[1]) as engine:
    engine.catalog.create('isolated')
    source = engine.catalog.directory('isolated') / 'main.py'
    source.write_text("import importlib.util\\ndef run(ctx):\\n    assert importlib.util.find_spec('shared_only_package') is None\\n    assert importlib.util.find_spec('pytest') is None\\n    ctx.task.save_text('ok', '中文 SDK isolation')\\n", encoding='utf-8')
    manager = engine.environments
    manager.submit('isolated','create',0,'create-environment')
    engine.drain(timeout=120)
    current = manager.status('isolated')
    assert current['state'] == 'ready', current
    manager.select('isolated','isolated',current['workflow_revision'])
    task = engine.create_task('isolated')
    engine.control(task,'start')
    engine.drain()
    state = engine.status(task)
    assert state['state'] == 'succeeded', state
    print('isolated SDK passed')
'''
    env = os.environ.copy()
    env["PYTHONPATH"] = str(site)
    result = subprocess.run([sys.executable, "-P", "-X", "utf8", "-c", script, str(tmp_path / "project")],
                            cwd=tmp_path, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                            encoding="utf-8", timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "isolated SDK passed" in result.stdout


@pytest.mark.parametrize("termination", ["crash", "timeout"])
def test_environment_installer_process_tree_cleanup(tmp_path, termination, monkeypatch):
    import subprocess
    from test_processes import assert_stopped
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    engine = Engine(tmp_path)
    root = workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
    marker = tmp_path / "installer-pids.json"
    # Installing this wheel makes the subsequent check start a long-lived descendant.
    # -S keeps that descendant from running this fixture's startup hook recursively.
    startup = ("import subprocess,sys,os,json,time; from pathlib import Path; "
               "p=subprocess.Popen([sys.executable,'-S','-c','import time;time.sleep(120)'],stdin=subprocess.DEVNULL); "
               f"Path({str(marker)!r}).write_text(json.dumps([os.getpid(),p.pid])); time.sleep(120)")
    package = wheel(root, "1.0", startup=startup)
    with engine:
        finish(engine, submit(engine))
    script = '''import sys,time
from pathlib import Path
from nebulae import Engine
with Engine(sys.argv[1]) as engine:
    env = engine.environments
    operation = env.submit('test','install',env.status('test')['version'],'install-crash',packages=[sys.argv[2]])
    while True:
        engine.tick()
        if sys.argv[3] == 'timeout' and Path(sys.argv[4]).exists() and env.active:
            env.active['deadline'] = 0
        if not env.pending():
            break
        time.sleep(.03)
'''
    scheduler = subprocess.Popen([sys.executable, "-c", script, str(tmp_path), package, termination, str(marker)],
                                 cwd=Path(__file__).resolve().parents[1], stdin=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 45
        while (not marker.exists() or not marker.stat().st_size) and time.monotonic() < deadline:
            assert scheduler.poll() is None
            time.sleep(.03)
        pids = json.loads(marker.read_text())
        if termination == "crash":
            scheduler.kill()
        scheduler.wait(timeout=15)
        assert_stopped(pids)
        with engine:
            engine.drain()
            state = engine.environments.status("test")
            assert state["state"] == "needs_repair"
            assert state["operations"][0]["state"] == ("interrupted" if termination == "crash" else "failed")
            assert engine.environments.active is None
    finally:
        if scheduler.poll() is None:
            scheduler.kill()
        scheduler.wait(timeout=10)
