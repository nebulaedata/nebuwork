"""Isolated v3 runner. JSONL stdout is a duplex RPC/event protocol, not a log."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import threading
import time
import uuid

from adapter import build_ir, select_ir, bind_record
from specflow.client import DirectClient, AccountBlocked
from specflow.v3 import prompts
from specflow.v3.classify import classify
from specflow.v3.engine import _extract_block, _skip_block
from specflow.v3.plan import plan_blocks, section_paths
from specflow.v3.scope import build_scope
from specflow.prepare import write_json

OUTPUT_LOCK = threading.Lock()


def emit(event, **values):
    with OUTPUT_LOCK:
        print(json.dumps(dict(event=event, **values), ensure_ascii=False), flush=True)


class RPCClient(DirectClient):
    def __init__(self, workdir):
        super().__init__('', '', 'bound-model', work_dir=workdir, thinking=False,
                         max_tokens={'extract': 10000}, on_call=self.call_observed)
        self.pending = {}
        self.lock = threading.Lock()
        self.work = threading.local()
        threading.Thread(target=self.read, daemon=True).start()

    def observe(self, phase, **values):
        block_id = values.get('block_id')
        if block_id:
            self.work.block_id = block_id
        emit('block_progress', root_id=getattr(self.work, 'root_id', ''), phase=phase, **values)

    def call_observed(self, meta):
        if meta.get('status') in ('retry', 'repair'):
            self.observe('model_retry_wait' if meta['status'] == 'retry' else 'model_schema_repair',
                         block_id=getattr(self.work, 'block_id', ''),
                         model_attempt=meta.get('attempt', 1), error=meta.get('error', ''))

    def read(self):
        for line in sys.stdin:
            value = json.loads(line)
            with self.lock:
                pending = self.pending.get(value.get('id'))
                if pending:
                    pending[1].append(value)
                    pending[0].set()
        with self.lock:
            for done, values in self.pending.values():
                values.append({'error': {'code': 'TRANSPORT_CLOSED', 'message': '模型通道已关闭'}})
                done.set()

    def _request(self, system, user, stage, thinking=None, max_tokens=None, output_schema=None, **kwargs):
        self.observe(stage, block_id=getattr(self.work, 'block_id', ''), model_call=True)
        request_id = uuid.uuid4().hex
        done, values = threading.Event(), []
        with self.lock:
            self.pending[request_id] = (done, values)
        started = time.monotonic()
        emit('model_request', id=request_id, body={
            'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            'temperature': 0, 'stream': False, 'max_tokens': max_tokens or self._max_tokens(stage),
            'response_format': {'type': 'json_object'},
        })
        if not done.wait(620):
            raise RuntimeError('model_timeout')
        with self.lock:
            self.pending.pop(request_id, None)
        reply = values[0]
        if reply.get('error'):
            error = reply['error']
            if error.get('code') in ('MODEL_NOT_CONFIGURED', 'MODEL_CONFIG_INVALID'):
                raise AccountBlocked(error.get('message'))
            raise RuntimeError(error.get('message', '模型调用失败'))
        raw = reply['response']
        choice = raw['choices'][0]
        meta = {'raw_text': choice['message']['content'], 'finish_reason': choice.get('finish_reason'),
                'usage': raw.get('usage') or {}, 'seconds': round(time.monotonic() - started, 3),
                'requested_model': raw.get('model'), 'response_id': raw.get('id'), 'stage': stage}
        write_json(self.work_dir / 'model-responses' / (request_id + '.json'), meta)
        return meta


class BlockStore:
    """Only the v3 block engine's persistence protocol; no v2 store or workflow."""
    def __init__(self, directory, ir, payload):
        self.directory, self.ir, self.payload = directory, ir, payload
        self.results = {}
        self.lock = threading.Lock()
        self.db = directory / 'checkpoint.sqlite3'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS blocks(id TEXT PRIMARY KEY,result TEXT NOT NULL)')
            for block_id, raw in db.execute('SELECT id,result FROM blocks'):
                self.results[block_id] = json.loads(raw)

    def execute(self, sql, args=()):
        # api_calls are retained as JSON trace files by RPCClient.
        if sql.startswith('UPDATE chunks SET status=') and args[0] == 'failed':
            emit('block_error', block_id=args[-1], error=args[1])

    def save_chunk(self, job_id, doc_id, block_id, result):
        result = dict(result)
        context_only = {u['id'] for u in self.ir['units'] if u.get('context_only')}
        result['records'] = [bind_record(r, self.ir, self.payload) for r in result['records']
                             if r.get('source', {}).get('primary_unit_id') not in context_only]
        with self.lock:
            ids = {r['id'] for value in self.results.values() for r in value['records']}
            ids.update(r['id'] for r in result['records'])
            if len(ids) > 5000:
                raise RuntimeError('EXTRACTION_RECORD_LIMIT: 已保留结果，请缩小章节范围')
            with closing(sqlite3.connect(self.db, timeout=30)) as db, db:
                db.execute('INSERT OR REPLACE INTO blocks VALUES(?,?)', (block_id, json.dumps(result, ensure_ascii=False)))
            self.results[block_id] = result
        emit('block_result', block_id=block_id, result=result)


