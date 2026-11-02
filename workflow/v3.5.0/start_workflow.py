"""Start the relocated code with its existing runtime, or an explicit isolated project."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent


def read_environment(path, environ):
    result = dict(environ)
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, separator, value = line.partition("=")
            name = name.strip()
            if not separator or not name.startswith("NEBULAE_"):
                raise ValueError("The local config must contain NEBULAE_NAME=value lines")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            result.setdefault(name, value)
    return result


def resolve_settings(root, environ, *, isolated=False, port=None):
    root = Path(root).resolve()
    env = dict(environ) if isolated else read_environment(root / ".env", environ)
    if isolated:
        env.pop("NEBULAE_AGENT_RUNTIME", None)
        temporary = root / ".qa"
        temporary.mkdir(exist_ok=True)
        project = Path(tempfile.mkdtemp(prefix="isolated-", dir=temporary))
        shutil.copytree(root / "workflows" / "demo", project / "workflows" / "demo",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        runtime = project / ".runtime" / "v1"
        host, remote, trusted = "127.0.0.1", False, []
    else:
        project = root
        configured = env.get("NEBULAE_RUNTIME_DIR", "").strip()
        if not configured:
            raise ValueError("Configure NEBULAE_RUNTIME_DIR in .env, or explicitly use --isolated")
        runtime = Path(configured).expanduser()
        runtime = (root / runtime).resolve() if not runtime.is_absolute() else runtime.resolve()
        if not (runtime / "state.sqlite3").is_file():
            raise ValueError("The configured existing SQLite database is missing; no new database was created")
        host = env.get("NEBULAE_HOST", "127.0.0.1")
        remote = env.get("NEBULAE_REMOTE_ACCESS", "false").lower() == "true"
        trusted = [item.strip() for item in env.get("NEBULAE_TRUSTED_HOSTS", "").split(",") if item.strip()]
    selected_port = int(port if port is not None else env.get("NEBULAE_PORT", "8765"))
    workers = int(env.get("NEBULAE_WORKERS", "4"))
    if not 1 <= selected_port <= 65535 or workers < 1:
        raise ValueError("Invalid service port or worker count")
    return dict(project=project, runtime=runtime, host=host, port=selected_port,
                workers=workers, remote_access=remote, trusted_hosts=trusted, env=env)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--isolated", action="store_true", help="Use a fresh local demo project, not the existing runtime")
    parser.add_argument("--port", type=int)
    parser.add_argument("--check", action="store_true", help="Validate and display paths without opening the database")
    args = parser.parse_args(argv)
    settings = resolve_settings(ROOT, os.environ, isolated=args.isolated, port=args.port)
    summary = {name: str(settings[name]) if isinstance(settings[name], Path) else settings[name]
               for name in ("project", "runtime", "host", "port", "workers", "remote_access", "trusted_hosts")}
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if args.check:
        return 0
    os.environ.update(settings["env"])
    if args.isolated:
        os.environ.pop("NEBULAE_AGENT_RUNTIME", None)
    from nebulae.__main__ import main as serve
    arguments = ["--project", str(settings["project"]), "--runtime", str(settings["runtime"]),
                 "serve", "--host", settings["host"], "--port", str(settings["port"]),
                 "--workers", str(settings["workers"])]
    if settings["remote_access"]:
        arguments.append("--remote-access")
    for host in settings["trusted_hosts"]:
        arguments.extend(["--trusted-host", host])
    return serve(arguments)


if __name__ == "__main__":
    raise SystemExit(main())
