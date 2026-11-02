"""Real HTTP MCP lifecycle, ownership and restart behavior (Windows and Linux)."""
import asyncio
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

import pytest

pytest.importorskip("mcp")
from mcp import Client as MCPClient
from fastapi.testclient import TestClient

from nebulae import Engine
from nebulae.api import create_app
from nebulae.client import APIError, Client
from nebulae.mcp_service import MCPService
from nebulae.mcp_settings import check_connection
from nebulae.store import Conflict
from test_mcp import call, serve
from test_processes import assert_stopped


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_state(service, state):
    until = time.monotonic() + 15
    while time.monotonic() < until:
        result = service.status()
        if result["state"] == state:
            return result
        if state == "running" and result["state"] == "failed":
            pytest.fail(str(result))
        time.sleep(.05)
    pytest.fail(str(service.status()))


@pytest.fixture
def managed(tmp_path):
    with Engine(tmp_path) as engine:
        service = MCPService(engine)
        service.open()
        service.configure(free_port(), 0, "configure")
        try:
            yield service
        finally:
            service.close()


def test_http_control_protocol_idempotency_and_persisted_restart(tmp_path):
    app = create_app(tmp_path)
    port = free_port()
    with serve(app) as url:
        api = Client(url)
        initial = api.request("/mcp/service")
        saved = api.request("/mcp/service/config", "PUT",
                            {"port": port, "expected_version": initial["version"], "command_id": "save"})
        start = {"expected_version": saved["version"], "command_id": "start"}
        launched = api.request("/mcp/service/start", "POST", start)
        duplicate = api.request("/mcp/service/start", "POST", start)
        assert launched["generation"] == duplicate["generation"]
        running = wait_state(app.state.mcp_service, "running")
        pid = running["pid"]
        assert check_connection(port)["connected"]

        async def health():
            async with MCPClient(running["url"]) as client:
                assert (await call(client, "workflow_health"))["scheduler"]
        asyncio.run(health())
        with pytest.raises(APIError) as conflict:
            api.request("/mcp/service/config", "PUT",
                        {"port": free_port(), "expected_version": running["version"], "command_id": "active-change"})
        assert conflict.value.status == 409
        with pytest.raises(APIError) as conflict:
            api.request("/mcp/service/stop", "POST", {"expected_version": saved["version"], "command_id": "stale-stop"})
        assert conflict.value.status == 409
        stop = {"expected_version": running["version"], "command_id": "stop"}
        stopped = api.request("/mcp/service/stop", "POST", stop)
        assert stopped["state"] == "stopped"
        assert_stopped([pid])
        assert not check_connection(port)["connected"]
        # Replaying old accepted commands never restarts or stops a newer instance.
        assert api.request("/mcp/service/start", "POST", start)["state"] == "stopped"
        latest = api.request("/mcp/service/start", "POST",
                             {"expected_version": stopped["version"], "command_id": "start-again"})
        assert latest["generation"] != running["generation"]
        running = wait_state(app.state.mcp_service, "running")
        assert api.request("/mcp/service/stop", "POST", stop)["pid"] == running["pid"]
        assert api.request("/tasks") == []
    assert_stopped([running["pid"]])
    # A fresh API process retains the saved port, never the execution eligibility.
    with serve(create_app(tmp_path)) as url:
        api = Client(url)
        state = api.request("/mcp/info")["service"]
        assert state["port"] == port and state["state"] == "stopped" and state["pid"] is None
        time.sleep(.25)
        assert api.request("/mcp/service")["state"] == "stopped"
        assert api.request("/tasks") == []


def test_port_conflict_preserves_external_listener_and_can_retry(managed):
    with socket.socket() as external:
        external.bind(("127.0.0.1", 0))
        external.listen()
        port = external.getsockname()[1]
        state = managed.configure(port, managed.status()["version"], "external-port")
        managed.start("http://127.0.0.1:8765", state["version"], "collision")
        failed = wait_state(managed, "failed")
        assert failed["pid"] is None and "ERROR" in failed["log"]
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            peer, _ = external.accept()
            peer.close()
    state = managed.configure(free_port(), failed["version"], "new-port")
    managed.start("http://127.0.0.1:8765", state["version"], "retry")
    assert check_connection(wait_state(managed, "running")["port"])["connected"]


def test_crashed_mcp_child_is_reaped_and_failure_is_visible(managed):
    managed.start("http://127.0.0.1:8765", managed.status()["version"], "start")
    running = wait_state(managed, "running")
    managed.child.process.kill()
    failed = wait_state(managed, "failed")
    assert failed["error"] and failed["pid"] is None
    assert_stopped([running["pid"]])
    assert not check_connection(running["port"])["connected"]


