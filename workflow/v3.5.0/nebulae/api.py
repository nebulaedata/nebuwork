"""Local management HTTP adapter. Lifecycle decisions remain in Engine."""
import asyncio
from contextlib import asynccontextmanager
import json
import os
import secrets
from pathlib import Path
import threading
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import definition
from .context import read_artifact
from .engine import Engine
from .mcp_service import MCPService
from .agent_service import AgentService
from .agent_api import register_agent_routes
from .store import Conflict, encode


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkflowCreate(Body):
    id: str
    name: str | None = None
    copy_from: str | None = None


class SourceSave(Body):
    content: str
    expected_revision: str | None


class DefinitionSave(Body):
    definition: dict
    expected_revision: str


class DefinitionDraft(Body):
    definition: dict | None = None


class Restore(Body):
    revision_id: int
    expected_revision: str


class TaskCreate(Body):
    workflow_id: str
    input: Any = Field(default_factory=dict)
    command_id: str = Field(min_length=1, max_length=100)


class Control(Body):
    expected_version: int
    command_id: str = Field(min_length=1, max_length=100)
    from_steps: list[str] | None = None
    expected_environment: str | None = None


class EnvironmentSelect(Body):
    mode: str
    expected_revision: str


class EnvironmentOperation(Body):
    kind: str
    expected_version: int = Field(ge=0)
    command_id: str = Field(min_length=1, max_length=100)
    packages: list[str] = Field(default_factory=list)
    requirements: bool = False


class Preview(Body):
    from_steps: list[str] | None = None


class Archive(Body):
    archived: bool = True


class MCPCheck(Body):
    port: int = Field(ge=1, le=65535, strict=True)


class MCPControl(Body):
    expected_version: int = Field(ge=0, strict=True)
    command_id: str = Field(min_length=1, max_length=100)


class MCPConfig(MCPControl):
    port: int = Field(ge=1, le=65535, strict=True)


