"""Minimal persistence protocol used by the vendored v3 block engine."""
import json


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
