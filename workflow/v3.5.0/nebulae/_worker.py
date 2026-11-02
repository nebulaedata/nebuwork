"""Internal subprocess entry point; always starts with a fresh interpreter."""

import asyncio
import inspect
import json
import os
from pathlib import Path
import runpy
import signal
import sys
import threading
import traceback

from .context import Context
from .definition import entrypoint
from .store import encode


def watch_parent():
    # A pipe closes even after an ungraceful scheduler crash. No PID-reuse guessing.
    # Raw reads do not hold BufferedReader locks during interpreter shutdown.
    while os.read(sys.stdin.fileno(), 1):
        pass
    if os.name != "nt":
        os.killpg(os.getpgrp(), signal.SIGKILL)
    os._exit(125)


def main():
    request_path = Path(sys.argv[1]).resolve()
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if os.read(sys.stdin.fileno(), 1) != b"G":
        return 125
    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        script, function = entrypoint(request["code_dir"], request["code"])
        sys.path[:0] = [str(script.parent), request["code_dir"]]
        namespace = runpy.run_path(str(script), run_name="__nebulae_step__")
        execute = namespace.get(function)
        if not callable(execute):
            raise TypeError(f"Step function is not callable: {request['code']}")
        value = execute(Context(request))
        if inspect.isawaitable(value):
            async def resolve():
                return await value
            value = asyncio.run(resolve())
        payload = encode({"ok": True})
    except BaseException:
        payload = encode({"ok": False, "error": traceback.format_exc()})
    temporary = request_path.parent / "result.tmp"
    temporary.write_text(payload, encoding="utf-8")
    os.replace(temporary, request_path.parent / "result.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
