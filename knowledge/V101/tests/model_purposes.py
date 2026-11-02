"""Text/outline binding compatibility, verified against isolated model requests."""
from client import *
import subprocess

check(BASE=='http://127.0.0.1:19081/api/v1','使用隔离的模型用途兼容验收环境')
connection=request('/model-connections',{'name':'用途混用验收','base_url':'http://model-fixture:9000/v1'})
def make(purpose):
    return request('/models',{'name':'混用验收 · '+purpose,'purpose':purpose,'protocol':'openai','connection_id':connection['id'],'model_name':'fixture-'+purpose,'dimension':16 if purpose=='embedding' else None})
text=make('text')
outline=make('outline')
embedding=make('embedding')
vision=make('vision')
def bind(text_id,outline_id,embedding_id=embedding['id']):
    return request('/settings/model-bindings',{'text':text_id,'outline':outline_id,'embedding':embedding_id},method='PUT')
def audit():
    raw=subprocess.check_output(['docker','compose','-f','tests/compose.yaml','-f','tests/compose.settings.yaml','exec','-T','model-fixture','python3','-c',"import urllib.request;print(urllib.request.urlopen('http://localhost:9000/observed').read().decode())"],text=True,encoding='utf-8')
    return [x for x in json.loads(raw)['requests'] if 'prompt' in x]
def library(name):
    return request('/knowledge-bases',{'name':name,'config':{'image_caption':False,'image_embedding':False,'graph_enabled':False}})
def ingest(kb,tag):
    return upload(kb['id'],tag+'.txt',('NebulaeKno 使用数据库保存知识资料。'+tag).encode())
def assert_usage(entries,text_model,outline_model):
    check(any(x['model']==text_model and '"pages"' in x['prompt'] for x in entries),'实际 Wiki 文本生成调用绑定模型 '+text_model)
    check(any(x['model']==outline_model and '"headings"' in x['prompt'] for x in entries),'实际目录提取调用绑定模型 '+outline_model)

bindings=bind(outline['id'],text['id'])
check(bindings['text']==outline['id'] and bindings['outline']==text['id'],'两个用途可以交叉绑定')
kb=library('交叉绑定运行验收')
before=len(audit())
doc=ingest(kb,'cross')
task=wait_task(doc['task_id'])
check(task['state']=='succeeded', '交叉绑定的完整入库任务成功：'+str(task.get('error')))
assert_usage(audit()[before:],'fixture-outline','fixture-text')

bind(outline['id'],outline['id'])
kb_same=library('同一目录模型用于两种用途')
before=len(audit())
same=ingest(kb_same,'same')
check(wait_task(same['task_id'])['state']=='succeeded','同一目录模型可同时执行两种用途')
assert_usage(audit()[before:],'fixture-outline','fixture-outline')

bind(text['id'],None)
kb_fallback=library('目录留空继承文本生成')
before=len(audit())
fallback=ingest(kb_fallback,'fallback')
check(wait_task(fallback['task_id'])['state']=='succeeded','目录留空继承规则保持可用')
assert_usage(audit()[before:],'fixture-text','fixture-text')

for role in ['text','outline']:
    request('/settings/model-bindings',{role:vision['id']},method='PUT',expected=400)
request('/settings/model-bindings',{'embedding':outline['id']},method='PUT',expected=400)
request('/settings/model-bindings',{'text':str(uuid.uuid4())},method='PUT',expected=400)
check(request('/settings/model-bindings')['text']==text['id'],'不兼容用途和不存在模型仍拒绝，且保留原绑定')

bind(text['id'],text['id'],None)
kb_pending=library('兼容用途切换与任务恢复')
pending=ingest(kb_pending,'pending')
check(wait_task(pending['task_id'])['state']=='waiting_configuration','准备缺少向量模型的未完成任务')
def change(purpose):
    request('/models/'+text['id'],{'name':text['name'],'purpose':purpose,'protocol':'openai','connection_id':connection['id'],'model_name':text['model_name'],'config':{}},method='PUT')
def assert_bindings_preserved():
    values=[request('/settings/model-bindings'),request('/knowledge-bases/'+kb_pending['id'])['config']['model_bindings'],request('/tasks/'+pending['task_id'])['config']['model_bindings']]
    check(all(v.get('text')==text['id'] and v.get('outline')==text['id'] for v in values),'兼容用途切换保留全局、知识库与任务的双用途绑定')
change('outline')
assert_bindings_preserved()
bind(text['id'],text['id'])
check(wait_task(pending['task_id'])['state']=='succeeded','配置恢复后任务保留兼容快照并继续成功')
change('text')
assert_bindings_preserved()
change('vision')
for value in [request('/settings/model-bindings'),request('/knowledge-bases/'+kb_pending['id'])['config']['model_bindings']]:
    check(value.get('text')!=text['id'] and value.get('outline')!=text['id'],'切换为不兼容用途仍清理两种绑定')
change('text')
bind(outline['id'],text['id'])
print('Bidirectional model binding, runtime use, fallback and purpose-change checks passed.')
