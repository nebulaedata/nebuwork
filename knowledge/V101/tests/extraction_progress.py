"""Real progress observations against the isolated extraction fixture."""
import json
import time
import urllib.request
from client import request, upload, wait_task, check, BASE

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Use isolated config test stack'
kb = request('/knowledge-bases', {'name': '参数提取流水线验收', 'config': {
    'wiki_enabled': False, 'graph_enabled': False, 'outline_enabled': False,
    'image_caption': False, 'image_embedding': False}})['id']
text = '\n\n'.join('# %d 技术要求\n第%d组额定电压应为 10 kV，额定频率应为 50 Hz。' % (i, i) for i in range(1, 31))
doc = upload(kb, '流水线规范.md', text.encode())
wait_task(doc['task_id'])
check(not request('/knowledge/' + doc['knowledge_id'] + '/extractions'), '数据处理不自动触发提取')
model = request('/models', {'name': '流水线慢模型', 'purpose': 'text', 'base_url': 'http://extraction-fixture:9000', 'model_name': 'extraction-slow', 'config': {}})
run = request('/knowledge/' + doc['knowledge_id'] + '/extractions', {'model_id': model['id']}, expected=202)
observed = []
deadline = time.monotonic() + 150
while time.monotonic() < deadline:
    task = request('/tasks/' + run['task_id'])
    p = task['checkpoint'].get('extraction', {})
    if p:
        observed.append(p)
        assert p['completed_blocks'] <= p['total_blocks'], p
        assert len(p['active_blocks']) <= 2, p
    if task['state'] not in ('running', 'queued'):
        break
    time.sleep(.25)
check(task['state'] in ('succeeded', 'partially_failed'), '提取流水线完成')
check(any(len(p['active_blocks']) == 2 for p in observed), '运行期间观察到两个真实并行分块')
check(any(0 < p['completed_blocks'] < p['total_blocks'] for p in observed), '完成分块后实时更新进度')
pipeline = task['checkpoint']['pipeline']
check([s['name'] for s in pipeline['stages']] == ['extraction_source', 'extraction_plan', 'extraction_blocks', 'extraction_save'], '记录四个真实执行阶段')
assert pipeline['status'] == task['state'] and pipeline['finished_at']
for span in pipeline['stages']:
    assert span['finished_at'] >= span['started_at'] and span['status'] != 'running', span
final = request('/extractions/' + run['run_id'])
p = task['checkpoint']['extraction']
check(p['records'] == final['records'] == 60 and p['completed_blocks'] == p['total_blocks'], '计数与持久化结果一致，不重复累计')
direct = json.load(urllib.request.urlopen('http://127.0.0.1:18082/api/v1/tasks/' + run['task_id']))['data']
check(direct['checkpoint'] == task['checkpoint'], '原地址与独立服务返回相同进度')
with urllib.request.urlopen(BASE + '/tasks/' + run['task_id'] + '/events?last_event_id=0', timeout=8) as stream:
    for _ in range(100):
        line = stream.readline().decode()
        if line.startswith('data: ') and json.loads(line[6:]).get('progress'):
            break
    else:
        raise AssertionError('SSE progress missing')
check(True, 'SSE 可续接提取进度事件')
print('EXTRACTION_PROGRESS_OK', flush=True)
