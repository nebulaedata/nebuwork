"""MCP adapter; tool definitions and validation are shared with Pi."""
from functools import wraps
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError as MCPToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from .mcp_guide import GUIDE
from .workflow_tools import local_url, workflow_tools
from .tool_catalog import ToolError


def _mcp_function(function):
    @wraps(function)
    async def call(**arguments):
        try:
            return await function(**arguments)
        except ToolError as exc:
            raise MCPToolError(str(exc)) from exc
    return call


def create_server(base_url="http://127.0.0.1:8765", *, client=None):
    catalog = workflow_tools(base_url, client=client)
    server = MCPServer("Nebulae Workflow", version="1.0.0", log_level="WARNING",
                       instructions="首次使用先调用 workflow_guide；修改携带版本，控制命令使用稳定 command_id。")
    @server.resource("workflow://guide", mime_type="text/markdown", description="Workflow 编写与控制契约")
    def guide_resource() -> str:
        return GUIDE
    for tool in catalog.entries.values():
        server.tool(annotations=ToolAnnotations(**tool["annotations"]))( _mcp_function(tool["function"]))
    return server


def run_server(base_url="http://127.0.0.1:8765", transport="stdio", host="127.0.0.1", port=8766):
    if host not in {"127.0.0.1", "localhost"} or not 1 <= port <= 65535:
        raise ValueError("MCP must listen on localhost with a valid port")
    server = create_server(base_url)
    if transport == "stdio":
        server.run(transport="stdio")
    elif transport == "streamable-http":
        server.run(transport="streamable-http", host=host, port=port, json_response=True, stateless_http=True,
                   transport_security=TransportSecuritySettings(
                       allowed_hosts=[f"127.0.0.1:{port}", f"localhost:{port}"],
                       allowed_origins=[f"http://127.0.0.1:{port}", f"http://localhost:{port}"]))
    else:
        raise ValueError("Transport must be stdio or streamable-http")
