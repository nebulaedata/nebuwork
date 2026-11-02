"""Isolated Wiki retry acceptance. Never uses development documents/models."""
from client import *
import re
import subprocess

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Isolated services only'
RUN='-'+uuid.uuid4().hex[:8]
COMPOSE=['docker','compose','-f','tests/compose.yaml','-f','tests/compose.settings.yaml','--profile','functional']
def observed():
    return json.loads(subprocess.check_output(['docker','exec','nebulaekno-config-test-model-fixture-1','python3','-c',"import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:9000/observed').read().decode())"]))['requests']
def model(name):
    name+=RUN
    return request('/models',dict(name=name,purpose='text',protocol='openai',base_url='http://model-fixture:9000/v1',model_name=name))
def change(m,name):
    name+=RUN
    return request('/models/'+m['id'],dict(name=name,purpose='text',protocol='openai',base_url='http://model-fixture:9000/v1',model_name=name),method='PUT')
def kb_for(m,label):
    return request('/knowledge-bases',{'name':'Wiki 批次验收 '+label,'config':{'model_bindings':{'text':m['id']},'image_caption':False,'image_embedding':False,'outline_enabled':False,'wiki_enabled':True,'graph_enabled':False,'chunk_size':128,'chunk_overlap':0}})['id']
def pages(kb):return request('/knowledge-bases/'+kb+'/wiki/pages?page_size=100')
def revisions(kb,page):return request('/knowledge-bases/'+kb+'/wiki/pages/'+page+'/revisions')
def wait_until(id,predicate,timeout=90):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        task=request('/tasks/'+id)
        if predicate(task):return task
        time.sleep(.2)
    raise AssertionError(('condition_timeout',task))

