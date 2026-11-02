import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import runner
from test_extraction import sample


class ObservedClient:
    mode = ''
    calls = 0

    def __init__(self, directory):
        self.work = threading.local()
        self.model = 'fixture'

    def observe(self, phase, **values):
        runner.emit('block_progress', root_id=getattr(self.work, 'root_id', ''), phase=phase, **values)

    def call(self, instruction, payload, schema, stage, **kwargs):
        type(self).calls += 1
        units = payload['units']
        if self.mode == 'split' and len(units) > 1:
            raise RuntimeError('incomplete_response_length')
        if self.mode == 'retry' and self.calls == 1:
            raise RuntimeError('timeout')
        records = [{'type': 'requirement', 'subject': '额定电压', 'content': '10 kV',
                    'primary_unit_id': u['id'], 'evidence': [{'unit_id': u['id'], 'quote': u['text']}]}
                   for u in units if '10 kV' in u['text']]
        if self.mode == 'repair' and stage == 'v3_extract':
            for r in records:
                r['content'] = '999 kV'
        coverage = [{'unit_id': u['id'], 'disposition': 'extracted' if '10 kV' in u['text'] else 'context_only', 'reason': 'fixture'} for u in units]
        return schema.model_validate({'records': records, 'coverage': coverage}), {'cache_id': 'fixture'}


class ProgressTests(unittest.TestCase):
    def execute(self, directory, mode=''):
        ObservedClient.mode, ObservedClient.calls = mode, 0
        events = []
        payload = sample('# 2 技术要求\n额定电压应为 10 kV。\n\n备用额定电压应为 10 kV。')
        with patch.object(runner, 'RPCClient', ObservedClient), patch.object(runner, 'emit', lambda event, **v: events.append(dict(event=event, **v))), patch('specflow.v3.engine.time.sleep'):
            runner.run(payload, Path(directory))
        return events

    def test_phases_repair_and_checkpoint_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            events = self.execute(directory, 'repair')
            starts = [e['stage'] for e in events if e['event'] == 'phase' and e['status'] == 'running']
            self.assertEqual(['extraction_source', 'extraction_plan', 'extraction_blocks', 'extraction_save'], starts)
            phases = [e['phase'] for e in events if e['event'] == 'block_progress']
            for phase in ('validation', 'v3_repair', 'coverage', 'block_save'):
                self.assertIn(phase, phases)
            self.assertTrue(all(e.get('root_id') for e in events if e['event'] == 'block_progress'))
            replay = self.execute(directory)
            self.assertEqual(0, ObservedClient.calls)
            self.assertTrue(any(e.get('reused') for e in replay if e['event'] == 'block_done'))
            self.assertEqual(events[-1]['summary']['records'], replay[-1]['summary']['records'])

    def test_retry_and_length_split_observation(self):
        for mode, expected in [('retry', 'retry_wait'), ('split', 'split')]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                events = self.execute(directory, mode)
                self.assertTrue(any(e.get('phase') == expected for e in events))
                plan = next(e for e in events if e['event'] == 'plan')
                done = [e for e in events if e['event'] == 'block_done']
                self.assertEqual(len(plan['blocks']), len(done))
                self.assertTrue(all(':' not in e['root_id'] for e in done))
                self.assertFalse(events[-1]['summary']['failed_blocks'])


if __name__ == '__main__':
    unittest.main()
