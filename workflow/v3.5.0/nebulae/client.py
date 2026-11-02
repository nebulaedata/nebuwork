"""Dependency-free Python client for the local management API."""
import json
import os
import urllib.error
import urllib.request
import uuid


class APIError(ValueError):
    """An API rejection, retaining the HTTP status for adapters such as MCP."""
    def __init__(self, status, body):
        self.status, self.body = status, body
        super().__init__(body)


class Client:
    def __init__(self, base_url="http://127.0.0.1:8765", api_key=None):
        self.base_url = base_url.rstrip("/") + "/api/v1"
        self.api_key = os.environ.get("NEBULAE_SERVICE_API_KEY", "") if api_key is None else api_key
        self._commands = {}

    def request(self, path, method="GET", data=None):
        body = json.dumps(data, ensure_ascii=False).encode() if data is not None else None
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        request = urllib.request.Request(self.base_url + path, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise APIError(exc.code, exc.read().decode("utf-8", errors="replace")) from exc

    def create_task(self, workflow_id, input=None, command_id=None):
        return self.request("/tasks", "POST", {"workflow_id": workflow_id, "input": {} if input is None else input,
                                              "command_id": command_id or uuid.uuid4().hex})

    def status(self, task_id):
        return self.request(f"/tasks/{task_id}")

    def environment(self, workflow_id):
        return self.request(f"/workflows/{workflow_id}/environment")

    def select_environment(self, workflow_id, mode, expected_revision=None):
        revision = expected_revision or self.environment(workflow_id)["workflow_revision"]
        return self.request(f"/workflows/{workflow_id}/environment", "PUT",
                            {"mode": mode, "expected_revision": revision})

    def environment_operation(self, workflow_id, kind, packages=None, requirements=False,
                              expected_version=None, command_id=None):
        command_id = command_id or uuid.uuid4().hex
        path = f"/workflows/{workflow_id}/environment/operations"
        payload = {"kind": kind, "packages": packages or [], "requirements": requirements, "command_id": command_id}
        previous = self._commands.get(command_id)
        if previous:
            old_path, old_payload = previous
            if old_path != path or any(old_payload.get(k) != v for k, v in payload.items()) or (
                    expected_version is not None and old_payload["expected_version"] != expected_version):
                raise ValueError("Command ID was already used for a different request")
            payload = old_payload
        else:
            payload["expected_version"] = self.environment(workflow_id)["version"] if expected_version is None else expected_version
            self._commands[command_id] = path, payload
        return self.request(path, "POST", payload)

    def operation(self, operation_id, after=0):
        return self.request(f"/environment/operations/{operation_id}?after={after}")

    def control(self, task_id, action, from_steps=None, command_id=None, expected_version=None):
        command_id = command_id or uuid.uuid4().hex
        path = f"/tasks/{task_id}/actions/{action}"
        previous = self._commands.get(command_id)
        if previous:
            old_path, payload = previous
            if old_path != path or payload["from_steps"] != from_steps or (expected_version is not None and payload["expected_version"] != expected_version):
                raise ValueError("Command ID was already used for a different request")
        else:
            version = self.status(task_id)["version"] if expected_version is None else expected_version
            payload = {"expected_version": version, "command_id": command_id, "from_steps": from_steps}
            self._commands[command_id] = (path, payload)
        return self.request(path, "POST", payload)
