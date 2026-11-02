"""Block planning for v3: few large, section-coherent, table-atomic blocks."""
from __future__ import annotations

import re

TOC_LINE = re.compile(r'[.…·•]{3,}\s*\d{1,4}\s*$')
REQUIREMENT_WORD = re.compile(r'应|不得|不应|必须|限值|试验|检验|要求|符合|大于|小于|不低于|不高于|提交|提供')
COVER_HINT = re.compile(r'(发布|实施|备案|ICS\s|CCS\s|书号|定价|版权|印刷)')
DATE_ONLY = re.compile(r'^\s*\d{4}\s*[-年/]\s*\d{1,2}\s*[-月/]\s*\d{0,2}\s*日?\s*(发布|实施)?\s*$')
META_SECTION = re.compile(r'^(前言|引言|目次|目录|编制说明|修订说明|说明)$')


def unit_is_metadata(unit, page_limit=4):
    """True for covers, TOC lines, dates and pure publishing furniture."""
    text = (unit.get('text') or '').strip()
    if not text:
        return True
    if unit.get('kind') == 'table_row':
        return False
    if unit.get('kind') in ('heading', 'section_heading') and len(text) <= 40 and not REQUIREMENT_WORD.search(text):
        return True
    if DATE_ONLY.match(text):
        return True
    if TOC_LINE.search(text):
        return True
    page = unit.get('page') or 99
    if page <= page_limit and len(text) <= 120 and COVER_HINT.search(text) and not REQUIREMENT_WORD.search(text):
        return True
    return False


def unit_is_toc(unit):
    return bool(TOC_LINE.search((unit.get('text') or '').strip()))


def _table_key(unit):
    return unit.get('logical_table_id') or unit.get('table_id') or None


def _column_count(unit):
    cols = unit.get('columns')
    if isinstance(cols, list) and cols:
        return len(cols)
    text = unit.get('text') or ''
    return text.count(' | ') + 1 if text else 0


def _same_table_continuation(previous_block, unit):
    """A captionless table fragment right after a table block with the same
    column count is almost certainly the same logical table split by page."""
    if not previous_block:
        return False
    if not (unit.get('kind') == 'table_row' or _table_key(unit)):
        return False
    tail = previous_block[-1]
    if not _table_key(tail):
        return False
    if _table_key(tail) == _table_key(unit):
        return True
    if unit.get('table_caption'):
        return False
    if tail.get('page') is not None and unit.get('page') is not None and unit['page'] - tail['page'] > 1:
        return False
    return _column_count(tail) == _column_count(unit) and _column_count(unit) >= 2


UNSPLITTABLE_KINDS = ('table_row', 'unreadable', 'figure', 'heading', 'section_heading')


def estimate_line_records(line):
    """Rough per-line record yield: one record per value cell in a table row,
    a couple for a long prose sentence, one otherwise. Used only to size
    groups, never to accept or drop content."""
    text = (line or '').strip()
    if not text:
        return 0
    cells = text.count(' | ')
    if cells:
        return max(1, cells)
    if len(text) > 150:
        return 2
    return 1


def estimate_unit_records(unit):
    text = unit.get('text') or ''
    if not text:
        return 0
    return sum(estimate_line_records(line) for line in text.split('\n'))


def split_dense_units(ir, max_chars=1500, max_records=30):
    """Split oversized multi-line text units at line boundaries.

    Scanned/OCR sources often deliver one giant text unit per page (dense
    parameter tables). A single such unit can hold far more clauses than the
    model can serialise in one response, and a one-unit block cannot be split
    by the engine's halving fallback, so extraction always fails there.
    Grouping lines into sub-units capped by estimated record count keeps every
    per-call output inside the model budget. Lines are never cut, so quotes
    stay verbatim and validation still anchors on real source text.
    """
    units = ir.get('units', [])
    out = []
    expanded = {}
    split_count = 0
    for unit in units:
        text = unit.get('text') or ''
        if (unit.get('kind') in UNSPLITTABLE_KINDS
                or (len(text) <= max_chars and estimate_unit_records(unit) <= max_records)):
            out.append(unit)
            continue
        lines = text.split('\n')
        if len(lines) < 3:
            out.append(unit)
            continue
        groups = []
        current, current_chars, current_records = [], 0, 0
        for line in lines:
            incoming = estimate_line_records(line)
            line_len = len(line) + 1
            if current and (current_chars + line_len > max_chars
                            or current_records + incoming > max_records):
                groups.append(current)
                current, current_chars, current_records = [], 0, 0
            current.append(line)
            current_chars += line_len
            current_records += incoming
        if current:
            groups.append(current)
        if len(groups) < 2:
            out.append(unit)
            continue
        ids = ['%s-L%03d' % (unit['id'], i + 1) for i in range(len(groups))]
        expanded[unit['id']] = ids
        split_count += 1
        for i, group in enumerate(groups):
            out.append(dict(unit, id=ids[i], text='\n'.join(group),
                            upstream_unit_id=unit['id'], split_method='line-groups/1'))
    if not expanded:
        return ir
    ir = dict(ir)
    for unit in out:
        if unit.get('context_unit_ids'):
            unit['context_unit_ids'] = [uid for old in unit['context_unit_ids']
                                        for uid in expanded.get(old, [old]) if uid != unit['id']]
    sections = [dict(s) for s in ir.get('sections', [])]
    for section in sections:
        if section.get('heading_unit_ids'):
            section['heading_unit_ids'] = [uid for old in section['heading_unit_ids']
                                           for uid in expanded.get(old, [old])]
    ir['sections'] = sections
    ir['units'] = out
    if len({u['id'] for u in out}) != len(out):
        raise ValueError('split_dense_unit_id_collision')
    ir.setdefault('source_warnings', []).append(
        'v3: %d 个超长文本单元已按行分组拆分，控制单次提取输出规模。' % split_count)
    return ir


