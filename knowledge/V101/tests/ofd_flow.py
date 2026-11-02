"""OFD API/version/location acceptance against the isolated configuration stack."""
import tempfile
import urllib.request
from pathlib import Path
from client import BASE, request, upload, wait_task, check
from test_ofd import fixture

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Only run against the isolated test stack'
catalog=request('/parser-engines')
ofd=next(f for f in catalog['formats'] if f['key']=='ofd')
assert ofd['default']=='paddleocr_vl'
request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000/regions'}},method='PUT')
model=request('/models',{'name':'OFD integration vector','purpose':'embedding','protocol':'openai',
                        'base_url':'http://model-fixture:9000/v1','model_name':'fixture-embedding','dimension':16})
cfg={'parser_engines':{'ofd':'native'},'model_bindings':{'embedding':model['id']},
     'image_caption':False,'image_embedding':False,'outline_enabled':False,'wiki_enabled':False,'graph_enabled':False}
kb=request('/knowledge-bases',{'name':'OFD source page regression','config':cfg})['id']
with tempfile.TemporaryDirectory() as temp:
    file=Path(temp)/'source.ofd'; fixture(file)
    data=file.read_bytes()
    document=upload(kb,'source.ofd',data)
task=wait_task(document['task_id']); assert task['state']=='succeeded',task
id=document['knowledge_id']
old=request('/knowledge/'+id+'/content')
old_chunks=request('/knowledge/'+id+'/chunks?page_size=100')
old_source=request('/sources/'+old_chunks[0]['source_ref_id'])
cfg['parser_engines']['ofd']='paddleocr_vl'
request('/knowledge-bases/'+kb,{'name':'OFD source page regression','config':cfg},method='PUT')
job=request('/knowledge/'+id+'/reparse',{},expected=202)
task=wait_task(job['task_id']); assert task['state']=='succeeded',task
content=request('/knowledge/'+id+'/content')
assert content['parse_version_id']!=old['parse_version_id']
assert content['engine']=='paddleocr_vl' and content['visual_layout_version']==2
manifest=request('/knowledge/'+id+'/preview/manifest')
assert manifest['type']=='pdf' and manifest['state']=='ready',manifest
with urllib.request.urlopen(BASE.removesuffix('/api/v1')+manifest['content_url']) as r:
    assert r.read(4)==b'%PDF'
with urllib.request.urlopen(BASE+'/knowledge/'+id+'/download') as r:
    assert r.read()==data
chunks=request('/knowledge/'+id+'/chunks?page_size=100')
assert chunks and any(c['images'] for c in chunks)
for c in chunks:
    source=request('/sources/'+c['source_ref_id'])
    loc=source['locators'][0]
    assert loc['page'] in (1,2) and loc['source_format']=='ofd' and len(loc['bbox'])==4,source
    assert source['precision']=='region'
images=request('/knowledge/'+id+'/images')
assert len(images)==4,images
assert all(i['metadata']['visual_role']=='image_region' for i in images)
for image in images:
    with urllib.request.urlopen(BASE+'/images/'+image['id']+'/content') as r: assert r.read(8)==b'\x89PNG\r\n\x1a\n'
assert request('/knowledge/'+id+'/content?parse_version_id='+old['parse_version_id'])==old
assert request('/sources/'+old_chunks[0]['source_ref_id'])==old_source
hits=request('/search',{'query_text':'数据库','mode':'keyword','knowledge_base_ids':[kb],
                       'knowledge_ids':[id],'include_sources':True,'rerank':{'mode':'disabled'}})['results']
assert hits and all(h['source_refs'] for h in hits)
for hit in hits:
    for source in hit['source_refs']:
        assert source['parse_version_id']==content['parse_version_id']
        assert source['locators'][0]['page'] in (1,2) and source['mapping_method']=='ocr_layout_region'
check(True,'OFD raster preview / original download / OCR text-table-image regions / source page mapping / immutable old references')

request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':''}},method='PUT')
job=request('/knowledge/'+id+'/reparse',{},expected=202)
task=wait_task(job['task_id']);assert task['state']=='waiting_configuration',task
assert request('/knowledge/'+id+'/content')['parse_version_id']==content['parse_version_id']
check(True,'Missing Paddle connection waits for configuration without XML fallback or replacing successful results')
print('OFD_TEST_DOCUMENT='+id)