def run(payload, directory):
    emit('phase', stage='extraction_source', status='running')
    identity = {'input_hash': payload['input_hash'], 'prompt_version': prompts.VERSION, 'engine_version': 'v3/1-nebulaekno'}
    identity_path = directory / 'identity.json'
    if identity_path.exists() and json.loads(identity_path.read_text(encoding='utf-8')) != identity:
        raise ValueError('提取输入或引擎版本已变化，请创建新的提取运行')
    write_json(identity_path, identity)
    ir = select_ir(build_ir(payload), payload.get('section_ids') or [])
    if not ir['units']:
        raise ValueError('NO_SOURCE_TEXT')
    write_json(directory / 'ir.json', ir)
    emit('phase', stage='extraction_source', status='succeeded')
    emit('phase', stage='extraction_plan', status='running')
    genre = classify(ir['title'], ir['units'])
    scope = build_scope(ir, genre)
    extract_ir = dict(ir, units=[u for u in ir['units'] if not u.get('context_only')])
    blocks = plan_blocks(extract_ir, max_chars=5000, max_records=30, genre=genre)
    if len(blocks) > 2500 or len(ir['units']) > 50000:
        raise ValueError('EXTRACTION_INPUT_LIMIT')
    emit('units', units=ir['units'])
    store = BlockStore(directory, ir, payload)
    paths = section_paths(ir)
    emit('plan', blocks=[{'id': b['id'], 'ordinal': i, 'units': [u['id'] for u in b['units']]}
                         for i, b in enumerate(blocks)], scope=scope, genre=genre, prompt_version=prompts.VERSION)
    emit('phase', stage='extraction_plan', status='succeeded')
    emit('phase', stage='extraction_blocks', status='running')
    # Replay persisted blocks before requesting new model output (also covers a
    # crash between the SQLite commit and PostgreSQL event acknowledgement).
    for block_id, result in list(store.results.items()):
        emit('block_result', block_id=block_id, result=result)
        if ':' not in block_id:
            emit('block_done', root_id=block_id, block_id=block_id, status='succeeded', reused=True, phase='reused')
    context_units = [u for u in ir['units'] if u.get('context_only')]
    if context_units and 'context:scope' not in store.results:
        store.save_chunk('run', ir['document_id'], 'context:scope', {
            'records': [], 'coverage': [{'unit_id': u['id'], 'disposition': 'context_only',
                'reason': '范围章节仅供理解，不属于本次选定提取范围'} for u in context_units],
            'issues': [], 'engine': 'v3',
        })
    client = RPCClient(directory)
    failures = []
    def process(block):
        block_id = block['id']
        if block_id in store.results:
            return
        client.work.root_id = block_id
        client.observe('block_attempt', block_id=block_id, attempt=1, max_retries=1)
        try:
            # A length-split parent resumes only incomplete halves.
            if block['skip']:
                _skip_block(store, client.model, ir, block)
                emit('block_done', root_id=block_id, block_id=block_id, status='succeeded', skipped=True, phase='skipped')
                return
            _, _, error = _extract_block(store, client, 'run', ir, block, scope, genre, paths)
            if error:
                failures.append({'block_id': block_id, 'error': error})
                emit('block_error', block_id=block_id, error=error)
            emit('block_done', root_id=block_id, block_id=block_id, status='failed' if error else 'succeeded', error=error or '', phase='finished')
        except Exception as exc:
            emit('block_done', root_id=block_id, block_id=block_id, status='failed', error=str(exc)[:500], phase='finished')
            raise
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(process, b): b['id'] for b in blocks}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as exc:
                failures.append({'block_id': futures[future], 'error': str(exc)[:500]})
                emit('block_error', block_id=futures[future], error=str(exc)[:500])
    emit('phase', stage='extraction_blocks', status='partially_failed' if failures else 'succeeded')
    emit('phase', stage='extraction_save', status='running')
    records, coverage = [], []
    seen = {}
    for result in store.results.values():
        coverage.extend(result['coverage'])
        for record in result['records']:
            if record['id'] in seen:
                # Preserve all evidence when identical records occur in neighbours.
                previous = seen[record['id']]
                previous['source']['evidence'].extend(record['source']['evidence'])
                previous['validation']['issues'] = sorted(set(previous['validation'].get('issues', []) + record['validation'].get('issues', [])))
                if previous['validation']['issues']:
                    previous['validation']['status'] = 'needs_review'
                continue
            seen[record['id']] = record
            records.append(record)
    for record in records:
        record['source']['evidence'] = list({
            json.dumps(e, sort_keys=True, ensure_ascii=False): e for e in record['source']['evidence']
        }.values())
    review = sum(r['validation']['status'] == 'needs_review' for r in records)
    pending = sum(c['disposition'] == 'needs_review' for c in coverage)
    if len(records) > 5000:
        failures.append({'error': 'EXTRACTION_RECORD_LIMIT'})
    summary = {'records': len(records), 'needs_review': review, 'coverage_needs_review': pending,
               'blocks': len(blocks), 'failed_blocks': len(failures), 'scope': scope,
               'genre': genre, 'prompt_version': prompts.VERSION, 'quality_method': 'program_validation',
               'issues': failures, 'empty_result': not records}
    state = 'partially_failed' if failures or review or pending or not records else 'succeeded'
    if failures and not store.results:
        state = 'failed'
    write_json(directory / 'result.json', dict(records=records, coverage=coverage, summary=summary))
    emit('complete', state=state, summary=summary, records=records)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['sections', 'run', 'export'])
    parser.add_argument('input')
    parser.add_argument('output', nargs='?')
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding='utf-8'))
    if args.mode == 'sections':
        print(json.dumps(build_ir(payload)['sections'], ensure_ascii=False))
    elif args.mode == 'export':
        from workbook import export_workbook
        export_workbook(payload, args.output)
    else:
        directory = Path(args.output)
        directory.mkdir(parents=True, exist_ok=True)
        run(payload, directory)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit('error', message=str(exc)[:1000])
        sys.exit(1)
