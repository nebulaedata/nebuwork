"""Read-only connection information for the management page; no scheduler ownership."""
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

from .mcp_guide import GUIDE


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


async def connection_info(api_url):
    tools, error, version = [], None, None
    try:
        version = importlib.metadata.version("mcp")
        from .mcp_server import create_server
        registered = await create_server().list_tools()
        tools = [{"name": tool.name, "description": tool.description,
                  "input_schema": tool.input_schema,
                  "read_only": bool(tool.annotations and tool.annotations.read_only_hint)} for tool in registered]
    except (ImportError, importlib.metadata.PackageNotFoundError) as exc:
        error = f"MCP 依赖不可用：{exc}"
    return {"installed": not error, "sdk_version": version, "dependency_error": error,
            "python": sys.executable, "working_directory": str(Path(__file__).resolve().parent.parent),
            "platform": "windows" if os.name == "nt" else "posix", "api_url": api_url,
            "default_port": 8766, "tools": tools, "guide": GUIDE}


def check_connection(port):
    """Only initialize the known local MCP endpoint. Never invoke tools or start processes."""
    url = f"http://127.0.0.1:{port}/mcp"
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    payload = {"jsonrpc": "2.0", "id": "ui-check", "method": "initialize", "params": {
        "protocolVersion": "2025-11-25", "capabilities": {},
        "clientInfo": {"name": "nebulae-management-page", "version": "1.0.0"}}}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    session_id = None
    protocol = "2025-11-25"
    try:
        request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        with opener.open(request, timeout=3) as response:
            session_id = response.headers.get("Mcp-Session-Id")
            data = json.loads(response.read(128 * 1024))
        if not isinstance(data, dict) or data.get("id") != "ui-check" or not isinstance(data.get("result"), dict):
            raise ValueError("该地址没有返回有效的 MCP 初始化响应")
        result = data["result"]
        protocol = result.get("protocolVersion", protocol)
        server = result.get("serverInfo", {})
        if not isinstance(protocol, str) or not isinstance(server, dict) or server.get("name") != "Nebulae Workflow":
            raise ValueError("该端口不是 Nebulae Workflow MCP 服务")
        return {"connected": True, "url": url, "server": server, "protocol_version": protocol, "error": None}
    except (OSError, ValueError, TypeError) as exc:
        return {"connected": False, "url": url, "server": None, "protocol_version": None,
                "error": f"连接未成功：{exc}。请启动 MCP 服务，再检测连接。"}
    finally:
        # The supplied bridge is stateless; also release a session if an older stateful bridge answered.
        if session_id:
            try:
                request = urllib.request.Request(url, method="DELETE", headers={
                    "Mcp-Session-Id": session_id, "MCP-Protocol-Version": protocol})
                with opener.open(request, timeout=2):
                    pass
            except OSError:
                pass
