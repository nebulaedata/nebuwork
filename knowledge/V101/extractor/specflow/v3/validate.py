"""Deterministic record validation for v3.

Checks that every evidence quote is verbatim source text and that every value
in a record's content is supported by the cited rows (quote, the cited unit's
own text, or its table header). Quotes may span adjacent units — PDF and OCR
text layers break lines mid-sentence — so a quote is accepted when it is a
contiguous fragment of the block's units concatenated in reading order, or when
each of its lines is found verbatim in some unit.
"""
from __future__ import annotations

import re
import unicodedata

# \d after a letter is a value ("kW0.019%"); only digits glued to digits or a
# decimal point belong to the same number.
NUMBER = re.compile(r'(?<![0-9.])\d+(?:\.\d+)?%?')
SPLIT = re.compile(r'[\r\n]+')


def _norm(text: str) -> str:
    text = unicodedata.normalize('NFKC', text or '')
    return re.sub(r'\s+', '', text)


def _flat(text: str) -> str:
    """NFKC without removing whitespace: numbers must never be glued together
    ("70.5 71.1" must stay two numbers, not become 70.571)."""
    return unicodedata.normalize('NFKC', text or '')


def _numbers(text: str):
    return {n.rstrip('%') for n in NUMBER.findall(_flat(text))}


def _numbers_of(parts):
    found = set()
    for part in parts:
        found |= _numbers(part)
    return found


def _unit_text(unit) -> str:
    return unit.get('text') or ''


def _unit_header(unit) -> str:
    header = unit.get('table_header')
    if isinstance(header, list):
        return '\n'.join(str(part) for part in header)
    return str(header or '')


def _support_text(unit) -> str:
    return _norm(_unit_text(unit) + ' ' + _unit_header(unit))


def _locate(needle, ids, norm_text):
    if not needle:
        return None
    matches = [uid for uid in ids if needle in norm_text.get(uid, '')]
    if len(matches) == 1:
        return matches[0]
    if matches:
        return matches[0]
    return None


def _spans(ids, norm_text):
    """(unit_id, start, end) offsets for a reading-order concatenation."""
    spans = []
    cursor = 0
    for uid in ids:
        length = len(norm_text.get(uid, ''))
        spans.append((uid, cursor, cursor + length))
        cursor += length
    return spans


def _span_anchor(quote, glued, spans):
    pos = glued.find(quote)
    if pos < 0:
        return None
    for uid, start, end in spans:
        if start <= pos < end:
            return uid
    return None


CELL_LABEL = re.compile(r'^C\d+(?:[-–—][A-Z]?\d+)*(?:\s*[,，]\s*[A-Z]?\d+)*\s*[:：]')

# Model reasoning leaked into the record content ("根据上下文推断…", "此处需
# 修正…") or an overlong dump means the model narrated instead of extracting;
# such rows are flagged for human review, never silently passed.
META_REASONING = re.compile(r'(根据上下文|此处需修正|需修正|推断|本行未|不对[，,]|表头顺序|无法确定对应|猜测)')
MAX_CONTENT_CHARS = 300


def _cell_quote_ok(quote, doc_search):
    """A table quote may cite a subset of a row's cells, e.g.
    `C4-C6: 高压 | C7: 中压`. Verify each cited cell VALUE occurs verbatim in
    the source; cell labels themselves are layout metadata, not content."""
    lines = [line for line in SPLIT.split(quote or '') if line.strip()]
    if not lines:
        return False
    checked = 0
    for line in lines:
        for part in line.split('|'):
            part = part.strip()
            if not part:
                continue
            match = CELL_LABEL.match(part)
            if not match:
                return False
            value = _norm(part[match.end():])
            if not value:
                continue
            if value not in doc_search:
                return False
            checked += 1
    return checked > 0


