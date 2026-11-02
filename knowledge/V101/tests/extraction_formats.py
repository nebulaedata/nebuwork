"""Text PDF, DOCX, spreadsheet and scanned PDF source-locator integration."""
import io
from pathlib import Path
import subprocess
import tempfile
from docx import Document
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFont
from client import request, upload, wait_task, check


model = request('/models', {'name': '格式定位协议验收', 'purpose': 'text', 'base_url': 'http://extraction-fixture:9000',
    'model_name': 'extraction-fixture', 'config': {}})
request('/settings/extraction-defaults', {'model_id': model['id']}, 'PUT')
request('/settings/parser-engines', {'paddleocr_vl': {'endpoint': 'http://model-fixture:9000',
    'use_seal_recognition': True, 'use_chart_recognition': False}}, 'PUT')
config = {'wiki_enabled': False, 'graph_enabled': False, 'outline_enabled': False,
          'image_caption': False, 'image_embedding': False, 'parser_engines': {'word': 'native', 'pdf': 'native'}}
kb = request('/knowledge-bases', {'name': '提取格式验收', 'config': config})['id']


def verify(name, data, expected_location, library=kb):
    document = upload(library, name, data)
    task = wait_task(document['task_id'])
    check(bool(request('/knowledge/' + document['knowledge_id'])['current_parse_version_id']), name + ' 已有解析版本')
    run = request('/knowledge/' + document['knowledge_id'] + '/extractions', {}, expected=202)
    state = wait_task(run['task_id'])
    assert state['state'] in ('succeeded', 'partially_failed'), state
    records = request('/extractions/' + run['run_id'] + '/records?page_size=100')
    assert records, name
    locations = []
    for record in records:
        for evidence in record['source']['evidence']:
            for ref in evidence['source_refs']:
                source = request('/sources/' + ref['source_ref_id'])
                locations.extend(source['locators'])
    check(any(l.get('type') == expected_location for l in locations), name + ' 来源定位：' + expected_location)
    return records


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    doc = Document()
    doc.add_heading('技术要求', 1)
    doc.add_paragraph('额定电压应为 10 kV，额定频率应为 50 Hz。')
    doc.save(root / 'parameters.docx')
    verify('parameters.docx', (root / 'parameters.docx').read_bytes(), 'paragraph')
    subprocess.run(['libreoffice', '-env:UserInstallation=file:///tmp/extraction-format-office',
        '--headless', '--convert-to', 'pdf', '--outdir', directory, str(root / 'parameters.docx')], check=True)
    verify('parameters.pdf', (root / 'parameters.pdf').read_bytes(), 'page')
    book = Workbook()
    sheet = book.active
    sheet.title = '设备参数'
    sheet.append(['额定电压', '10 kV'])
    sheet.append(['额定频率', '50 Hz'])
    book.save(root / 'parameters.xlsx')
    verify('parameters.xlsx', (root / 'parameters.xlsx').read_bytes(), 'sheet')
    image = Image.new('RGB', (800, 600), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 30)
    draw.text((60, 120), '额定电压应为 10 kV。', font=font, fill='black')
    image.save(root / 'scanned.pdf', 'PDF')
    scanned_kb = request('/knowledge-bases', {'name': '扫描件提取验收', 'config': dict(config,
        parser_engines={'pdf': 'paddleocr_vl'})})['id']
    records = verify('scanned.pdf', (root / 'scanned.pdf').read_bytes(), 'page', scanned_kb)
    check(all(r['validation']['status'] == 'needs_review' for r in records), '扫描区域定位保留待核验精度提示')
print('EXTRACTION_FORMATS_OK', flush=True)
