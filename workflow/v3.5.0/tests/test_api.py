import json
from fastapi.testclient import TestClient
import pytest
from nebulae.api import create_app

@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, run_scheduler=False)
    with app.state.engine, TestClient(app) as client:
        yield client, app.state.engine

def test_workflow_sources_validation_revisions_and_archive(client):
    client, engine = client
    response = client.post("/api/v1/workflows", json={"id": "sample", "name": "示例"})
    assert response.status_code == 201
    original = client.get("/api/v1/workflows/sample/source", params={"path": "main.py"}).json()
    path = "/api/v1/workflows/sample/source?path=main.py"
    changed = client.put(path, json={"content": "def run(ctx):\r\n    pass\r\n", "expected_revision": original["revision"]})
    assert changed.status_code == 200
    assert client.put(path, json={"content": original["content"], "expected_revision": original["revision"]}).status_code == 409
    assert client.put(path, json={"content": "def invalid(", "expected_revision": changed.json()["revision"]}).status_code == 422
    history = client.get("/api/v1/workflows/sample/revisions?path=main.py").json()
    assert len(history) == 2
    restored = client.post("/api/v1/workflows/sample/restore?path=main.py",
                           json={"revision_id": history[-1]["id"], "expected_revision": changed.json()["revision"]})
    assert restored.json()["content"] == original["content"]
    assert client.post("/api/v1/workflows/sample/validate", json={}).status_code == 200
    assert client.post("/api/v1/workflows", json={"id": "copied", "copy_from": "sample"}).status_code == 201
    assert client.post("/api/v1/workflows/sample/archive", json={}).json()["archived"]

def test_task_commands_artifacts_and_sse_cursor(client):
    client, engine = client
    client.post("/api/v1/workflows", json={"id": "demo"})
    create = {"workflow_id": "demo", "input": {"hello": "world"}, "command_id": "create-once"}
    first = client.post("/api/v1/tasks", json=create).json()
    assert client.post("/api/v1/tasks", json=create).json()["id"] == first["id"]
    task_id = first["id"]
    assert first["state"] == "ready"
    command = {"command_id": "start-once", "expected_version": first["version"]}
    assert client.post(f"/api/v1/tasks/{task_id}/actions/start", json=command).status_code == 200
    engine.drain()
    assert client.post(f"/api/v1/tasks/{task_id}/actions/start", json=command).status_code == 200
    task = client.get(f"/api/v1/tasks/{task_id}").json()
    assert task["state"] == "succeeded"
    assert task["steps"][0]["attempts"] == 1
    artifact = task["artifacts"][0]
    assert client.get(f"/api/v1/artifacts/{artifact['id']}/content").json()["data"] == {"hello": "world"}
    assert client.get(f"/api/v1/artifacts/{artifact['id']}/download").status_code == 200
    all_events = client.get(f"/api/v1/tasks/{task_id}/events").json()
    cursor = all_events[1]["id"]
    stream = client.get(f"/api/v1/tasks/{task_id}/stream?follow=false", headers={"Last-Event-ID": str(cursor)})
    delivered = [json.loads(line[6:]) for line in stream.text.splitlines() if line.startswith("data: ")]
    assert [e["id"] for e in delivered] == [e["id"] for e in all_events if e["id"] > cursor]
    assert client.post(f"/api/v1/tasks/{task_id}/preview", json={"from_steps": ["main"]}).json()["affected"] == ["main"]


def test_input_presets_round_trip_and_edited_run_input(client):
    client, engine = client
    flow = client.post('/api/v1/workflows', json={'id': 'presets'}).json()
    presets = [{'id': 'normal', 'name': '处理文本', 'description': '处理给定文本',
                'input': {'text': '样例'}, 'fields': {'/text': '待处理的文本内容'}}]
    definition = {**flow['definition'], 'input_presets': presets}
    validated = client.post('/api/v1/workflows/presets/validate', json={'definition': definition})
    assert validated.status_code == 200
    assert validated.json()['input_presets'] == presets
    saved = client.put('/api/v1/workflows/presets/definition', json={'definition': definition, 'expected_revision': flow['revision']})
    assert saved.status_code == 200
    assert saved.json()['definition']['input_presets'] == presets
    task = client.post('/api/v1/tasks', json={'workflow_id': 'presets', 'input': {'text': '用户修改'}, 'command_id': 'preset-run'}).json()
    assert task['input'] == {'text': '用户修改'}
    assert task['definition']['input_presets'] == presets
    assert task['state'] == 'ready'
    assert not task['artifacts']
    invalid = {**definition, 'input_presets': [presets[0], presets[0]]}
    assert client.post('/api/v1/workflows/presets/validate', json={'definition': invalid}).status_code == 422

