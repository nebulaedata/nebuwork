"""Deterministic document scope and per-record applicability for v3.

The v2 workflow spent many model calls resolving applicability. v3 derives
the document-level object text from the 范围 section or the title, and binds
each record to its owning section. No model calls happen here.
"""
from __future__ import annotations

import re

TOC_LEADER = re.compile(r'(?:·{2,}|⋯{2,}|…{2,}|\.{3,}|。{3,})')
PAGE_SUFFIX = re.compile(r'\s+\d{1,3}\s*$')


def _clean_title(title: str) -> str:
    text = re.sub(r'\.(pdf|docx?|md|txt)$', '', title or '', flags=re.I).strip()
    text = re.sub(r'^[0-9a-f]{8}[_\-]+', '', text).strip()
    text = re.sub(r'^【\d+】', '', text).strip()
    # Only strip a standard number when a standard prefix is present; "2026年…"
    # or "220-750kV…" are part of the title, not a standard number.
    text = re.sub(
        r'^(?:(?:GB\s*/?\s*[Tt]?|GBT|GB∕T|Q\s*/\s*GDW|Q／GDW|DL\s*/\s*T|NB\s*/\s*T|IEC|ISO)'
        r'\s*[\d.]+(?:[—\-–]\d{0,4})?)\s*', '', text, flags=re.I).strip()
    text = re.sub(r'^[《\s]+|[》\s]+$', '', text)
    return text or (title or '').strip()


def _clean_scope_lines(texts) -> list:
    """Drop dot leaders and page numbers so TOC rows never become scope text."""
    parts = []
    for text in texts:
        for line in re.split(r'[\n\r]+', text or ''):
            line = line.strip()
            if not line:
                continue
            leaders = bool(TOC_LEADER.search(line))
            cleaned = PAGE_SUFFIX.sub('', TOC_LEADER.sub('', line)).strip()
            if not cleaned:
                continue
            if leaders and len(cleaned) < 16:
                continue
            parts.append(cleaned)
    return parts


def _scope_section_text(units: list, sections: list) -> str:
    """Return the leading text of the 范围 chapter, if one exists."""
    scope_ids = {s['id'] for s in sections
                 if re.fullmatch(r'\s*范围\s*', str(s.get('title') or ''))}
    if scope_ids:
        parts = _clean_scope_lines(
            u.get('text', '') for u in units if u.get('section_id') in scope_ids)
        if parts:
            return '\n'.join(parts)[:600]
    for i, unit in enumerate(units[:120]):
        if re.fullmatch(r'\s*(?:1\s*[.、]?\s*)?范围\s*', (unit.get('text') or '').strip()):
            parts = _clean_scope_lines(
                u.get('text', '') for u in units[i + 1:i + 6])
            if parts:
                return '\n'.join(parts)[:600]
    return ''


def _object_from_scope(scope_text: str) -> str:
    match = re.search(r'适用于([^。；\n]{2,80})', scope_text)
    if match:
        return match.group(1).strip(' ，,。；;')
    match = re.search(r'规定[了了]?([^。；\n]{2,80})', scope_text)
    if match:
        return match.group(1).strip(' ，,。；;')
    return ''


def build_scope(ir: dict, genre: str) -> dict:
    title = ir.get('title') or ''
    scope_text = _scope_section_text(ir.get('units', []), ir.get('sections', []))
    object_text = _object_from_scope(scope_text) or _clean_title(title)
    return {
        'genre': genre,
        'text': scope_text or object_text,
        'object_text': object_text,
        'status': 'verified',
        'method': 'v3_deterministic_scope',
    }


def applicability_for(unit: dict, scope: dict) -> dict:
    """Deterministic per-record applicability: owning section + document object."""
    return {
        'section_id': unit.get('section_id') or '__document__',
        'text': scope.get('object_text') or scope.get('text') or '',
        'basis': 'document',
        'status': 'confirmed',
    }
