"""Progress reports actual parser work and never turns DOCX blocks into pages."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'reader'))
import progress
from parse import parse


class ParserProgressTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'files').mkdir()
        self.env = patch.dict(os.environ, NEBULAEKNO_DATA_DIR=str(self.root))
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def read(self, ext, data, engine):
        path = self.root / 'files' / ('test.' + ext)
        path.write_bytes(data)
        output = self.root / 'derived' / ext
        result = parse(dict(path=str(path), output=str(output), options=dict(preview_enabled=False, parser_engines=engine)))
        progress.finish()
        return result, json.loads((output / 'progress.json').read_text())

    def test_docx_native_paragraph_and_table_counts(self):
        from docx import Document
        doc = Document()
        for n in range(7): doc.add_paragraph('段落 ' + str(n))
        doc.add_table(rows=2, cols=2)
        data = io.BytesIO(); doc.save(data)
        _, trace = self.read('docx', data.getvalue(), {'word':'native'})
        phase = next(p for p in trace['phases'] if p['name']=='read_docx')
        self.assertEqual(phase['progress'], dict(unit='docx_block', completed=8, total=8, current=0, paragraphs=7, tables=1))
        self.assertEqual(phase['status'], 'succeeded')

    def test_anydoc_reports_its_own_phases(self):
        data = (Path(__file__).parent / 'fixtures/sample.docx').read_bytes()
        _, trace = self.read('docx', data, {'word':'anydoc'})
        self.assertEqual(trace['engine'], 'anydoc')
        names = [p['name'] for p in trace['phases']]
        self.assertIn('anydoc_extract', names)
        self.assertIn('source_positions', names)
        self.assertIn('match_blocks', names)
        self.assertNotIn('read_docx', names)  # nested reference reader must not reset the trace
        self.assertFalse(any(p['progress']['unit'] in ('page','converted_page') for p in trace['phases']))
        match = next(p['progress'] for p in trace['phases'] if p['name']=='match_blocks')
        self.assertGreater(match['total'], 0)
        self.assertEqual(match['completed'], match['total'])

    def test_paddle_updates_before_and_after_actual_pages(self):
        from pypdf import PdfWriter
        doc = PdfWriter()
        for _ in range(3): doc.add_blank_page(width=100,height=100)
        data=io.BytesIO();doc.write(data)
        observed=[]
        def model(path,config,locator,size):
            snapshot=json.loads((path.parent/'progress.json').read_text())
            observed.append(snapshot['phases'][-1]['progress'].copy())
            return []
        with patch('paddle.parse_image', side_effect=model), patch('progress.time.monotonic', side_effect=lambda: 0), patch('progress.write', wraps=progress.write) as _:
            # Explicitly flush at each page so the assertion observes the in-flight counter.
            original=progress.report
            def report(*args,**kwargs): original(*args,**kwargs);progress.write(True)
            with patch('progress.report',side_effect=report):
                _, trace=self.read('pdf',data.getvalue(),{'pdf':'paddleocr_vl'})
        self.assertEqual([p['current'] for p in observed],[1,2,3])
        self.assertEqual([p['completed'] for p in observed],[0,1,2])
        self.assertEqual(trace['phases'][-1]['progress']['completed'],3)

    def test_failure_freezes_counter_and_does_not_complete(self):
        out=self.root/'derived';out.mkdir()
        progress.configure(out,'anydoc')
        progress.report('match_blocks','block',3,20,4)
        progress.finish('failed')
        span=json.loads((out/'progress.json').read_text())['phases'][-1]
        self.assertEqual(span['status'],'failed')
        self.assertEqual(span['progress']['completed'],3)
        self.assertIn('finished_at',span)


if __name__ == '__main__': unittest.main()
