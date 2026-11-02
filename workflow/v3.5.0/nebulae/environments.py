"""Local Python environments; all reservations share the scheduler's SQLite lock."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from . import definition
from .process import Child
from .store import Conflict, encode

ACTIVE = "('queued','running','pausing','cancelling')"
BUSY = {"queued", "running"}


def python_environment(interpreter, isolated=False):
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    if isolated:
        env.pop("PYTHONPATH", None)
        env["PYTHONNOUSERSITE"] = "1"
        env["VIRTUAL_ENV"] = str(Path(interpreter).parent.parent)
        env["PATH"] = str(Path(interpreter).parent) + os.pathsep + env.get("PATH", "")
    return env


def probe(interpreter, isolated=False, sdk=False):
    if not Path(interpreter).is_file():
        raise Conflict(f"Python 解释器不存在：{interpreter}")
    command = [str(interpreter), "-B", "-X", "utf8", "-I" if isolated else "-P"]
    command += [str(Path(__file__).with_name("_environment_probe.py"))]
    if sdk:
        command.append("--sdk")
    try:
        result = subprocess.run(command, env=python_environment(interpreter, isolated),
                                cwd=Path(__file__).parent, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                encoding="utf-8", timeout=20, check=True,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise Conflict(f"无法读取 Python 环境：{interpreter}；{exc}") from exc


def interpreter_at(directory):
    return str(Path(directory) / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))


class EnvironmentManager:
    def __init__(self, engine):
        self.engine, self.store, self.catalog = engine, engine.store, engine.catalog
        self.root = engine.runtime / "environments"
        self.active = None

    def shared(self):
        return {"mode": "shared", **probe(sys.executable)}

    def configuration(self, workflow_id):
        source = self.catalog.read(workflow_id, "workflow.json")
        raw = json.loads(source["content"])
        return definition.environment_mode(raw), source["revision"]

    def select(self, workflow_id, mode, expected_revision):
        definition.environment_mode({"environment": {"mode": mode}})
        source = self.catalog.read(workflow_id, "workflow.json")
        if source["revision"] != expected_revision:
            raise Conflict("工作流已修改，请刷新后重试")
        raw = json.loads(source["content"])
        raw["environment"] = {"mode": mode}
        self.catalog.save(workflow_id, "workflow.json", json.dumps(raw, ensure_ascii=False, indent=2), expected_revision)
        return self.status(workflow_id)

    def occupants(self, db, workflow_id):
        return [dict(r) for r in db.execute(
            "SELECT t.id,t.state FROM tasks t JOIN environment_revisions e ON e.id=t.environment_revision "
            f"WHERE e.workflow_id=? AND e.mode='isolated' AND t.state IN {ACTIVE}", (workflow_id,))]

    def record(self, db, revision_id):
        if not revision_id:
            return None
        row = db.execute("SELECT * FROM environment_revisions WHERE id=?", (revision_id,)).fetchone()
        if row is None:
            raise Conflict("执行环境记录不存在")
        item = dict(row)
        item.update(json.loads(item.pop("info")))
        return item

    def status(self, workflow_id):
        mode, revision = self.configuration(workflow_id)
        with self.store.reader(snapshot=True) as db:
            row = db.execute("SELECT * FROM environments WHERE workflow_id=?", (workflow_id,)).fetchone()
            value = dict(row) if row else {"workflow_id": workflow_id, "state": "not_created", "version": 0,
                                           "current_revision": None, "error": None}
            value.update(mode=mode, workflow_revision=revision, occupants=self.occupants(db, workflow_id),
                         current=self.record(db, value["current_revision"]))
            value["operations"] = [dict(r) for r in db.execute(
                "SELECT id,kind,state,created_at,finished_at,error FROM environment_operations "
                "WHERE workflow_id=? ORDER BY created_at DESC", (workflow_id,))]
        return value

    def packages(self, workflow_id):
        status = self.status(workflow_id)
        if status["state"] in {"creating", "installing", "rebuilding"}:
            raise Conflict("环境正在修改，请等待操作完成后刷新包列表")
        if not status["current"]:
            raise Conflict("独立环境尚未创建成功")
        return probe(status["current"]["interpreter"], isolated=True)

    def binding(self, db, workflow_id, expected_token=None):
        mode, workflow_revision = self.configuration(workflow_id)
        if mode == "shared":
            info = probe(sys.executable, sdk=True)
            stable = {k: info[k] for k in ("interpreter", "python_version", "packages")}
            revision_id = "shared-" + hashlib.sha256(encode(stable).encode()).hexdigest()
            record = {"id": revision_id, "mode": mode, "generation": None, **info}
        else:
            row = db.execute("SELECT * FROM environments WHERE workflow_id=?", (workflow_id,)).fetchone()
            if not row or row["state"] != "ready":
                raise Conflict("独立环境未就绪，请先创建或修复环境")
            record = self.record(db, row["current_revision"])
            if not Path(record["interpreter"]).is_file():
                raise Conflict("独立环境解释器不存在，请重建环境")
            actual = probe(record["interpreter"], isolated=True, sdk=True)
            if actual["packages"] != record["packages"] or actual["python_version"] != record["python_version"]:
                raise Conflict("环境依赖在外部发生变化，请通过安装依赖或重建重新校验环境")
        token = workflow_revision + ":" + record["id"]
        if expected_token is not None and token != expected_token:
            raise Conflict("执行环境已变化，请重新预览后再执行")
        return record, token

    def bind(self, db, workflow_id, expected_token=None):
        record, _ = self.binding(db, workflow_id, expected_token)
        if record["mode"] == "shared":
            db.execute("INSERT OR IGNORE INTO environment_revisions(id,mode,interpreter,info,created_at) VALUES(?,?,?,?,?)",
                       (record["id"], "shared", record["interpreter"], encode({k: record[k] for k in
                        ("python_version", "packages", "package_count", "observed_at")}), time.time()))
        return record["id"]

    def submit(self, workflow_id, kind, expected_version, command_id, packages=None, requirements=False):
        if not command_id or len(command_id) > 100:
            raise ValueError("command_id is required (1–100 characters)")
        if kind not in {"create", "install", "rebuild"}:
            raise ValueError("Unknown environment operation")
        packages = packages or []
        if not isinstance(packages, list) or any(not isinstance(p, str) or not p.strip() or p.lstrip().startswith('-') or '\n' in p or '\r' in p for p in packages):
            raise ValueError("每个包应为单独的包名、版本约束或包路径，不接受 pip 命令选项")
        if kind == "install" and (bool(packages) == bool(requirements)):
            raise ValueError("请选择包列表或 requirements.txt 中的一种安装方式")
        if kind != "install" and (packages or requirements):
            raise ValueError("创建和重建不接受安装参数")
        fingerprint = encode([workflow_id, kind, expected_version, packages, requirements])
        with self.store.transaction() as db:
            old = db.execute("SELECT id,fingerprint FROM environment_operations WHERE command_id=?", (command_id,)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise Conflict("命令 ID 已用于另一操作")
                return self.operation(old["id"])
            epoch = db.execute("SELECT value FROM meta WHERE key='epoch'").fetchone()
            if not self.engine.epoch or not epoch or epoch[0] != self.engine.epoch:
                raise Conflict("请先启动调度服务")
            self.configuration(workflow_id)
            row = db.execute("SELECT * FROM environments WHERE workflow_id=?", (workflow_id,)).fetchone()
            version = row["version"] if row else 0
            if version != expected_version:
                raise Conflict("环境状态已变化，请刷新后重试")
            if row and row["state"] in {"creating", "installing", "rebuilding"}:
                raise Conflict("该环境已有待处理操作")
            occupants = self.occupants(db, workflow_id)
            if occupants:
                raise Conflict("环境被任务占用，请暂停并等待收尾：" + ", ".join(r["id"] for r in occupants))
            current = self.record(db, row["current_revision"]) if row else None
            if kind == "create" and current:
                raise Conflict("环境已存在；请使用重建")
            if kind == "install" and not current:
                raise Conflict("请先创建独立环境")
            operation_id = uuid.uuid4().hex
            directory = self.root / "operations" / operation_id
            directory.mkdir(parents=True)
            generation = current["generation"] if kind == "install" else uuid.uuid4().hex
            target = self.root / workflow_id / generation
            request = {"id": operation_id, "kind": kind, "target": str(target),
                       "interpreter": interpreter_at(target), "packages": packages, "requirements": requirements,
                       "generation": generation}
            if kind == "install":
                # Freeze local wheels, nested requirements and relative paths together.
                definition.snapshot(self.catalog.directory(workflow_id), directory / "source")
                request["source"] = str(directory / "source")
                if requirements:
                    request["requirements_content"] = (directory / "source" / "requirements.txt").read_text(encoding="utf-8-sig")
            (directory / "request.json").write_text(encode(request), encoding="utf-8")
            state = {"create": "creating", "install": "installing", "rebuild": "rebuilding"}[kind]
            db.execute("INSERT INTO environments(workflow_id,state,version) VALUES(?,?,1) "
                       "ON CONFLICT(workflow_id) DO UPDATE SET state=excluded.state,version=version+1,error=NULL", (workflow_id, state))
            db.execute("INSERT INTO environment_operations(id,workflow_id,kind,state,epoch,command_id,fingerprint,request,directory,created_at,before_info) "
                       "VALUES(?,?,?,'queued',?,?,?,?,?,?,?)",
                       (operation_id, workflow_id, kind, self.engine.epoch, command_id, fingerprint, encode(request), str(directory), time.time(),
                        encode(current) if current else None))
        return self.operation(operation_id)

    def operation(self, operation_id, after=0):
        if after < 0:
            raise ValueError("Invalid log cursor")
        rows = self.store.read("SELECT * FROM environment_operations WHERE id=?", (operation_id,))
        if not rows:
            raise ValueError("环境操作不存在")
        result = rows[0]
        for key in ("request", "before_info", "after_info"):
            result[key] = json.loads(result[key]) if result[key] else None
        path = Path(result.pop("directory")) / "console.log"
        data, cursor = b"", after
        if path.exists():
            with path.open("rb") as file:
                file.seek(after)
                data = file.read(65536)
                cursor = file.tell()
        # Keep complete UTF-8 characters across incremental reads.
        import codecs
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        result["log"] = decoder.decode(data, final=result["state"] not in BUSY and
                                       (not path.exists() or cursor >= path.stat().st_size))
        result["cursor"] = cursor - len(decoder.getstate()[0])
        result["has_more"] = path.exists() and path.stat().st_size > result["cursor"]
        result.pop("fingerprint")
        result.pop("epoch")
        return result

    def recover(self, db):
        for row in db.execute("SELECT id,workflow_id FROM environment_operations WHERE state IN ('queued','running')").fetchall():
            error = "服务停止，环境操作已中断；请人工重试或重建"
            db.execute("UPDATE environment_operations SET state='interrupted',finished_at=?,error=? WHERE id=?", (time.time(), error, row["id"]))
            db.execute("UPDATE environments SET state='needs_repair',version=version+1,error=? WHERE workflow_id=?", (error, row["workflow_id"]))

    def close(self):
        if self.active:
            self.active["child"].close()
            self.active = None
        with self.store.transaction() as db:
            self.recover(db)

    def _finish(self, row, info=None, error=None):
        with self.store.transaction() as db:
            before_path = Path(row["directory"]) / "before.json"
            if before_path.exists():
                try:
                    before = encode(json.loads(before_path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    before = row["before_info"]
                db.execute("UPDATE environment_operations SET before_info=? WHERE id=?", (before, row["id"]))
            if info is not None and error is None:
                request = json.loads(row["request"])
                revision_id = uuid.uuid4().hex
                db.execute("INSERT INTO environment_revisions VALUES(?,?,?,?,?,?,?)",
                           (revision_id, row["workflow_id"], "isolated", request["interpreter"], request["generation"], encode(info), time.time()))
                db.execute("UPDATE environments SET state='ready',version=version+1,current_revision=?,error=NULL WHERE workflow_id=?",
                           (revision_id, row["workflow_id"]))
                db.execute("UPDATE environment_operations SET state='succeeded',finished_at=?,after_info=?,revision_id=? WHERE id=?",
                           (time.time(), encode(info), revision_id, row["id"]))
            else:
                db.execute("UPDATE environments SET state='needs_repair',version=version+1,error=? WHERE workflow_id=?", (error, row["workflow_id"]))
                db.execute("UPDATE environment_operations SET state='failed',finished_at=?,error=?,after_info=? WHERE id=?",
                           (time.time(), error, encode(info) if info else None, row["id"]))

    def tick(self):
        if self.active:
            child, row = self.active["child"], self.active["row"]
            code = child.process.poll()
            if code is None and time.monotonic() < self.active["deadline"]:
                return
            child.close()
            self.active = None
            try:
                result = json.loads((Path(row["directory"]) / "result.json").read_text(encoding="utf-8"))
                error = result.get("error") or (f"环境进程退出：{code}" if code != 0 else None)
                if not result.get("info") and not error:
                    error = "环境进程未返回有效包清单"
                self._finish(row, result.get("info"), error)
            except (OSError, ValueError):
                self._finish(row, error=f"环境进程中断或超时（退出码 {code}），请查看日志后重试")
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM environment_operations WHERE epoch=? AND state='queued' ORDER BY created_at LIMIT 1",
                             (self.engine.epoch,)).fetchone()
            if row is None:
                return
            row = dict(row)
            db.execute("UPDATE environment_operations SET state='running',started_at=? WHERE id=?", (time.time(), row["id"]))
        try:
            directory = Path(row["directory"])
            child = Child([sys.executable, "-B", "-u", "-P", "-X", "utf8", str(Path(__file__).with_name("_bootstrap.py")),
                           "_environment_worker", str(directory / "request.json")],
                          directory, python_environment(sys.executable), directory / "console.log")
            self.active = {"child": child, "row": row, "deadline": time.monotonic() + 1800}
        except Exception as exc:
            self._finish(row, error=str(exc))

    def pending(self):
        return bool(self.store.read("SELECT 1 FROM environment_operations WHERE epoch=? AND state IN ('queued','running') LIMIT 1", (self.engine.epoch,)))