def plan_blocks(ir, max_chars=8000, max_units=60, min_chars=1200, genre='generic',
                max_table_rows=28, max_records=80):
    """Group units into blocks; tables and chapters are never cut apart
    (giant single tables split at row granularity — every row carries its
    header). Table-dense blocks are capped by row count so the structured
    output fits the model's response budget.

    Returns a list of dicts: {id, units, skip, skip_reason}.
    Front-matter-only blocks (cover/TOC/前言) are marked skip and are
    dispositioned locally without a model call.
    """
    units = ir.get('units', [])
    sections = {s['id']: s for s in ir.get('sections', [])}
    blocks = []
    current = []
    size = 0
    rows = 0
    records = 0
    current_table = None

    def flush():
        nonlocal current, size, rows, records, current_table
        if current:
            blocks.append(current)
        current, size, rows, records, current_table = [], 0, 0, 0, None

    for unit in units:
        tkey = _table_key(unit) if (unit.get('kind') == 'table_row' or _table_key(unit)) else None
        ulen = len(unit.get('text') or '')
        # A wide limit table yields one record per value cell (7 columns → 6
        # records); ordinary tables yield one or two; a prose page several.
        # OCR'd table rows often arrive as plain text units, so the column
        # count decides first and the unit kind only as a fallback.
        cells = _column_count(unit)
        if cells >= 6:
            incoming = cells - 1
        elif tkey:
            incoming = 2
        else:
            incoming = 3
        if current:
            # A table boundary is a soft break (only once the block has real
            # content); size/count/rows/records are hard breaks. A giant single
            # table is split at row granularity — every row carries its header.
            hard_break = ((size + ulen > max_chars and size >= min_chars)
                          or len(current) >= max_units
                          or (tkey and rows >= max_table_rows)
                          or records + incoming > max_records)
            soft_break = ((tkey or current_table) and tkey != current_table
                          and size >= max(min_chars, max_chars // 2)
                          and not _same_table_continuation(current, unit))
            if hard_break or soft_break:
                flush()
        current.append(unit)
        size += ulen
        records += incoming
        if tkey:
            rows += 1
            current_table = tkey
        elif not (unit.get('kind') == 'table_row' or _table_key(unit)):
            current_table = None
    flush()

    planned = []
    for i, block_units in enumerate(blocks, 1):
        section_titles = {sections.get(u.get('section_id'), {}).get('title', '')
                          for u in block_units}
        named_sections = [t for t in section_titles if t]
        meta_section = bool(named_sections) and all(META_SECTION.match(t.strip()) for t in named_sections)
        if meta_section and genre in ('standard', 'procurement_dedicated', 'procurement_general', 'bid'):
            skip, reason = True, '前言/目次/编制说明等元信息章节，不产生条款记录'
        elif all(unit_is_metadata(u) for u in block_units):
            skip, reason = True, '封面/目次/发布信息等版面元信息'
        else:
            skip, reason = False, ''
        planned.append({
            'id': f'c{i:04}',
            'units': block_units,
            'skip': skip,
            'skip_reason': reason,
        })
    return planned


def section_paths(ir):
    """unit_id -> human-readable section path label for prompt context."""
    sections = {s['id']: s for s in ir.get('sections', [])}

    def path_of(sid):
        titles = []
        seen = set()
        cursor = sid
        while cursor and cursor in sections and cursor not in seen:
            seen.add(cursor)
            title = (sections[cursor].get('title') or '').strip()
            if title:
                titles.append(title)
            cursor = sections[cursor].get('parent_id')
        return ' › '.join(reversed(titles))

    return {u['id']: path_of(u.get('section_id')) for u in ir.get('units', [])}
