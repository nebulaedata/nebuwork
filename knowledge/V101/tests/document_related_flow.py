"""Read-only document projections against deterministic isolated fixtures.

Run only on tests/compose.settings.yaml (port 19081), never dev data.
"""
import json, os, subprocess, urllib.request, urllib.error, uuid
from pathlib import Path

BASE = os.environ.get('NEBULAEKNO_TEST_API_URL', 'http://127.0.0.1:19081/api/v1')
assert BASE == 'http://127.0.0.1:19081/api/v1'
def sql(q):
    return subprocess.run(['docker','exec','-i','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-At','-v','ON_ERROR_STOP=1'],input='SET search_path=nebulaekno,public;\n'+q,text=True,encoding='utf-8',capture_output=True,check=True).stdout.strip().removeprefix('SET\n')
def literal(v):
    if not isinstance(v,str): v=json.dumps(v,ensure_ascii=False)
    return "'"+v.replace("'","''")+"'"
def get(path,status=200):
    try: response=urllib.request.urlopen(BASE+path,timeout=30)
    except urllib.error.HTTPError as e: response=e
    body=json.load(response)
    assert response.status==status,(path,response.status,body)
    return body
def uid(): return str(uuid.uuid4())
def check(message): print('PASS',message,flush=True)
kb=uid();a,b,empty=uid(),uid(),uid()
fa,fb,fe,oldfile=uid(),uid(),uid(),uid()
pa,pb,oldparse,oldfileparse=uid(),uid(),uid(),uid()
sa,sb,sold,soldfile=uid(),uid(),uid(),uid()
shared,target,foreign,manual=uid(),uid(),uid(),uid()
olderrev,newerrev=uid(),uid()
commands=[f'INSERT INTO knowledge_bases(id,name) VALUES ({literal(kb)},\'文档关联验收\');']
for kid,fid,pid,title in [(a,fa,pa,'文档甲'),(b,fb,pb,'文档乙'),(empty,fe,None,'待配置')]:
    commands.append(f"INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status,current_file_version_id,current_parse_version_id) VALUES ({literal(kid)},{literal(kb)},{literal(title)},'txt','ready',{literal(fid)},{literal(pid) if pid else 'NULL'});")
    commands.append(f"INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES ({literal(fid)},{literal(kid)},'fixture',{literal('/data/files/'+fid+'.txt')},4,'text/plain');")
commands.append(f"INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES ('{oldfile}','{a}','fixture','/data/files/{oldfile}.txt',4,'text/plain');")
for kid,fid,pid,ref,age,loc in [(a,fa,pa,sa,0,[{'type':'page','page':2,'bbox':[0.1,0.2,0.8,0.9]}]),(b,fb,pb,sb,0,[{'type':'paragraph','paragraph':2}]),(a,fa,oldparse,sold,2,[{'type':'sheet','sheet':'清单','row_start':5,'row_end':5,'cell_range':'A5:B5'}]),(a,oldfile,oldfileparse,soldfile,3,[{'type':'time','start_ms':1000,'end_ms':3000}])]:
    commands.append(f"INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content,created_at) VALUES ('{pid}','{kid}','{fid}','native','测试证据',now()-interval '{age} day');")
    commands.append(f"INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end) VALUES ('{ref}','{kid}','{fid}','{pid}',{literal(loc)},'测试证据','exact',0,4);")
def section(kid,ref,body): return f'<!-- source-document:{kid}:0 -->\n{body} [来源](source:{ref})\n<!-- /source-document -->'
for page,title,body,refs in [
    (shared,'共享主题',section(a,sa,'甲文件贡献 [[甲的关联页]]')+section(b,sb,'乙文件秘密 [[仅乙页面]]'),[sa,sb]),
    (target,'甲的关联页',section(a,sa,'甲独立内容'),[sa]),
    (foreign,'仅乙页面',section(b,sb,'乙独立内容'),[sb]),
    (manual,'手工合并页','没有贡献标记的正文 [来源](source:'+sa+')',[sa])]:
    commands.append(f"INSERT INTO wiki_pages(id,knowledge_base_id,title,content,source_ids,search_vector) VALUES ('{page}','{kb}',{literal(title)},{literal(body)},{literal(refs)},''::tsvector);")
