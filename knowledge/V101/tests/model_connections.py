"""Run prepare on the previous image, then verify after upgrading the isolated app."""
from client import *
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

check(BASE == 'http://127.0.0.1:19081/api/v1', '仅在隔离环境执行服务连接验收')
report = Path(__file__).parent.parent / 'test-results/connection-upgrade.json'

def audit():
    raw = subprocess.check_output(['docker', 'compose', '-f', 'tests/compose.yaml', '-f', 'tests/compose.settings.yaml',
        'exec', '-T', 'model-fixture', 'python3', '-c',
        "import urllib.request;print(urllib.request.urlopen('http://localhost:9000/observed').read().decode())"], text=True, encoding='utf-8')
    return json.loads(raw)['requests']

def assert_key(key, path):
    entries = [entry for entry in audit() if entry.get('path') == path]
    expected = hashlib.sha256(('Bearer '+key if key else '').encode()).hexdigest()
    check(bool(entries) and entries[-1]['authorization_sha256'] == expected, '实际调用复用正确凭证：'+path)

def model(name, **overrides):
    return {'name': name, 'purpose': 'text', 'protocol': 'openai', 'model_name': 'fixture-text', 'config': {}, **overrides}

if len(sys.argv) > 1 and sys.argv[1] == 'prepare':
    legacy = []
    for i, key in enumerate(['legacy-one', 'legacy-two', '']):
        entry = request('/models', model('迁移样本 '+str(i), base_url='http://model-fixture:9000/v1', api_key=key))
        legacy.append({'id': entry['id'], 'key': key, 'base_url': entry['base_url'], 'name': entry['name']})
    report.write_text(json.dumps(legacy), encoding='utf-8')
    print('Legacy models seeded; rebuild and restart the isolated app before verification.')
    sys.exit()

legacy = json.loads(report.read_text(encoding='utf-8'))
connections = []
for entry in legacy:
    current = request('/models/'+entry['id'])
    check(current['name'] == entry['name'] and current['base_url'] == entry['base_url'], '迁移保留原模型及地址')
    check(current['connection_id'] and current['has_api_key'] == bool(entry['key']), '原密钥自动归入服务连接')
    connections.append(current['connection_id'])
    request('/models/'+entry['id']+'/test', {})
    assert_key(entry['key'], '/v1/chat/completions')
    request('/models/'+entry['id'], model(entry['name']+' 已编辑', base_url=entry['base_url']), method='PUT')
    check(request('/models/'+entry['id'])['connection_id'] == current['connection_id'], '旧客户端省略 connection_id 时保留引用')
check(len(set(connections)) == 3, '同地址的不同凭证不会合并错用')

shared = request('/model-connections', {'name': '共用服务', 'base_url': 'http://model-fixture:9000', 'api_key': 'shared-one'})
check(shared['base_url'].endswith('/v1') and shared['has_api_key'] and 'api_key' not in shared, '连接地址规范化且密钥不回显')
a = request('/models', model('共用模型 A', connection_id=shared['id']))
b = request('/models', model('共用模型 B', connection_id=shared['id']))
check(a['has_api_key'] and b['has_api_key'] and 'api_key' not in a, '添加多个模型时只需选择连接')
request('/models/discover', {'connection_id': shared['id'], 'base_url': 'http://unrelated-service.invalid/v1'})
assert_key('shared-one', '/v1/models')
request('/models/test', model('未保存模型', connection_id=shared['id']))
assert_key('shared-one', '/v1/chat/completions')
request('/models/'+b['id']+'/test', {})
assert_key('shared-one', '/v1/chat/completions')
request('/models', model('混合凭证拒绝', connection_id=shared['id'], api_key='other'), expected=400)
request('/model-connections/'+shared['id'], method='DELETE', expected=409)

request('/model-connections/'+shared['id'], {'name': '共用服务已更新', 'base_url': shared['base_url'], 'api_key': 'shared-two'}, method='PUT')
for item in [a, b]:
    request('/models/'+item['id']+'/test', {})
    assert_key('shared-two', '/v1/chat/completions')
check(request('/model-connections/'+shared['id'])['model_count'] == 2, '连接引用计数准确')
request('/model-connections/'+shared['id'], {'name': '新地址', 'base_url': 'http://model-fixture:9000/second/v1'}, method='PUT', expected=400)
request('/model-connections/'+shared['id'], {'name': '新地址', 'base_url': 'http://model-fixture:9000/second/v1', 'api_key': 'shared-three'}, method='PUT')
request('/models/'+a['id']+'/test', {})
assert_key('shared-three', '/second/v1/chat/completions')
check(request('/models/'+b['id'])['base_url'].endswith('/second/v1'), '编辑连接地址同步用于关联模型')

request('/settings/model-bindings', {'text': a['id']}, method='PUT')
kb = request('/knowledge-bases', {'name': '模型用途修改验收'})
changed = request('/models/'+a['id'], model('共用模型 A', connection_id=shared['id'], purpose='vision'), method='PUT')
check(changed['purpose'] == 'vision' and changed['purpose_changed'], '已有模型用途可修改')
check(request('/settings/model-bindings').get('text') != a['id'], '旧默认用途绑定已清理')
check(request('/knowledge-bases/'+kb['id'])['config']['model_bindings'].get('text') != a['id'], '旧知识库用途绑定已清理')
check(request('/settings/model-bindings').get('vision') != a['id'], '未自动占用新用途绑定')
request('/settings/model-bindings', {'vision': a['id']}, method='PUT')
request('/settings/model-bindings', {'text': a['id']}, method='PUT', expected=400)
request('/models/'+a['id'], model('错误用途', connection_id=shared['id'], purpose='invalid'), method='PUT', expected=400)
check(request('/models/'+a['id'])['purpose'] == 'vision', '无效编辑回滚且不破坏原模型')

request('/model-connections/'+shared['id'], {'name': '无凭证连接', 'base_url': 'http://model-fixture:9000/second/v1', 'clear_api_key': True}, method='PUT')
request('/models/'+b['id']+'/test', {})
assert_key('', '/second/v1/chat/completions')
check(not request('/models/'+b['id'])['has_api_key'], '清除 Key 同步生效且不回退到旧模型密钥')
unused = request('/model-connections', {'name': '可删除连接', 'base_url': 'http://model-fixture:9000/v1'})
request('/model-connections/'+unused['id'], method='DELETE')
request('/model-connections/'+unused['id'], expected=404)
schema = json.load(urllib.request.urlopen(BASE+'/openapi.json'))
check('/api/v1/model-connections' in schema['paths'], '服务连接接口进入 OpenAPI')
barrier = Barrier(24)
def concurrent_create(i):
    barrier.wait(timeout=10)
    return request('/models', model('并发连接引用 '+str(i), connection_id=shared['id']))
with ThreadPoolExecutor(max_workers=24) as executor:
    batch = list(executor.map(concurrent_create, range(24)))
check(len(batch) == 24 and all(m['connection_id'] == shared['id'] for m in batch), '超过数据库连接池大小的并发建模不会阻塞')
print('Connection migration, credential reuse and editable model purposes passed.')
