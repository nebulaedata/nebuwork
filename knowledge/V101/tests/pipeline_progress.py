"""End-to-end progress acceptance against isolated infrastructure only."""
from client import *
import io
import threading
from pypdf import PdfWriter

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Use isolated settings test stack'
stamp=uuid.uuid4().hex[:8]
models={}
for purpose in ['text','embedding']:
    model=request('/models',dict(name='流水线验收 '+purpose+' '+stamp,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,dimension=16 if purpose=='embedding' else None))
    models[purpose]=model['id']
request('/settings/model-bindings',models,method='PUT')
request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000/progress','use_seal_recognition':True,'use_chart_recognition':False}},method='PUT')
kb=request('/knowledge-bases',{'name':'实时流水线验收 '+stamp,'config':{'image_caption':False,'image_embedding':False,'wiki_enabled':True,'graph_enabled':False}})['id']

def validate(task):
    pipeline=task['checkpoint']['pipeline']
    assert pipeline['finished_at'] and pipeline['status']==task['state'],task
    assert all(s['status']!='running' and s.get('finished_at') for s in pipeline['stages']),pipeline
    for s in pipeline['stages']:
        assert s['finished_at']>=s['started_at'],s
        for c in s.get('children',[]):
            assert c['status']!='running' and c.get('finished_at'),c
            p=c.get('progress',{})
            assert p.get('completed',0)<=p.get('total',0) or not p.get('total'),p
    return pipeline

def pdf(pages):
    writer=PdfWriter()
    for _ in range(pages):writer.add_blank_page(width=300,height=400)
    out=io.BytesIO();writer.write(out);return out.getvalue()

doc=upload(kb,'PDF 实时进度验收.pdf',pdf(4))
observed=[]
deadline=time.monotonic()+120
while time.monotonic()<deadline:
    task=request('/tasks/'+doc['task_id'])
    parse=next((s for s in task['checkpoint'].get('pipeline',{}).get('stages',[]) if s['name']=='parse'),{})
    phase=next((s for s in parse.get('children',[]) if s['name']=='paddle_pages'),{})
    if phase.get('progress'):
        observed.append(phase['progress'])
        if phase['status']=='running': assert request('/knowledge/'+doc['knowledge_id'])['status']=='processing'
    if task['state'] not in ('queued','running'):break
    time.sleep(.25)
assert task['state']=='succeeded',task
trace=validate(task)
check(len({p.get('current') for p in observed})>=3 and any(p['completed']<p['total'] for p in observed),'PDF 运行期间逐页上报，读取到至少三个不同页码')
check(observed[-1]['completed']==observed[-1]['total']==4,'PDF 完成计数准确')
check(task['last_event_id']>0 and task['server_time'],'任务快照提供事件续接位置和服务端时间')
events=urllib.request.urlopen(BASE+'/tasks/'+doc['task_id']+'/events?last_event_id=0',timeout=5)
found=False
for _ in range(100):
    line=events.readline().decode()
    if line.startswith('data: ') and json.loads(line[6:]).get('progress'):
        found=True;break
events.close()
check(found,'SSE 可续接真实进度事件')

for engine in ['anydoc','native']:
    request('/knowledge-bases/'+kb,{'name':'实时流水线验收 '+stamp,'config':{'parser_engines':{'word':engine}}},method='PUT')
    item=upload(kb,'DOCX '+engine+' 进度验收.docx',(Path(__file__).parent/'fixtures/sample.docx').read_bytes())
    task=wait_task(item['task_id']);assert task['state']=='succeeded',task
    parse=next(s for s in validate(task)['stages'] if s['name']=='parse')
    phases=parse.get('children',[])
    assert parse['engine']==engine,parse
    assert all(s.get('progress',{}).get('unit') not in ('page','converted_page') for s in phases),phases
    target=next(s for s in phases if s['name']==('match_blocks' if engine=='anydoc' else 'read_docx'))
    assert target['progress']['completed']==target['progress']['total']>0,target
    check(True,'DOCX '+engine+' 按真实内容块计数，预览转换独立计时')
    if engine=='anydoc':anydoc=item

cancelled=upload(kb,'取消验证.pdf',pdf(15))
while True:
    before=request('/tasks/'+cancelled['task_id'])
    spans=before['checkpoint'].get('pipeline',{}).get('stages',[])
    if spans and spans[0].get('children'):break
    time.sleep(.3)
request('/tasks/'+cancelled['task_id']+'/cancel',{})
after=wait_task(cancelled['task_id']);assert after['state']=='cancelled',after
validate(after)
snapshot=after['checkpoint']['pipeline']
time.sleep(1)
check(request('/tasks/'+cancelled['task_id'])['checkpoint']['pipeline']==snapshot,'取消后冻结耗时与计数')
request('/tasks/'+cancelled['task_id']+'/retry',{})
deadline=time.monotonic()+30
while time.monotonic()<deadline:
    resumed=request('/tasks/'+cancelled['task_id'])
    if resumed['checkpoint'].get('pipeline',{}).get('run_id')!=snapshot['run_id']:break
    time.sleep(.3)
check(resumed['checkpoint']['pipeline']['run_id']!=snapshot['run_id'],'重试使用新运行记录，不叠加旧进度')
request('/tasks/'+cancelled['task_id']+'/cancel',{})
wait_task(cancelled['task_id'])
bad=upload(kb,'损坏文件.docx',b'not a document')
task=wait_task(bad['task_id']);assert task['state']=='failed',task
validate(task)
check(True,'解析失败的流水线关闭活动阶段')

previous=request('/settings/model-bindings')
try:
    request('/settings/model-bindings',{'embedding':None,'text':None},method='PUT')
    pending_kb=request('/knowledge-bases',{'name':'待配置流水线 '+stamp,'config':{'image_caption':False,'image_embedding':False,'outline_enabled':False,'wiki_enabled':False,'graph_enabled':False}})
    pending=wait_task(upload(pending_kb['id'],'待配置.txt','真实来源文本'.encode())['task_id'])
    assert pending['state']=='waiting_configuration',pending['state']
    validate(pending)
    check(True,'缺少模型时待配置，冻结阶段计时')
finally:
    request('/settings/model-bindings',previous,method='PUT')

out=Path(__file__).resolve().parents[1]/'test-results/pipeline-acceptance.json'
out.write_text(json.dumps({'knowledge_base_id':kb,'pdf':doc,'anydoc':anydoc},ensure_ascii=False,indent=2),encoding='utf-8')
print('ALL PIPELINE PROGRESS CHECKS PASSED',flush=True)

