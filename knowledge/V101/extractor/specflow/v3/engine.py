"""v3 engine orchestration: plan -> per-block extract -> validate -> repair."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, FIRST_COMPLETED, wait
import json
import time

from ..client import AccountBlocked, DeadlineExceeded
from ..store import dumps
from . import prompts
from .classify import classify, GENRE_LABELS
from .models import V3BlockResult
from .plan import plan_blocks, section_paths
from .scope import build_scope, applicability_for
from .validate import validate_records, reconcile_coverage

GAP_HINT = ('应', '不得', '不应', '必须', '限值', '试验', '检验', '要求', '提交', '提供')


def _compact_units(units, paths):
    compact = []
    seen_header = set()
    for u in units:
        item = {
            'id': u['id'],
            'page': u.get('page'),
            'kind': u.get('kind'),
            'section': paths.get(u['id']) or '',
            'text': u.get('text') or '',
        }
        header = u.get('table_header')
        tkey = u.get('logical_table_id') or u.get('table_id')
        if header and tkey and tkey not in seen_header:
            item['table_header'] = header
            seen_header.add(tkey)
        compact.append(item)
    return compact


def _context_units(ir, block_unit_ids, paths, limit=24):
    """Adjacent units of the first/last block unit as read-only context."""
    units = ir.get('units', [])
    index = {u['id']: i for i, u in enumerate(units)}
    first = min(index[u] for u in block_unit_ids if u in index)
    last = max(index[u] for u in block_unit_ids if u in index)
    chosen = []
    for i in list(range(max(0, first - 4), first)) + list(range(last + 1, min(len(units), last + 5))):
        if units[i]['id'] not in block_unit_ids:
            chosen.append(units[i])
        if len(chosen) >= limit:
            break
    return _compact_units(chosen, paths)


def _dedupe_records(records):
    """Split halves and neighbouring blocks can re-extract the same clause;
    keep the first occurrence per (section, type, subject, conditions, content)."""
    seen = set()
    unique = []
    for record in records:
        key = (record.get('applicability', {}).get('section_id'), record.get('type'),
               record.get('subject'), record.get('conditions'), record.get('content'))
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    return unique


def _finalize_records(records, ir, scope, doc_id):
    final = []
    for record in records:
        primary = next((u for u in ir['units'] if u['id'] == record['primary_unit_id']), None)
        evidence = [{
            'unit_id': e['unit_id'],
            'cell_id': None,
            'page': next((u.get('page') for u in ir['units'] if u['id'] == e['unit_id']), None),
            'clause': e.get('clause'),
            'quote': e['quote'],
        } for e in record['evidence']]
        final.append({
            'type': record['type'],
            'subject': record.get('subject'),
            'conditions': record.get('conditions'),
            'content': record['content'],
            'supplement': {
                'exceptions': record.get('exceptions') or [],
                'references': record.get('references') or [],
                'relations': record.get('relations') or [],
            },
            'applicability': applicability_for(primary or {}, scope),
            'source': {
                'document_id': doc_id,
                'primary_unit_id': record['primary_unit_id'],
                'evidence': evidence,
            },
            'validation': record['validation'],
        })
    return final


def _payload(ir, block, scope, genre, paths):
    return {
        'document': {
            'title': ir.get('title'),
            'genre': GENRE_LABELS.get(genre, genre),
            'scope': scope.get('text') or '',
        },
        'units': _compact_units(block['units'], paths),
        'context_units': _context_units(ir, {u['id'] for u in block['units']}, paths),
    }


def _split_block(block):
    """Split a block into two halves at a unit boundary, avoiding a cut inside
    the same logical table when possible."""
    units = block['units']
    best = len(units) // 2
    for distance in range(0, len(units) // 4 + 1):
        for cut in (best - distance, best + distance):
            if 0 < cut < len(units):
                a = units[cut - 1].get('logical_table_id') or units[cut - 1].get('table_id')
                b = units[cut].get('logical_table_id') or units[cut].get('table_id')
                if a != b or not a:
                    best = cut
                    return (dict(block, id=block['id'] + ':a', units=units[:cut]),
                            dict(block, id=block['id'] + ':b', units=units[cut:]))
    return (dict(block, id=block['id'] + ':a', units=units[:best]),
            dict(block, id=block['id'] + ':b', units=units[best:]))


def _extract_block(store, client, job_id, ir, block, scope, genre, paths, _depth=0):
    cid = block['id']
    if cid in getattr(store, 'results', {}):
        return cid, len(store.results[cid]['records']), None
    last_error = None
    for attempt in (1, 2):
        _observe(client, 'block_attempt', block_id=cid, attempt=attempt, max_retries=1)
        try:
            return _extract_block_once(store, client, job_id, ir, block, scope, genre, paths,
                                       _tracked=_depth == 0)
        except (AccountBlocked, DeadlineExceeded):
            raise
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)[:1500]
            if 'incomplete_response_length' in last_error and len(block['units']) >= 2 and _depth < 4:
                _observe(client, 'split', block_id=cid, error=last_error)
                # Response exceeds the model's output budget: split the block
                # and process the halves; results are saved under sub-ids.
                try:
                    total = 0
                    for half in _split_block(block):
                        _, n, err = _extract_block(store, client, job_id, ir, half,
                                                   scope, genre, paths, _depth + 1)
                        if err:
                            raise RuntimeError(err)
                        total += n
                    store.execute('UPDATE chunks SET status=?,error=? WHERE job_id=? AND id=?',
                                  ('done', 'split:' + last_error[:200], job_id, cid))
                    if hasattr(store, 'results'):
                        halves = [store.results[h['id']] for h in _split_block(block)]
                        store.save_chunk(job_id, ir['document_id'], cid, {
                            'records': [r for half in halves for r in half['records']],
                            'coverage': [c for half in halves for c in half['coverage']], 'issues': [], 'engine': 'v3',
                        })
                    return cid, total, None
                except (AccountBlocked, DeadlineExceeded):
                    raise
                except Exception as split_exc:  # noqa: BLE001
                    last_error = str(split_exc)[:1500]
                    break
            transient = any(w in last_error.lower() for w in
                            ('urlopen', 'remote end', 'timed out', 'getaddrinfo',
                             'connection', '503', '502', '429', 'timeout'))
            if attempt == 2 or not transient:
                break
            _observe(client, 'retry_wait', block_id=cid, error=last_error, attempt=attempt, max_retries=1)
            time.sleep(20)
    if _depth == 0:
        store.execute('UPDATE chunks SET status=?,error=? WHERE job_id=? AND id=?',
                      ('failed', last_error, job_id, cid))
    return cid, 0, last_error


def _feedback(fixable, records, block_units, all_units, limit=16):
    """Actionable repair instructions: what failed and the real source text."""
    units = {u['id']: u for u in (all_units or block_units)}
    lines = []
    for item in fixable[:limit]:
        record = records[item['index']]
        detail = []
        for issue in item['issues']:
            if issue.startswith('quote_not_in_source'):
                uid = issue.split(':')[1]
                text = (units.get(uid, {}).get('text') or '')[:120]
                quoted = next((str(e.get('quote'))[:80] for e in record['evidence']
                               if e.get('unit_id') == uid), '')
                detail.append('该引文未在原文中找到。引文：%s ／ 原文实际内容：%s' % (quoted, text))
            elif issue.startswith('unsupported_value_number'):
                detail.append('内容中的数值在引用原文中找不到依据：%s' % issue.split(':', 1)[-1])
            elif issue.startswith('primary_unit_not_in_block'):
                detail.append('primary_unit_id 必须是本次 units 中的 id')
            else:
                detail.append(issue)
        lines.append('第%d条记录（%s）：%s' % (item['index'] + 1,
                                             record.get('subject') or record.get('content', '')[:20],
                                             '；'.join(detail)))
    return '\n'.join(lines)


def _observe(client, phase, **values):
    observer = getattr(client, 'observe', None)
    if observer:
        observer(phase, **values)


def _extract_block_once(store, client, job_id, ir, block, scope, genre, paths, _tracked=True):
    cid = block['id']
    if _tracked:
        store.execute('UPDATE chunks SET status=?,error=NULL WHERE job_id=? AND id=?', ('running', job_id, cid))
    payload = _payload(ir, block, scope, genre, paths)
    primary_ids = {u['id'] for u in block['units']}

    def call(instruction, data, stage):
        _observe(client, stage, block_id=cid)
        parsed, meta = client.call(instruction, data, V3BlockResult, stage,
                                   prompt_version=prompts.VERSION,
                                   system_prompt=prompts.system_prompt(genre))
        store.execute('INSERT OR IGNORE INTO api_calls VALUES(?,?,?,?,?)',
                      (job_id, cid, meta['cache_id'], stage, dumps(meta)))
        return parsed

    try:
        result = call(prompts.EXTRACT_INSTRUCTION, payload, 'v3_extract')
        _observe(client, 'validation', block_id=cid)
        records, fixable = validate_records([r.model_dump() for r in result.records],
                                            primary_ids, block['units'], ir.get('units'))
        if not records and any(any(w in (u.get('text') or '') for w in GAP_HINT) for u in block['units']):
            result = call(prompts.EXTRACT_INSTRUCTION + '\n' + prompts.GAP_NOTE,
                          payload, 'v3_gap_check')
            _observe(client, 'validation', block_id=cid)
            records, fixable = validate_records([r.model_dump() for r in result.records],
                                                primary_ids, block['units'], ir.get('units'))
        if fixable:
            feedback = _feedback(fixable, records, block['units'], ir.get('units'))
            repaired = call(prompts.EXTRACT_INSTRUCTION + '\n'
                            + prompts.REPAIR_NOTE.replace('{feedback}', feedback),
                            payload, 'v3_repair')
            _observe(client, 'validation', block_id=cid)
            records, fixable = validate_records([r.model_dump() for r in repaired.records],
                                                primary_ids, block['units'], ir.get('units'))
            coverage_model = [c.model_dump() for c in repaired.coverage]
        else:
            coverage_model = [c.model_dump() for c in result.coverage]
        _observe(client, 'coverage', block_id=cid)
        coverage, missing = reconcile_coverage(coverage_model, block['units'], records)
        final_records = _finalize_records(records, ir, scope, ir['document_id'])
        result_json = {
            'records': final_records,
            'coverage': [{**c, 'record_indexes': [], 'table_cells': None} for c in coverage],
            'issues': [],
            'genre': genre,
            'engine': 'v3',
        }
        _observe(client, 'block_save', block_id=cid)
        store.save_chunk(job_id, ir['document_id'], cid, result_json)
        return cid, len(final_records), None
    except (AccountBlocked, DeadlineExceeded):
        raise


def _skip_block(store, job_id, ir, block):
    cid = block['id']
    coverage = [{'unit_id': u['id'], 'disposition': 'ignored', 'reason': block['skip_reason'],
                 'record_indexes': [], 'table_cells': None} for u in block['units']]
    store.save_chunk(job_id, ir['document_id'], cid,
                     {'records': [], 'coverage': coverage, 'issues': [], 'engine': 'v3'})
    return cid, 0, None


def run_v3(store, client, job_id, ir, config, emit):
    """Run the full v3 workflow; returns the job quality dict."""
    started = time.monotonic()
    genre = classify(ir.get('title') or '', ir.get('units', []))
    scope = build_scope(ir, genre)
    paths = section_paths(ir)
    max_chars = int(config.get('v3_block_chars') or 8000)
    max_records = int(config.get('v3_max_records') or 30)
    blocks = plan_blocks(ir, max_chars=max_chars, genre=genre, max_records=max_records)
    emit('stage', stage='extracting', genre=genre, blocks=len(blocks))

    for block in blocks:
        store.execute('INSERT INTO chunks(job_id,id,status,input_json) VALUES(?,?,?,?)',
                      (job_id, block['id'], 'queued',
                       dumps({'block_units': len(block['units']), 'skip': block['skip'],
                              'genre': genre})))

    done = 0
    failures = []
    with ThreadPoolExecutor(max_workers=max(1, int(config.get('workers') or 2))) as pool:
        futures = {}
        for block in blocks:
            if block['skip']:
                futures[pool.submit(_skip_block, store, job_id, ir, block)] = block['id']
            else:
                futures[pool.submit(_extract_block, store, client, job_id, ir, block,
                                    scope, genre, paths)] = block['id']
        pending = set(futures)
        while pending:
            finished, pending = wait(pending, return_when=FIRST_COMPLETED)
            for future in finished:
                cid = futures[future]
                try:
                    _, count, error = future.result()
                except DeadlineExceeded:
                    raise
                except Exception as exc:  # noqa: BLE001
                    count, error = 0, str(exc)[:1500]
                done += 1
                if error:
                    failures.append({'chunk': cid, 'error': error})
                emit('progress', chunk=cid, records=count, done=done, total=len(blocks),
                     error=error)
                store.execute('UPDATE jobs SET updated=? WHERE id=?', (time.time(), job_id))

    quality = store.quality(job_id)
    parameters = quality.get('parameters') or {}
    records_total = sum(parameters.values())
    needs = parameters.get('needs_review', 0)
    chunks = quality.get('chunks') or {}
    other_blockers = (
        any(chunks.get(state, 0) for state in ('failed', 'blocked', 'running', 'queued', 'cancelled'))
        or (quality.get('coverage') or {}).get('needs_review', 0) * 100.0 /
        max(sum((quality.get('coverage') or {}).values()), 1) > 2.0
        or quality.get('source_review_pending_units')
        or quality.get('source_review_pending_pages')
        or (quality.get('processed_units') or 0) < (quality.get('source_units') or 0)
        or (quality.get('document_scope') or {}).get('status') not in (None, 'verified')
    )
    if records_total == 0:
        # A source with no extractable text (or an all-skipped plan) must never
        # look releasable: zero records is a failure mode, not a clean result.
        quality['release_ready'] = False
        quality['v3_empty_result'] = True
    elif not other_blockers and needs:
        # Small flagged residue is expected on real documents; those records are
        # individually marked for review, so the batch stays releasable.
        ratio = needs * 100.0 / records_total
        quality['v3_needs_review_ratio'] = round(ratio, 2)
        if ratio <= 2.0:
            quality['release_ready'] = True
            quality['v3_release_note'] = ('待核验记录占 %.1f%%，按宽松可用标准放行；'
                                          '待核验条目单独标注' % ratio)
    quality['v3'] = {
        'genre': genre,
        'blocks': len(blocks),
        'skipped_blocks': sum(1 for b in blocks if b['skip']),
        'scope_text': scope.get('text'),
        'object_text': scope.get('object_text'),
    }
    status = ('failed' if failures and done == len(failures)
              else 'partial' if failures or not quality.get('release_ready')
              else 'completed')
    store.execute('UPDATE jobs SET status=?,updated=? WHERE id=?', (status, time.time(), job_id))
    quality['elapsed'] = time.monotonic() - started
    return quality, scope, genre
