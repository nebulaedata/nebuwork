"""First-stage parse blocks -> v3 IR. Source locations always come from stored refs."""
from __future__ import annotations

import hashlib
import json
import re
from source_tables import split_blocks, _parse_html_table, _parse_markdown_table, _clean, heading_info
from specflow.v3.plan import split_dense_units


def norm(text):
    return re.sub(r'\s+', '', _clean(text or ''))


def build_ir(payload):
    doc = payload['document']
    refs = payload.get('refs') or []
    units, sections = [], {}
    current = None
    numbered_section = None
    offset = 0
    for index, block in enumerate(payload.get('blocks') or []):
        raw = block.get('text') or ''
        end = offset + len(raw)
        candidates = [r for r in refs if r['char_start'] < end and r['char_end'] > offset]
        # Captions and generated descriptions must never become source evidence.
        if block.get('method') in ('image_caption', 'frame_caption') or block.get('visual_role') == 'reference_only':
            offset = end + 1
            continue
        locator = block.get('locator') or {}
        page = locator.get('page') if isinstance(locator.get('page'), int) else None
        pieces = list(split_blocks(raw))
        if block.get('title') and block.get('level'):
            title = str(block['title'])
            pieces = [('heading', title)] if norm(title) == norm(raw) else [('heading', title)] + pieces
        for kind, text in pieces:
            text = text.strip()
            if not _clean(text):
                continue
            if kind == 'text' and re.fullmatch(r'\d+(?:\.\d+){0,5}\s+[\u4e00-\u9fffA-Za-z][^。；;\n]{0,60}', text):
                if not re.search(r'\d\s*(?:kV|V|Hz|kW|A|mm|%|℃)\b', text, re.I):
                    kind = 'heading'
            info = heading_info(text if text.startswith('#') else '# ' + text, {}) if kind == 'heading' else None
            if info:
                number = info.get('number')
                if number:
                    numbered_section = number
                sid = number or ((numbered_section + '.') if numbered_section else '') + 'section-' + str(index + 1)
                parts = sid.split('.')
                for depth in range(1, len(parts)):
                    ancestor = '.'.join(parts[:depth])
                    sections.setdefault(ancestor, {'id': ancestor, 'parent_id': '.'.join(parts[:depth-1]) or None,
                                                  'title': ancestor, 'heading_unit_ids': []})
                current = sid
                sections.setdefault(sid, {'id': sid, 'parent_id': '.'.join(parts[:-1]) or None,
                                          'title': info['title'], 'heading_unit_ids': []})
            base = {'page': page, 'section_id': current, 'method': block.get('method') or 'native',
                    'source_refs': candidates, 'source_block': index, 'block_offset': offset,
                    'locator': locator, 'precision': block.get('precision') or 'document'}
            if kind in ('table_html', 'table_md'):
                rows = _parse_html_table(text, []) if kind == 'table_html' else _parse_markdown_table(text)
                header = block.get('context_text') or ''
                if not header and (kind == 'table_md' or re.search(r'<th\b', text, re.I)):
                    header = ' | '.join(' '.join(c['text'] for c in row) for row in rows[:1])
                for row_index, row in enumerate(rows):
                    row_text = ' | '.join(c['text'] for c in row)
                    if row_text.strip():
                        units.append(dict(base, id='b%d-r%d' % (index, row_index), kind='table_row', text=row_text,
                                          table_id='table-%d' % index, logical_table_id='table-%d' % index,
                                          table_header=header, cells=row))
            else:
                uid = 'b%d-u%d' % (index, len(units))
                units.append(dict(base, id=uid, kind='heading' if info else 'text',
                                  text=_clean(text.lstrip('#').strip() if info else text)))
                if info:
                    sections[current]['heading_unit_ids'].append(uid)
        offset = end + 1
    ir = {'document_id': doc['id'], 'title': doc['name'], 'units': units,
          'sections': list(sections.values()), 'sha256': payload['input_hash']}
    ir = split_dense_units(ir, max_chars=1500, max_records=30)
    for unit in ir['units']:
        text = norm(unit['text'])
        raw = payload['blocks'][unit['source_block']].get('text') or ''
        position = raw.find(unit['text'])
        if position >= 0 and raw.count(unit['text']) == 1:
            start = unit['block_offset'] + position
            end = start + len(unit['text'])
            unit['source_refs'] = [r for r in unit['source_refs'] if r['char_start'] < end and r['char_end'] > start]
    return ir


