"""AI configuration drafts: only run against the isolated protocol fixture."""
from client import *
import subprocess

check(BASE == 'http://127.0.0.1:19081/api/v1', '使用隔离配置验收环境')
path = '/processing-config/suggest'
before = request('/settings/parser-defaults')
request('/settings/model-bindings', {'text': ''}, method='PUT')
check(request(path, {'kind': 'image', 'context': '设备图片'}, expected=422)['code'] == 'MODEL_NOT_CONFIGURED', '模型未绑定明确报错')
for body in [{}, {'kind': 'unknown', 'context': '测试'}, {'kind': 'graph', 'context': ' '},
             {'kind': 'image', 'context': '中'*4001}, {'kind': 'image', 'context': '测试', 'current': {'graph_enabled': False}}]:
    request(path, body, expected=400)

def model(name, purpose='text'):
    return request('/models', {'name': name, 'purpose': purpose, 'protocol': 'openai',
                              'base_url': 'http://model-fixture:9000/v1', 'model_name': name,
                              'api_key': 'fixture-secret'})

text = model('fixture-suggestion')
request('/settings/model-bindings', {'text': text['id']}, method='PUT')
image = request(path, {'kind': 'image', 'context': '设备图片，突出铭牌参数',
                      'current': {'image_instructions': '保留来源 SUGGEST_CURRENT_IMAGE'}})
check(image['suggestion']['image_instructions'] and image['saved'] is False, '图片要求通过实际模型协议生成，返回草稿')
graph = request(path, {'kind': 'graph', 'context': '设备项目关系', 'current': {'extract_config': {'tags': []}}})
check(set(graph['suggestion']['extract_config']) == {'tags','relations','custom_instructions','text'}, '图谱生成四项要求')
check(graph['suggestion']['extract_config']['text'].startswith('【虚构示例'), '示例标记为虚构')
check(request('/settings/parser-defaults') == before, '生成不会自动保存配置')

outline = model('fixture-outline-suggestion', 'outline')
kb = request('/knowledge-bases', {'name': 'AI 建议隔离验收', 'config': {'model_bindings': {'text': outline['id']}}})
overridden = request(path, {'kind': 'graph', 'context': '知识库局部要求', 'knowledge_base_id': kb['id']})
check(overridden['model']['id'] == outline['id'], '知识库使用自己的文本用途绑定，兼容目录核验类型模型')
check(request('/knowledge-bases/'+kb['id']) == kb, '生成不修改知识库')
request(path, {'kind': 'image', 'context': '测试', 'knowledge_base_id': str(uuid.uuid4())}, expected=404)
request(path, {'kind': 'image', 'context': '测试', 'knowledge_base_id': 'invalid'}, expected=400)

for name, code in [('fixture-invalid-suggestion','MODEL_RESPONSE_INVALID'),
                   ('fixture-nonjson-suggestion','MODEL_RESPONSE_INVALID'),
                   ('fixture-failure-suggestion','MODEL_REQUEST_FAILED')]:
    broken = model(name)
    request('/settings/model-bindings', {'text': broken['id']}, method='PUT')
    check(request(path, {'kind': 'image', 'context': '测试'}, expected=502)['code'] == code, '错误结果不伪装成功: '+name)
request('/settings/model-bindings', {'text': text['id']}, method='PUT')
check(request('/settings/parser-defaults') == before, '失败后原设置仍保持不变')

raw = subprocess.check_output(['docker','compose','-f','tests/compose.yaml','-f','tests/compose.settings.yaml',
    'exec','-T','model-fixture','python3','-c', "import urllib.request;print(urllib.request.urlopen('http://localhost:9000/observed').read().decode())"], text=True, encoding='utf-8')
observed = json.loads(raw)['requests']
check(any('SUGGEST_CURRENT_IMAGE' in r.get('prompt','') for r in observed), '当前填写内容被传入生成请求')
check(any(r.get('authorization_sha256') == hashlib.sha256(b'Bearer fixture-secret').hexdigest() for r in observed), '凭证通过后端传递给配置的模型服务')
check('api_key' not in json.dumps(image), '响应不包含模型凭证')
schema = json.load(urllib.request.urlopen(BASE+'/openapi.json'))
check('/api/v1'+path in schema['paths'], 'OpenAPI 包含生成接口')
Path('test-results/suggestion-test-models.json').write_text(json.dumps({'text':text['id'],'knowledge_base_id':kb['id']}),encoding='utf-8')
print('AI suggestion acceptance passed; protocol fixture validates behavior, not real model quality.')
