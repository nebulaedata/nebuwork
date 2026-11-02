"""Managed venv/pip supervisor. Its whole process tree dies with the scheduler."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import traceback

from ._worker import watch_parent
from .environments import probe, python_environment
from .store import encode


def main():
    if os.read(sys.stdin.fileno(), 1) != b"G":
        return 125
    threading.Thread(target=watch_parent, daemon=True).start()
    path = Path(sys.argv[1])
    request = json.loads(path.read_text(encoding="utf-8"))
    interpreter = request["interpreter"]
    info = None
    def execute(command, cwd=None):
        command = [command[0], "-X", "utf8", *command[1:]]
        subprocess.run(command, cwd=cwd, env=python_environment(interpreter, isolated=True),
                       stdin=subprocess.DEVNULL, check=True)
    try:
        if request["kind"] in {"create", "rebuild"}:
            print("正在创建独立 Python 环境…", flush=True)
            execute([sys.executable, "-I", "-m", "venv", request["target"]])
        else:
            before = probe(interpreter, isolated=True)
            (path.parent / "before.json").write_text(encode(before), encoding="utf-8")
            print("正在安装依赖…", flush=True)
            args = ["-r", "requirements.txt"] if request["requirements"] else request["packages"]
            execute([interpreter, "-I", "-m", "pip", "--disable-pip-version-check", "--no-input", "install", *args], request["source"])
        print("正在校验依赖与步骤运行器…", flush=True)
        execute([interpreter, "-I", "-m", "pip", "--disable-pip-version-check", "check"])
        info = probe(interpreter, isolated=True, sdk=True)
        result = {"info": info, "error": None}
        print("环境已就绪。", flush=True)
    except BaseException:
        error = traceback.format_exc()
        print(error, flush=True)
        try:
            info = probe(interpreter, isolated=True)
        except Exception:
            pass
        result = {"info": info, "error": error}
    temporary = path.parent / "result.tmp"
    temporary.write_text(encode(result), encoding="utf-8")
    os.replace(temporary, path.parent / "result.json")
    return 1 if result["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
