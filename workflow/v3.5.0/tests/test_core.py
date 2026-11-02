import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from nebulae import Engine
from nebulae.context import read_artifact
from nebulae.store import Conflict


@pytest.fixture
def engine(tmp_path):
    with Engine(tmp_path) as engine:
        yield engine


def workflow(engine, sources, specs=None, workflow_id="test"):
    root = engine.catalog.directory(workflow_id)
    root.mkdir(parents=True, exist_ok=True)
    for name, text in sources.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text, encoding="utf-8")
    specs = specs or {"main": {"code": "main.py:run"}}
    (root / "workflow.json").write_text(json.dumps({"name": workflow_id, "steps": specs}), encoding="utf-8")
    return root


def start(engine, workflow_id="test", input=None):
    task = engine.create_task(workflow_id, input)
    engine.control(task, "start")
    return task


def wait_for(engine, task, predicate, timeout=15):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        engine.tick()
        status = engine.status(task)
        if predicate(status):
            return status
        time.sleep(0.03)
    pytest.fail(str(engine.status(task)))


def steps(engine, task):
    return {s["name"]: s for s in engine.status(task)["steps"]}


def artifact(engine, task, step, name):
    return read_artifact(next(a for a in engine.status(task)["artifacts"]
                              if a["step"] == step and a["name"] == name and a["effective"]))


def test_explicit_artifacts_ignore_arbitrary_return(engine):
    workflow(engine, {"main.py": '''def run(ctx):
    local_secret = "not-an-artifact"
    ctx.task.save_json("json", {"n": 1})
    ctx.task.save_text("text", "中文")
    file = ctx.work_dir / "test.bin"
    file.write_bytes(b"abc")
    ctx.task.save_file("file", file)
    return object()
'''})
    task = start(engine)
    engine.drain()
    assert engine.status(task)["state"] == "succeeded"
    assert {a["name"] for a in engine.status(task)["artifacts"]} == {"json", "text", "file"}
    assert artifact(engine, task, "main", "json") == {"n": 1}
    assert artifact(engine, task, "main", "text") == "中文"
    assert artifact(engine, task, "main", "file").read_bytes() == b"abc"


def test_no_artifacts_and_async_steps(engine):
    workflow(engine, {"main.py": "async def run(ctx):\n    return object()\n"})
    task = start(engine)
    engine.drain()
    assert engine.status(task)["state"] == "succeeded"
    assert engine.status(task)["artifacts"] == []


def test_rerun_invalidates_descendants_and_pins_other_success(engine):
    root = workflow(engine, {
        "a.py": 'def run(ctx):\n    ctx.task.save_json("n", 1)\n',
        "b.py": 'def run(ctx):\n    ctx.task.save_json("n", ctx.task.read("a", "n") + 1)\n',
        "d.py": 'def run(ctx):\n    ctx.task.save_json("n", 10)\n',
        "c.py": 'def run(ctx):\n    ctx.task.save_json("n", ctx.task.read("b", "n") + ctx.task.read("d", "n"))\n',
    }, {"a": {"code": "a.py:run"}, "b": {"code": "b.py:run", "needs": ["a"]},
        "d": {"code": "d.py:run"}, "c": {"code": "c.py:run", "needs": ["b", "d"]}})
    task = start(engine)
    engine.drain()
    assert artifact(engine, task, "c", "n") == 12
    assert engine.rerun_preview(task, ["b"])["affected"] == ["b", "c"]
    (root / "b.py").write_text('def run(ctx):\n    ctx.task.save_json("n", 9)\n    raise ValueError("failed")\n')
    engine.control(task, "rerun", from_steps=["b"])
    engine.drain()
    current = steps(engine, task)
    assert current["c"]["state"] == "blocked"
    assert current["c"]["attempts"] == 1
    assert not [a for a in engine.status(task)["artifacts"] if a["step"] in {"b", "c"} and a["effective"]]
    (root / "b.py").write_text('def run(ctx):\n    ctx.task.save_json("n", 20)\n')
    engine.control(task, "resume")
    engine.drain()
    assert artifact(engine, task, "c", "n") == 30
    current = steps(engine, task)
    assert current["a"]["attempts"] == current["d"]["attempts"] == 1
    assert current["c"]["history"][-1]["dependencies"] == {"b": 3, "d": 1}


def test_missing_artifact_never_falls_back_to_older_success(engine):
    root = workflow(engine, {"a.py": 'def run(ctx):\n    ctx.task.save_text("x", "old")\n',
                            "b.py": 'def run(ctx):\n    ctx.task.read("a", "x")\n'},
                    {"a": {"code": "a.py:run"}, "b": {"code": "b.py:run", "needs": ["a"]}})
    task = start(engine)
    engine.drain()
    (root / "a.py").write_text("def run(ctx):\n    pass\n")
    engine.control(task, "rerun", from_steps=["a"])
    engine.drain()
    assert steps(engine, task)["a"]["state"] == "succeeded"
    assert steps(engine, task)["b"]["state"] == "failed"


