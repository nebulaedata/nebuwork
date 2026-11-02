"""Image capability acceptance using only the isolated protocol fixture."""
from client import *
import subprocess

check(BASE == 'http://127.0.0.1:19081/api/v1', '使用隔离的模型图片输入验收环境')
connection = request('/model-connections', {'name': '图片输入验收连接', 'base_url': 'http://model-fixture:9000/v1'})
def model(name, config=None, purpose='text'):
    return {'name':name, 'purpose':purpose, 'protocol':'openai', 'connection_id':connection['id'], 'model_name':'fixture-text', 'config':config or {}}
def observed_images():
    raw = subprocess.check_output(['docker','compose','-f','tests/compose.yaml','-f','tests/compose.settings.yaml','exec','-T','model-fixture','python3','-c',"import urllib.request;print(urllib.request.urlopen('http://localhost:9000/observed').read().decode())"],text=True,encoding='utf-8')
    return [r for r in json.loads(raw)['requests'] if r.get('image_count',0) > 0]

entry=request('/models',model('文字模型图片开关验收'))
check(entry['config']['allow_image_input'] is False, '新文本模型默认关闭图片输入')
body,headers=multipart('sample.png',(Path(__file__).parent/'fixtures/sample.png').read_bytes())
before=len(observed_images())
error=request('/models/'+entry['id']+'/test-file',body,headers=headers,expected=422)
check(error['code']=='IMAGE_INPUT_DISABLED' and len(observed_images())==before, '关闭时拒绝图片且不向上游发送')
check(request('/models/'+entry['id']+'/test',{})['tested']=='text_generation','关闭图片仍可使用文字生成')
for bad in ['true',1,None]:
    request('/models/'+entry['id'],model('无效开关',{'allow_image_input':bad}),method='PUT',expected=400)
enabled=request('/models/'+entry['id'],model('文字模型图片开关验收',{'allow_image_input':True,'timeout_seconds':45,'max_concurrency':3}),method='PUT')
check(enabled['config']['allow_image_input'] is True and enabled['purpose']=='text','开启后仍保持文本用途')
saved=request('/models/'+entry['id'])
listed=next(m for m in request('/models') if m['id']==entry['id'])
check(saved['config']==enabled['config'] and listed['config']==enabled['config'],'详情和列表持久化回显图片开关及其他配置')
result=request('/models/'+entry['id']+'/test-file',body,headers=headers)
check(result['tested']=='vision_image_input' and len(observed_images())==before+1,'开启后实际发送图片内容并取得响应')
check(request('/models/'+entry['id']+'/test',{})['tested']=='text_generation','开启图片仍可独立测试文字')
request('/models/'+entry['id'],model('文字模型图片开关验收',{'allow_image_input':False}),method='PUT')
before=len(observed_images())
request('/models/'+entry['id']+'/test-file',body,headers=headers,expected=422)
check(len(observed_images())==before,'再次关闭立即阻止图片请求')
vision=request('/models',model('原视觉模型回归',purpose='vision'))
check(request('/models/'+vision['id']+'/test-file',body,headers=headers)['tested']=='vision_image_input','视觉用途图片输入保持可用')
changed=request('/models/'+entry['id'],model('用途切换验收',{'allow_image_input':True},purpose='outline'),method='PUT')
check('allow_image_input' not in changed['config'],'切换到其他用途清除文本图片开关')
schema=json.load(urllib.request.urlopen(BASE+'/openapi.json'))
flag=schema['components']['schemas']['ModelInput']['properties']['config']['properties']['allow_image_input']
check(flag['type']=='boolean' and flag['default'] is False,'OpenAPI 包含布尔开关及默认值')
# Leave distinct on/off samples for visual verification, isolated from development data.
request('/models',model('文本生成 · 允许图片',{'allow_image_input':True}))
request('/models',model('文本生成 · 仅文本'))
print('Image input setting, runtime enforcement and sample tests passed.')