def validate_records(records, primary_ids, block_units, all_units=None):
    """Annotate records with validation status; returns (records, fixable)."""
    units_by_id = {u['id']: u for u in (all_units or block_units)}
    # A quote may cite a row while quoting its header, or cite the header row
    # itself; both are real source text. Reading-order concatenation stays
    # text-only so repeated headers cannot manufacture a cross-row match.
    norm_text = {uid: _norm(_unit_text(u)) for uid, u in units_by_id.items()}
    search_text = {uid: _norm(_unit_text(u) + '\x00' + _unit_header(u))
                   for uid, u in units_by_id.items()}
    block_ids = [u['id'] for u in block_units]
    glued_block = ''.join(norm_text.get(uid, '') for uid in block_ids)
    glued_doc = ''.join(norm_text.get(uid, '') for uid in units_by_id)
    block_spans = _spans(block_ids, norm_text)
    doc_spans = _spans(list(norm_text), norm_text)
    fixable = []

    seen = {}
    unique = []
    for record in records:
        key = (units_by_id.get(record.get('primary_unit_id'), {}).get('section_id'),
               record['type'], record.get('subject'), record.get('conditions'), record['content'])
        if key in seen:
            seen[key]['evidence'].extend(record['evidence'])
            continue
        seen[key] = record
        unique.append(record)

    for index, record in enumerate(unique):
        issues = []
        content = record.get('content') or ''
        if META_REASONING.search(content):
            issues.append('content_meta_reasoning:内容疑似混入模型推理过程，须人工核对')
        elif len(content) > MAX_CONTENT_CHARS:
            issues.append('content_overlong:内容过长（>%d字），疑似整段转述，须人工核对' % MAX_CONTENT_CHARS)
        for item in record['evidence']:
            uid = item['unit_id']
            quote = _norm(item['quote'])
            if not quote:
                issues.append('empty_evidence_quote:' + uid)
                continue
            if uid in search_text and quote in search_text[uid]:
                continue
            located = None
            # A quote cut by a line break in the source spans adjacent units.
            if len(quote) >= 8 and quote in glued_block:
                located = _span_anchor(quote, glued_block, block_spans)
            elif len(quote) >= 8 and quote in glued_doc:
                located = _span_anchor(quote, glued_doc, doc_spans)
            if located:
                item['unit_id'] = located
                continue
            segments = [_norm(part) for part in SPLIT.split(item['quote'] or '') if part.strip()]
            if len(segments) > 1:
                order = block_ids + [uid for uid in search_text if uid not in block_ids]
                resolved = []
                missing = []
                for segment in segments:
                    found = _locate(segment[:48], order, search_text) or (
                        _locate(segment, order, search_text))
                    if found:
                        resolved.append(found)
                    else:
                        missing.append(segment[:40])
                if not missing:
                    longest = max(segments, key=len)
                    item['unit_id'] = _locate(longest[:48], order, search_text) or resolved[0]
                    continue
                issues.append('quote_not_in_source:' + uid + ':' + missing[0])
                continue
            if _cell_quote_ok(item['quote'], glued_doc):
                # Cell-subset quote: every cited value exists in the source.
                continue
            located = _locate(quote, list(search_text), search_text)
            if located:
                item['unit_id'] = located
                continue
            issues.append('quote_not_in_source:' + uid)
        # Ownership is decided after relocation: a record may cite a header
        # that sits in a neighbouring block while its own row is here. A real
        # source unit outside this block is accepted (split halves legitimately
        # reference their sibling); only invented ids are flagged.
        if record['primary_unit_id'] not in primary_ids:
            anchors = [e['unit_id'] for e in record['evidence'] if e['unit_id'] in primary_ids]
            if anchors:
                record['primary_unit_id'] = anchors[0]
            elif record['primary_unit_id'] not in units_by_id:
                issues.append('primary_unit_not_in_source')
        if record['evidence']:
            support = list(item['quote'] for item in record['evidence'])
            for item in record['evidence']:
                unit = units_by_id.get(item['unit_id'])
                if unit:
                    support.extend([_unit_text(unit), _unit_header(unit)])
            primary = units_by_id.get(record['primary_unit_id'])
            if primary:
                support.extend([_unit_text(primary), _unit_header(primary)])
            supported = _numbers_of(support)
            missing = [n for n in sorted(_numbers(record['content'])) if n not in supported]
            if missing:
                issues.append('unsupported_value_number:' + ','.join(missing[:5]))
        record['validation'] = {
            'status': 'needs_review' if issues else 'machine_checked',
            'issues': sorted(set(issues)),
        }
        if issues:
            fixable.append({'index': index, 'issues': record['validation']['issues']})
    return unique, fixable


def reconcile_coverage(model_rows, block_units, records):
    """One coverage row per primary unit; fill or trim model output."""
    primary = [u['id'] for u in block_units]
    anchored = {}
    for i, record in enumerate(records):
        for item in record['evidence']:
            anchored.setdefault(item['unit_id'], set()).add(i)
        anchored.setdefault(record['primary_unit_id'], set()).add(i)

    rows = {}
    for row in model_rows:
        uid = row.get('unit_id')
        if uid in primary and uid not in rows:
            rows[uid] = {
                'unit_id': uid,
                'disposition': row.get('disposition'),
                'reason': str(row.get('reason') or '')[:200],
            }
    missing = []
    for uid in primary:
        if uid not in rows:
            unit = next(u for u in block_units if u['id'] == uid)
            text = _unit_text(unit).strip()
            if uid in anchored:
                rows[uid] = {'unit_id': uid, 'disposition': 'extracted', 'reason': '模型未给出处置，按证据归属自动补记'}
            elif not text:
                rows[uid] = {'unit_id': uid, 'disposition': 'ignored', 'reason': '空白单元'}
            elif unit.get('kind') in ('heading', 'section_heading'):
                rows[uid] = {'unit_id': uid, 'disposition': 'context_only', 'reason': '章节标题，自动归类'}
            else:
                rows[uid] = {'unit_id': uid, 'disposition': 'needs_review',
                             'reason': '模型未给出该单元处置'}
                missing.append(uid)
    for uid, row in rows.items():
        if row['disposition'] == 'extracted' and uid not in anchored:
            row['disposition'] = 'context_only'
            row['reason'] = (row['reason'] + ' ' if row['reason'] else '') + '无证据锚点，降级为上下文'
    return [rows[uid] for uid in primary], missing