for rev,ref,body,age in [(olderrev,sold,'旧解析初稿',2),(newerrev,sold,'旧解析最近修订',1),(uid(),soldfile,'旧文件贡献',3)]:
    commands.append(f"INSERT INTO wiki_revisions(id,page_id,content,source_ids,created_at) VALUES ('{rev}','{shared}',{literal(section(a,ref,body))},{literal([ref])},now()-interval '{age} day');")
def payload(ref,desc,name='共享实体',relation=True):
    return {'entities':[{'Name':name,'Type':'组织','Description':desc,'Quote':'测试证据','source_ref_id':ref}]+([{'Name':'无关系实体','Type':'概念','Description':'独立','Quote':'测试证据','source_ref_id':ref}] if desc=='描述0' else []),'relations':[{'Source':name,'Target':'目标','Relation':'关联','Quote':'测试证据','source_ref_id':ref}] if relation else []}
# >100 records exercises cursor pagination and the UI's continue-loading control.
for i in range(103):
    commands.append(f"INSERT INTO graph_records(id,knowledge_id,source_ref_id,payload,synced_at,created_at) VALUES ('{uid()}','{a}','{sa}',{literal(payload(sa,'描述'+str(i)))}, {'NULL' if i==0 else 'now()'},now()+interval '{i} microseconds');")
for kid,ref,desc in [(b,sb,'其他文件描述'),(a,sold,'旧解析描述'),(a,soldfile,'旧文件描述')]:
    commands.append(f"INSERT INTO graph_records(id,knowledge_id,source_ref_id,payload,synced_at) VALUES ('{uid()}','{kid}','{ref}',{literal(payload(ref,desc))},now());")
for kid,cp,state,stage in [(a,{'parse_version_id':pa,'wiki':'failed','wiki_error':{'code':'WIKI_EVIDENCE','message':'验收：一批引用缺失'},'graph':'succeeded'},'partially_failed','wiki'),(empty,{'wiki':'waiting_configuration','graph':'waiting_configuration'},'waiting_configuration','wiki')]:
    tid=uid()
    commands.append(f"INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,stage,checkpoint,idempotency_key) VALUES ('{tid}','{kb}','{kid}','ingest','{state}','{stage}',{literal(cp)},'{tid}');")
sql('BEGIN;\n'+'\n'.join(commands)+'\nCOMMIT;')

def fingerprint():
    return {table:sql(f"SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY id)) FROM {table} t;") for table in ['parse_versions','source_refs','graph_records','wiki_pages','wiki_revisions']}
before=fingerprint()
root='/knowledge/'+a
# A replacement upload may have a new current file while the previous successful
# parse remains current. Default projection must still follow that parse's file.
sql(f"UPDATE knowledge SET current_file_version_id='{oldfile}' WHERE id='{a}';")
kept=get(root+'/related/stats')['data']
assert kept['file_version_id']==fa and kept['parse_version_id']==pa and kept['is_current']
sql(f"UPDATE knowledge SET current_file_version_id='{fa}' WHERE id='{a}';")
check('新上传尚未解析时默认继续读取当前成功解析的文件版本')
stats=get(root+'/related/stats')['data'];assert stats['wiki_pages']==3 and stats['entities']==3 and stats['relations']==103 and stats['evidence_records']==103,stats
assert stats['pending_sync_records']==1 and stats['stages']['wiki']['state']=='partially_failed'
assert stats['stages']['wiki']['error']['code']=='WIKI_EVIDENCE'
assert stats['file_version_id']==fa and stats['parse_version_id']==pa and stats['is_current']
check('完整数量、部分成功及待同步状态')
pages=[]
for page in range(1,4):
    response=get(root+f'/wiki/pages?page={page}&page_size=1&parse_version_id={pa}')
    pages+=response['data'];assert response['meta']['total']==3 and response['meta']['parse_version_id']==pa