def create_app(project=".", runtime=None, max_workers=4, run_scheduler=True,
               remote_access=False, service_api_key=None, trusted_hosts=None):
    service_api_key = service_api_key or os.environ.get("NEBULAE_SERVICE_API_KEY", "")
    if remote_access and (len(service_api_key) < 32 or any(ord(c) < 33 or ord(c) > 126 for c in service_api_key)):
        raise ValueError("Remote access requires NEBULAE_SERVICE_API_KEY with at least 32 non-whitespace ASCII characters")
    hosts = ["127.0.0.1", "localhost", "testserver"]
    if remote_access:
        if not trusted_hosts or any("*" in h or "://" in h or "/" in h for h in trusted_hosts):
            raise ValueError("Remote access requires explicit trusted host names or IP addresses")
        hosts.extend(trusted_hosts)
    engine = Engine(project, runtime)
    mcp_service = MCPService(engine)
    agent_service = AgentService(engine)

    @asynccontextmanager
    async def lifespan(app):
        stop = threading.Event()
        thread = None
        if run_scheduler:
            engine.open()
            def serve():
                try:
                    engine.serve_loop(stop, max_workers)
                except Exception as exc:
                    app.state.scheduler_error = str(exc)
                finally:
                    engine.close()
            thread = threading.Thread(target=serve, name="workflow-scheduler", daemon=True)
            thread.start()
        try:
            mcp_service.open()
            agent_service.open()
            yield
        finally:
            try:
                await asyncio.to_thread(agent_service.close)
                await asyncio.to_thread(mcp_service.close)
            finally:
                stop.set()
                if thread:
                    await asyncio.to_thread(thread.join)

    app = FastAPI(title="Nebulae Workflow", version="1.0.0", lifespan=lifespan)
    app.state.engine, app.state.scheduler_error = engine, None
    app.state.mcp_service = mcp_service
    app.state.agent_service = agent_service
    register_agent_routes(app, agent_service)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
                       allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type", "Last-Event-ID"])

    @app.middleware("http")
    async def local_origins(request, call_next):
        if remote_access and request.url.path.startswith("/api/"):
            supplied = request.headers.get("authorization", "")
            if not secrets.compare_digest(supplied.encode(), ("Bearer " + service_api_key).encode()):
                return JSONResponse({"detail": "A valid service Bearer token is required"}, status_code=401)
        origin = request.headers.get("origin")
        allowed = {str(request.base_url).rstrip("/"), "http://127.0.0.1:5173", "http://localhost:5173"}
        if origin and origin not in allowed:
            return JSONResponse({"detail": "Only the local application may issue requests"}, status_code=403)
        if request.method in {"POST", "PUT"} and request.headers.get("content-type", "").split(";")[0] != "application/json":
            return JSONResponse({"detail": "application/json is required"}, status_code=415)
        return await call_next(request)

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ValueError)
    @app.exception_handler(SyntaxError)
    async def validation_handler(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(FileNotFoundError)
    async def missing_handler(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    base = "/api/v1"

    @app.get(base + "/mcp/info")
    async def mcp_info(request: Request):
        from .mcp_settings import connection_info
        result = await connection_info(str(request.base_url).rstrip("/"))
        result["service"] = mcp_service.status()
        return result

    @app.get(base + "/mcp/service")
    def mcp_status():
        return mcp_service.status()

    @app.put(base + "/mcp/service/config")
    def mcp_config(body: MCPConfig):
        return mcp_service.configure(**body.model_dump())

    @app.post(base + "/mcp/service/start")
    def mcp_start(body: MCPControl, request: Request):
        return mcp_service.start(str(request.base_url).rstrip("/"), **body.model_dump())

    @app.post(base + "/mcp/service/stop")
    def mcp_stop(body: MCPControl):
        return mcp_service.stop(**body.model_dump())

    @app.post(base + "/mcp/check")
    def mcp_check(body: MCPCheck):
        from .mcp_settings import check_connection
        return check_connection(body.port)

    @app.get(base + "/environment/shared")
    def shared_environment():
        return engine.environments.shared()

    @app.get(base + "/workflows/{workflow_id}/environment")
    def workflow_environment(workflow_id: str):
        return engine.environments.status(workflow_id)

    @app.put(base + "/workflows/{workflow_id}/environment")
    def select_environment(workflow_id: str, body: EnvironmentSelect):
        return engine.environments.select(workflow_id, body.mode, body.expected_revision)

    @app.get(base + "/workflows/{workflow_id}/environment/packages")
    def environment_packages(workflow_id: str):
        return engine.environments.packages(workflow_id)

    @app.post(base + "/workflows/{workflow_id}/environment/operations", status_code=202)
    def environment_operation(workflow_id: str, body: EnvironmentOperation):
        return engine.environments.submit(workflow_id, **body.model_dump())

    @app.get(base + "/environment/operations/{operation_id}")
    def environment_operation_status(operation_id: str, after: int = 0):
        return engine.environments.operation(operation_id, after)

    @app.get(base + "/health")
    def health():
        return {"service": "nebulae-workflow", "integration_version": 1,
                "status": "error" if app.state.scheduler_error else "ok", "scheduler": bool(engine.epoch),
                "error": app.state.scheduler_error, "runtime": str(engine.runtime)}

    @app.get(base + "/workflows")
    def workflows():
        return engine.catalog.list()

    @app.post(base + "/workflows", status_code=201)
    def create_workflow(body: WorkflowCreate):
        return engine.catalog.create(body.id, body.name, body.copy_from)

    @app.get(base + "/workflows/{workflow_id}")
    def workflow(workflow_id: str):
        return engine.catalog.get(workflow_id)

    @app.put(base + "/workflows/{workflow_id}/definition")
    def save_definition(workflow_id: str, body: DefinitionSave):
        engine.catalog.save(workflow_id, "workflow.json", json.dumps(body.definition, ensure_ascii=False, indent=2), body.expected_revision)
        return engine.catalog.get(workflow_id)

    @app.post(base + "/workflows/{workflow_id}/validate")
    def validate_workflow(workflow_id: str, body: DefinitionDraft | None = None):
        if body is not None and body.definition is not None:
            return definition.validate(body.definition, engine.catalog.directory(workflow_id))
        return definition.load(engine.catalog.directory(workflow_id))

    @app.post(base + "/workflows/{workflow_id}/archive")
    def archive(workflow_id: str, body: Archive):
        return engine.catalog.archive(workflow_id, body.archived)

    @app.get(base + "/workflows/{workflow_id}/source")
    def source(workflow_id: str, path: str):
        return engine.catalog.read(workflow_id, path)

    @app.put(base + "/workflows/{workflow_id}/source")
    def save_source(workflow_id: str, path: str, body: SourceSave):
        return engine.catalog.save(workflow_id, path, body.content, body.expected_revision)

    @app.get(base + "/workflows/{workflow_id}/revisions")
    def revisions(workflow_id: str, path: str):
        return engine.catalog.revisions(workflow_id, path)

    @app.post(base + "/workflows/{workflow_id}/restore")
    def restore(workflow_id: str, path: str, body: Restore):
        return engine.catalog.restore(workflow_id, path, body.revision_id, body.expected_revision)

    @app.get(base + "/workflows/{workflow_id}/artifacts")
    def workflow_artifacts(workflow_id: str):
        return engine.artifacts(workflow_id)

    @app.get(base + "/tasks")
    def tasks(limit: int = 100, workflow_id: str | None = None):
        return engine.tasks(limit, workflow_id)

    @app.post(base + "/tasks", status_code=201)
    def create_task(body: TaskCreate):
        return engine.status(engine.create_task(body.workflow_id, body.input, body.command_id))

    @app.get(base + "/tasks/{task_id}")
    def task(task_id: str):
        return engine.status(task_id)

    @app.post(base + "/tasks/{task_id}/preview")
    def preview(task_id: str, body: Preview):
        return engine.rerun_preview(task_id, body.from_steps)

    @app.post(base + "/tasks/{task_id}/actions/{action}")
    def control(task_id: str, action: str, body: Control):
        engine.control(task_id, action, body.expected_version, body.command_id, body.from_steps, body.expected_environment)
        return engine.status(task_id)

    @app.get(base + "/tasks/{task_id}/events")
    def events(task_id: str, after: int = 0, limit: int = 500):
        engine.status(task_id)
        return engine.events(task_id, after, limit)

    @app.get(base + "/tasks/{task_id}/stream")
    async def stream(task_id: str, request: Request, after: int = 0, follow: bool = True):
        engine.status(task_id)
        cursor = max(after, int(request.headers.get("last-event-id", "0")))
        async def generate():
            nonlocal cursor
            while not await request.is_disconnected():
                rows = await asyncio.to_thread(engine.events, task_id, cursor)
                for row in rows:
                    cursor = row["id"]
                    yield f"id: {cursor}\ndata: {encode(row)}\n\n"
                if not follow:
                    break
                if not rows:
                    yield ": heartbeat\n\n"
                    await asyncio.sleep(0.5)
        return StreamingResponse(generate(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get(base + "/tasks/{task_id}/logs")
    def logs(task_id: str, step: str, attempt: int):
        row = next((a for s in engine.status(task_id)["steps"] if s["name"] == step
                    for a in s["history"] if a["number"] == attempt), None)
        if row is None:
            raise HTTPException(404, "Attempt does not exist")
        path = Path(row["code_dir"]).parent / "console.log" if row["code_dir"] else None
        if path is None or not path.exists():
            return {"text": "", "truncated": False}
        with path.open("rb") as file:
            size = path.stat().st_size
            file.seek(max(0, size - 1024 * 1024))
            return {"text": file.read().decode("utf-8", errors="replace"), "truncated": size > 1024 * 1024}

    @app.get(base + "/artifacts/{artifact_id}/content")
    def content(artifact_id: str):
        artifact = engine.artifact(artifact_id)
        if artifact["kind"] == "file" or artifact["size"] > 2 * 1024 * 1024:
            return {"kind": artifact["kind"], "download_only": True, "data": None}
        return {"kind": artifact["kind"], "data": read_artifact(artifact), "download_only": False}

    @app.get(base + "/artifacts/{artifact_id}/download")
    def download(artifact_id: str):
        artifact = engine.artifact(artifact_id)
        return FileResponse(artifact["path"], filename=artifact["filename"], media_type="application/octet-stream")

    web = Path(__file__).parent / "web"
    if (web / "assets").exists():
        app.mount("/assets", StaticFiles(directory=web / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        if (web / "index.html").exists():
            return FileResponse(web / "index.html")
        return JSONResponse({"message": "Build the frontend with npm run build in frontend/", "docs": "/docs"}, status_code=503)

    return app
