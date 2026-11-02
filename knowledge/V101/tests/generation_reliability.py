"""Black-box recovery and evidence checks; isolated services only."""
from client import *
import subprocess

assert BASE == 'http://127.0.0.1:19081/api/v1'
RUN='-'+uuid.uuid4().hex[:8]

def sql(query):
    result=subprocess.run(['docker','exec','-i','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-At','-v','ON_ERROR_STOP=1'],input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    return result.stdout.decode().strip()

def model(name,purpose='text'):
    return request('/models',dict(name=name+RUN,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name=name+RUN,**({'dimension':16} if purpose=='embedding' else {})))

def change(m,name):
    return request('/models/'+m['id'],dict(name=name+RUN,purpose='text',protocol='openai',base_url='http://model-fixture:9000/v1',model_name=name+RUN),method='PUT')

def observed():
    return json.loads(subprocess.check_output(['docker','exec','nebulaekno-config-test-model-fixture-1','python3','-c',"import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:9000/observed').read().decode())"]))['requests']

embed=model('fixture-embedding','embedding')
m=model('fixture-repair-graph-fail')
kb=request('/knowledge-bases',{'name':'逐块恢复验收'+RUN,'config':{'model_bindings':{'text':m['id'],'embedding':embed['id']},'chunk_size':128,'chunk_overlap':0,'image_caption':False,'image_embedding':False,'outline_enabled':False,'wiki_enabled':True,'graph_enabled':True}})['id']
content='__GRAPH_FAIL__ NebulaeKno 使用数据库。电压 500 kV，不得超过 40℃。\n\n'+'\n\n'.join(f'条款 {i}：NebulaeKno 使用数据库。原文事实和证据必须保存，不允许推测不同条件下的关系。' for i in range(10))
doc=upload(kb,'图谱逐块验收.txt',content.encode())
task=wait_task(doc['task_id']);plan=task['checkpoint']['graph_batches']
failed=[b for b in plan['batches'] if b['status']=='failed']
assert len(failed)==1 and failed[0]['attempts']==3,task
assert failed[0]['accepted_entities']==2 and failed[0]['accepted_relations']==0
assert all(b['status']=='succeeded' for b in plan['batches'] if b not in failed)
assert failed[0]['error']['code']=='GRAPH_EVIDENCE_INVALID'
assert failed[0]['error']['issues'][0]['source_ref_ids']==[failed[0]['source_ref_id']]
source=request('/sources/'+failed[0]['source_ref_id']);assert source['locators'] and source['quote'] in content
payload=json.loads(sql("SELECT payload FROM nebulaekno.graph_records WHERE id='"+failed[0]['record_id']+"';"))
assert len(payload['entities'])==2 and payload['relations']==[]
check(True,'关系引文错误仅影响当前分块，实体保留，后续分块完成，每块最多重试两次，原文仍可定位')

before_wiki=request('/knowledge-bases/'+kb+'/wiki/pages?page_size=100')
before_checkpoint={k:task['checkpoint'].get(k) for k in ['parse_version_id','parse','wiki','wiki_batches','embedding']}
change(m,'fixture-repair-graph-ok')
request('/tasks/'+doc['task_id']+'/graph/retry-failed',{},method='POST')
fixed=wait_task(doc['task_id']);assert fixed['state']=='succeeded',fixed
assert all(fixed['checkpoint'].get(k)==v for k,v in before_checkpoint.items())
assert request('/knowledge-bases/'+kb+'/wiki/pages?page_size=100')==before_wiki
for before,after in zip(plan['batches'],fixed['checkpoint']['graph_batches']['batches']):
    if before['status']=='succeeded':assert before==after
fixed_bad=fixed['checkpoint']['graph_batches']['batches'][failed[0]['index']-1]
assert fixed_bad['attempts']==1 and fixed_bad['round']==2 and fixed_bad['accepted_entities']==2 and fixed_bad['accepted_relations']==1
calls=[r for r in observed() if r.get('model')=='fixture-repair-graph-ok'+RUN and 'prompt' in r]
assert len(calls)==1 and '待修复项：' in calls[0]['prompt']
assert '999 kV' in calls[0]['prompt'] and '500 kV' in calls[0]['prompt']
payload=json.loads(sql("SELECT payload FROM nebulaekno.graph_records WHERE id='"+failed[0]['record_id']+"';"))
assert payload['relations'][0]['Quote']==source['quote']
request('/tasks/'+doc['task_id']+'/graph/retry-failed',{},expected=409)
check(True,'只补跑失败关系，不重复有效实体/分块，不改 Wiki 页面或解析版本，修复引文映射回原文')

# Inject a legacy OCR anomaly into isolated records; no production source changes.
ocrdoc=upload(kb,'旧 OCR 异常验收.txt','NebulaeKno 使用数据库。'.encode());wait_task(ocrdoc['task_id'])
raw='30 40 50 60 70 '*130
sql(f"""UPDATE nebulaekno.source_refs SET quote='{raw}',origin='paddleocr_vl',metadata=metadata||'{{"block_type":"image"}}',locators='[{{"page":17,"bbox":[0.1,0.2,0.3,0.4],"region_id":"page-17-block-8"}}]' WHERE knowledge_id='{ocrdoc['knowledge_id']}';
UPDATE nebulaekno.chunks SET content='{raw}' WHERE knowledge_id='{ocrdoc['knowledge_id']}';
UPDATE nebulaekno.tasks SET state='partially_failed',checkpoint=(checkpoint-'wiki_batches'-'graph_batches')||'{{"wiki":"failed","graph":"failed"}}' WHERE id='{ocrdoc['task_id']}';""")
before_calls=len([r for r in observed() if 'prompt' in r])
request('/tasks/'+ocrdoc['task_id']+'/retry',{})
ocr=wait_task(ocrdoc['task_id'])
for stage in ['wiki','graph']:
    batch=ocr['checkpoint'][stage+'_batches']['batches'][0]
    assert batch['status']=='failed' and batch['attempts']==0 and batch['error']['code']=='OCR_QUALITY_SUSPECT',batch
    ref=request('/sources/'+batch['error']['issues'][0]['source_ref_ids'][0])
    assert ref['quote']==raw and ref['locators'][0]['page']==17 and ref['locators'][0]['bbox']==[.1,.2,.3,.4]
assert len([r for r in observed() if 'prompt' in r])==before_calls
check(True,'旧 OCR 数字循环也能检出，保留完整 OCR/页码/区域；不消耗生成重试，不把异常当事实')

# Fresh PaddleOCR upload: warnings and raw data survive the actual parse/index path.
from pypdf import PdfWriter
import io
request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000/ocr-anomaly'}},method='PUT')
writer=PdfWriter();writer.add_blank_page(width=300,height=400)
stream=io.BytesIO();writer.write(stream)
fresh=upload(kb,'新 OCR 版面验收.pdf',stream.getvalue())
fresh_task=wait_task(fresh['task_id'])
fresh_chunks=request('/knowledge/'+fresh['knowledge_id']+'/chunks?page_size=100')
suspect=[c for c in fresh_chunks if c['content'].startswith('30 40 50 60 70 ')]
assert len(suspect)==1 and suspect[0]['content']==raw.strip()
fresh_source=request('/sources/'+suspect[0]['source_ref_id'])
assert fresh_source['metadata']['warning']=='OCR_QUALITY_SUSPECT' and fresh_source['locators'][0]['page']==1
assert fresh_source['locators'][0]['bbox']
assert fresh_task['checkpoint']['wiki_batches']['batches'][0]['error']['code']=='OCR_QUALITY_SUSPECT'
graph_items=fresh_task['checkpoint']['graph_batches']['batches']
assert sum(b['status']=='failed' for b in graph_items)==1 and any(b['status']=='succeeded' for b in graph_items)
assert json.loads(sql("SELECT metadata->'warnings' FROM nebulaekno.parse_versions WHERE id='"+fresh_task['checkpoint']['parse_version_id']+"';"))[0]['code']=='OCR_QUALITY_SUSPECT'
check(True,'新 PDF 上传保留完整 OCR 和裁剪区域，写入异常标记；其余图谱分块继续处理')

# A missing or changed source version must not reuse a successful evidence ledger.
sql(f"UPDATE nebulaekno.tasks SET state='partially_failed',checkpoint=checkpoint||'{{\"graph\":\"failed\"}}' WHERE id='{doc['task_id']}'; UPDATE nebulaekno.chunks SET content=content||'材料已变更' WHERE knowledge_id='{doc['knowledge_id']}';")
request('/tasks/'+doc['task_id']+'/graph/retry-failed',{})
assert wait_task(doc['task_id'])['checkpoint']['graph_error']['code']=='GRAPH_INPUT_CHANGED'
check(True,'图谱材料变化时拒绝混用旧检查点')
Path('test-results/generation-reliability.json').write_text(json.dumps({'graph_task':doc['task_id'],'ocr_task':ocrdoc['task_id'],'ocr_document':ocrdoc['knowledge_id'],'knowledge_base':kb},ensure_ascii=False),encoding='utf-8')
print('PASS 生成可靠性隔离验收完成',flush=True)
