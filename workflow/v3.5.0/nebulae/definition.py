"""Validate a small DAG definition and freeze the code used by each attempt."""

import ast
import hashlib
import json
import math
from pathlib import Path
import re

from .input_presets import validate_input_presets


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", value):
        raise ValueError(f"Invalid identifier: {value!r}; use letters, digits, _ or -")
    return value


def contained(root, relative):
    root = Path(root).resolve()
    if not isinstance(relative, (str, Path)) or Path(relative).is_absolute() or ':' in str(relative):
        raise ValueError(f"A relative path is required: {relative}")
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f"Path must stay inside {root}: {relative}")
    return path


def entrypoint(root, code):
    if not isinstance(code, str) or ":" not in code:
        raise ValueError("Step code must be relative/file.py:function")
    filename, function = code.rsplit(":", 1)
    path = contained(root, filename)
    if path.suffix != ".py" or not path.is_file() or not function.isidentifier():
        raise ValueError(f"Invalid step entry point: {code}")
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == function]
    if not functions:
        raise ValueError(f"Entry function must be defined at module scope: {code}")
    args = functions[0].args
    if len(args.posonlyargs + args.args) != 1 or args.vararg or args.kwarg or args.kwonlyargs:
        raise ValueError(f"Step signature must be {function}(ctx): {code}")
    return path, function


def environment_mode(raw):
    if not isinstance(raw, dict):
        raise ValueError("Workflow must be an object")
    settings = raw.get("environment", {"mode": "shared"})
    if (not isinstance(settings, dict) or set(settings) != {"mode"}
            or not isinstance(settings["mode"], str) or settings["mode"] not in {"shared", "isolated"}):
        raise ValueError("environment must contain mode: shared or isolated")
    return settings["mode"]


def validate(raw, root):
    if not isinstance(raw, dict) or set(raw) - {"name", "steps", "layout", "environment", "input_presets"}:
        raise ValueError("Workflow supports only name, steps, layout, environment and input_presets")
    mode = environment_mode(raw)
    if "name" in raw and (not isinstance(raw["name"], str) or not raw["name"].strip()):
        raise ValueError("Workflow name must be a non-empty string")
    steps = raw.get("steps")
    if not isinstance(steps, dict) or not steps:
        raise ValueError("Workflow steps must be a non-empty object")
    normalized = {}
    for name, spec in steps.items():
        identifier(name)
        if not isinstance(spec, dict) or set(spec) - {"code", "needs", "retries", "retry_delay", "timeout"}:
            raise ValueError(f"Invalid step settings: {name}")
        entrypoint(root, spec.get("code"))
        needs = spec.get("needs", [])
        if not isinstance(needs, list) or any(not isinstance(n, str) for n in needs):
            raise ValueError(f"needs must be a list of step names: {name}")
        if len(needs) != len(set(needs)) or any(n not in steps or n == name for n in needs):
            raise ValueError(f"Unknown, duplicate, or self dependency: {name}")
        retries = spec.get("retries", 0)
        if type(retries) is not int or retries < 0:
            raise ValueError(f"retries must be a non-negative integer: {name}")
        delay, timeout = spec.get("retry_delay", 1), spec.get("timeout")
        for value in (delay,) + (() if timeout is None else (timeout,)):
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise ValueError(f"Invalid retry_delay or timeout: {name}")
        if timeout == 0:
            raise ValueError(f"timeout must be positive: {name}")
        normalized[name] = dict(code=spec["code"], needs=needs, retries=retries,
                                retry_delay=delay, timeout=timeout)
    seen = set()
    while len(seen) < len(steps):
        ready = {n for n, s in normalized.items() if n not in seen and set(s["needs"]) <= seen}
        if not ready:
            raise ValueError("Workflow contains a dependency cycle")
        seen.update(ready)
    layout = raw.get("layout", {})
    if not isinstance(layout, dict):
        raise ValueError("layout must be an object")
    for position in layout.values():
        if not isinstance(position, dict) or any(type(position.get(k)) not in (int, float) or not math.isfinite(position[k]) for k in ('x','y')):
            raise ValueError("Invalid node position")
    result = {"name": raw.get("name", Path(root).name), "steps": normalized, "layout": layout,
              "environment": {"mode": mode}}
    if "input_presets" in raw:
        result["input_presets"] = validate_input_presets(raw["input_presets"])
    return result


def load(root):
    return validate(json.loads((Path(root) / "workflow.json").read_text(encoding="utf-8-sig")), root)


def descendants(steps, selected):
    result = set(selected)
    while True:
        added = {n for n, s in steps.items() if set(s["needs"]) & result} - result
        if not added:
            return result
        result.update(added)


def snapshot(source, destination):
    """Copy a workflow's local sources/resources, excluding Python bytecode."""
    source, destination = Path(source).resolve(), Path(destination)
    # Keep snapshots self-contained. Symlinks could escape or change during execution.
    ignored = {"__pycache__", ".git", ".venv", "venv", ".runtime"}
    manifest = hashlib.sha256()
    def copy_dir(current, relative):
        for item in sorted(current.iterdir()):
            if item.name in ignored or item.suffix in {".pyc", ".pyo"}:
                continue
            if item.is_symlink() or item.is_junction():
                raise ValueError(f"Workflow sources must not contain symlinks: {item}")
            rel = relative / item.name
            target = destination / rel
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                copy_dir(item, rel)
            elif item.is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                data = item.read_bytes()
                target.write_bytes(data)
                manifest.update(rel.as_posix().encode())
                manifest.update(b"\0")
                manifest.update(hashlib.sha256(data).digest())
    destination.mkdir(parents=True, exist_ok=False)
    copy_dir(source, Path())
    return manifest.hexdigest()
