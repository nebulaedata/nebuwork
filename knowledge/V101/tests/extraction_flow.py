"""Full extraction API/source/export lifecycle against isolated test services."""
import io
import time
import urllib.request
import zipfile
from client import request, upload, wait_task, check, BASE


request('/settings/extraction-defaults', {'model_id': ''}, 'PUT')
kb = request('/knowledge-bases', {'name': '条款参数提取验收', 'config': {
    'wiki_enabled': False, 'graph_enabled': False, 'outline_enabled': False,
    'image_caption': False, 'image_embedding': False}})['id']
text = '# 1 范围\n本规范适用于配电设备。\n\n# 2 技术要求\n额定电压应为 10 kV，额定频率应为 50 Hz。\n\n# 3 交付要求\n设备应提供出厂试验报告。'
uploaded = upload(kb, '配电设备规范.md', text.encode())
doc = uploaded['knowledge_id']
processing = wait_task(uploaded['task_id'])
parse = request('/knowledge/' + doc)['current_parse_version_id']
check(bool(parse), '解析完成即可提取，独立于其他阶段状态')
check(not request('/knowledge/' + doc + '/extractions'), '上传与数据处理不自动提取')
request('/knowledge/' + doc + '/extractions', {'section_ids': ['不存在']}, expected=400)
sections = request('/knowledge/' + doc + '/extractions/sections')
check({'1', '2', '3'} <= {s['id'] for s in sections}, '从已有解析内容读取章节')
created = request('/knowledge/' + doc + '/extractions', {}, expected=202)
check(wait_task(created['task_id'])['state'] == 'waiting_configuration', '缺少模型时独立等待配置')
request('/knowledge/' + doc + '/extractions', {}, expected=409)
model = request('/models', {'name': '提取协议测试', 'purpose': 'text', 'protocol': 'openai',
    'base_url': 'http://extraction-fixture:9000', 'model_name': 'extraction-fixture', 'config': {}})
request('/settings/extraction-defaults', {'model_id': model['id']}, 'PUT')
task = wait_task(created['task_id'])
check(task['state'] in ('succeeded', 'partially_failed'), ('提取完成', task))
run = request('/extractions/' + created['run_id'])
records = request('/extractions/' + created['run_id'] + '/records?page_size=100')
check(len(records) >= 3 and run['records'] == len(records), '六字段参数与文字要求入库')
check(any(r['subject'] == '额定电压' for r in records) and any(r['subject'] == '额定频率' for r in records), '同一条款拆出两个技术参数')
for record in records:
    check(record['source']['parse_version_id'] == parse, '结果绑定解析版本')
    for evidence in record['source']['evidence']:
        for ref in evidence['source_refs']:
            source = request('/sources/' + ref['source_ref_id'])
            assert source['parse_version_id'] == parse and source['preview_url'] == ref['preview_url']
            assert evidence['quote'] in source['quote']
check(bool(request('/extractions/documents?knowledge_base_id=' + kb)), '独立工作台按知识库查询')
request('/knowledge/' + doc + '/extractions', {'section_ids': ['2']}, expected=202)
history = request('/knowledge/' + doc + '/extractions')
selected = history[0]
wait_task(selected['task_id'])
selected_records = request('/extractions/' + selected['id'] + '/records?page_size=100')
check(len(selected_records) == 2, '章节范围不泄漏其他章节条款')
check(len(request('/knowledge/' + doc + '/extractions')) == 2, '重新提取保留历史结果')
with urllib.request.urlopen(BASE + '/extractions/' + created['run_id'] + '/export.xlsx') as response:
    workbook = response.read()
with zipfile.ZipFile(io.BytesIO(workbook)) as archive:
    xml = archive.read('xl/workbook.xml').decode()
    check(all(name in xml for name in ('规范条款', '待核验', '覆盖与问题', '说明')), 'Excel 导出包含四张表')
before = request('/knowledge/' + doc)['status']
slow = request('/models', {'name': '取消测试', 'purpose': 'text', 'protocol': 'openai',
    'base_url': 'http://extraction-fixture:9000', 'model_name': 'extraction-slow', 'config': {}})
cancelled = request('/knowledge/' + doc + '/extractions', {'model_id': slow['id']}, expected=202)
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    if request('/tasks/' + cancelled['task_id'])['state'] == 'running':
        break
    time.sleep(.3)
request('/tasks/' + cancelled['task_id'] + '/cancel', {})
cancelled_task = wait_task(cancelled['task_id'])
check(cancelled_task['state'] == 'cancelled', '提取支持取消')
check(not cancelled_task['checkpoint'].get('extraction', {}).get('active_blocks'), '取消后不再显示活动分块')
check(request('/knowledge/' + doc)['status'] == before, '提取状态不修改数据处理状态')
wait_task(uploaded['task_id'])
reparse = request('/knowledge/' + doc + '/reparse', {}, expected=202)
wait_task(reparse['task_id'])
check(request('/extractions/' + created['run_id'])['historical'], '重解析后历史结果提示版本差异')
for record in records:
    for evidence in record['source']['evidence']:
        for ref in evidence['source_refs']:
            assert request('/sources/' + ref['source_ref_id'])['parse_version_id'] == parse
check(True, '历史引用仍定位原始解析版本')
print('EXTRACTION_FLOW_OK', flush=True)
