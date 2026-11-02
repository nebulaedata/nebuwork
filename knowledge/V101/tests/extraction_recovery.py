"""Run on the host; restart only the specified app/extraction test service."""
import json
import subprocess
import sys
import time
from client import request, upload, wait_task, check


def sql(query):
    return subprocess.check_output(['docker', 'compose', '-f', 'tests/compose.yaml', 'exec', '-T', 'postgres',
        'psql', '-U', 'nebulaekno', '-d', 'nebulaekno', '-At', '-c',
        'SET search_path=nebulaekno,public; ' + query], text=True).strip().splitlines()[-1]


model = request('/models', {'name': '重启协议验收', 'purpose': 'text', 'base_url': 'http://extraction-fixture:9000',
    'model_name': 'extraction-slow', 'config': {}})
kb = request('/knowledge-bases', {'name': '提取恢复验收', 'config': {'wiki_enabled': False,
    'graph_enabled': False, 'outline_enabled': False, 'image_caption': False, 'image_embedding': False}})['id']
text = '\n\n'.join('# %d 技术要求\n第%d组额定电压应为 10 kV，额定频率应为 50 Hz。' % (i, i) for i in range(1, 31))
document = upload(kb, '重启恢复规范.md', text.encode())
wait_task(document['task_id'])
run = request('/knowledge/' + document['knowledge_id'] + '/extractions', {'model_id': model['id']}, expected=202)
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    status = request('/extractions/' + run['run_id'])
    if status['completed_blocks'] >= 1 and status['completed_blocks'] < status['blocks']:
        break
    time.sleep(.4)
else:
    raise AssertionError(('没有观察到可恢复的部分完成状态', status))
completed = json.loads(sql("SELECT coalesce(json_agg(block_id),'[]') FROM extraction_blocks WHERE run_id='%s' AND state='succeeded'" % run['run_id']))
before = sql("SELECT md5(string_agg(data::text,'' ORDER BY id)) FROM extraction_records WHERE run_id='%s'" % run['run_id'])
old_trace = request('/tasks/' + run['task_id'])['checkpoint'].get('pipeline')
check(bool(completed) and bool(before), '重启前已有分块与条款持久化')
target = sys.argv[1] if len(sys.argv) > 1 else 'app'
assert target in ('app', 'extraction')
subprocess.check_call(['docker', 'compose', '-f', 'tests/compose.yaml', 'restart', target])
deadline = time.monotonic() + 150
while time.monotonic() < deadline:
    try:
        result = request('/tasks/' + run['task_id'])
        if result['state'] not in ('queued', 'running'):
            break
    except Exception:
        pass
    time.sleep(.5)
check(result['state'] in ('succeeded', 'partially_failed'), ('重启后续跑完成', result['state']))
after = request('/extractions/' + run['run_id'])
check(after['completed_blocks'] == after['blocks'], '恢复后分块全部完成')
check(after['records'] == 60, '已保存分块不重复入库')
if old_trace:
    trace = result['checkpoint']['pipeline']
    check(trace['run_id'] != old_trace['run_id'] and trace['attempt'] > old_trace['attempt'], '重启恢复使用独立执行计时')
    check(result['checkpoint']['extraction']['reused_blocks'] >= len([b for b in completed if ':' not in b]), '恢复进度标记已复用成功分块')
check(int(sql("SELECT count(*) FROM extraction_blocks WHERE run_id='%s' AND block_id IN (%s) AND state='succeeded'" %
    (run['run_id'], ','.join("'" + b + "'" for b in completed)))) == len(completed), '重启保留成功分块检查点')
print('EXTRACTION_RECOVERY_OK', flush=True)
