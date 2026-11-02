import copy
import json
from pathlib import Path
import tempfile
import unittest

from adapter import build_ir, select_ir, bind_record
from runner import BlockStore
from specflow.v3.validate import validate_records
from specflow.v3.plan import unit_is_metadata
from workbook import export_workbook
from openpyxl import load_workbook


def sample(text='# 1 范围\n本规范适用于配电设备。\n\n# 2 技术要求\n额定电压应为 10 kV，额定频率应为 50 Hz。'):
    return {'document': {'id': 'document', 'name': '配电设备规范'},
            'input_hash': 'a' * 64, 'parse_version_id': 'parse-old', 'file_version_id': 'file-old',
            'blocks': [{'text': text, 'method': 'native', 'locator': {'type': 'paragraph', 'paragraph': 1}, 'precision': 'paragraph'}],
            'refs': [{'id': 'source-old', 'char_start': 0, 'char_end': len(text), 'quote': text,
                      'locators': [{'type': 'paragraph', 'paragraph': 1}], 'precision': 'paragraph'}]}


class ExtractionTests(unittest.TestCase):
    def test_short_first_page_parameter_is_not_cover_metadata(self):
        self.assertFalse(unit_is_metadata({'page': 1, 'kind': 'text', 'text': '额定电压 10 kV'}))
        self.assertFalse(unit_is_metadata({'page': 1, 'kind': 'heading', 'text': '额定电压应为 10 kV'}))

    def test_unnumbered_subheadings_stay_in_selected_chapter(self):
        ir = build_ir(sample('# 3 术语和定义\n## 招标人 bidder\n招标人是采购组织。\n## 投标人 tenderer\n投标人提供设备。\n# 4 技术要求\n电压应为 10 kV。'))
        selected = select_ir(ir, ['3'])
        self.assertTrue(any('招标人是采购组织' in u['text'] for u in selected['units']))
        self.assertTrue(any('投标人提供设备' in u['text'] for u in selected['units']))
        self.assertFalse(any('10 kV' in u['text'] for u in selected['units']))
    def test_sections_do_not_guess_missing_page(self):
        payload = sample()
        ir = build_ir(payload)
        self.assertEqual(['1', '2'], [s['id'] for s in ir['sections']])
        self.assertTrue(all(u['page'] is None for u in ir['units']))
        selected = select_ir(ir, ['2'])
        self.assertTrue(any(u.get('context_only') for u in selected['units']))
        with self.assertRaisesRegex(ValueError, 'SECTION_NOT_FOUND'):
            select_ir(ir, ['missing'])

    def test_two_parameters_keep_old_source(self):
        payload = sample()
        ir = build_ir(payload)
        unit = ir['units'][-1]
        records = []
        for subject, value in [('额定电压', '10 kV'), ('额定频率', '50 Hz')]:
            record = {'type': 'requirement', 'subject': subject, 'conditions': None, 'content': value,
                      'primary_unit_id': unit['id'], 'evidence': [{'unit_id': unit['id'], 'quote': unit['text']}]}
            records.append(record)
        valid, issues = validate_records(records, {unit['id']}, [unit], ir['units'])
        self.assertFalse(issues)
        for record in valid:
            public = bind_record({'type': record['type'], 'subject': record['subject'], 'content': record['content'],
                                  'validation': record['validation'], 'source': {'evidence': record['evidence']}}, ir, payload)
            ref = public['source']['evidence'][0]['source_refs'][0]
            self.assertEqual('source-old', ref['source_ref_id'])
            self.assertIn('parse-old', ref['preview_url'])
            self.assertEqual('machine_checked', public['validation']['status'])

    def test_coarse_and_duplicate_locations_need_review(self):
        payload = sample('电压应为 10 kV。电压应为 10 kV。')
        payload['refs'][0]['precision'] = 'document'
        ir = build_ir(payload)
        record = {'type': 'requirement', 'content': '10 kV', 'validation': {'status': 'machine_checked'},
                  'source': {'evidence': [{'unit_id': ir['units'][0]['id'], 'quote': '电压应为 10 kV。'}]}}
        result = bind_record(record, ir, payload)
        self.assertEqual('needs_review', result['validation']['status'])
        self.assertEqual(2, len(result['validation']['issues']))

    def test_generated_text_is_excluded(self):
        payload = sample()
        payload['blocks'].append({'text': '模型虚构电压 999 kV', 'method': 'image_caption'})
        self.assertNotIn('999', json.dumps(build_ir(payload), ensure_ascii=False))

    def test_table_structure(self):
        payload = sample('<table><tr><th>指标</th><th>要求</th></tr><tr><td>电压</td><td>10 kV</td></tr></table>')
        units = build_ir(payload)['units']
        self.assertEqual(2, len(units))
        self.assertEqual('table_row', units[-1]['kind'])
        self.assertIn('指标', units[-1]['table_header'])
        self.assertEqual(2, len(units[-1]['cells']))

    def test_missing_number_is_flagged(self):
        ir = build_ir(sample())
        u = ir['units'][-1]
        result, issues = validate_records([{'type': 'requirement', 'subject': '电压', 'content': '999 kV',
            'primary_unit_id': u['id'], 'evidence': [{'unit_id': u['id'], 'quote': u['text']}]}], {u['id']}, [u], ir['units'])
        self.assertTrue(issues)
        self.assertEqual('needs_review', result[0]['validation']['status'])

    def test_equal_values_in_different_sections_are_not_collapsed(self):
        units = [{'id': 'a', 'text': '甲电压应为 10 kV。', 'section_id': '2'},
                 {'id': 'b', 'text': '乙电压应为 10 kV。', 'section_id': '3'}]
        records = [{'type': 'requirement', 'subject': '电压', 'content': '10 kV',
                    'primary_unit_id': u['id'], 'evidence': [{'unit_id': u['id'], 'quote': u['text']}]}
                   for u in units]
        validated, issues = validate_records(records, {'a', 'b'}, units, units)
        self.assertEqual(2, len(validated))
        self.assertFalse(issues)

    def test_checkpoint_reopens_and_excel_has_four_sheets(self):
        payload = sample()
        ir = build_ir(payload)
        with tempfile.TemporaryDirectory() as directory:
            store = BlockStore(Path(directory), ir, payload)
            result = {'records': [], 'coverage': []}
            store.save_chunk('job', 'doc', 'block', result)
            self.assertEqual(result, BlockStore(Path(directory), ir, payload).results['block'])
            output = Path(directory) / 'result.xlsx'
            export_workbook({'run': {'文档': '=1+1'}, 'records': [], 'coverage': []}, output)
            workbook = load_workbook(output)
            self.assertEqual(['规范条款', '待核验', '覆盖与问题', '说明'], workbook.sheetnames)
            self.assertEqual('s', workbook['说明']['B2'].data_type)


if __name__ == '__main__':
    unittest.main()