embedding=request('/models',dict(name='Wiki 验收向量',purpose='embedding',protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-embedding',dimension=16))
request('/settings/model-bindings',{'embedding':embedding['id']},method='PUT')
text='__WIKI_FAIL__\n'+ '\n\n'.join(f'条款 {i:03d}：NebulaeKno 使用数据库保存证据。额定电压 500 kV，范围 -20～40℃。不同条件应分别保留，不能混合或省略。' for i in range(65))
m=model('fixture-wiki-fail');kb=kb_for(m,'失败保留');doc=upload(kb,'批次恢复验收.txt',text.encode())
task=wait_task(doc['task_id'])
plan=task['checkpoint']['wiki_batches'];batches=plan['batches']
assert task['state']=='partially_failed' and len(batches)>=3,task
assert batches[0]['status']=='failed' and batches[0]['attempts']==3
assert all(b['status']=='succeeded' and b['attempts']==1 for b in batches[1:])
check(True,'首批失败仅调用三次，后续批次仍完成并保存')
all_saved=pages(kb);assert {p['title'] for p in all_saved}=={'测试资料','已保留的有效页'}
saved=[p for p in all_saved if p['title']=='测试资料']
partial=[p for p in all_saved if p['title']=='已保留的有效页'][0]
partial_revisions=revisions(kb,partial['id'])
assert len(partial_revisions)==1 and batches[0]['accepted_pages']==['已保留的有效页']
old_content=saved[0]['content'];old_revisions=revisions(kb,saved[0]['id'])
assert len(old_revisions)==len(batches)-1
check(True,'失败批次中校验通过的页面也保存一次，待修复页不会入库')
assert all(re.fullmatch(r'[0-9a-f-]{36}',x) for x in saved[0]['source_ids'])
for source in saved[0]['source_ids']:
    ref=request('/sources/'+source)
    assert ref['knowledge_id']==doc['knowledge_id'] and ref['locators']
check(True,'S 编号恢复为真实 source_ref_id，原文定位仍可访问')
attempts=[r for r in observed() if r.get('wiki_batch') and r.get('model')=='fixture-wiki-fail'+RUN]
assert sum(r['wiki_batch']==attempts[0]['wiki_batch'] for r in attempts)==3
calls=[r for r in observed() if r.get('model')=='fixture-wiki-fail'+RUN and 'prompt' in r]
inputs=[json.loads(r['prompt'].split('材料：')[-1]) for r in calls]
assert inputs[0]==inputs[1]==inputs[2]
assert '上次生成未通过校验' in calls[1]['prompt']
assert all(re.fullmatch(r'S\d+',c['source_ref_id']) and set(c)=={'source_ref_id','content'} for c in inputs[0])
check(True,'重试携带校验反馈，完整原始材料逐字一致，模型只收到短来源编号')
before={key:task['checkpoint'].get(key) for key in ['parse_version_id','parse','embedding','graph','images','outline']}
change(m,'fixture-wiki-ok')
request('/tasks/'+doc['task_id']+'/wiki/retry-failed',{},method='POST')
fixed=wait_task(doc['task_id'])
assert fixed['state']=='succeeded',fixed
assert all(fixed['checkpoint'].get(k)==v for k,v in before.items())
after_plan=fixed['checkpoint']['wiki_batches']
assert after_plan['batches'][0]['round']==2 and after_plan['batches'][0]['attempts']==1
assert after_plan['batches'][1:]==batches[1:]
new_page=next(p for p in pages(kb) if p['title']=='测试资料');new_revisions=revisions(kb,new_page['id'])
assert revisions(kb,partial['id'])==partial_revisions
assert next(p for p in pages(kb) if p['title']=='失败页')['source_ids']
assert new_page['content']==old_content and len(new_revisions)==len(old_revisions)
assert {r['id']:r['content'] for r in old_revisions}.items() <= {r['id']:r['content'] for r in new_revisions}.items()
assert len([r for r in observed() if r.get('wiki_batch') and r.get('model')=='fixture-wiki-ok'+RUN])==1
check(True,'仅补跑失败首批，成功批次正文/引用/历史版本不变，其他处理阶段不重跑')
request('/tasks/'+doc['task_id']+'/wiki/retry-failed',{},expected=409)
check(True,'已完成任务拒绝重复提交失败批次补跑')

transient=model('fixture-wiki-transient');kb2=kb_for(transient,'自动重试');doc2=upload(kb2,'引用纠正.txt','仅使用有依据的资料：电压 500 kV。保留不同条件和原始数值。'.encode())
seen_retry=False
def caught(t):
    global seen_retry
    batches=t['checkpoint'].get('wiki_batches',{}).get('batches',[])
    seen_retry=seen_retry or any(b['status']=='retrying' or b['attempts']>1 for b in batches)
    return t['state'] not in ('queued','running')
fixed2=wait_until(doc2['task_id'],caught)
assert fixed2['state']=='succeeded' and seen_retry
assert fixed2['checkpoint']['wiki_batches']['batches'][0]['attempts']==3
check(True,'结构化来源错误触发局部修复；第三次正确结果通过，实时快照包含重试进度')

# Restart during the second model call, then recover from persisted per-batch state.
pause=model('fixture-wiki-pause');kb3=kb_for(pause,'中断恢复');doc3=upload(kb3,'重启恢复.txt',text.encode())
inflight=wait_until(doc3['task_id'],lambda t: any(b['status']=='succeeded' for b in t['checkpoint'].get('wiki_batches',{}).get('batches',[])) and any(b['status']=='running' for b in t['checkpoint'].get('wiki_batches',{}).get('batches',[])))
first=inflight['checkpoint']['wiki_batches']['batches'][0]
assert first['status']=='succeeded'
subprocess.run(COMPOSE+['stop','-t','15','app'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(COMPOSE+['up','-d','--no-deps','--wait','--wait-timeout','120','app'],check=True,stdout=subprocess.DEVNULL)
recovered=wait_task(doc3['task_id'])
assert recovered['state']=='succeeded',recovered
assert recovered['checkpoint']['wiki_batches']['batches'][0]==first
assert len(revisions(kb3,pages(kb3)[0]['id']))==len(recovered['checkpoint']['wiki_batches']['batches'])
check(True,'容器停止后续跑，成功批次不再调用模型、不重复写版本；中断请求计入预算')

# Legacy checkpoints are explicit: no invented successful batches.
legacy=model('fixture-wiki-fail');kb4=kb_for(legacy,'旧任务兼容');doc4=upload(kb4,'旧任务兼容.txt','__WIKI_FAIL__ 历史文档条款。'.encode());wait_task(doc4['task_id'])
subprocess.run(['docker','exec','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-c',f"UPDATE nebulaekno.tasks SET checkpoint=checkpoint-'wiki_batches' WHERE id='{doc4['task_id']}'"],check=True,stdout=subprocess.DEVNULL)
change(legacy,'fixture-wiki-ok');request('/tasks/'+doc4['task_id']+'/wiki/retry-failed',{})
assert wait_task(doc4['task_id'])['state']=='succeeded'
check(True,'旧失败任务可单独重试 Wiki，并建立新的批次检查点')

# Preserve unrelated failures and refuse stale inputs instead of mixing evidence.
new=request('/knowledge/'+doc['knowledge_id']+'/reparse',{},expected=202)
assert wait_task(new['task_id'])['state']=='succeeded'
assert request('/tasks/'+doc['task_id']+'/wiki/retry-failed',{},expected=409)['code']=='STALE_TASK'
check(True,'旧解析版本拒绝补跑')
def sql(query):
    subprocess.run(['docker','exec','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-c',query],check=True,stdout=subprocess.DEVNULL)
id=doc4['task_id']
sql(f"UPDATE nebulaekno.tasks SET state='partially_failed',checkpoint=checkpoint||jsonb_build_object('wiki','failed','graph','failed') WHERE id='{id}'")
request('/tasks/'+id+'/wiki/retry-failed',{})
other=wait_task(id)
assert other['checkpoint']['wiki']=='succeeded' and other['checkpoint']['graph']=='failed' and other['state']=='partially_failed'
assert other['error']['code']=='OTHER_STAGE_FAILED'
check(True,'Wiki 单独完成后仍保留其他阶段失败状态')
sql(f"UPDATE nebulaekno.chunks SET content=content||'变更' WHERE knowledge_id='{doc4['knowledge_id']}'; UPDATE nebulaekno.tasks SET checkpoint=checkpoint||jsonb_build_object('wiki','failed') WHERE id='{id}'")
request('/tasks/'+id+'/wiki/retry-failed',{})
assert wait_task(id)['checkpoint']['wiki_error']['code']=='WIKI_INPUT_CHANGED'
check(True,'材料变化后拒绝混用旧批次')

# Leave a dedicated failed fixture for visual acceptance of the retry button.
ui=model('fixture-wiki-fail');kb_ui=kb_for(ui,'页面交互');doc_ui=upload(kb_ui,'Wiki 重试进度验收.txt',text.encode());wait_task(doc_ui['task_id'])
Path('test-results/wiki-batches.json').write_text(json.dumps({'documents':[doc,doc2,doc3,doc4],'ui':doc_ui,'ui_model':ui,'ui_kb':kb_ui},ensure_ascii=False),encoding='utf-8')
print('PASS Wiki 批次隔离验收全部完成',flush=True)
