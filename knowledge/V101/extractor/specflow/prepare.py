"""Small shared helpers for the runner (no PyMuPDF/OCR dependency)."""
from pathlib import Path
import hashlib
import json


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
