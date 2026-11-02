"""Regression for shared search filtering with deterministic model fixtures."""
from client import *

assert BASE == 'http://127.0.0.1:19081/api/v1'
bindings = {}
for purpose in ('text','embedding','vision','multimodal_embedding'):
    model = request('/models', {'name':'检索回归 '+purpose, 'purpose':purpose,
        'protocol':'jina' if purpose=='multimodal_embedding' else 'openai',
        'base_url':'http://model-fixture:9000/v1', 'model_name':'fixture-'+purpose,
        'dimension':16 if 'embedding' in purpose else None})
    bindings[purpose] = model['id']
kb = request('/knowledge-bases', {'name':'图谱检索调整回归', 'config':{
    'outline_enabled':False,'wiki_enabled':True,'graph_enabled':True,
    'image_caption':True,'image_embedding':True,'model_bindings':bindings}})['id']
docs = []
for filename in ('sample.md','sample.png'):
    path = Path(__file__).parent/'fixtures'/filename
    doc = upload(kb, filename, path.read_bytes())
    task = wait_task(doc['task_id'])
    assert task['state']=='succeeded', task
    docs.append(doc['knowledge_id'])
for mode in ('keyword','vector','hybrid','graph','wiki','image_text','image_vector','multi'):
    result = request('/search', {'query_text':'数据库','knowledge_base_ids':[kb],
        'mode':mode,'include_sources':True,'include_context':True,'rerank':{'mode':'disabled'}})
    assert result['results'], (mode,result)
    assert all(ref['knowledge_id'] in docs for h in result['results'] for ref in h['source_refs'])
    assert all(h['source_refs'] for h in result['results'])
    check(True, mode+' 检索结果与来源正常')
    scoped = request('/search', {'query_text':'数据库','knowledge_base_ids':[kb],
        'knowledge_ids':[docs[0]], 'mode':mode,'rerank':{'mode':'disabled'}})
    assert all(ref['knowledge_id']==docs[0] for h in scoped['results'] for ref in h['source_refs'])
print('SEARCH_CHANNELS_OK', flush=True)
