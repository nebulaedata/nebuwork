import pytest
from fastapi.testclient import TestClient
from nebulae.api import create_app

TOKEN = "integration-test-token-01234567890123456789"


def test_remote_mode_requires_token_and_explicit_trusted_hosts(tmp_path):
    with pytest.raises(ValueError, match="SERVICE_API_KEY"):
        create_app(tmp_path, remote_access=True, service_api_key="short", trusted_hosts=["workflow.internal"])
    with pytest.raises(ValueError, match="trusted host"):
        create_app(tmp_path, remote_access=True, service_api_key=TOKEN, trusted_hosts=["*"])


def test_remote_management_authentication_and_compatibility_handshake(tmp_path):
    app = create_app(tmp_path, run_scheduler=False, remote_access=True,
                     service_api_key=TOKEN, trusted_hosts=["workflow.internal"])
    with app.state.engine, TestClient(app, base_url="http://workflow.internal") as client:
        assert client.get("/api/v1/health").status_code == 401
        assert client.get("/api/v1/workflows", headers={"Authorization": "Bearer wrong"}).status_code == 401
        headers = {"Authorization": "Bearer " + TOKEN}
        health = client.get("/api/v1/health", headers=headers).json()
        assert health["service"] == "nebulae-workflow"
        assert health["integration_version"] == 1 and health["scheduler"]
        assert TOKEN not in str(health)
        created = client.post("/api/v1/workflows", json={"id": "managed", "name": "真实工作流"}, headers=headers)
        assert created.status_code == 201
        assert client.get("/api/v1/workflows/managed", headers=headers).json()["definition"]["steps"]
        assert client.get("/api/v1/health", headers={**headers, "Host": "untrusted.internal"}).status_code == 400
        assert client.post("/api/v1/workflows", json={"id": "cross-origin"}, headers={**headers, "Origin": "https://other.example"}).status_code == 403


def test_default_local_mode_remains_usable_without_credentials(tmp_path):
    app = create_app(tmp_path, run_scheduler=False)
    with app.state.engine, TestClient(app) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert client.post("/api/v1/workflows", json={"id": "local"}).status_code == 201


def test_step_process_does_not_inherit_the_service_token(tmp_path, monkeypatch):
    monkeypatch.setenv("NEBULAE_SERVICE_API_KEY", TOKEN)
    app = create_app(tmp_path, run_scheduler=False)
    with app.state.engine, TestClient(app) as client:
        client.post("/api/v1/workflows", json={"id": "credential-check"})
        source = client.get("/api/v1/workflows/credential-check/source?path=main.py").json()
        code = 'def run(ctx):\n    import os\n    ctx.task.save_json("check", {"present": "NEBULAE_SERVICE_API_KEY" in os.environ})\n'
        assert client.put("/api/v1/workflows/credential-check/source?path=main.py", json={"content": code, "expected_revision": source["revision"]}).status_code == 200
        task = client.post("/api/v1/tasks", json={"workflow_id": "credential-check", "command_id": "credential-create"}).json()
        client.post(f"/api/v1/tasks/{task['id']}/actions/start", json={"expected_version": 0, "command_id": "credential-start"})
        app.state.engine.drain()
        final = client.get(f"/api/v1/tasks/{task['id']}").json()
        assert final["state"] == "succeeded"
        artifact = final["artifacts"][0]
        assert client.get(f"/api/v1/artifacts/{artifact['id']}/content").json()["data"] == {"present": False}