def test_task_isolation_shared_versions_and_failed_staging(engine):
    workflow(engine, {"main.py": '''def run(ctx):
    if ctx.input.get("read"):
        ctx.task.save_json("seen", ctx.workflow.read("shared"))
    else:
        ctx.task.save_json("own", ctx.input["value"])
        ctx.workflow.save_json("shared", ctx.input["value"])
        if ctx.input.get("fail"):
            raise ValueError("do not publish")
'''})
    first = start(engine, input={"value": 1})
    engine.drain()
    second = start(engine, input={"value": 2, "fail": True})
    engine.drain()
    third = start(engine, input={"read": True})
    engine.drain()
    assert artifact(engine, third, "main", "seen") == 1
    assert artifact(engine, first, "main", "own") == 1
    assert all(not a["published"] for a in engine.status(second)["artifacts"])
    workflow(engine, {"main.py": 'def run(ctx):\n    ctx.workflow.read("shared")\n'}, workflow_id="other")
    other = start(engine, "other")
    engine.drain()
    assert engine.status(other)["state"] == "failed"


def test_hot_reload_same_task_and_helper_same_mtime(engine):
    root = workflow(engine, {"first.py": "import time\ndef run(ctx):\n    time.sleep(0.5)\n",
                            "next.py": 'import helper\ndef run(ctx):\n    ctx.task.save_text("version", helper.VALUE)\n',
                            "helper.py": 'VALUE = "old"\n'},
                    {"first": {"code": "first.py:run"}, "next": {"code": "next.py:run", "needs": ["first"]}})
    task = start(engine)
    wait_for(engine, task, lambda s: s["steps"][0]["state"] == "running")
    timestamp = (root / "helper.py").stat().st_mtime
    (root / "helper.py").write_text('VALUE = "new"\n')
    os.utime(root / "helper.py", (timestamp, timestamp))
    engine.drain()
    assert artifact(engine, task, "next", "version") == "new"
    old_snapshot = Path(steps(engine, task)["first"]["history"][0]["code_dir"])
    assert '"old"' in (old_snapshot / "helper.py").read_text()


def test_retry_and_timeout(engine):
    workflow(engine, {"main.py": '''def run(ctx):
    if ctx.attempt == 1:
        raise ValueError("try again")
    ctx.task.save_json("attempt", ctx.attempt)
'''}, {"main": {"code": "main.py:run", "retries": 1, "retry_delay": 0.01}})
    task = start(engine)
    engine.drain()
    assert artifact(engine, task, "main", "attempt") == 2
    workflow(engine, {"main.py": "import time\ndef run(ctx):\n    time.sleep(30)\n"},
             {"main": {"code": "main.py:run", "timeout": 0.4}}, "slow")
    task = start(engine, "slow")
    engine.drain()
    assert steps(engine, task)["main"]["history"][-1]["state"] == "timed_out"


def test_pause_then_resume_and_duplicate_commands(engine):
    workflow(engine, {"a.py": "import time\ndef run(ctx):\n    time.sleep(.3)\n", "b.py": "def run(ctx):\n    pass\n"},
             {"a": {"code": "a.py:run"}, "b": {"code": "b.py:run", "needs": ["a"]}})
    task = start(engine)
    wait_for(engine, task, lambda s: s["steps"][0]["state"] == "running")
    engine.control(task, "pause")
    engine.drain()
    assert engine.status(task)["state"] == "paused"
    assert steps(engine, task)["b"]["attempts"] == 0
    engine.control(task, "resume")
    engine.drain()
    version = engine.status(task)["version"]
    engine.control(task, "rerun", version, "same-command", ["b"])
    engine.drain()
    engine.control(task, "rerun", version, "same-command", ["b"])
    engine.drain()
    assert steps(engine, task)["b"]["attempts"] == 2
    with pytest.raises(Conflict):
        engine.control(task, "rerun", version, "different-command", ["b"])


def test_restart_never_runs_queued_retrying_or_running(engine):
    workflow(engine, {"main.py": "import time\ndef run(ctx):\n    time.sleep(30)\n"})
    queued = start(engine)
    running = start(engine)
    engine._start(running, "main")
    engine.close()
    engine.open()
    engine.drain()
    assert engine.status(queued)["state"] == "waiting_manual"
    assert steps(engine, queued)["main"]["attempts"] == 0
    assert engine.status(running)["state"] == "waiting_manual"
    assert steps(engine, running)["main"]["history"][0]["state"] == "interrupted"
    workflow(engine, {"main.py": 'def run(ctx):\n    raise ValueError("retry")\n'},
             {"main": {"code": "main.py:run", "retries": 2, "retry_delay": 60}})
    retrying = start(engine)
    wait_for(engine, retrying, lambda s: s["steps"][0]["state"] == "retry_wait")
    engine.close()
    engine.open()
    engine.drain()
    assert engine.status(retrying)["state"] == "waiting_manual"
    assert steps(engine, retrying)["main"]["attempts"] == 1