assert len({p['id'] for p in pages})==3
assert len(get(root+'/wiki/pages?q='+urllib.parse.quote('手工'))['data'])==1
detail=get(root+'/wiki/pages/'+shared)['data']
assert detail['shared'] and '甲文件贡献' in detail['content'] and '乙文件秘密' not in detail['content'] and detail['source_ids']==[sa]
assert 'wiki_page='+shared in detail['full_page_url']
assert get(root+'/wiki/pages/'+manual)['data']['content_state']=='unavailable'
assert not get(root+'/wiki/pages/'+manual)['data'].get('content')
get(root+'/wiki/pages/'+foreign,404)
wg=get(root+'/wiki/graph')['data'];assert len(wg['nodes'])==3 and len(wg['edges'])==1,wg
assert wg['edges'][0]['source_id']==shared and wg['edges'][0]['target_id']==target,wg
check('Wiki 搜索/分页、共享正文与关系隔离、缺失标记诚实降级')
history=get(root+'/wiki/pages/'+shared+'?parse_version_id='+oldparse)['data']
assert history['revision_id']==newerrev and '旧解析最近修订' in history['content'] and not history['is_current']
assert get(root+'/wiki/pages/'+shared+'?file_version_id='+oldfile)['data']['source_ids']==[soldfile]
for suffix in ['/related/stats','/wiki/pages','/wiki/graph','/graph']:
    get(root+suffix+'?parse_version_id='+pb,404)
    get(root+suffix+'?file_version_id='+fa+'&parse_version_id='+oldfileparse,404)
    get(root+suffix+'?file_version_id='+uid(),404)
    get(root+suffix+'?parse_version_id=invalid',400)
assert get(root+'/graph?parse_version_id='+oldparse)['data']['nodes'][0]['description']!='其他文件描述'
check('历史文件/解析版本修订与来源保持，错误版本不回退')
all_relations=set();descriptions=set();cursor='';record_count=0
while True:
    graph=get(root+'/graph?page_size=7&parse_version_id='+pa+('&cursor='+cursor if cursor else ''))['data']
    assert graph['meta']['total_records']==103
    record_count+=graph['meta']['returned_records']
    for node in graph['nodes']:
        assert node['source_ids']==[sa]
        descriptions.update(d['text'] for d in node['descriptions'])
    for r in graph['relations']:
        assert r['id'] not in all_relations and r['source_ref_id']==sa
        all_relations.add(r['id'])
    if not graph['meta']['has_more']:break
    cursor=graph['meta']['next_cursor']
assert record_count==103 and len(all_relations)==103 and '描述102' in descriptions and '其他文件描述' not in descriptions
get(root+'/graph?parse_version_id='+oldparse+'&cursor='+cursor,400)
get(root+'/graph?cursor=invalid',400)
check('证据分页完整、同名描述保留、无关系实体、游标版本检查')
for ref,pid,fid in [(sa,pa,fa),(sold,oldparse,fa),(soldfile,oldfileparse,oldfile)]:
    source=get('/sources/'+ref)['data'];assert source['parse_version_id']==pid and source['file_version_id']==fid and source['locators']
    assert 'source_ref_id='+ref in source['preview_url']
check('页码/单元格/音视频来源及预览链接保持原版本')
es=get('/knowledge/'+empty+'/related/stats')['data'];assert es['wiki_pages']==0 and es['parse_version_id']=='' and es['stages']['wiki']['state']=='waiting_configuration'
assert get('/knowledge/'+empty+'/graph')['data']['nodes']==[]
assert get('/knowledge/'+empty+'/wiki/pages')['data']==[]
check('未配置和无结果返回真实状态及空数组')
spec=get('/openapi.json')
for suffix in ['/related/stats','/wiki/pages','/wiki/pages/{page}','/wiki/graph','/graph']:
    op=spec['paths']['/api/v1/knowledge/{id}'+suffix]['get']
    assert 'description' in op and 'properties' in op['responses']['200']['content']['application/json']['schema']
assert fingerprint()==before
check('OpenAPI 完整，查询未改写解析/Wiki/图谱/来源记录')
out=Path(__file__).resolve().parents[1]/'test-results'/'document-related.json'
out.write_text(json.dumps({'knowledge_base_id':kb,'document_id':a,'shared_page_id':shared,'parse_version_id':pa,'old_parse_version_id':oldparse,'pending_document_id':empty},ensure_ascii=False),encoding='utf-8')
print('UI fixture:',a)
