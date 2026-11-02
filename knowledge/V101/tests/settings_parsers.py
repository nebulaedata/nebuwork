"""Run ONLY against compose.settings.yaml, with its explicit protocol fixture."""
from client import *
import subprocess

check(BASE=='http://127.0.0.1:19081/api/v1','使用隔离的配置验收服务')
request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':''}},method='PUT')
stamp=uuid.uuid4().hex[:8]
defaults=request('/settings/parser-defaults')
check(defaults['parser_engines']['pdf']=='paddleocr_vl','PDF 默认 PaddleOCR-VL')
for key in ['word','presentation','spreadsheet','epub','docm','odt','ods','odp','pptm','rtf','xlsm']:
    check(defaults['parser_engines'][key]=='anydoc',key+' 默认 anydoc')
check(defaults['parser_engines']['image']=='paddleocr_vl','图片默认 PaddleOCR-VL')
catalog=request('/parser-engines')
check(catalog['anydoc']['available'] and catalog['anydoc']['version']=='0.2.4','容器实际包含 anydoc 0.2.4')
keys=[f['key'] for f in catalog['formats']]
check('text' not in keys and 'media' not in keys and all(k in keys for k in ['txt','markdown','csv','epub','audio','video','html','htm']),'类型独立列出')
discovery=request('/models/discover',{'base_url':'http://model-fixture:9000','api_key':'fixture-secret'})
check(discovery['models']==['fixture-text','fixture-vision'] and discovery['base_url'].endswith('/v1'),'查询模型列表、去重并规范化基础地址')
models={}
for purpose in ['text','embedding','vision','asr','multimodal_embedding']:
    model=request('/models',{'name':'配置验收 '+purpose+' '+stamp,'purpose':purpose,'protocol':'jina' if purpose=='multimodal_embedding' else 'openai','base_url':'http://model-fixture:9000/v1','model_name':'fixture-'+purpose,'api_key':'fixture-secret','dimension':16 if 'embedding' in purpose else None})
    models[purpose]=model['id']
request('/settings/model-bindings',models,method='PUT')
saved=request('/models/discover',{'id':models['text'],'base_url':'http://model-fixture:9000/v1'})
check(saved['models']==discovery['models'] and 'api_key' not in saved,'编辑模型查询复用已加密密钥且不回显')
request('/models/discover',{'id':models['text'],'base_url':'http://different-service/v1'},expected=400)
request('/settings/parser-defaults',{'parser_engines':{'pdf':'invalid'}},method='PUT',expected=400)
request('/settings/parser-defaults',{'frame_interval_seconds':17,'image_instructions':'只描述设备铭牌 CONFIG_GLOBAL_'+stamp,'extract_config':{'tags':['概念'],'relations':['使用'],'custom_instructions':'CONFIG_GRAPH_'+stamp+' 只抽取有来源的关系'}},method='PUT')
check(request('/settings/media-defaults')['frame_interval_seconds']==17,'合并后的音视频设置与兼容接口一致')
kb=request('/knowledge-bases',{'name':'配置验收 '+stamp,'config':{'wiki_enabled':False}})
check(kb['config']['frame_interval_seconds']==17 and 'CONFIG_GLOBAL' in kb['config']['image_instructions'],'新知识库继承全局设置')
pending=upload(kb['id'],'sample.pdf',(Path(__file__).parent/'fixtures/sample.pdf').read_bytes())
task=wait_task(pending['task_id'])
check(task['state']=='waiting_configuration' and task['error']['code']=='PARSER_NOT_CONFIGURED','Paddle 未配置明确待配置，没有静默回退')
request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000','use_seal_recognition':True,'use_chart_recognition':False}},method='PUT')
request('/parser-engines/check',{})
task=wait_task(pending['task_id'])
assert task['state']=='succeeded',task
check(True,'保存解析服务后自动恢复任务')
chunks=request('/knowledge/'+pending['knowledge_id']+'/chunks?page_size=100')
sources=[request('/sources/'+c['source_ref_id']) for c in chunks]
check(any(s['content_origin']=='paddleocr_vl' and s['locators'][0].get('page')==1 and s['locators'][0].get('bbox') for s in sources),'Paddle 解析贯穿文件版本、原文页码和区域')
request('/knowledge-bases/'+kb['id'],{'name':kb['name'],'config':{'parser_engines':{'pdf':'native','image':'paddleocr_vl'},'image_instructions':'只描述铭牌 CONFIG_KB_'+stamp}},method='PUT')
persisted=request('/knowledge-bases/'+kb['id'])
check(persisted['config']['parser_engines']['pdf']=='native' and persisted['config']['parser_engines']['audio']=='simple' and persisted['config']['parser_engines']['video']=='simple','知识库覆盖指定引擎，同时保留其他类型')
request('/knowledge-bases/'+kb['id'],{'name':kb['name'],'config':{'parser_engines':{'word':'native','audio':'ffmpeg'}}},method='PUT')
for ext, expected in [('docx','native'),('epub','anydoc'),('odt','anydoc'),('mp3','ffmpeg'),('mp4','simple'),('csv','simple')]:
    resolved=request('/processing-config/resolve',{'knowledge_base_id':kb['id'],'file_type':ext})
    check(resolved['parser_engine']==expected,ext+' 独立选择和后端路由一致')
native=upload(kb['id'],'native.pdf',(Path(__file__).parent/'fixtures/sample.pdf').read_bytes())
check(wait_task(native['task_id'])['state']=='succeeded','知识库 PDF 引擎切换实际生效')
image=upload(kb['id'],'sample.png',(Path(__file__).parent/'fixtures/sample.png').read_bytes())
check(wait_task(image['task_id'])['state']=='succeeded','图片 Paddle OCR 与自定义内容理解执行成功')
raw=subprocess.check_output(['docker','compose','-f','tests/compose.yaml','-f','tests/compose.settings.yaml','exec','-T','model-fixture','python3','-c',"import urllib.request;print(urllib.request.urlopen('http://localhost:9000/observed').read().decode())"],text=True,encoding='utf-8')
prompts=[r['prompt'] for r in json.loads(raw)['requests'] if 'prompt' in r]
check(any('CONFIG_KB_'+stamp in p for p in prompts),'图片解析要求发送到实际模型请求')
check(any('CONFIG_GRAPH_'+stamp in p for p in prompts),'图谱抽取要求发送到实际模型请求')
schema=json.load(urllib.request.urlopen(BASE+'/openapi.json'))
check('/api/v1/models/discover' in schema['paths'],'OpenAPI 包含模型查询接口')
print('Settings/parser acceptance passed (protocol fixture; real OCR quality requires configured Paddle service).')
