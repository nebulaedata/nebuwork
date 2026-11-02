"""Optional, versioned run examples and their JSON Pointer field documentation."""

import copy
import math
import re


def _json_value(value):
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float and math.isfinite(value):
        return
    if isinstance(value, list):
        for item in value:
            _json_value(item)
        return
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        for item in value.values():
            _json_value(item)
        return
    raise ValueError("场景输入必须是有效 JSON，数字必须有限")


def _pointer_exists(value, pointer):
    if not isinstance(pointer, str) or (pointer and not pointer.startswith('/')) or re.search(r'~(?![01])', pointer):
        return False
    if not pointer:
        return True
    for part in pointer[1:].split('/'):
        token = part.replace('~1', '/').replace('~0', '~')
        if isinstance(value, dict) and token in value:
            value = value[token]
        elif isinstance(value, list) and re.fullmatch(r'0|[1-9][0-9]*', token) and int(token) < len(value):
            value = value[int(token)]
        else:
            return False
    return True


def validate_input_presets(presets):
    if not isinstance(presets, list):
        raise ValueError("input_presets 必须是场景数组")
    ids = set()
    for index, preset in enumerate(presets):
        label = f"运行场景 {index + 1}"
        if not isinstance(preset, dict) or set(preset) != {'id', 'name', 'description', 'input', 'fields'}:
            raise ValueError(f"{label} 必须包含 id、name、description、input 和 fields")
        ident = preset['id']
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}', ident) or ident in ids:
            raise ValueError(f"{label} 的 id 无效或重复")
        ids.add(ident)
        if not isinstance(preset['name'], str) or not preset['name'].strip():
            raise ValueError(f"{label} 必须填写名称")
        if not isinstance(preset['description'], str):
            raise ValueError(f"{label} 的用途说明必须是文本")
        _json_value(preset['input'])
        fields = preset['fields']
        if not isinstance(fields, dict):
            raise ValueError(f"{label} 的 fields 必须是参数路径到说明的映射")
        for pointer, description in fields.items():
            if not _pointer_exists(preset['input'], pointer):
                raise ValueError(f"{label} 的参数路径不存在或不是有效 JSON Pointer：{pointer}")
            if not isinstance(description, str):
                raise ValueError(f"{label} 的参数说明必须是文本：{pointer}")
    return copy.deepcopy(presets)
