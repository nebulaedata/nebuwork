"""Real subprocess tests: cancellation, timeouts, worker and scheduler crashes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from nebulae import Engine
from test_core import workflow, start, wait_for, steps


def alive(pid):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x100000, False, pid)
        if not handle:
            return False
        try:
            return kernel.WaitForSingleObject(handle, 0) == 258
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        status = Path(f"/proc/{pid}/stat")
        return not status.exists() or status.read_text().split(") ", 1)[1][0] != "Z"
    except ProcessLookupError:
        return False


def assert_stopped(pids):
    deadline = time.monotonic() + 5
    while any(alive(pid) for pid in pids) and time.monotonic() < deadline:
        time.sleep(.05)
    assert not any(alive(pid) for pid in pids), pids


SOURCE = '''import json, os, subprocess, sys, time
from pathlib import Path
def run(ctx):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], stdin=subprocess.DEVNULL)
    ctx.task.save_text("staged", "must not publish")
    Path(ctx.input["pids"]).write_text(json.dumps([os.getpid(), child.pid]))
    if ctx.input.get("crash"):
        os._exit(23)
    time.sleep(120)
'''


@pytest.mark.parametrize("mode", ["cancel", "timeout", "worker_crash"])
def test_process_tree_cleanup(tmp_path, mode):
    with Engine(tmp_path) as engine:
        workflow(engine, {"main.py": SOURCE}, {"main": {"code": "main.py:run", "timeout": 2 if mode == "timeout" else None}})
        path = tmp_path / "pids.json"
        task = start(engine, input={"pids": str(path), "crash": mode == "worker_crash"})
        wait_for(engine, task, lambda s: path.exists() and path.stat().st_size > 0)
        pids = json.loads(path.read_text())
        if mode == "cancel":
            engine.control(task, "cancel")
        engine.drain()
        assert_stopped(pids)
        record = steps(engine, task)["main"]["history"][-1]
        assert record["state"] == {"cancel": "cancelled", "timeout": "timed_out", "worker_crash": "failed"}[mode]
        assert all(not a["published"] for a in engine.status(task)["artifacts"])


def test_abrupt_scheduler_death_stops_tree_and_requires_manual_resume(tmp_path):
    engine = Engine(tmp_path)
    workflow(engine, {"main.py": SOURCE})
    pids_file, task_file = tmp_path / "pids.json", tmp_path / "task.txt"
    script = '''import sys, time
from pathlib import Path
from nebulae import Engine
with Engine(sys.argv[1]) as engine:
    task = engine.create_task("test", {"pids": sys.argv[2]})
    Path(sys.argv[3]).write_text(task)
    engine.control(task, "start")
    while True:
        engine.tick()
        time.sleep(.03)
'''
    scheduler = subprocess.Popen([sys.executable, "-c", script, str(tmp_path), str(pids_file), str(task_file)],
                                 cwd=Path(__file__).resolve().parents[1])
    try:
        deadline = time.monotonic() + 15
        while (not pids_file.exists() or not pids_file.stat().st_size) and time.monotonic() < deadline:
            assert scheduler.poll() is None
            time.sleep(.05)
        pids = json.loads(pids_file.read_text())
        task = task_file.read_text()
        scheduler.kill()
        scheduler.wait(timeout=10)
        assert_stopped(pids)
        with engine:
            engine.drain()
            status = engine.status(task)
            assert status["state"] == "waiting_manual"
            assert status["steps"][0]["history"][0]["state"] == "interrupted"
            assert status["steps"][0]["attempts"] == 1
            assert not status["artifacts"][0]["published"]
            (engine.catalog.directory("test") / "main.py").write_text('def run(ctx):\n    ctx.task.save_text("fixed", "done")\n')
            engine.control(task, "resume")
            engine.drain()
            assert engine.status(task)["state"] == "succeeded"
    finally:
        if scheduler.poll() is None:
            scheduler.kill()
        scheduler.wait(timeout=10)
