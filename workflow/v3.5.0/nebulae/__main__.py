"""CLI: local server, standalone execution, and thin HTTP management commands."""
import argparse
import json
from pathlib import Path
import sys
from urllib.parse import urlencode

from .client import Client
from .engine import Engine

def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="nebulae")
    parser.add_argument("--project", default=".")
    parser.add_argument("--runtime")
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    sub = parser.add_subparsers(dest="command", required=True)
    agent_install = sub.add_parser("agent-install", help="Install the optional pinned Pi runtime (Node.js 22.19+)")
    agent_install.add_argument("--node-path", default="")
    serve = sub.add_parser("serve", help="Start the local API, UI, and scheduler; old tasks never auto-run")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--remote-access", action="store_true", help="Enable Bearer-protected service access (NEBULAE_SERVICE_API_KEY required)")
    serve.add_argument("--trusted-host", action="append", default=[], help="Allowed service host name or IP; repeat for multiple names")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--workers", type=int, default=4)
    mcp = sub.add_parser("mcp", help="MCP bridge to the running Workflow API; never starts a scheduler")
    mcp.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    mcp.add_argument("--host", choices=["127.0.0.1", "localhost"], default="127.0.0.1")
    mcp.add_argument("--port", type=int, default=8766)
    for name in ("run", "create"):
        command = sub.add_parser(name, help="Standalone new task" if name == "run" else "Create a task via HTTP")
        command.add_argument("workflow")
        group = command.add_mutually_exclusive_group()
        group.add_argument("--input", default="{}")
        group.add_argument("--input-file")
        if name == "run":
            command.add_argument("--workers", type=int, default=4)
        else:
            command.add_argument("--start", action="store_true")
    sub.add_parser("workflows")
    sub.add_parser("tasks")
    sub.add_parser("env-shared", help="Show the service interpreter and installed packages")
    for name in ("env-show", "env-select", "env-packages", "env-create", "env-install", "env-rebuild"):
        command = sub.add_parser(name)
        command.add_argument("workflow")
        if name == "env-select":
            command.add_argument("mode", choices=["shared", "isolated"])
            command.add_argument("--revision", help="Expected workflow source revision")
        if name in {"env-create", "env-install", "env-rebuild"}:
            command.add_argument("--version", type=int, help="Expected environment state version")
            command.add_argument("--command-id", help="Reuse the same ID to safely retry a request")
        if name == "env-install":
            group = command.add_mutually_exclusive_group(required=True)
            group.add_argument("--package", action="append", help="Package specification or wheel path; repeat for multiple packages")
            group.add_argument("--requirements", action="store_true", help="Use the workflow's saved requirements.txt")
    operation = sub.add_parser("env-operation")
    operation.add_argument("operation_id")
    operation.add_argument("--after", type=int, default=0)
    create_flow = sub.add_parser("workflow-create")
    create_flow.add_argument("workflow")
    create_flow.add_argument("--name")
    create_flow.add_argument("--copy-from")
    for name in ("workflow", "validate", "archive", "files", "source", "save-source", "revisions", "restore-source", "artifacts"):
        command = sub.add_parser(name)
        command.add_argument("workflow")
        if name == "archive":
            command.add_argument("--undo", action="store_true")
        if name in {"source", "save-source", "revisions", "restore-source"}:
            command.add_argument("path")
        if name == "save-source":
            command.add_argument("--file", required=True, help="Local UTF-8 source file")
            command.add_argument("--revision", required=True, help="Expected SHA256, or new for a new file")
        if name == "restore-source":
            command.add_argument("--revision-id", required=True, type=int)
            command.add_argument("--revision", required=True)
    logs = sub.add_parser("logs")
    logs.add_argument("task")
    logs.add_argument("step")
    logs.add_argument("attempt", type=int)
    for name in ("status", "start", "pause", "resume", "cancel", "rerun", "preview", "events"):
        command = sub.add_parser(name)
        command.add_argument("task")
        if name in ("rerun", "preview"):
            command.add_argument("--from-step", action="append")
        if name == "events":
            command.add_argument("--after", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        if args.command == "agent-install":
            from .agent_runtime import install
            runtime = Path(args.runtime).resolve() if args.runtime else Path(args.project).resolve() / ".runtime" / "v1"
            print(json.dumps(install(runtime, args.node_path), ensure_ascii=False, indent=2))
            return 0
        if args.command == "mcp":
            try:
                from .mcp_server import run_server
            except ImportError as exc:
                raise RuntimeError('MCP dependencies are missing. Run: uv sync --extra server --extra mcp') from exc
            run_server(args.url, args.transport, args.host, args.port)
            return 0
        if args.command == "serve":
            import uvicorn
            from .api import create_app
            if args.workers < 1:
                raise ValueError("workers must be positive")
            if args.host not in {"127.0.0.1", "localhost", "::1"} and not args.remote_access:
                raise ValueError("A non-loopback listener requires --remote-access and --trusted-host")
            # An open SSE stream must not keep shutdown waiting indefinitely.
            uvicorn.run(create_app(args.project, args.runtime, args.workers,
                                   remote_access=args.remote_access, trusted_hosts=args.trusted_host),
                        host=args.host, port=args.port, proxy_headers=False, timeout_graceful_shutdown=5)
            return 0
        client = Client(args.url)
        if args.command == "env-shared":
            result = client.request("/environment/shared")
        elif args.command == "env-show":
            result = client.environment(args.workflow)
        elif args.command == "env-select":
            result = client.select_environment(args.workflow, args.mode, args.revision)
        elif args.command == "env-packages":
            result = client.request(f"/workflows/{args.workflow}/environment/packages")
        elif args.command == "env-operation":
            result = client.operation(args.operation_id, args.after)
        elif args.command in {"env-create", "env-install", "env-rebuild"}:
            result = client.environment_operation(args.workflow, args.command.removeprefix("env-"),
                                                 getattr(args, "package", None), getattr(args, "requirements", False),
                                                 args.version, args.command_id)
        elif args.command in {"run", "create"}:
            payload = json.loads(Path(args.input_file).read_text(encoding="utf-8-sig") if args.input_file else args.input)
            if args.command == "run":
                with Engine(args.project, args.runtime) as engine:
                    task = engine.create_task(args.workflow, payload)
                    engine.control(task, "start")
                    print(json.dumps({"task_id": task}), flush=True)
                    engine.drain(args.workers, timeout=86400)
                    result = engine.status(task)
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 0 if result["state"] == "succeeded" else 1
            result = client.create_task(args.workflow, payload)
            if args.start:
                result = client.control(result["id"], "start")
        elif args.command in {"workflows", "tasks"}:
            result = client.request("/" + args.command)
        elif args.command == "workflow-create":
            result = client.request("/workflows", "POST", {"id": args.workflow, "name": args.name, "copy_from": args.copy_from})
        elif args.command in {"workflow", "files"}:
            result = client.request(f"/workflows/{args.workflow}")
            if args.command == "files":
                result = result["files"]
        elif args.command == "validate":
            result = client.request(f"/workflows/{args.workflow}/validate", "POST")
        elif args.command == "archive":
            result = client.request(f"/workflows/{args.workflow}/archive", "POST", {"archived": not args.undo})
        elif args.command == "artifacts":
            result = client.request(f"/workflows/{args.workflow}/artifacts")
        elif args.command in {"source", "save-source", "revisions", "restore-source"}:
            endpoint = {"save-source": "source", "restore-source": "restore"}.get(args.command, args.command)
            path = f"/workflows/{args.workflow}/{endpoint}?" + urlencode({"path": args.path})
            if args.command == "save-source":
                result = client.request(path, "PUT", {"content": Path(args.file).read_text(encoding="utf-8-sig"),
                                                      "expected_revision": None if args.revision == "new" else args.revision})
            elif args.command == "restore-source":
                result = client.request(path, "POST", {"revision_id": args.revision_id, "expected_revision": args.revision})
            else:
                result = client.request(path)
        elif args.command == "logs":
            result = client.request(f"/tasks/{args.task}/logs?" + urlencode({"step": args.step, "attempt": args.attempt}))
        elif args.command == "status":
            result = client.status(args.task)
        elif args.command == "events":
            result = client.request(f"/tasks/{args.task}/events?" + urlencode({"after": args.after}))
        elif args.command == "preview":
            result = client.request(f"/tasks/{args.task}/preview", "POST", {"from_steps": args.from_step})
        else:
            result = client.control(args.task, args.command, getattr(args, "from_step", None))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        return 130
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