def test_validation_and_catalog_conflicts(engine):
    flow = engine.catalog.create("hello")
    file = engine.catalog.read("hello", "main.py")
    path = engine.catalog.directory("hello") / "main.py"
    path.write_text("def run(ctx):\n    pass\n")
    with pytest.raises(Conflict):
        engine.catalog.save("hello", "main.py", file["content"], file["revision"])
    fresh = engine.catalog.read("hello", "main.py")
    saved = engine.catalog.save("hello", "main.py", file["content"], fresh["revision"])
    revisions = engine.catalog.revisions("hello", "main.py")
    assert len(revisions) >= 3
    engine.catalog.restore("hello", "main.py", revisions[1]["id"], saved["revision"])
    for path in ("../escape.py", "C:/escape.py", ".runtime/key.py"):
        with pytest.raises(ValueError):
            engine.catalog.save("hello", path, "x=1", None)
    with pytest.raises(ValueError):
        workflow(engine, {"main.py": "def run(ctx):\n    pass\n"}, {"main": {"code": "main.py:run", "needs": ["main"]}})
        engine.create_task("test")
    engine.catalog.archive("hello")
    with pytest.raises(Conflict):
        engine.create_task("hello")


def test_only_one_scheduler_and_queries_do_not_recover(engine):
    workflow(engine, {"main.py": "def run(ctx):\n    pass\n"})
    task = start(engine)
    observer = Engine(engine.project)
    assert observer.status(task)["state"] == "queued"
    with pytest.raises(RuntimeError):
        observer.open()
    engine.drain()
    assert observer.status(task)["state"] == "succeeded"


def test_true_parallel_execution(engine):
    source = '''import time
from pathlib import Path
def run(ctx):
    shared = Path(ctx.input["barrier"])
    shared.mkdir(exist_ok=True)
    (shared / ctx.step_id).write_text("ready")
    deadline = time.monotonic() + 5
    while len(list(shared.iterdir())) < 2:
        if time.monotonic() > deadline:
            raise RuntimeError("parallel branch never started")
        time.sleep(.02)
'''
    workflow(engine, {"main.py": source}, {"a": {"code": "main.py:run"}, "b": {"code": "main.py:run"}})
    task = start(engine, input={"barrier": str(engine.project / "barrier")})
    engine.drain(max_workers=2)
    assert engine.status(task)["state"] == "succeeded"


def test_frozen_graph_undeclared_reads_and_independent_branch(engine):
    root = workflow(engine, {
        "a.py": 'def run(ctx):\n    ctx.task.save_text("x", "a")\n',
        "b.py": 'def run(ctx):\n    ctx.task.read("a", "x")\n',
        "c.py": 'def run(ctx):\n    pass\n',
    }, {"a": {"code": "a.py:run"}, "b": {"code": "b.py:run"},
        "c": {"code": "c.py:run", "needs": ["b"]}})
    task = start(engine)
    changed = json.loads((root / "workflow.json").read_text())
    changed["steps"]["b"]["needs"] = ["a"]
    (root / "workflow.json").write_text(json.dumps(changed))
    engine.drain()
    current = steps(engine, task)
    assert current["a"]["state"] == "succeeded"
    assert current["b"]["state"] == "failed"
    assert "Undeclared dependency" in current["b"]["history"][0]["error"]
    assert current["c"]["state"] == "blocked"
    new = start(engine)
    engine.drain()
    assert engine.status(new)["state"] == "succeeded"


@pytest.mark.parametrize("settings", [
    {"a": {"code": "a.py:run", "needs": ["b"]}, "b": {"code": "a.py:run", "needs": ["a"]}},
    {"a": {"code": "missing.py:run"}},
    {"a": {"code": "a.py:no_such_function"}},
    {"a": {"code": "../escape.py:run"}},
])
def test_invalid_graph_rejected_before_task_creation(engine, settings):
    workflow(engine, {"a.py": 'def run(ctx):\n    pass\n'}, settings)
    with pytest.raises(ValueError):
        engine.create_task("test")
    assert engine.tasks() == []


def test_broken_external_json_remains_editable(engine):
    engine.catalog.create("repair")
    path = engine.catalog.directory("repair") / "workflow.json"
    original = path.read_text()
    path.write_text("{broken")
    broken = engine.catalog.get("repair")
    assert broken["error"]
    assert "workflow.json" in broken["files"]
    engine.catalog.save("repair", "workflow.json", original, broken["revision"])
    assert not engine.catalog.get("repair")["error"]


def test_console_event_tail_is_not_lost(engine):
    workflow(engine, {"main.py": 'def run(ctx):\n    print("X" * 200000)\n'})
    task = start(engine)
    engine.drain()
    console = "".join(e["payload"]["text"] for e in engine.events(task) if e["kind"] == "console")
    assert console.count("X") == 200000
