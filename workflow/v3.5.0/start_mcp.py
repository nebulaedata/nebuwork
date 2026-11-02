"""PyCharm: run this file for HTTP MCP. Agent subprocess: pass --transport stdio."""
import sys
import os
from pathlib import Path
from nebulae.__main__ import main
from start_workflow import read_environment

# The existing Workflow service must already be running (e.g. in another PyCharm configuration).
WORKFLOW_URL = "http://127.0.0.1:8765"

if __name__ == "__main__":
    os.environ.update(read_environment(Path(__file__).resolve().parent / ".env", os.environ))
    workflow_url = os.environ.get("NEBULAE_WORKFLOW_URL", WORKFLOW_URL)
    raise SystemExit(main(["--url", workflow_url, "mcp"] +
                          (sys.argv[1:] or ["--transport", "streamable-http"])))
