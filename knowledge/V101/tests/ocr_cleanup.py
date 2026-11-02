"""OCR display, source and generation checks; isolated services only."""
from client import *
import io
import subprocess
from pypdf import PdfWriter

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Only use isolated test services'

def sql(query):
    p=subprocess.run(['docker','exec','-i','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-At','-v','ON_ERROR_STOP=1'],input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    return p.stdout.decode().strip()

models={}
for purpose in ['text','vision','embedding']:
    models[purpose]=request('/models',dict(name='OCR cleanup '+purpose,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,**({'dimension':16} if purpose=='embedding' else {})))['id']
request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000/ocr-loops'}},method='PUT')
kb=request('/knowledge-bases',{'name':'OCR loop display acceptance','config':{'model_bindings':models,'image_caption':True,'image_embedding':False,'outline_enabled':False,'wiki_enabled':True,'graph_enabled':True}})['id']
pdf=PdfWriter();pdf.add_blank_page(width=300,height=400);buffer=io.BytesIO();pdf.write(buffer)
doc=upload(kb,'OCR区域验收.pdf',buffer.getvalue());task=wait_task(doc['task_id']);kid=doc['knowledge_id']
content=request('/knowledge/'+kid+'/content')
assert content['content'].count('职业化能力')==100
assert content['display_content'].count('职业化能力')==1
assert content['ocr_cleanup']['needs_review'] is True
chunks=request('/knowledge/'+kid+'/chunks?page_size=100')
bad=next(c for c in chunks if c['content'].count('职业化能力')==100)
assert bad['display_content'].count('职业化能力')==1 and bad['display_content'].startswith('原图😀标题') and bad['display_content'].endswith('结束：正常内容。')
assert content['content'][bad['char_start']:bad['char_end']]==bad['content']
source=request('/sources/'+bad['source_ref_id'])
assert source['quote']==bad['content'] and source['display_quote']==bad['display_content']
assert source['locators']==bad['locators'] and source['char_start']==bad['char_start'] and source['parse_version_id']==content['parse_version_id']
resolved=request('/sources/resolve-batch',{'source_ref_ids':[source['source_ref_id']]})
assert resolved[0]==source
detail=request('/images/'+bad['images'][0]['id'])
assert detail['recognized_text']==bad['content'] and detail['display_recognized_text']==bad['display_content']
assert detail['locators']==source['locators']
assert detail['caption_ready'] and any(s['origin']=='image_caption' for s in detail['source_refs'])
assert '_ocr_blocks' not in detail
table=next(c for c in chunks if c['block_type']=='table')
assert table['display_content']==table['content'] and table['ocr_cleanup'] is None
assert table['content'].count('表格结构必须完整保存')==10
check(True,'原始 OCR、分块、页码区域、Unicode 引用位置保持原样；正文/图片/分块/来源提供相同去重投影')

assert sql(f"SELECT search_vector=''::tsvector FROM nebulaekno.chunks WHERE id='{bad['id']}';")=='t'
assert sql(f"SELECT count(*) FROM nebulaekno.embeddings WHERE source_ref_id='{bad['source_ref_id']}';")=='0'
for stage in ['wiki','graph']:
    batches=task['checkpoint'][stage+'_batches']['batches']
    assert any(b.get('error',{}).get('code')=='OCR_QUALITY_SUSPECT' for b in batches),task
    assert all(b['attempts']==0 for b in batches if b.get('error',{}).get('code')=='OCR_QUALITY_SUSPECT')
before=task['checkpoint']['graph_batches']['batches']
assert any(b['status']=='succeeded' for b in before),before
request('/tasks/'+doc['task_id']+'/graph/retry-failed',{},method='POST')
retry=wait_task(doc['task_id'])
after=retry['checkpoint']['graph_batches']['batches']
assert all(b==after[i] for i,b in enumerate(before) if b['status']=='succeeded')
assert request('/knowledge/'+kid+'/content')==content and request('/images/'+detail['id'])==detail
check(True,'异常 OCR 不作为新增索引/Wiki/图谱事实；图像理解继续，补跑不改已有成功图谱和原文')

# Simulate a pre-upgrade parse without stored cleanup metadata in this isolated DB.
pid=content['parse_version_id']
sql(f"""UPDATE nebulaekno.parse_versions SET metadata=jsonb_set(metadata,'{{blocks}}',(SELECT jsonb_agg(b-'ocr_cleanup'-'display_text'-'warning' ORDER BY n) FROM jsonb_array_elements(metadata->'blocks') WITH ORDINALITY t(b,n))) WHERE id='{pid}';
UPDATE nebulaekno.source_refs SET metadata=metadata-'warning' WHERE parse_version_id='{pid}';""")
assert request('/knowledge/'+kid+'/content')['display_content']==content['display_content']
assert request('/sources/'+source['source_ref_id'])['display_quote']==source['display_quote']
assert request('/images/'+detail['id'])['display_recognized_text']==detail['display_recognized_text']
check(True,'旧解析无须重新调用 OCR 即可展示去重结果，不改解析版本和来源 ID')
