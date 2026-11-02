"""Local scheduling with explicit artifacts and human-authorized execution."""
import json
from pathlib import Path
import time
import traceback
import uuid

from . import definition
from .catalog import Catalog
from .environments import EnvironmentManager, python_environment
from .process import Child, SchedulerLock
from .store import Conflict, Store, encode, event

TERMINAL = {"succeeded", "failed", "blocked", "cancelled", "interrupted"}
ACTIVE_TASKS = {"queued", "running", "pausing", "cancelling"}
FINISHED_TASKS = {"succeeded", "failed", "cancelled"}

class Engine:
    def __init__(self, project=".", runtime=None):
        self.project = Path(project).resolve()
        self.runtime = Path(runtime).resolve() if runtime else self.project / ".runtime" / "v1"
        self.store = Store(self.runtime / "state.sqlite3")
        self.store.initialize()
        self.catalog = Catalog(self.project / "workflows", self.store)
        self.active, self.epoch, self._lock = {}, None, None
        self.environments = EnvironmentManager(self)

    def __enter__(self):
        return self.open()

    def __exit__(self, *args):
        self.close()

    def open(self):
        if self.epoch:
            raise RuntimeError("This scheduler is already open")
        lock = SchedulerLock(self.runtime / "scheduler.lock")
        lock.__enter__()
        try:
            epoch = uuid.uuid4().hex
            with self.store.transaction() as db:
                self.environments.recover(db)
                for row in db.execute("SELECT task_id,name,attempts FROM steps WHERE state='running'").fetchall():
                    task_id, name, number = row
                    db.execute("UPDATE steps SET state='interrupted' WHERE task_id=? AND name=?", (task_id, name))
                    db.execute("UPDATE attempts SET state='interrupted',finished_at=?,error=? WHERE task_id=? AND step=? AND number=?",
                               (time.time(), "Scheduler stopped before recording completion", task_id, name, number))
                    event(db, task_id, "step.interrupted", None, name, number)
                for task in db.execute("SELECT id FROM tasks WHERE state NOT IN ('succeeded','failed','cancelled')").fetchall():
                    self._state(db, task["id"], "waiting_manual")
                    db.execute("UPDATE tasks SET epoch=NULL WHERE id=?", (task["id"],))
                    event(db, task["id"], "task.manual_required", {"reason": "Runtime restarted"})
                db.execute("INSERT INTO meta VALUES('epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (epoch,))
            self._lock, self.epoch = lock, epoch
            return self
        except BaseException:
            lock.__exit__()
            raise

    def close(self):
        if not self.epoch:
            return
        try:
            self.environments.close()
            for (task_id, name), record in list(self.active.items()):
                record["child"].close()
                self._finish(task_id, name, record["number"], "interrupted", error="Scheduler stopped")
            self.active.clear()
            with self.store.transaction() as db:
                for task in db.execute("SELECT id FROM tasks WHERE epoch=? AND state NOT IN ('succeeded','failed','cancelled')", (self.epoch,)).fetchall():
                    self._state(db, task["id"], "waiting_manual")
                    db.execute("UPDATE tasks SET epoch=NULL WHERE id=?", (task["id"],))
        finally:
            self.epoch = None
            self._lock.__exit__()
            self._lock = None

    def _task(self, db, task_id):
        task = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if task is None:
            raise ValueError(f"Task does not exist: {task_id}")
        return task

    def _state(self, db, task_id, state):
        previous = self._task(db, task_id)["state"]
        if previous != state:
            db.execute("UPDATE tasks SET state=?,version=version+1,updated_at=? WHERE id=?", (state, time.time(), task_id))
            event(db, task_id, "task.state", {"from": previous, "to": state})

    def _dedup(self, db, command_id, fingerprint):
        if not command_id:
            return None
        row = db.execute("SELECT * FROM commands WHERE id=?", (command_id,)).fetchone()
        if row and row["fingerprint"] != fingerprint:
            raise Conflict("Command ID was already used for a different request")
        return row["task_id"] if row else None

    def _record_command(self, db, command_id, fingerprint, task_id):
        if command_id:
            db.execute("INSERT INTO commands VALUES(?,?,?,?)", (command_id, fingerprint, task_id, time.time()))

    def create_task(self, workflow_id, input=None, command_id=None):
        payload = {} if input is None else input
        fingerprint = encode(["create", workflow_id, payload])
        with self.store.transaction() as db:
            duplicate = self._dedup(db, command_id, fingerprint)
            if duplicate:
                return duplicate
            if self.catalog.is_archived(workflow_id):
                raise Conflict("Archived workflows cannot create new tasks")
            workflow = definition.load(self.catalog.directory(workflow_id))
            task_id, now = uuid.uuid4().hex, time.time()
            db.execute("INSERT INTO tasks(id,workflow_id,definition,input,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                       (task_id, workflow_id, encode(workflow), encode(payload), "ready", now, now))
            db.executemany("INSERT INTO steps(task_id,name,state) VALUES(?,?,'pending')",
                           [(task_id, name) for name in workflow["steps"]])
            event(db, task_id, "task.created", {"workflow_id": workflow_id})
            self._record_command(db, command_id, fingerprint, task_id)
        return task_id

    def tasks(self, limit=100, workflow_id=None):
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be between 1 and 1000")
        return self.store.read("SELECT id,workflow_id,state,version,created_at,updated_at FROM tasks "
                               "WHERE (? IS NULL OR workflow_id=?) ORDER BY created_at DESC LIMIT ?",
                               (workflow_id, workflow_id, limit))

    def status(self, task_id):
        with self.store.reader(snapshot=True) as db:
            task = dict(self._task(db, task_id))
            task["definition"], task["input"] = json.loads(task["definition"]), json.loads(task["input"])
            task["environment"] = self.environments.record(db, task["environment_revision"])
            task["steps"] = [dict(r) for r in db.execute("SELECT * FROM steps WHERE task_id=? ORDER BY rowid", (task_id,))]
            for step in task["steps"]:
                step["history"] = [dict(r) for r in db.execute(
                    "SELECT * FROM attempts WHERE task_id=? AND step=? ORDER BY number", (task_id, step["name"]))]
                for attempt in step["history"]:
                    attempt["dependencies"] = json.loads(attempt["dependencies"])
                    attempt["environment"] = self.environments.record(db, attempt["environment_revision"])
            task["artifacts"] = self._artifacts(db, task_id=task_id)
        return task

    def _artifacts(self, db, task_id=None, workflow_id=None):
        rows = [dict(r) for r in db.execute(
            "SELECT a.*,s.successful_attempt FROM artifacts a JOIN steps s ON s.task_id=a.task_id AND s.name=a.step "
            "WHERE (? IS NULL OR a.task_id=?) AND (? IS NULL OR a.workflow_id=?) ORDER BY a.created_at DESC",
            (task_id, task_id, workflow_id, workflow_id))]
        for row in rows:
            row["published"] = row["published_seq"] is not None
            if row["scope"] == "task":
                row["effective"] = row["published"] and row["attempt"] == row["successful_attempt"]
            else:
                latest = db.execute("SELECT MAX(published_seq) FROM artifacts WHERE scope='workflow' AND workflow_id=? AND name=?",
                                    (row["workflow_id"], row["name"])).fetchone()[0]
                row["effective"] = row["published"] and row["published_seq"] == latest
            row.pop("successful_attempt", None)
        return rows

    def artifacts(self, workflow_id):
        with self.store.reader(snapshot=True) as db:
            return self._artifacts(db, workflow_id=workflow_id)

    def artifact(self, artifact_id):
        rows = self.store.read("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
        if not rows:
            raise ValueError("Artifact does not exist")
        path = Path(rows[0]["path"]).resolve()
        if not path.is_relative_to(self.runtime):
            raise ValueError("Artifact path is outside the runtime")
        return rows[0]

    def events(self, task_id, after=0, limit=500):
        if not 1 <= limit <= 1000:
            raise ValueError("Invalid event limit")
        rows = self.store.read("SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT ?", (task_id, after, limit))
        for row in rows:
            row["payload"] = json.loads(row["payload"])
        return rows

    def _preview(self, db, task, from_steps):
        specs = json.loads(task["definition"])["steps"]
        selected = set(specs if from_steps is None else from_steps)
        if not selected or selected - set(specs):
            raise ValueError("Select at least one existing step")
        affected = definition.descendants(specs, selected)
        rows = {r["name"]: r for r in db.execute("SELECT * FROM steps WHERE task_id=?", (task["id"],))}
        reused = {n: rows[n]["successful_attempt"] for s in affected for n in specs[s]["needs"] if n not in affected}
        if any(number is None for number in reused.values()):
            raise Conflict("An upstream dependency has no valid successful attempt; rerun it first")
        return {"affected": sorted(affected), "reused": reused, "version": task["version"]}

    def rerun_preview(self, task_id, from_steps=None):
        with self.store.reader(snapshot=True) as db:
            task = self._task(db, task_id)
            preview = self._preview(db, task, from_steps)
            preview["environment"], preview["environment_token"] = self.environments.binding(db, task["workflow_id"])
            return preview

    def control(self, task_id, action, expected_version=None, command_id=None, from_steps=None, expected_environment=None):
        fingerprint = encode([task_id, action, expected_version, from_steps] +
                             ([expected_environment] if expected_environment is not None else []))
        with self.store.transaction() as db:
            duplicate = self._dedup(db, command_id, fingerprint)
            if duplicate:
                return
            task = self._task(db, task_id)
            if expected_version is not None and task["version"] != expected_version:
                raise Conflict("Task changed; refresh and retry the operation")
            if action in {"start", "resume", "rerun"}:
                if not self.epoch:
                    raise Conflict("Open a scheduler session before authorizing execution")
                epoch = db.execute("SELECT value FROM meta WHERE key='epoch'").fetchone()
                if not epoch or epoch[0] != self.epoch:
                    raise Conflict("Scheduler session has expired")
                # Resolve before invalidating steps. Any error rolls back the entire command.
                environment_revision = self.environments.bind(db, task["workflow_id"], expected_environment)
            running = db.execute("SELECT 1 FROM steps WHERE task_id=? AND state='running'", (task_id,)).fetchone()
            if action == "start":
                if task["state"] != "ready":
                    raise Conflict("Start requires a newly created ready task; use resume after restart")
                self._state(db, task_id, "queued")
            elif action == "resume":
                if task["state"] not in {"paused", "failed", "cancelled", "waiting_manual"} or running:
                    raise Conflict("Task cannot be resumed until it has stopped")
                db.execute("UPDATE steps SET state='pending',retries_used=0,next_at=0 WHERE task_id=? AND successful_attempt IS NULL", (task_id,))
                self._state(db, task_id, "queued")
            elif action == "rerun":
                if task["state"] in ACTIVE_TASKS or running:
                    raise Conflict("Pause or cancel the task and wait for it to stop before rerunning")
                preview = self._preview(db, task, from_steps)
                db.executemany("UPDATE steps SET state='pending',successful_attempt=NULL,retries_used=0,next_at=0 WHERE task_id=? AND name=?",
                               [(task_id, name) for name in preview["affected"]])
                event(db, task_id, "task.invalidated", preview)
                self._state(db, task_id, "queued")
            elif action == "pause":
                if task["state"] not in {"queued", "running", "pausing", "paused"}:
                    raise Conflict("Only active tasks can be paused")
                self._state(db, task_id, "pausing" if running else "paused")
            elif action == "cancel":
                if task["state"] in FINISHED_TASKS:
                    raise Conflict("Task has already finished")
                db.execute("UPDATE steps SET state='cancelled' WHERE task_id=? AND state IN ('pending','retry_wait','interrupted','blocked')", (task_id,))
                self._state(db, task_id, "cancelling" if running else "cancelled")
            else:
                raise ValueError("Unknown task action")
            if action in {"start", "resume", "rerun"}:
                db.execute("UPDATE tasks SET epoch=?,environment_revision=? WHERE id=?", (self.epoch, environment_revision, task_id))
                event(db, task_id, "task.environment", {"revision": environment_revision})
            event(db, task_id, "task.command", {"action": action, "command_id": command_id})
            self._record_command(db, command_id, fingerprint, task_id)

    def _finish(self, task_id, name, number, state, error=None):
        with self.store.transaction() as db:
            task = self._task(db, task_id)
            step = db.execute("SELECT * FROM steps WHERE task_id=? AND name=?", (task_id, name)).fetchone()
            if step["state"] != "running" or step["attempts"] != number:
                return
            if task["state"] == "cancelling":
                state, error = "cancelled", "Cancelled by user"
            spec = json.loads(task["definition"])["steps"][name]
            if state == "succeeded":
                for artifact in db.execute("SELECT path,size FROM artifacts WHERE task_id=? AND step=? AND attempt=?", (task_id, name, number)):
                    if not Path(artifact["path"]).is_file() or Path(artifact["path"]).stat().st_size != artifact["size"]:
                        state, error = "failed", "A staged artifact is missing or changed"
                        break
            seq = event(db, task_id, "step." + state, {"error": error}, name, number)
            db.execute("UPDATE attempts SET state=?,finished_at=?,error=? WHERE task_id=? AND step=? AND number=?",
                       (state, time.time(), error, task_id, name, number))
            next_state = state
            if state == "succeeded":
                db.execute("UPDATE artifacts SET published_seq=? WHERE task_id=? AND step=? AND attempt=?",
                           (seq, task_id, name, number))
                db.execute("UPDATE steps SET successful_attempt=? WHERE task_id=? AND name=?", (number, task_id, name))
            elif state in {"failed", "timed_out"}:
                next_state = "failed"
                if step["retries_used"] < spec["retries"]:
                    next_state = "retry_wait"
                    db.execute("UPDATE steps SET retries_used=retries_used+1,next_at=? WHERE task_id=? AND name=?",
                               (time.time() + spec["retry_delay"], task_id, name))
                    event(db, task_id, "step.retry_scheduled", {"delay": spec["retry_delay"]}, name, number)
            db.execute("UPDATE steps SET state=? WHERE task_id=? AND name=?", (next_state, task_id, name))

    def _advance(self):
        with self.store.transaction() as db:
            tasks = db.execute("SELECT * FROM tasks WHERE epoch=? AND state IN ('queued','running','pausing','cancelling')", (self.epoch,)).fetchall()
            for task in tasks:
                task_id, specs = task["id"], json.loads(task["definition"])["steps"]
                states = {r["name"]: r["state"] for r in db.execute("SELECT name,state FROM steps WHERE task_id=?", (task_id,))}
                if task["state"] == "cancelling":
                    if "running" not in states.values():
                        self._state(db, task_id, "cancelled")
                    continue
                changed = True
                while changed:
                    changed = False
                    for name, state in list(states.items()):
                        if state in {"pending", "retry_wait"} and any(states[n] in TERMINAL - {"succeeded"} for n in specs[name]["needs"]):
                            states[name] = "blocked"
                            db.execute("UPDATE steps SET state='blocked' WHERE task_id=? AND name=?", (task_id, name))
                            event(db, task_id, "step.blocked", {"reason": "Upstream step did not succeed"}, name)
                            changed = True
                if all(s in TERMINAL for s in states.values()):
                    self._state(db, task_id, "succeeded" if all(s == "succeeded" for s in states.values()) else "failed")
                elif task["state"] == "pausing" and "running" not in states.values():
                    self._state(db, task_id, "paused")

    def _ready(self):
        groups = []
        for task in self.store.read("SELECT * FROM tasks WHERE epoch=? AND state IN ('queued','running') ORDER BY created_at", (self.epoch,)):
            specs = json.loads(task["definition"])["steps"]
            states = {s["name"]: s for s in self.store.read("SELECT * FROM steps WHERE task_id=?", (task["id"],))}
            groups.append([(task["id"], name) for name, spec in specs.items()
                           if states[name]["state"] in {"pending", "retry_wait"} and states[name]["next_at"] <= time.time()
                           and all(states[n]["state"] == "succeeded" for n in spec["needs"])])
        # Interleave tasks so a wide graph does not consume every free slot first.
        return [group[index] for index in range(max(map(len, groups), default=0)) for group in groups if index < len(group)]

    def _start(self, task_id, name):
        with self.store.transaction() as db:
            task = self._task(db, task_id)
            if task["epoch"] != self.epoch or task["state"] not in {"queued", "running"}:
                return
            step = db.execute("SELECT * FROM steps WHERE task_id=? AND name=?", (task_id, name)).fetchone()
            if step["state"] not in {"pending", "retry_wait"}:
                return
            spec = json.loads(task["definition"])["steps"][name]
            upstream = {r["name"]: r for r in db.execute("SELECT * FROM steps WHERE task_id=?", (task_id,))}
            if any(upstream[n]["state"] != "succeeded" for n in spec["needs"]):
                return
            dependencies = {n: upstream[n]["successful_attempt"] for n in spec["needs"]}
            number = step["attempts"] + 1
            db.execute("UPDATE steps SET state='running',attempts=? WHERE task_id=? AND name=?", (number, task_id, name))
            db.execute("INSERT INTO attempts(task_id,step,number,state,started_at,dependencies,environment_revision) VALUES(?,?,?,?,?,?,?)",
                       (task_id, name, number, "running", time.time(), encode(dependencies), task["environment_revision"]))
            execution_environment = self.environments.record(db, task["environment_revision"])
            self._state(db, task_id, "running")
            event(db, task_id, "step.started", {"dependencies": dependencies}, name, number)
        child = None
        try:
            directory = self.runtime / "tasks" / task_id / "attempts" / name / str(number)
            directory.mkdir(parents=True, exist_ok=False)
            code_dir = directory / "code"
            code_hash = definition.snapshot(self.catalog.directory(task["workflow_id"]), code_dir)
            definition.entrypoint(code_dir, spec["code"])
            request = dict(task_id=task_id, workflow_id=task["workflow_id"], step_id=name, attempt=number,
                           input=json.loads(task["input"]), dependencies=dependencies, code=spec["code"],
                           code_dir=str(code_dir), attempt_dir=str(directory), database=str(self.store.path),
                           runtime=str(self.runtime))
            request_path = directory / "request.json"
            request_path.write_text(encode(request), encoding="utf-8")
            with self.store.transaction() as db:
                db.execute("UPDATE attempts SET code_hash=?,code_dir=? WHERE task_id=? AND step=? AND number=?",
                           (code_hash, str(code_dir), task_id, name, number))
                cancelled = self._task(db, task_id)["state"] == "cancelling"
            if cancelled:
                self._finish(task_id, name, number, "cancelled")
                return
            if execution_environment is None:
                raise Conflict("执行环境未绑定，请人工恢复任务")
            interpreter = execution_environment["interpreter"]
            isolated = execution_environment["mode"] == "isolated"
            env = python_environment(interpreter, isolated)
            # This is a transport credential for the trusted service, not workflow input.
            env.pop("NEBULAE_SERVICE_API_KEY", None)
            command = [interpreter, "-B", "-u", "-X", "utf8", "-I" if isolated else "-P"]
            child = Child([*command, str(Path(__file__).with_name("_bootstrap.py")), "_worker", str(request_path)],
                          code_dir, env, directory / "console.log")
            with self.store.transaction() as db:
                db.execute("UPDATE attempts SET pid=? WHERE task_id=? AND step=? AND number=?", (child.process.pid, task_id, name, number))
            self.active[(task_id, name)] = dict(child=child, number=number, directory=directory, log_offset=0,
                                                deadline=time.monotonic() + spec["timeout"] if spec["timeout"] else float("inf"))
        except BaseException as exc:
            if child:
                child.close()
            self._finish(task_id, name, number, "failed" if isinstance(exc, Exception) else "interrupted", error=traceback.format_exc())
            if not isinstance(exc, Exception):
                raise

    def _capture_logs(self, task_id, name, record, drain=False):
        with (record["directory"] / "console.log").open("rb") as file:
            file.seek(record["log_offset"])
            while True:
                chunk = file.read(65536)
                record["log_offset"] += len(chunk)
                if not chunk:
                    break
                with self.store.transaction() as db:
                    event(db, task_id, "console", {"text": chunk.decode("utf-8", errors="replace")}, name, record["number"])
                if not drain:
                    break

    def _poll(self):
        for (task_id, name), record in list(self.active.items()):
            child, number, directory = record["child"], record["number"], record["directory"]
            self._capture_logs(task_id, name, record)
            state = self.store.read("SELECT state FROM tasks WHERE id=?", (task_id,))[0]["state"]
            returncode = child.process.poll()
            if state == "cancelling":
                outcome = {"state": "cancelled", "error": "Cancelled by user"}
            elif returncode is not None:
                try:
                    result = json.loads((directory / "result.json").read_text(encoding="utf-8"))
                    outcome = ({"state": "succeeded"} if returncode == 0 and result.get("ok") is True
                               else {"state": "failed", "error": result.get("error", f"Worker exited: {returncode}")})
                except (OSError, ValueError, KeyError, TypeError, AttributeError):
                    outcome = {"state": "failed", "error": f"Worker exited without a valid completion record (code={returncode}); see console.log"}
            elif time.monotonic() >= record["deadline"]:
                outcome = {"state": "timed_out", "error": "Step execution exceeded its timeout"}
            else:
                continue
            child.close()
            self._capture_logs(task_id, name, record, drain=True)
            self._finish(task_id, name, number, **outcome)
            del self.active[(task_id, name)]

    def tick(self, max_workers=4):
        if not self.epoch:
            raise RuntimeError("Open the scheduler first")
        if type(max_workers) is not int or max_workers < 1:
            raise ValueError("max_workers must be positive")
        self._poll()
        self.environments.tick()
        self._advance()
        for task_id, name in self._ready():
            if len(self.active) >= max_workers:
                break
            self._start(task_id, name)

    def drain(self, max_workers=4, timeout=300):
        deadline = time.monotonic() + timeout
        while True:
            self.tick(max_workers)
            remaining = self.store.read("SELECT 1 FROM tasks WHERE epoch=? AND state IN ('queued','running','pausing','cancelling') LIMIT 1", (self.epoch,))
            if not self.active and not remaining and not self.environments.pending():
                return
            if time.monotonic() > deadline:
                raise TimeoutError("Timed out waiting for the task queue")
            time.sleep(0.03)

    def serve_loop(self, stop_event, max_workers=4):
        while not stop_event.is_set():
            self.tick(max_workers)
            stop_event.wait(0.05)
