"""Explicit, attempt-scoped artifacts. Returning a value saves nothing."""
import hashlib
import json
import math
import os
from pathlib import Path
import time
import uuid
from .store import Store, encode, event

def read_artifact(row):
    path = Path(row["path"])
    if row["kind"] == "json":
        return json.loads(path.read_text(encoding="utf-8"))
    if row["kind"] == "text":
        return path.read_text(encoding="utf-8")
    return path

class Artifacts:
    def __init__(self, ctx, scope):
        self.ctx, self.scope = ctx, scope

    def save_json(self, name, value):
        return self._save(name, "json", encode(value).encode("utf-8"), None)

    def save_text(self, name, value):
        if not isinstance(value, str):
            raise TypeError("Text artifacts require str")
        return self._save(name, "text", value.encode("utf-8"), None)

    def save_file(self, name, path):
        path = Path(path).resolve()
        if not path.is_file():
            raise ValueError(f"File does not exist: {path}")
        return self._save(name, "file", None, path)

    def _save(self, name, kind, data, source):
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ValueError("Artifact name must contain 1-200 characters")
        ctx, artifact_id = self.ctx, uuid.uuid4().hex
        directory = (ctx.runtime / "workflows" / ctx.workflow_id / "artifacts" if self.scope == "workflow"
                     else ctx.attempt_dir / "artifacts")
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / artifact_id
        temporary = directory / (artifact_id + ".tmp")
        digest, size = hashlib.sha256(), 0
        with temporary.open("xb") as output:
            if source is not None:
                with source.open("rb") as file:
                    while chunk := file.read(1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
            else:
                output.write(data)
                digest.update(data)
                size = len(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        with ctx.store.transaction() as db:
            ctx._assert_running(db)
            db.execute("DELETE FROM artifacts WHERE task_id=? AND step=? AND attempt=? AND scope=? AND name=?",
                       (ctx.task_id, ctx.step_id, ctx.attempt, self.scope, name))
            db.execute("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
                       (artifact_id, ctx.task_id, ctx.workflow_id, ctx.step_id, ctx.attempt, self.scope, name,
                        kind, str(target), source.name if source else name, size, digest.hexdigest(), time.time()))
            event(db, ctx.task_id, "artifact.staged", {"id": artifact_id, "name": name, "scope": self.scope}, ctx.step_id, ctx.attempt)
        return artifact_id

    def read(self, *args):
        ctx = self.ctx
        if self.scope == "task":
            if len(args) != 2:
                raise TypeError("task.read(step_id, name) requires two arguments")
            step, name = args
            if step not in ctx.dependencies:
                raise ValueError(f"Undeclared dependency: {step}")
            rows = ctx.store.read("SELECT * FROM artifacts WHERE task_id=? AND step=? AND attempt=? "
                                  "AND scope='task' AND name=? AND published_seq IS NOT NULL",
                                  (ctx.task_id, step, ctx.dependencies[step], name))
        else:
            if len(args) != 1:
                raise TypeError("workflow.read(name) requires one argument")
            name = args[0]
            rows = ctx.store.read("SELECT * FROM artifacts WHERE workflow_id=? AND scope='workflow' "
                                  "AND name=? AND published_seq IS NOT NULL ORDER BY published_seq DESC LIMIT 1",
                                  (ctx.workflow_id, name))
        if not rows:
            raise KeyError(f"No published artifact for this execution: {args}")
        return read_artifact(rows[0])

class Context:
    def __init__(self, request):
        self.task_id, self.workflow_id = request["task_id"], request["workflow_id"]
        self.step_id, self.attempt = request["step_id"], request["attempt"]
        self.input, self.dependencies = request["input"], request["dependencies"]
        self.attempt_dir, self.runtime = Path(request["attempt_dir"]), Path(request["runtime"])
        self.work_dir = self.attempt_dir / "work"
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.store = Store(request["database"])
        self.task, self.workflow = Artifacts(self, "task"), Artifacts(self, "workflow")

    def _assert_running(self, db):
        row = db.execute("SELECT s.state,s.attempts,t.state AS task_state FROM steps s JOIN tasks t ON t.id=s.task_id "
                         "WHERE s.task_id=? AND s.name=?", (self.task_id, self.step_id)).fetchone()
        if not row or row["state"] != "running" or row["attempts"] != self.attempt or row["task_state"] not in {"running", "pausing"}:
            raise RuntimeError("This attempt is no longer allowed to publish data")

    def emit(self, kind, payload=None):
        with self.store.transaction() as db:
            self._assert_running(db)
            event(db, self.task_id, "custom." + str(kind), payload, self.step_id, self.attempt)

    def log(self, message):
        self.emit("log", {"message": str(message)})

    def progress(self, percent, message=""):
        if type(percent) not in (int, float) or not math.isfinite(percent) or not 0 <= percent <= 100:
            raise ValueError("Progress must be between 0 and 100")
        self.emit("progress", {"percent": percent, "message": message})