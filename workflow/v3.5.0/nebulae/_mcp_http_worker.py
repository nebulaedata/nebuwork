"""HTTP MCP subprocess controlled by the API's job/pipe lifetime."""
import asyncio
import json
import os
from pathlib import Path
import sys
import threading

from ._worker import watch_parent
from .catalog import atomic_write


async def serve(request_path):
    # Install the parent watcher before importing optional server dependencies.
    import uvicorn
    from mcp.server.transport_security import TransportSecuritySettings
    from .mcp_server import create_server

    request = json.loads(request_path.read_text(encoding="utf-8"))
    port = request["port"]
    app = create_server(request["api_url"]).streamable_http_app(
        stateless_http=True, json_response=True,
        transport_security=TransportSecuritySettings(
            allowed_hosts=[f"127.0.0.1:{port}", f"localhost:{port}"],
            allowed_origins=[f"http://127.0.0.1:{port}", f"http://localhost:{port}"]))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port,
                                          log_level="info", timeout_graceful_shutdown=2))
    task = asyncio.create_task(server.serve())
    while not server.started:
        if task.done():
            await task
            raise RuntimeError("MCP 未成功监听端口")
        await asyncio.sleep(.05)
    # Only this worker's successful bind can mark the parent's state as running.
    atomic_write(request_path.parent / "ready.json", json.dumps(
        {"pid": os.getpid(), "port": port, "generation": request["generation"]}))
    await task


def main():
    if os.read(sys.stdin.fileno(), 1) != b"G":
        return 125
    threading.Thread(target=watch_parent, daemon=True).start()
    asyncio.run(serve(Path(sys.argv[1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
