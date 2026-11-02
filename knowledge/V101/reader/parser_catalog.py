"""The UI, Go API and reader share the same file-type catalog."""
import json
from pathlib import Path

catalog_path = Path(__file__).with_name('parser_catalog.json')
if not catalog_path.exists():
    catalog_path = Path(__file__).resolve().parents[1] / 'internal/defaults/parser_catalog.json'
FORMATS = json.loads(catalog_path.read_text(encoding='utf-8'))


def resolve(extension, selections):
    extension = extension.lower().lstrip('.')
    for item in FORMATS:
        if extension in item['extensions']:
            key = item['key']
            engine = selections.get(key)
            if not engine and key in ('audio', 'video'):
                engine = selections.get('media')
            if not engine and key == 'txt':
                engine = selections.get('text')
            engine = engine or item['default']
            if engine not in item['choices']:
                raise ValueError('UNSUPPORTED_PARSER_ENGINE')
            return key, engine
    raise ValueError('UNSUPPORTED_FORMAT')
