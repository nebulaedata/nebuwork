from client import *

stamp=str(uuid.uuid4())[:8]
kb=request('/knowledge-bases',{'name':'功能验收 '+stamp,'description':'隔离测试数据，模型为协议测试桩。'})['id']
models={}
for purpose in ['text','embedding','vision','asr','rerank','multimodal_embedding']:
    model=request('/models',{'name':'协议测试 '+purpose+' '+stamp,'purpose':purpose,'protocol':'jina' if purpose=='multimodal_embedding' else 'openai','base_url':'http://model-fixture:9000/v1','model_name':'fixture-'+purpose,'api_key':'fixture-secret','dimension':16 if 'embedding' in purpose else None})
    check('api_key' not in model and model['has_api_key'],purpose+' 凭证不回显')
    models[purpose]=model['id']
    if purpose not in ['vision','asr']: request('/models/'+model['id']+'/test',{})
request('/settings/model-bindings',models,method='PUT')
documents={}
for path in sorted((Path(__file__).parent/'fixtures').glob('sample.*')):
    result=upload(kb,path.name,path.read_bytes(),'functional:'+stamp+':'+path.name)
    same=upload(kb,path.name,path.read_bytes(),'functional:'+stamp+':'+path.name)
    check(result==same,path.name+' 上传幂等')
    documents[path.suffix]=result
for ext,doc in documents.items():
    task=wait_task(doc['task_id'])
    check(task['state']=='succeeded',(ext,task['state'],task.get('error'),task['checkpoint']))
    chunks=request('/knowledge/'+doc['knowledge_id']+'/chunks?page_size=100')
    check(bool(chunks),ext+' 真实解析分块')
    source=request('/sources/'+chunks[0]['source_ref_id'])
    check(source['file_version_id']==doc['file_version_id'] and source['locators'],ext+' 引用版本与位置')
    content=request('/knowledge/'+doc['knowledge_id']+'/content?parse_version_id='+source['parse_version_id'])
    if source['char_end']>source['char_start']:
        check(content['content'][source['char_start']:source['char_end']].strip()==source['quote'].strip(),ext+' Unicode 原文范围核验')
for mode in ['keyword','vector','hybrid','graph','wiki','image_text','image_vector','multi']:
    result=request('/search',{'query_text':'数据库','mode':mode,'knowledge_base_ids':[kb],'include_sources':True,'include_context':True,'rerank':{'mode':'disabled'}})
    check(bool(result['results']),mode+' 检索有结果')
    check(all(hit['source_refs'] for hit in result['results']),mode+' 所有结果携带来源')
    only=documents['.md']['knowledge_id']
    scoped=request('/search',{'query_text':'数据库','mode':mode,'knowledge_base_ids':[kb],'knowledge_ids':[only],'rerank':{'mode':'disabled'}})
    check(all(s['knowledge_id']==only for hit in scoped['results'] for s in hit['source_refs']),mode+' 文档范围不串库')
image=(Path(__file__).parent/'fixtures/sample.png').read_bytes();body,headers=multipart('query.png',image)
query=request('/search/query-images',body,headers=headers,expected=201)
result=request('/search/image-vector',{'query_image_id':query['query_image_id'],'knowledge_base_ids':[kb],'rerank':{'mode':'disabled'}})
check(bool(result['results']),'以图搜图')
for ext in ['.wav','.mp4']:
    transcript=request('/knowledge/'+documents[ext]['knowledge_id']+'/transcript')
    check(any(s['locators'][0].get('start_ms')==200 for s in transcript),ext+' ASR 时间位置')

payload=(b'# resumable\n'+b'NebulaeKno database\n'*(500000))
session=request('/knowledge-bases/'+kb+'/uploads',{'file_name':'resumable.md','file_size':len(payload),'sha256':hashlib.sha256(payload).hexdigest()},expected=201)
size=session['part_size'];id=session['upload_id']
for i,start in enumerate(range(0,len(payload),size),1):
    part=payload[start:start+size];headers={'Content-Type':'application/octet-stream','X-Content-SHA256':hashlib.sha256(part).hexdigest()}
    request(f'/uploads/{id}/parts/{i}',part,method='PUT',headers=headers)
    same=request(f'/uploads/{id}/parts/{i}',part,method='PUT',headers=headers);check(same['reused'],'分片重传幂等 '+str(i))
    if i==1:
        changed=bytes([part[0]^1])+part[1:]
        request(f'/uploads/{id}/parts/{i}',changed,method='PUT',expected=409)
check(request('/uploads/'+id)['received_bytes']==len(payload),'续传状态准确')
done=request('/uploads/'+id+'/complete',{},expected=202)
check(done==request('/uploads/'+id+'/complete',{}),'合并提交幂等')
request('/tasks/'+done['task_id']+'/cancel',{})
cancelled=wait_task(done['task_id'])
check(cancelled['state']=='cancelled' and request('/knowledge/'+done['knowledge_id'])['status']=='cancelled','取消状态同步到文档')
deleted=request('/knowledge/'+done['knowledge_id'],method='DELETE',expected=202)
check(wait_task(deleted['task_id'])['state']=='succeeded','清理大文件续传测试样本')

bad=request('/search',{'query_text':'数据库','mode':'hybrid','knowledge_base_ids':[kb],'top_k':99,'candidate_k':3},expected=400)
check(bad['code']=='INVALID_ARGUMENT','无效检索参数拒绝')
result=request('/search/keyword',{'query_text':'数据库','knowledge_base_ids':[kb],'rerank':{'mode':'enabled','model_id':models['rerank']}})
check(result['meta']['rerank_status']=='applied','真实协议重排调用')
report={'knowledge_base_id':kb,'documents':documents,'models':models,'passed_at':time.time(),'model_validation':'deterministic protocol fixture; real provider quality requires deployed credentials'}
out=Path(__file__).parent.parent/'test-results';out.mkdir(exist_ok=True);(out/'functional.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('All functional checks passed.',flush=True)
