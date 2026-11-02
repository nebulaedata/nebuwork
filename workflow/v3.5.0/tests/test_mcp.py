"""Protocol-level coverage against the same API and scheduler used by the UI."""
import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
import socket
import sys
import threading
import time

import pytest

pytest.importorskip("mcp")
from mcp import Client as MCPClient, StdioServerParameters
from fastapi.testclient import TestClient
import uvicorn
from wheels import wheel

from nebulae.api import create_app
from nebulae.client import APIError, Client
from nebulae.mcp_server import create_server, local_url


class LocalClient(Client):
    def __init__(self, http):
        self.http = http

    def request(self, path, method="GET", data=None):
        response = self.http.request(method, "/api/v1" + path, json=data)
        if response.status_code >= 400:
            raise APIError(response.status_code, response.text)
        return response.json()


@pytest.fixture
def adapter(tmp_path):
    app = create_app(tmp_path, run_scheduler=False)
    with app.state.engine, TestClient(app) as http:
        yield create_server(client=LocalClient(http)), app.state.engine


async def call(client, tool_name, **args):
    result = await client.call_tool(tool_name, args)
    assert not result.is_error, result
    assert result.structured_content is not None
    return result.structured_content


async def error(client, tool_name, text, **args):
    result = await client.call_tool(tool_name, args)
    assert result.is_error, result
    assert text in " ".join(c.text for c in result.content if c.type == "text"), result


