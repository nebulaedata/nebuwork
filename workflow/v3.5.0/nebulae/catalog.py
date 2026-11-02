"""Workflow/source management shared by the UI and Python API."""
import ast
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

from . import definition
from .store import Conflict


def digest(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Catalog:
    def __init__(self, root, store):
        self.root, self.store = Path(root), store
        self.root.mkdir(parents=True, exist_ok=True)

    def directory(self, workflow_id):
        return definition.contained(self.root, definition.identifier(workflow_id))

    def file_path(self, workflow_id, path):
        root = self.directory(workflow_id)
        resolved = definition.contained(root, path)
        if resolved.suffix not in {".py", ".json", ".txt", ".md", ".toml", ".yaml", ".yml"}:
            raise ValueError("Only workflow source and text resources can be edited")
        relative = resolved.relative_to(root)
        if any(part.startswith(".") or part == "__pycache__" for part in relative.parts):
            raise ValueError("Hidden/runtime files cannot be edited")
        current = root
        for part in Path(str(path).replace("\\", "/")).parts:
            current = current / part
            if current.is_symlink() or current.is_junction():
                raise ValueError("Symlinks cannot be edited")
        return resolved

    def is_archived(self, workflow_id):
        rows = self.store.read("SELECT archived FROM workflows WHERE id=?", (workflow_id,))
        return bool(rows and rows[0]["archived"])

    def list(self):
        result = []
        for file in sorted(self.root.glob("*/workflow.json")):
            if file.parent.name.startswith("."):
                continue
            try:
                item = self.get(file.parent.name)
                item.pop("definition", None)
                item.pop("files", None)
            except (OSError, ValueError, SyntaxError) as exc:
                item = {"id": file.parent.name, "name": file.parent.name, "error": str(exc),
                        "archived": self.is_archived(file.parent.name)}
            result.append(item)
        return result

    def get(self, workflow_id):
        source = self.read(workflow_id, "workflow.json")
        error = None
        try:
            raw = json.loads(source["content"])
            definition.validate(raw, self.directory(workflow_id))
        except (ValueError, SyntaxError, OSError) as exc:
            error = str(exc)
            # Keep the source editor accessible even when a local edit broke JSON.
            raw = {"name": workflow_id, "steps": {}}
        files = [p.relative_to(self.directory(workflow_id)).as_posix()
                 for p in sorted(self.directory(workflow_id).rglob("*"))
                 if p.is_file() and p.suffix in {".py", ".json", ".txt", ".md", ".toml", ".yaml", ".yml"}
                 and not any(part.startswith(".") or part == "__pycache__" for part in p.relative_to(self.directory(workflow_id)).parts)]
        return {"id": workflow_id, "name": raw.get("name", workflow_id), "definition": raw,
                "revision": source["revision"], "files": files, "error": error,
                "archived": self.is_archived(workflow_id)}

    def create(self, workflow_id, name=None, copy_from=None):
        target = self.directory(workflow_id)
        if target.exists():
            raise Conflict("Workflow already exists")
        temporary = self.root / (".create-" + uuid.uuid4().hex)
        if copy_from:
            definition.snapshot(self.directory(copy_from), temporary)
            raw = json.loads((temporary / "workflow.json").read_text(encoding="utf-8-sig"))
            raw["name"] = name or workflow_id
        else:
            temporary.mkdir()
            atomic_write(temporary / "main.py", 'def run(ctx):\n    ctx.task.save_json("result", ctx.input)\n')
            raw = {"name": name or workflow_id, "steps": {"main": {"code": "main.py:run", "needs": []}},
                   "layout": {"main": {"x": 100, "y": 100}}}
        atomic_write(temporary / "workflow.json", json.dumps(raw, ensure_ascii=False, indent=2))
        definition.load(temporary)
        # Rename only the newly created sibling directory, never user-owned sources.
        if not temporary.resolve().is_relative_to(self.root.resolve()) or not target.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("Workflow directory escaped the source root")
        temporary.rename(target)
        with self.store.transaction() as db:
            db.execute("INSERT INTO workflows(id) VALUES(?)", (workflow_id,))
            for file in target.rglob("*"):
                if file.is_file() and file.suffix in {".py", ".json", ".txt", ".md"}:
                    content = file.read_text(encoding="utf-8")
                    self._revision(db, workflow_id, file.relative_to(target).as_posix(), content)
        return self.get(workflow_id)

    def archive(self, workflow_id, archived=True):
        self.get(workflow_id)
        with self.store.transaction() as db:
            db.execute("INSERT INTO workflows(id,archived) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET archived=excluded.archived",
                       (workflow_id, int(archived)))
        return self.get(workflow_id)

    def read(self, workflow_id, path):
        file = self.file_path(workflow_id, path)
        content = file.read_text(encoding="utf-8-sig")
        return {"path": file.relative_to(self.directory(workflow_id)).as_posix(), "content": content, "revision": digest(content)}

    def _revision(self, db, workflow_id, path, content):
        previous = db.execute("SELECT digest FROM revisions WHERE workflow_id=? AND path=? ORDER BY id DESC LIMIT 1",
                              (workflow_id, path)).fetchone()
        if not previous or previous[0] != digest(content):
            db.execute("INSERT INTO revisions(workflow_id,path,digest,content,created_at) VALUES(?,?,?,?,?)",
                       (workflow_id, path, digest(content), content, time.time()))

    def save(self, workflow_id, path, content, expected_revision):
        # Match text reads and prevent CRLF-only duplicate history on Windows.
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        file = self.file_path(workflow_id, path)
        path = file.relative_to(self.directory(workflow_id)).as_posix()
        if not self.directory(workflow_id).is_dir():
            raise ValueError("Workflow does not exist")
        if file.suffix == ".py":
            ast.parse(content, filename=path)
        elif file.suffix == ".json":
            raw = json.loads(content)
            if path == "workflow.json":
                definition.validate(raw, self.directory(workflow_id))
        with self.store.transaction() as db:
            previous = file.read_text(encoding="utf-8-sig") if file.exists() else None
            actual = digest(previous) if previous is not None else None
            if actual != expected_revision:
                raise Conflict("File changed outside this editor. Reload before saving.")
            if previous is not None:
                self._revision(db, workflow_id, path, previous)
            atomic_write(file, content)
            self._revision(db, workflow_id, path, content)
        return self.read(workflow_id, path)

    def revisions(self, workflow_id, path):
        path = self.file_path(workflow_id, path).relative_to(self.directory(workflow_id)).as_posix()
        return self.store.read("SELECT * FROM revisions WHERE workflow_id=? AND path=? ORDER BY id DESC", (workflow_id, path))

    def restore(self, workflow_id, path, revision_id, expected_revision):
        revisions = self.revisions(workflow_id, path)
        found = next((row for row in revisions if row["id"] == revision_id), None)
        if not found:
            raise ValueError("Revision does not belong to this file")
        return self.save(workflow_id, path, found["content"], expected_revision)
