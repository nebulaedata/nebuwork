"""Graph search uses partial synced evidence without writing or rerunning data.

Only the isolated config test database/Neo4j are modified by this fixture.
"""
import json
import os
import subprocess
import uuid

from client import BASE, check, request

assert BASE == 'http://127.0.0.1:19081/api/v1'
PG = 'nebulaekno-config-test-postgres-1'
GRAPH = 'nebulaekno-config-test-graph-1'


def uid():
    return str(uuid.uuid4())


def literal(value):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    return "'" + value.replace("'", "''") + "'"


def sql(query):
    result = subprocess.run(['docker', 'exec', '-i', PG, 'psql', '-U', 'nebulaekno', '-d', 'nebulaekno', '-At', '-v', 'ON_ERROR_STOP=1'],
        input='SET search_path=nebulaekno,public;\n' + query, text=True, encoding='utf-8', capture_output=True, check=True)
    return result.stdout.strip().removeprefix('SET\n')


def cypher(query):
    subprocess.run(['docker', 'exec', '-i', GRAPH, 'cypher-shell', '-u', 'neo4j', '-p', 'integration-only', '--format', 'plain'],
        input=query, text=True, encoding='utf-8', capture_output=True, check=True)


kb, foreign_kb, empty_kb = uid(), uid(), uid()
sql(';\n'.join("INSERT INTO knowledge_bases(id,name) VALUES (%s,%s)" % (literal(k), literal(name))
    for k, name in [(kb, '图谱部分可用验收'), (foreign_kb, '图谱范围隔离验收'), (empty_kb, '图谱空库验收')]) + ';')
installation = sql('SELECT id FROM installation;')


def document(name, state='failed', library=kb, parsed=True):
    kid, fid, pid, task = uid(), uid(), uid(), uid()
    sql(f"""BEGIN;
INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status,current_file_version_id,current_parse_version_id,tags)
VALUES ('{kid}','{library}',{literal(name)},'txt','partially_failed','{fid}',{'NULL' if not parsed else literal(pid)},'["in-scope"]');
INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES ('{fid}','{kid}','fixture','/data/files/{fid}.txt',100,'text/plain');
""" + (f"""INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content) VALUES ('{pid}','{kid}','{fid}','native','Codex fixture');
INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,stage,checkpoint,idempotency_key)
VALUES ('{task}','{library}','{kid}','ingest','partially_failed','graph',{literal({'parse_version_id':pid,'graph':state})},'{task}');
""" if parsed else '') + 'COMMIT;')
    return {'id': kid, 'file': fid, 'parse': pid, 'task': task, 'kb': library}


partial = document('部分完成图谱.txt')
failed = document('无成功分块.txt')
pending = document('仅待同步.txt')
completed_empty = document('完成但无实体.txt', 'succeeded')
unparsed = document('尚未解析.txt', parsed=False)
foreign = document('其他知识库.txt', library=foreign_kb)


def evidence(doc, ordinal, status='synced', origin='file', version=None, locators=None):
    source, record = uid(), uid()
    version = version or doc['parse']
    text = 'Codex current evidence ' + str(ordinal)
    sql(f"""BEGIN;
INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin)
VALUES ('{source}','{doc['id']}','{doc['file']}','{version}',{literal(locators or [{'type':'paragraph','paragraph':ordinal+1}])},{literal(text)},'exact',0,{len(text)},{literal(origin)});
INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector)
VALUES ('{uid()}','{doc['id']}','{version}','{source}',{ordinal},{literal(text)},to_tsvector('simple',{literal(text)}));
""" + (f"""INSERT INTO graph_records(id,knowledge_id,source_ref_id,payload,synced_at)
VALUES ('{record}','{doc['id']}','{source}',{literal({'entities':[{'Name':'Codex','Type':'产品','Description':text,'Quote':text,'source_ref_id':source}],'relations':[]})},{'now()' if status=='synced' else 'NULL'});
""" if status != 'absent' else '') + 'COMMIT;')
    if status != 'absent':
        # Include even unsynced sources in Neo4j to simulate interrupted writes.
        cypher("MERGE(n:NebulaeKnoEntity {installation_id:%s,kb_id:%s,name:'Codex'}) SET n.source_ids=apoc.coll.union(coalesce(n.source_ids,[]),[%s]);" %
            tuple(json.dumps(v) for v in (installation, doc['kb'], source)))
    return source, record