def test_stop_bridge_does_not_cancel_workflow_task(tmp_path):
    app = create_app(tmp_path)
    with serve(app) as url:
        service = app.state.mcp_service
        configured = service.configure(free_port(), 0, "config")
        service.start(url, configured["version"], "start")
        running = wait_state(service, "running")
        engine = app.state.engine
        engine.catalog.create("continue-task")
        (engine.catalog.directory("continue-task") / "main.py").write_text(
            "import time\ndef run(ctx):\n    time.sleep(1)\n    ctx.task.save_text('done', 'yes')\n", encoding="utf-8")
        task = engine.create_task("continue-task")
        engine.control(task, "start")
        until = time.monotonic() + 10
        while not engine.status(task)["steps"][0]["history"] and time.monotonic() < until:
            time.sleep(.02)
        assert engine.status(task)["steps"][0]["history"]
        service.stop(running["version"], "stop")
        while engine.status(task)["state"] != "succeeded" and time.monotonic() < until:
            time.sleep(.03)
        assert engine.status(task)["state"] == "succeeded"
        assert engine.status(task)["artifacts"][0]["published"]


def test_parent_death_kills_bridge_and_restart_never_replays_start(tmp_path):
    report = tmp_path / "report.json"
    script = '''import json, os, sys, time
from pathlib import Path
from nebulae import Engine
from nebulae.mcp_service import MCPService
with Engine(sys.argv[1]) as engine:
    manager = MCPService(engine)
    manager.open()
    configured = manager.configure(int(sys.argv[3]), 0, "configure")
    manager.start("http://127.0.0.1:8765", configured["version"], "start")
    while manager.status()["state"] == "starting":
        time.sleep(.05)
    Path(sys.argv[2]).write_text(json.dumps({"parent": os.getpid(), "service": manager.status()}))
    while True:
        time.sleep(1)
'''
    parent = subprocess.Popen([sys.executable, "-c", script, str(tmp_path), str(report), str(free_port())],
                              cwd=Path(__file__).resolve().parents[1])
    parent_pid = None
    try:
        until = time.monotonic() + 20
        while (not report.exists() or not report.stat().st_size) and time.monotonic() < until:
            assert parent.poll() is None
            time.sleep(.05)
        value = json.loads(report.read_text())
        state = value["service"]
        parent_pid = value["parent"]
        assert state["state"] == "running", state
        os.kill(parent_pid, signal.SIGTERM)
        parent.wait(timeout=10)
        parent_pid = None
        assert_stopped([state["pid"]])
        with Engine(tmp_path) as engine:
            manager = MCPService(engine)
            manager.open()
            try:
                assert manager.status()["state"] == "stopped"
                assert manager.start("http://127.0.0.1:8765", 1, "start")["state"] == "stopped"
                time.sleep(.3)
                assert manager.child is None
                assert not check_connection(state["port"])["connected"]
            finally:
                manager.close()
    finally:
        if parent_pid:
            os.kill(parent_pid, signal.SIGTERM)
        if parent.poll() is None:
            parent.kill()
        parent.wait(timeout=10)


def test_validation_persistence_failure_and_repair(managed, monkeypatch):
    state = managed.status()
    with pytest.raises(Conflict, match="端口"):
        managed.start(f"http://127.0.0.1:{state['port']}", state["version"], "same-port")
    with pytest.raises(Conflict, match="状态"):
        managed.configure(free_port(), 0, "stale")
    from nebulae import mcp_service
    original = mcp_service.atomic_write
    def fail(*args):
        raise OSError("disk full")
    monkeypatch.setattr(mcp_service, "atomic_write", fail)
    with pytest.raises(OSError, match="disk full"):
        managed.configure(free_port(), state["version"], "write-failed")
    assert managed.status() == state
    monkeypatch.setattr(mcp_service, "atomic_write", original)
    managed.file.write_text("broken JSON", encoding="utf-8")
    repaired = MCPService(managed.engine)
    repaired.open()
    try:
        assert repaired.status()["config_error"]
        with pytest.raises(Conflict, match="配置"):
            repaired.start("http://127.0.0.1:8765", 0, "start")
        saved = repaired.configure(free_port(), 0, "repair")
        assert saved["config_error"] is None
        assert json.loads(repaired.file.read_text())["port"] == saved["port"]
    finally:
        repaired.close()


def test_control_api_rejects_invalid_fields_and_unowned_runtime(tmp_path):
    with TestClient(create_app(tmp_path, run_scheduler=False), base_url="http://127.0.0.1:8765") as client:
        assert client.get("/api/v1/mcp/service").json()["state"] == "stopped"
        for port in [0, 65536, True, "8766", 1.5]:
            assert client.put("/api/v1/mcp/service/config", json={
                "port": port, "expected_version": 0, "command_id": "bad"}).status_code == 422
        assert client.post("/api/v1/mcp/service/start", json={
            "expected_version": 0, "command_id": "start"}).status_code == 409