def test_browser_origin_and_path_controls(client):
    client, engine = client
    assert client.post("/api/v1/workflows", json={"id": "x"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/v1/workflows", content="x=1", headers={"Content-Type": "text/plain"}).status_code == 415
    client.post("/api/v1/workflows", json={"id": "good"})
    assert client.get("/api/v1/workflows/good/source?path=../../escape.py").status_code == 422
    assert client.get("/api/v1/nonexistent").status_code == 404


def test_environment_routes_and_task_preconditions(client):
    client, engine = client
    client.post("/api/v1/workflows", json={"id": "env-flow"})
    shared = client.get("/api/v1/environment/shared")
    assert shared.status_code == 200 and shared.json()["packages"]
    endpoint = "/api/v1/workflows/env-flow/environment"
    state = client.get(endpoint).json()
    selection = {"mode": "isolated", "expected_revision": state["workflow_revision"]}
    assert client.put(endpoint, json=selection).status_code == 200
    assert client.put(endpoint, json=selection).status_code == 409
    task = client.post("/api/v1/tasks", json={"workflow_id": "env-flow", "command_id": "env-task"}).json()
    assert client.post(f"/api/v1/tasks/{task['id']}/actions/start", json={"expected_version": 0, "command_id": "start"}).status_code == 409
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["state"] == "ready"
    command = {"kind": "create", "command_id": "env-create", "expected_version": 0}
    created = client.post(endpoint + "/operations", json=command)
    assert created.status_code == 202
    operation_id = created.json()["id"]
    assert client.post(endpoint + "/operations", json=command).json()["id"] == operation_id
    assert client.post(endpoint + "/operations", json={**command, "command_id": "another"}).status_code == 409
    assert client.get(f"/api/v1/environment/operations/{operation_id}?after=0").json()["state"] == "queued"
    assert client.get(endpoint + "/packages").status_code == 409

def test_real_lifespan_restart_is_manual(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        client.post("/api/v1/workflows", json={"id": "test"})
        task = client.post("/api/v1/tasks", json={"workflow_id": "test", "command_id": "new"}).json()
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(f"/api/v1/tasks/{task['id']}").json()["state"] == "waiting_manual"
        assert client.get("/api/v1/health").json()["scheduler"] is True


def test_python_client_retry_preserves_version_and_scalar_input(client):
    from nebulae.client import Client
    http, engine = client
    python = Client()
    def request(path, method="GET", data=None):
        response = http.request(method, "/api/v1" + path, json=data)
        response.raise_for_status()
        return response.json()
    python.request = request
    python.request("/workflows", "POST", {"id": "scalar"})
    task = python.create_task("scalar", 0, command_id="scalar-task")
    assert task["input"] == 0
    python.control(task["id"], "start", command_id="start-scalar")
    engine.drain()
    python.control(task["id"], "start", command_id="start-scalar")
    assert python.status(task["id"])["steps"][0]["attempts"] == 1
    with pytest.raises(ValueError):
        python.control(task["id"], "rerun", command_id="start-scalar")


def test_draft_validation_does_not_save_or_execute(client):
    http, engine = client
    flow = engine.catalog.create("draft")
    invalid = {"steps": {"main": {"code": "main.py:run", "needs": ["main"]}}}
    response = http.post("/api/v1/workflows/draft/validate", json={"definition": invalid})
    assert response.status_code == 422
    assert engine.catalog.get("draft")["revision"] == flow["revision"]
    assert engine.tasks() == []


def test_environment_python_client_retry_and_cli(client, monkeypatch, capsys):
    from nebulae.client import Client
    from nebulae.__main__ import main
    http, engine = client
    engine.catalog.create("env-client")
    def request(self, path, method="GET", data=None):
        response = http.request(method, "/api/v1" + path, json=data)
        if response.status_code >= 400:
            raise ValueError(response.text)
        return response.json()
    monkeypatch.setattr(Client, "request", request)
    python = Client()
    assert python.select_environment("env-client", "isolated")["mode"] == "isolated"
    op = python.environment_operation("env-client", "create", command_id="python-env-once")
    assert python.environment_operation("env-client", "create", command_id="python-env-once")["id"] == op["id"]
    with pytest.raises(ValueError):
        python.environment_operation("env-client", "rebuild", command_id="python-env-once")
    assert python.operation(op["id"])["state"] == "queued"
    assert main(["env-show", "env-client"]) == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "isolated"
    assert main(["env-operation", op["id"]]) == 0
    assert json.loads(capsys.readouterr().out)["state"] == "queued"
    assert main(["env-shared"]) == 0
    assert json.loads(capsys.readouterr().out)["package_count"] > 0
