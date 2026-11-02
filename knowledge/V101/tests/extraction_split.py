"""Host-side split-service compatibility, concurrency and outage acceptance."""
import concurrent.futures
import io
import json
import subprocess
import time
import urllib.request
import urllib.error
import zipfile

from client import request, upload, wait_task, check, BASE

DIRECT = 'http://127.0.0.1:18082/api/v1'


def call(base, path, body=None, method=None, expected=200):
    headers = {}
    if body is not None:
        body = json.dumps(body, ensure_ascii=False).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as exc:
        response = exc
    value = json.load(response)
    assert response.status == expected, (path, response.status, value)
    return value.get('data', value.get('error'))


def fixture_metrics(path=''):
    script = "import urllib.request;print(urllib.request.urlopen('http://extraction-fixture:9000/metrics" + path + "').read().decode())"
    return json.loads(subprocess.check_output(['docker', 'compose', '-f', 'tests/compose.yaml', 'exec', '-T',
        'app', 'python3', '-c', script], text=True))


models = [request('/models', {'name': '双容器并发验收' + str(i), 'purpose': 'text',
    'base_url': 'http://extraction-fixture:9000', 'model_name': 'extraction-concurrency-' + str(i),
    'config': {'max_concurrency': 2}}) for i in range(3)]
kb = request('/knowledge-bases', {'name': '独立提取容器验收', 'config': {'wiki_enabled': False,
    'graph_enabled': False, 'outline_enabled': False, 'image_caption': False, 'image_embedding': False}})['id']
text = '\n\n'.join('# %d 技术要求\n第%d组额定电压应为 10 kV，额定频率应为 50 Hz。' % (i, i) for i in range(1, 31))
document = upload(kb, '双容器规范.md', text.encode())
wait_task(document['task_id'])
call(DIRECT, '/settings/extraction-defaults', {'model_id': models[0]['id']}, 'PUT')
assert request('/settings/extraction-defaults')['model_id'] == models[0]['id']
check(call(DIRECT, '/settings/extraction-defaults', {}, 'PUT')['model_id'] == models[0]['id'], '直连设置与旧入口行为一致')
fixture_metrics('/reset')
run = call(DIRECT, '/knowledge/' + document['knowledge_id'] + '/extractions', {}, 'POST', 202)
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    if fixture_metrics()['active']:
        break
    time.sleep(.1)
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(lambda i: request('/models/' + models[i % 3]['id'] + '/test', {}), range(12)))
wait_task(run['task_id'])
metrics = fixture_metrics()
check(3 <= metrics['peak'] <= 4 and max(metrics['peak_models'].values()) <= 2,
      ('双容器仍遵守总并发4、单模型并发2', metrics))
check(request('/extractions/' + run['run_id'])['records'] == 60, '直连创建经主系统模型网关完成提取')
for path in ['/extractions/' + run['run_id'] + '/records',
             '/extractions/' + run['run_id'] + '/coverage',
             '/knowledge/' + document['knowledge_id'] + '/extractions',
             '/knowledge/' + document['knowledge_id'] + '/extractions/sections',
             '/extractions/documents?knowledge_base_id=' + kb]:
    assert request(path) == call(DIRECT, path), path
check(True, '旧入口与新端口查询、章节、历史和覆盖一致')
call(DIRECT, '/tasks/' + document['task_id'], expected=404)
for path in ('/models', '/knowledge-bases', '/search'):
    try:
        urllib.request.urlopen(DIRECT + path)
        raise AssertionError('提取服务暴露其他模块：' + path)
    except urllib.error.HTTPError as error:
        assert error.code == 404
for base in (BASE, DIRECT):
    with urllib.request.urlopen(base + '/tasks/' + run['task_id'] + '/events', timeout=10) as response:
        assert response.readline().startswith(b'id:')
check(True, '两种入口的事件订阅保持同一任务记录')
workbooks = []
for base in (BASE, DIRECT):
    with urllib.request.urlopen(base + '/extractions/' + run['run_id'] + '/export.xlsx', timeout=30) as response:
        with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
            workbooks.append([archive.read('xl/worksheets/sheet%d.xml' % i) for i in range(1, 5)])
check(workbooks[0] == workbooks[1], '直连与转发 Excel 四张表内容一致')
call(BASE.removesuffix('/api/v1'), '/internal/extraction/model-completions', {}, 'POST', 403)
check(True, '内部模型接口拒绝未认证调用')
for action in ('cancel', 'retry'):
    if action == 'cancel':
        pending = call(DIRECT, '/knowledge/' + document['knowledge_id'] + '/extractions', {}, 'POST', 202)
    call(DIRECT, '/tasks/' + pending['task_id'] + '/' + action, {}, 'POST')
    if action == 'cancel':
        assert wait_task(pending['task_id'])['state'] == 'cancelled'
wait_task(pending['task_id'])
check(True, '直连取消与重试沿用已有任务语义')
subprocess.check_call(['docker', 'compose', '-f', 'tests/compose.yaml', 'stop', 'extraction'])
try:
    error = request('/extractions/documents', expected=503)
    assert error['code'] == 'EXTRACTION_UNAVAILABLE', error
    assert urllib.request.urlopen(BASE.removesuffix('/api/v1') + '/health/ready').status == 200
    another = upload(kb, '提取停机期间上传.md', '额定电压应为 10 kV。'.encode())
    wait_task(another['task_id'])
    check(bool(request('/knowledge/' + another['knowledge_id'])['current_parse_version_id']),
          '提取容器停止时主系统和上传解析仍正常')
finally:
    subprocess.check_call(['docker', 'compose', '-f', 'tests/compose.yaml', 'start', 'extraction'])
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    try:
        call(DIRECT, '/extractions/' + run['run_id'])
        break
    except Exception:
        time.sleep(.3)
else:
    raise AssertionError('提取容器未恢复')
check(True, '提取容器恢复后历史仍可查询')
print('EXTRACTION_SPLIT_OK', flush=True)