def select_ir(ir, selected):
    if not selected:
        return ir
    known = {s['id'] for s in ir['sections']}
    if any(s not in known for s in selected):
        raise ValueError('SECTION_NOT_FOUND')
    scope_sections = {s['id'] for s in ir['sections'] if s['title'].strip() == '范围'}
    result = dict(ir)
    result['units'] = [dict(u, context_only=not any(
        u.get('section_id') == s or (u.get('section_id') or '').startswith(s + '.') for s in selected))
        for u in ir['units'] if u.get('section_id') in scope_sections or any(
            u.get('section_id') == s or (u.get('section_id') or '').startswith(s + '.') for s in selected)]
    if not any(not u.get('context_only') for u in result['units']):
        raise ValueError('SECTION_EMPTY')
    return result


def bind_record(record, ir, payload):
    by_id = {u['id']: u for u in ir['units']}
    issues = list(record['validation'].get('issues') or [])
    evidence = []
    for item in record['source']['evidence']:
        unit = by_id.get(item['unit_id'])
        bound = dict(item, page=None, source_refs=[])
        if not unit:
            issues.append('来源单元不存在')
            evidence.append(bound)
            continue
        needle = norm(item.get('quote'))
        source_units = [unit]
        if needle and needle not in norm(unit.get('text') or ''):
            # v3 may validate a quote spanning adjacent source units. Retain
            # every contributing anchor, rather than only its first unit.
            ordered = ir['units']
            glued = ''.join(norm(u.get('text')) for u in ordered)
            start = glued.find(needle)
            if start >= 0:
                cursor = 0
                source_units = []
                for other in ordered:
                    end = cursor + len(norm(other.get('text')))
                    if cursor < start + len(needle) and end > start:
                        source_units.append(other)
                    cursor = end
                if glued.count(needle) > 1:
                    issues.append('跨单元引文匹配不唯一，请核验来源')
            else:
                issues.append('引文未能完整映射到来源单元')
        candidates = list({r['id']: r for u in source_units for r in u.get('source_refs', [])}.values())
        exact = [r for r in candidates if needle and needle in norm(r.get('quote'))]
        # A quote may cross stored chunk boundaries. Use the actual block refs,
        # never a guessed page or a ref from a different occurrence.
        chosen = exact[:1] if exact else candidates
        if not chosen:
            issues.append('没有可访问的原文引用')
        raw_block = payload['blocks'][unit['source_block']].get('text') or ''
        if needle and norm(raw_block).count(needle) > 1:
            issues.append('原文引文在同一来源块出现多次，位置需核验')
        for ref in chosen:
            locators = ref.get('locators') or []
            coarse = ref.get('precision') in ('document', 'page', 'region', 'frame')
            converted = any(l.get('mapping') == 'converted_structure' for l in locators)
            if coarse or converted:
                issues.append('原文位置精度有限，请结合引文核验')
            source_id = ref['id']
            bound['source_refs'].append({
                'source_ref_id': source_id, 'quote': ref['quote'], 'locators': locators,
                'precision': ref['precision'], 'file_version_id': payload['file_version_id'],
                'parse_version_id': payload['parse_version_id'],
                'preview_url': '/documents/' + payload['document']['id'] + '?source_ref_id=' + source_id
                    + '&file_version_id=' + payload['file_version_id'] + '&parse_version_id=' + payload['parse_version_id'],
            })
        physical = [l['page'] for r in chosen for l in r.get('locators', [])
                    if isinstance(l.get('page'), int) and l.get('mapping') != 'converted_structure']
        bound['page'] = physical[0] if physical else None
        evidence.append(bound)
    record['source'].update(evidence=evidence, file_version_id=payload['file_version_id'],
                            parse_version_id=payload['parse_version_id'])
    record['validation'] = {'status': 'needs_review' if issues else 'machine_checked', 'issues': sorted(set(issues))}
    key = [record.get('type'), record.get('subject'), record.get('conditions'), record.get('content'),
           record.get('applicability', {}).get('section_id')]
    record['id'] = hashlib.sha256(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:32]
    return record
