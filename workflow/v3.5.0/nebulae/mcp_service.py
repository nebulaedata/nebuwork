"""Lifecycle of the single HTTP MCP bridge owned by this API process."""
import json
from pathlib import Path
import re
import sys
import threading
import time
from urllib.parse import urlsplit
import uuid

from .catalog import atomic_write
from .environments import python_environment
from .process import Child
from .store import Conflict, encode


class MCPService:
    def __init__(self, engine):
        self.engine = engine
        self.root = engine.runtime / "mcp"
        self.file = self.root / "settings.json"
        self.lock = threading.RLock()
        self.child = None
        self.server_pid = None
        self.thread = None
        self.closed = True
        self.stop_event = threading.Event()
        self.config_error = None
        self.data = {"port": 8766, "version": 0, "state": "stopped", "error": None,
                     "generation": None, "started_at": None, "api_url": None, "commands": {}}
        try:
            if self.file.exists():
                value = json.loads(self.file.read_text(encoding="utf-8"))
                if (type(value.get("port")) is not int or not 1 <= value["port"] <= 65535
                        or type(value.get("version")) is not int or value["version"] < 0
                        or not isinstance(value.get("commands"), dict)
                        or value.get("state") not in {"stopped", "starting", "running", "failed"}
                        or (value.get("generation") is not None and not re.fullmatch(r"[a-f0-9]{32}", value["generation"]))):
                    raise ValueError("Invalid MCP configuration")
                self.data.update(value)
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            self.config_error = f"MCP 配置无法读取，请重新保存配置：{exc}"
        # A persisted state is never evidence that a process is still ours/alive.
        self.recovering = self.data["state"] in {"starting", "running"}
        if self.recovering:
            self.data.update(state="stopped", error=None, started_at=None)

    def open(self):
        with self.lock:
            self.closed = False
            if self.recovering and self.engine.epoch:
                self._save()
                self.recovering = False
            self.stop_event.clear()
            self.thread = threading.Thread(target=self._monitor, name="mcp-supervisor", daemon=True)
            self.thread.start()

    def _save(self, **changes):
        updated = {**self.data, **changes, "version": self.data["version"] + 1}
        atomic_write(self.file, encode(updated))
        self.data = updated

    def _authorize(self, expected_version, command_id, fingerprint):
        if self.closed or not self.engine.epoch:
            raise Conflict("Workflow 执行核心尚未启动或已关闭，不能控制 MCP")
        if not isinstance(command_id, str) or not command_id.strip() or len(command_id) > 100:
            raise ValueError("command_id must contain 1–100 characters")
        previous = self.data["commands"].get(command_id)
        if previous is not None:
            if previous != fingerprint:
                raise Conflict("命令 ID 已用于另一个 MCP 操作")
            return False
        if type(expected_version) is not int or expected_version != self.data["version"]:
            raise Conflict("MCP 状态已变化，请刷新后重试")
        return True

    def _record(self, command_id, fingerprint, **changes):
        self._save(commands={**self.data["commands"], command_id: fingerprint}, **changes)

    def configure(self, port, expected_version, command_id):
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("MCP 端口必须是 1–65535 之间的整数")
        with self.lock:
            fingerprint = encode(["configure", port, expected_version])
            if not self._authorize(expected_version, command_id, fingerprint):
                return self._status()
            if self.child is not None:
                raise Conflict("请先停止 MCP，再修改端口")
            self._record(command_id, fingerprint, port=port, state="stopped", error=None)
            self.config_error = None
            return self._status()

    def start(self, api_url, expected_version, command_id):
        with self.lock:
            fingerprint = encode(["start", api_url, expected_version])
            if not self._authorize(expected_version, command_id, fingerprint):
                return self._status()
            if self.config_error:
                raise Conflict(self.config_error)
            try:
                from .mcp_server import local_url
                api_url = local_url(api_url)
            except ImportError as exc:
                raise Conflict("MCP 依赖不可用，请先安装项目的 mcp 可选依赖") from exc
            if (urlsplit(api_url).port or 80) == self.data["port"]:
                raise Conflict("MCP 端口不能与 Workflow 服务端口相同")
            if self.child is not None:
                # A second click with a fresh ID also cannot create another bridge.
                self._record(command_id, fingerprint)
                return self._status()
            generation = uuid.uuid4().hex
            directory = self.root / "runs" / generation
            request = directory / "request.json"
            atomic_write(request, encode({"port": self.data["port"], "api_url": api_url, "generation": generation}))
            self._record(command_id, fingerprint, state="starting", generation=generation, api_url=api_url,
                         started_at=time.time(), error=None)
            try:
                self.child = Child([sys.executable, "-I", "-X", "utf8",
                                    str(Path(__file__).with_name("_bootstrap.py")), "_mcp_http_worker", str(request)],
                                   cwd=Path(__file__).parent, env=python_environment(sys.executable),
                                   logfile=directory / "console.log")
            except Exception as exc:
                self._save(state="failed", error=f"MCP 进程无法启动：{exc}", started_at=None)
            return self._status()

    def stop(self, expected_version, command_id):
        with self.lock:
            fingerprint = encode(["stop", expected_version])
            if not self._authorize(expected_version, command_id, fingerprint):
                return self._status()
            self._terminate()
            self._record(command_id, fingerprint, state="stopped", error=None, started_at=None)
            return self._status()

    def _terminate(self):
        if self.child is not None:
            self.child.close()
            self.child = None
        self.server_pid = None

    def _monitor(self):
        while not self.stop_event.wait(.2):
            with self.lock:
                if self.closed or self.child is None:
                    continue
                try:
                    code = self.child.process.poll()
                    error = None
                    if not self.engine.epoch:
                        error = "Workflow 执行核心已停止，MCP 已关闭"
                    elif code is not None:
                        error = f"MCP 进程已退出（退出码 {code}），请查看启动日志后重试"
                    elif self.data["state"] == "starting":
                        ready = self.root / "runs" / self.data["generation"] / "ready.json"
                        if ready.exists():
                            report = json.loads(ready.read_text(encoding="utf-8"))
                            if (report.get("generation") != self.data["generation"]
                                    or report.get("port") != self.data["port"]
                                    or type(report.get("pid")) is not int or report["pid"] <= 0):
                                raise ValueError("MCP 启动报告不匹配")
                            # Windows venv launchers can have a different PID from Python.
                            # The generation's private ready file proves the successful bind;
                            # ownership/termination always uses Child's job, never this PID.
                            self.server_pid = report["pid"]
                            self._save(state="running")
                        elif time.time() - self.data["started_at"] > 20:
                            error = "MCP 启动超时，进程已停止，请查看启动日志后重试"
                    if error:
                        self._terminate()
                        self._save(state="failed", error=error, started_at=None)
                except Exception as exc:
                    self._terminate()
                    self.data.update(state="failed", error=f"MCP 监控失败：{exc}", started_at=None)
                    try:
                        self._save()
                    except OSError:
                        pass

    def _status(self):
        log = ""
        truncated = False
        if self.data["generation"]:
            path = self.root / "runs" / self.data["generation"] / "console.log"
            if path.exists():
                with path.open("rb") as file:
                    size = path.stat().st_size
                    truncated = size > 16384
                    file.seek(max(0, size - 16384))
                    log = file.read().decode("utf-8", errors="replace")
        return {key: value for key, value in self.data.items() if key != "commands"} | {
            "pid": (self.server_pid or self.child.process.pid) if self.child and self.child.process.poll() is None else None,
            "config_error": self.config_error, "url": f"http://127.0.0.1:{self.data['port']}/mcp",
            "log": log, "log_truncated": truncated}

    def status(self):
        with self.lock:
            return self._status()

    def close(self):
        self.stop_event.set()
        try:
            with self.lock:
                self.closed = True
                if self.child:
                    self._terminate()
                    self.data.update(state="stopped", error=None, started_at=None)
                    self._save()
        finally:
            if self.thread:
                self.thread.join(timeout=5)
                self.thread = None
