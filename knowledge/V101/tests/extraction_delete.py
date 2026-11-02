"""Deleting a document cancels extraction before removing its independent data."""
import time
from client import request, upload, wait_task, check

kb = request('/knowledge-bases', {'name': '提取删除验收', 'config': {
    'wiki_enabled': False, 'graph_enabled': False, 'outline_enabled': False,
    'image_caption': False, 'image_embedding': False}})['id']
doc = upload(kb, '删除测试.md', b'# Test\nRated voltage should be 10 kV.')
wait_task(doc['task_id'])
model = request('/models', {'name': '删除测试慢模型', 'purpose': 'text', 'base_url': 'http://extraction-fixture:9000',
    'model_name': 'extraction-slow', 'config': {}})
run = request('/knowledge/' + doc['knowledge_id'] + '/extractions', {'model_id': model['id']}, expected=202)
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    if request('/tasks/' + run['task_id'])['state'] == 'running':
        break
    time.sleep(.3)
deleted = request('/knowledge/' + doc['knowledge_id'], method='DELETE', expected=202)
result = wait_task(deleted['task_id'])
check(result['state'] == 'succeeded', '删除等待提取停止后完成')
request('/extractions/' + run['run_id'], expected=404)
check(wait_task(run['task_id'])['state'] == 'cancelled', '提取任务取消历史保留，关联运行已清理')
print('EXTRACTION_DELETE_OK', flush=True)