@contextmanager
def serve(app):
    """Use an OS-assigned local port, including on Windows."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", timeout_graceful_shutdown=2))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        until = time.monotonic() + 15
        while not server.started:
            if not thread.is_alive() or time.monotonic() >= until:
                pytest.fail("Test server did not start")
            time.sleep(.02)
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(15)
        listener.close()
        assert not thread.is_alive(), "Test server did not stop"


def test_discovery_guide_and_required_preconditions(adapter):
    server, engine = adapter
    async def scenario():
        async with MCPClient(server) as client:
            tools = {t.name: t for t in (await client.list_tools()).tools}
            assert len(tools) == 28
            assert tools["source_save"].input_schema["required"] == ["workflow_id", "path", "content", "expected_revision"]
            assert "expected_environment" in tools["task_rerun"].input_schema["required"]
            assert tools["task_get"].annotations.read_only_hint
            assert tools["task_control"].annotations.open_world_hint
            assert tools["task_create"].annotations.idempotent_hint
            guide = await call(client, "workflow_guide")
            assert "ctx.task.save_json" in guide["guide"]
            resource = await client.read_resource("workflow://guide")
            assert resource.contents[0].text == guide["guide"]
            await error(client, "task_control", "expected_version", task_id="missing", action="start", command_id="x")
            await error(client, "workflow_get", "pattern", workflow_id="../tasks")
            assert (await call(client, "workflow_list"))["workflows"] == []
    asyncio.run(scenario())
    assert engine.tasks() == []


def test_source_conflicts_history_validation_and_copy(adapter):
    server, engine = adapter
    async def scenario():
        async with MCPClient(server) as client:
            flow = await call(client, "workflow_create", workflow_id="edit", name="智能体编辑")
            await error(client, "workflow_create", "409", workflow_id="edit")
            source = await call(client, "source_read", workflow_id="edit", path="main.py")
            edited = await call(client, "source_save", workflow_id="edit", path="main.py",
                                content="def run(ctx):\n    pass\n", expected_revision=source["revision"])
            await error(client, "source_save", "409", workflow_id="edit", path="main.py",
                        content=source["content"], expected_revision=source["revision"])
            await error(client, "source_save", "422", workflow_id="edit", path="../escape.py",
                        content="x = 1", expected_revision=None)
            await error(client, "source_save", "422", workflow_id="edit", path="main.py",
                        content="def broken(", expected_revision=edited["revision"])
            revisions = (await call(client, "source_revisions", workflow_id="edit", path="main.py"))["revisions"]
            restored = await call(client, "source_restore", workflow_id="edit", path="main.py",
                                  revision_id=revisions[-1]["id"], expected_revision=edited["revision"])
            assert restored["content"] == source["content"]
            invalid = {"steps": {"main": {"code": "main.py:run", "needs": ["main"]}}}
            await error(client, "workflow_validate", "422", workflow_id="edit", definition=invalid)
            assert (await call(client, "workflow_get", workflow_id="edit"))["revision"] == flow["revision"]
            await call(client, "workflow_validate", workflow_id="edit")
            copy = await call(client, "workflow_create", workflow_id="copy", copy_from="edit")
            assert copy["definition"]["steps"] == flow["definition"]["steps"]
            assert (await call(client, "workflow_archive", workflow_id="copy", archived=True))["archived"]
            assert not (await call(client, "workflow_archive", workflow_id="copy", archived=False))["archived"]
    asyncio.run(scenario())
    assert not (engine.project / "escape.py").exists()


def test_commands_environment_and_reconnect_do_not_execute(adapter):
    server, engine = adapter
    async def scenario():
        async with MCPClient(server) as client:
            await call(client, "workflow_create", workflow_id="env")
            shared = await call(client, "environment_shared", search="pytest")
            assert shared["matched_count"] == 1 and shared["package_count"] > 1
            state = await call(client, "environment_get", workflow_id="env")
            await call(client, "environment_select", workflow_id="env", mode="isolated",
                       expected_revision=state["workflow_revision"])
            task = await call(client, "task_create", workflow_id="env", command_id="once", input=0)
            assert task["input"] == 0
            assert (await call(client, "task_create", workflow_id="env", command_id="once", input=0))["id"] == task["id"]
            await error(client, "task_create", "409", workflow_id="env", command_id="once", input=False)
            await error(client, "task_control", "409", task_id=task["id"], action="start",
                        expected_version=task["version"], command_id="blocked")
            assert (await call(client, "task_get", task_id=task["id"]))["state"] == "ready"
            await error(client, "environment_packages", "409", workflow_id="env")
            state = await call(client, "environment_get", workflow_id="env")
            args = dict(workflow_id="env", kind="create", expected_version=state["version"], command_id="env-once")
            op = await call(client, "environment_operate", **args)
            assert (await call(client, "environment_operate", **args))["id"] == op["id"]
            pending = await call(client, "environment_operation_get", operation_id=op["id"])
            assert pending["state"] == "queued" and pending["next_cursor"] == 0
        # Opening another MCP session doesn't acquire a scheduler lock or run pending work.
        async with MCPClient(server) as client:
            assert (await call(client, "task_get", task_id=task["id"]))["steps"][0]["attempts"] == 0
            assert (await call(client, "environment_operation_get", operation_id=op["id"]))["state"] == "queued"
    asyncio.run(scenario())


@pytest.mark.parametrize("transport", ["stdio", "streamable-http"])
def test_protocol_create_fail_fix_rerun_and_artifacts(tmp_path, transport):
    app = create_app(tmp_path)
    async def scenario(target):
        async with MCPClient(target, read_timeout_seconds=15) as client:
            assert (await call(client, "workflow_health"))["scheduler"]
            flow = await call(client, "workflow_create", workflow_id="agent", name="智能体流程")
            await call(client, "source_save", workflow_id="agent", path="prepare.py", expected_revision=None,
                       content="def run(ctx):\n    ctx.task.save_json('input', ctx.input)\n")
            fail_source = "def run(ctx):\n    print('准备报告')\n    ctx.task.save_text('report', '失败草稿')\n    raise RuntimeError('需要修复')\n"
            source = await call(client, "source_save", workflow_id="agent", path="report.py", expected_revision=None,
                                content=fail_source)
            definition = {"name": "智能体流程", "steps": {"prepare": {"code": "prepare.py:run"},
                          "report": {"code": "report.py:run", "needs": ["prepare"]}}}
            await call(client, "workflow_validate", workflow_id="agent", definition=definition)
            await call(client, "workflow_save_definition", workflow_id="agent", definition=definition,
                       expected_revision=flow["revision"])
            task = await call(client, "task_create", workflow_id="agent", input={"text": "你好"}, command_id="create")
            start = dict(task_id=task["id"], action="start", expected_version=task["version"], command_id="start")
            await call(client, "task_control", **start)
            async def terminal():
                for _ in range(200):
                    state = await call(client, "task_get", task_id=task["id"])
                    if state["state"] in {"succeeded", "failed", "cancelled"}:
                        return state
                    await asyncio.sleep(.05)
                pytest.fail("Task did not finish")
            failed = await terminal()
            assert failed["state"] == "failed"
            await call(client, "task_control", **start)  # lost-response retry cannot start twice
            log = await call(client, "task_logs", task_id=task["id"], step_id="report", attempt=1)
            assert "需要修复" in log["error"] and "准备报告" in log["text"]
            await call(client, "source_save", workflow_id="agent", path="report.py", expected_revision=source["revision"],
                       content="def run(ctx):\n    data = ctx.task.read('prepare', 'input')\n    ctx.log('修复完成')\n    ctx.task.save_text('report', data['text'])\n    return '不应保存'\n")
            preview = await call(client, "task_rerun_preview", task_id=task["id"], from_steps=["report"])
            assert preview["affected"] == ["report"] and preview["reused"] == {"prepare": 1}
            rerun = dict(task_id=task["id"], from_steps=["report"], expected_version=preview["version"],
                         expected_environment=preview["environment_token"], command_id="rerun")
            await error(client, "task_rerun", "409", **{**rerun, "expected_environment": "stale", "command_id": "stale"})
            assert (await call(client, "task_get", task_id=task["id"]))["state"] == "failed"
            await call(client, "task_rerun", **rerun)
            success = await terminal()
            assert success["state"] == "succeeded"
            await call(client, "task_rerun", **rerun)
            assert {s["name"]: s["attempts"] for s in success["steps"]} == {"prepare": 1, "report": 2}
            artifacts = (await call(client, "artifact_list", workflow_id="agent", task_id=task["id"]))["artifacts"]
            assert len(artifacts) == 3
            draft = next(a for a in artifacts if a["step"] == "report" and a["attempt"] == 1)
            assert not draft["published"] and not draft["effective"]
            final = next(a for a in artifacts if a["step"] == "report" and a["effective"])
            assert (await call(client, "artifact_read", artifact_id=final["id"]))["data"] == "你好"
            events = await call(client, "task_events", task_id=task["id"], limit=2)
            later = await call(client, "task_events", task_id=task["id"], after=events["next_cursor"])
            assert all(e["id"] > events["next_cursor"] for e in later["events"])
            assert any(e["kind"] == "custom.log" for e in later["events"])
            assert len((await call(client, "task_list", workflow_id="agent"))["tasks"]) == 1
    with serve(app) as base_url:
        if transport == "stdio":
            target = StdioServerParameters(command=sys.executable, args=["-m", "nebulae", "--url", base_url,
                                          "--project", str(tmp_path / "unused"), "mcp"],
                                          cwd=str(Path(__file__).resolve().parents[1]))
            asyncio.run(scenario(target))
            assert not (tmp_path / "unused").exists()
        else:
            mcp_app = create_server(base_url).streamable_http_app(stateless_http=True, json_response=True)
            with serve(mcp_app) as mcp_url:
                asyncio.run(scenario(mcp_url + "/mcp"))


def test_connection_errors_and_local_boundaries():
    for value in ["http://example.com", "https://localhost", "http://127.0.0.1/api", "http://user@localhost", "http://localhost?q=x"]:
        with pytest.raises(ValueError):
            local_url(value)
    class Offline:
        def request(self, *args):
            raise ConnectionRefusedError("offline")
    async def scenario():
        async with MCPClient(create_server(client=Offline())) as client:
            await error(client, "workflow_health", "请确认服务已启动")
    asyncio.run(scenario())


def test_start_script_from_another_directory(tmp_path):
    script = Path(__file__).resolve().parents[1] / "start_mcp.py"
    async def scenario():
        target = StdioServerParameters(command=sys.executable, args=[str(script), "--transport", "stdio"], cwd=tmp_path)
        async with MCPClient(target) as client:
            assert len((await client.list_tools()).tools) == 28
            assert "ctx.task.save_file" in (await call(client, "workflow_guide"))["guide"]
    asyncio.run(scenario())
    assert not list(tmp_path.iterdir())


def test_environment_install_and_execution_through_mcp(adapter, monkeypatch):
    monkeypatch.setenv("PIP_NO_INDEX", "1")
    server, engine = adapter
    async def scenario():
        async with MCPClient(server) as client:
            await call(client, "workflow_create", workflow_id="isolated")
            package = wheel(engine.catalog.directory("isolated"), "1.0")
            state = await call(client, "environment_get", workflow_id="isolated")
            op = await call(client, "environment_operate", workflow_id="isolated", kind="create",
                            expected_version=state["version"], command_id="create-env")
            await asyncio.to_thread(engine.drain, timeout=120)
            assert (await call(client, "environment_operation_get", operation_id=op["id"]))["state"] == "succeeded"
            await call(client, "source_save", workflow_id="isolated", path="requirements.txt",
                       content=package + "\n", expected_revision=None)
            state = await call(client, "environment_get", workflow_id="isolated")
            op = await call(client, "environment_operate", workflow_id="isolated", kind="install", requirements=True,
                            expected_version=state["version"], command_id="install-env")
            await asyncio.to_thread(engine.drain, timeout=120)
            done = await call(client, "environment_operation_get", operation_id=op["id"])
            assert done["state"] == "succeeded" and done["next_cursor"] > 0
            assert (await call(client, "environment_operation_get", operation_id=op["id"], after=done["next_cursor"]))["log"] == ""
            packages = (await call(client, "environment_packages", workflow_id="isolated"))["packages"]
            assert any(p["name"] == "nebulae-env-fixture" and p["version"] == "1.0" for p in packages)
            assert not any(p["name"] == "mcp" for p in packages)
            state = await call(client, "environment_get", workflow_id="isolated")
            await call(client, "environment_select", workflow_id="isolated", mode="isolated", expected_revision=state["workflow_revision"])
            source = await call(client, "source_read", workflow_id="isolated", path="main.py")
            await call(client, "source_save", workflow_id="isolated", path="main.py", expected_revision=source["revision"],
                       content="def run(ctx):\n    import nebulae_env_fixture\n    ctx.task.save_text('version', nebulae_env_fixture.VERSION)\n")
            task = await call(client, "task_create", workflow_id="isolated", command_id="isolated-task")
            await call(client, "task_control", task_id=task["id"], action="start", expected_version=task["version"], command_id="start-isolated")
            await asyncio.to_thread(engine.drain)
            task = await call(client, "task_get", task_id=task["id"])
            assert task["state"] == "succeeded" and task["environment"]["mode"] == "isolated"
            assert (await call(client, "artifact_read", artifact_id=task["artifacts"][0]["id"]))["data"] == "1.0"
    asyncio.run(scenario())


def test_http_origin_and_protocol_compatibility():
    server = create_server()
    with TestClient(server.streamable_http_app(stateless_http=True, json_response=True), base_url="http://127.0.0.1:8766") as http:
        headers = {"Accept": "application/json, text/event-stream"}
        request = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "older-agent", "version": "1"}}}
        response = http.post("/mcp", json=request, headers=headers)
        assert response.status_code == 200
        assert response.json()["result"]["protocolVersion"] == "2025-11-25"
        assert http.post("/mcp", json=request, headers={**headers, "Origin": "https://evil.example"}).status_code == 403
        assert http.post("/mcp", json=request, headers={**headers, "Host": "evil.example"}).status_code == 421


def test_cli_mcp_dispatch_never_constructs_engine(monkeypatch):
    from nebulae.__main__ import main
    received = []
    monkeypatch.setattr("nebulae.mcp_server.run_server", lambda *args: received.append(args))
    monkeypatch.setattr("nebulae.__main__.Engine", lambda *args: pytest.fail("MCP cannot own a scheduler"))
    assert main(["--url", "http://localhost:9999", "mcp", "--transport", "streamable-http", "--port", "9998"]) == 0
    assert received == [("http://localhost:9999", "streamable-http", "127.0.0.1", 9998)]


def test_management_info_and_missing_dependency(tmp_path, monkeypatch):
    import importlib.metadata
    app = create_app(tmp_path, run_scheduler=False)
    with TestClient(app, base_url="http://127.0.0.1:8765") as http:
        response = http.get("/api/v1/mcp/info")
        assert response.status_code == 200
        info = response.json()
        assert info["installed"] and len(info["tools"]) == 28
        assert info["python"] == sys.executable and info["api_url"] == "http://127.0.0.1:8765"
        tool = next(t for t in info["tools"] if t["name"] == "task_rerun")
        assert not tool["read_only"] and "expected_environment" in tool["input_schema"]["required"]
        def missing(_):
            raise importlib.metadata.PackageNotFoundError("mcp")
        monkeypatch.setattr("nebulae.mcp_settings.importlib.metadata.version", missing)
        missing_info = http.get("/api/v1/mcp/info").json()
        assert not missing_info["installed"] and missing_info["tools"] == []
        assert "ctx.task.save_json" in missing_info["guide"]
    assert app.state.engine.epoch is None and app.state.engine.tasks() == []


def test_management_probes_real_mcp_and_rejects_bad_ports(tmp_path):
    app = create_app(tmp_path, run_scheduler=False)
    bridge = create_server().streamable_http_app(stateless_http=True, json_response=True)
    with TestClient(app) as http, serve(bridge) as url:
        port = int(url.rsplit(":", 1)[1])
        result = http.post("/api/v1/mcp/check", json={"port": port}).json()
        assert result["connected"] and result["server"]["name"] == "Nebulae Workflow"
        assert result["protocol_version"] == "2025-11-25"
        for body in ({"port": -1}, {"port": True}, {"port": 65536}, {"port": port, "url": "https://example.com"}):
            assert http.post("/api/v1/mcp/check", json=body).status_code == 422
        assert http.post("/api/v1/mcp/check", json={"port": port}, headers={"Origin": "https://evil.example"}).status_code == 403
    with TestClient(app) as http:
        assert not http.post("/api/v1/mcp/check", json={"port": port}).json()["connected"]
    assert app.state.engine.epoch is None and app.state.engine.tasks() == []