good, _ = evidence(partial, 0)
ocr, _ = evidence(partial, 1, origin='ocr', locators=[{'type':'time','start_ms':1000,'end_ms':4000}])
unsynced, pending_record = evidence(partial, 2, status='pending')
evidence(partial, 3, status='absent')
evidence(failed, 0, status='absent')
evidence(completed_empty, 0, status='absent')
evidence(pending, 0, status='pending')
foreign_source, _ = evidence(foreign, 0)
old_parse = uid()
sql(f"INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content) VALUES ('{old_parse}','{partial['id']}','{partial['file']}','native','Codex historical evidence');")
old, _ = evidence(partial, 0, version=old_parse)
# Also reject an inconsistent chunk pointing to an old-version source.
sql(f"INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) VALUES ('{uid()}','{partial['id']}','{partial['parse']}','{old}',9,'Codex inconsistent source',to_tsvector('simple','Codex inconsistent source'));")


def search(doc=partial, mode='graph', expected=200, query='Codex', **options):
    body = {'mode': mode, 'query_text': query, 'knowledge_base_ids': [doc['kb']], 'knowledge_ids': [doc['id']],
        'include_sources': True, 'rerank': {'mode':'disabled'}, **options}
    return request('/search', body, expected=expected)


before = sql(f"SELECT md5(string_agg(to_jsonb(g)::text,'' ORDER BY id)) FROM graph_records g WHERE knowledge_id='{partial['id']}';")
result = search()
refs = {ref['source_ref_id'] for hit in result['results'] for ref in hit['source_refs']}
assert refs == {good, ocr}, (refs, result)
coverage = result['meta']['graph_coverage']
assert coverage == {'documents':1,'completed_documents':0,'indexed_documents':1,'evidence_records':3,'synced_records':2,'pending_sync_records':1,'partial':True}, coverage
assert any(w['code']=='GRAPH_PARTIAL_COVERAGE' for w in result['meta']['warnings'])
check(True, '部分失败仍返回已同步证据，旧版本、未同步及跨库证据不混入')
assert not search(query='NeverMatchingFixture')['results']
check(True, '部分图谱中无匹配时正常返回空结果和覆盖提示')

sql(f"UPDATE tasks SET state='running',owner='{uid()}',lease_until=now()+interval '1 hour',checkpoint=jsonb_set(checkpoint,'{{graph}}','\"running\"') WHERE id='{partial['task']}';")
assert search()['results']
check(True, '仍在生成时已同步内容可即时查询')
assert search(failed, expected=409)['code']=='INDEX_NOT_READY'
assert '同步' in search(pending, expected=409)['message']
assert search(unparsed, expected=409)['code']=='INDEX_NOT_READY'
assert request('/search/graph', {'query_text':'Codex','knowledge_base_ids':[empty_kb]}, expected=409)['code']=='INDEX_NOT_READY'
check(True, '全失败、未解析、仅待同步及空库保持明确就绪提示，其他文档成功不能绕过范围限制')
assert search(completed_empty)['results']==[]
check(True, '图谱阶段完成但无实体时仍正常返回空结果')
result = search(filters={'content_origins':['ocr'],'file_types':['txt'],'tags':['in-scope'],'time_start_ms':2000,'time_end_ms':4000})
assert len(result['results'])==1 and result['results'][0]['source_refs'][0]['source_ref_id']==ocr
assert result['meta']['graph_coverage']['synced_records']==1 and result['meta']['graph_coverage']['pending_sync_records']==0
check(True, '覆盖统计与文档、格式、标签、来源及时间过滤保持一致')
multi = search(pending, mode='multi', multi={'channels':['graph','keyword']})
assert multi['results'] and any(w['channel']=='graph' and w['code']=='INDEX_NOT_READY' for w in multi['meta']['warnings'])
assert search(pending, mode='keyword')['results']
assert 'graph_coverage' not in search(pending, mode='keyword')['meta']
assert search(mode='multi', multi={'channels':['graph','keyword']})['results']
check(True, '关键词与多路检索保留原有行为，图谱未就绪不阻断其他可用通道')
assert before == sql(f"SELECT md5(string_agg(to_jsonb(g)::text,'' ORDER BY id)) FROM graph_records g WHERE knowledge_id='{partial['id']}';")
check(True, '查询不会修改图谱证据或重新执行数据处理')

sql(f"UPDATE graph_records SET synced_at=now() WHERE id='{pending_record}'; UPDATE tasks SET state='succeeded',owner=NULL,lease_until=NULL,checkpoint=jsonb_set(checkpoint,'{{graph}}','\"succeeded\"') WHERE id='{partial['task']}';")
complete = search()
assert not complete['meta']['graph_coverage']['partial'] and not complete['meta']['warnings']
assert len(complete['results'])==3
check(True, '同步及阶段完成后自动使用新增证据并去除覆盖警告')
sql(f"UPDATE tasks SET state='partially_failed',checkpoint=jsonb_set(checkpoint,'{{graph}}','\"failed\"') WHERE id='{partial['task']}';")
print('GRAPH_PARTIAL_SEARCH_OK', partial['id'], kb, flush=True)
