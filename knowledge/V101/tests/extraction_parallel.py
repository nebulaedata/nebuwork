"""Extraction finishes while the same document is still generating Wiki."""
import time
from client import request, upload, wait_task, check

wiki = request('/models', {'name': '并行数据处理模型', 'purpose': 'text', 'base_url': 'http://model-fixture:9000',
    'model_name': 'fixture-wiki-pause', 'config': {}})
embedding = request('/models', {'name': '并行向量模型', 'purpose': 'embedding', 'base_url': 'http://model-fixture:9000',
    'model_name': 'fixture-embedding', 'dimension': 16, 'config': {}})
extraction = request('/models', {'name': '并行提取模型', 'purpose': 'text', 'base_url': 'http://extraction-fixture:9000',
    'model_name': 'extraction-fixture', 'config': {}})
kb = request('/knowledge-bases', {'name': '数据处理与提取并行验收', 'config': {'wiki_enabled': True,
    'graph_enabled': False, 'outline_enabled': False, 'image_caption': False, 'image_embedding': False,
    'model_bindings': {'text': wiki['id'], 'embedding': embedding['id']}}})['id']
text = '\n\n'.join('第%d段，额定电压应为 10 kV。%s' % (i, '设备使用数据库管理技术资料。' * 30) for i in range(45))
document = upload(kb, '并行处理规范.md', text.encode())
deadline = time.monotonic() + 100
while time.monotonic() < deadline:
    processing = request('/tasks/' + document['task_id'])
    if processing['state'] == 'running' and processing['stage'] == 'wiki':
        break
    time.sleep(.2)
else:
    raise AssertionError(('未观察到 Wiki 处理中', processing))
run = request('/knowledge/' + document['knowledge_id'] + '/extractions', {'model_id': extraction['id']}, expected=202)
deadline = time.monotonic() + 100
while time.monotonic() < deadline:
    result = request('/tasks/' + run['task_id'])
    if result['state'] not in ('queued', 'running'):
        break
    time.sleep(.2)
processing = request('/tasks/' + document['task_id'])
check(result['state'] in ('succeeded', 'partially_failed'), 'Wiki 处理期间独立完成参数提取')
check(processing['state'] == 'running', '提取完成时原数据处理任务仍在运行')
check(request('/knowledge/' + document['knowledge_id'])['status'] == 'processing', '提取没有覆盖文档数据处理状态')
check(wait_task(document['task_id'])['state'] == 'succeeded', '原数据处理流程正常完成')
print('EXTRACTION_PARALLEL_OK', flush=True)
