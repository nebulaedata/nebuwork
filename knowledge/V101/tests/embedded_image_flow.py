"""Version-safe illustrated content, actual image bytes, additive repair and captions."""
from client import *
import subprocess
import sys

assert BASE=='http://127.0.0.1:19081/api/v1','Only use isolated integration services'
APP='nebulaekno-config-test-app-1';DB='nebulaekno-config-test-postgres-1'
def sql(query):
    return subprocess.check_output(['docker','exec','-i',DB,'psql','-X','-U','nebulaekno','-d','nebulaekno','-At','-v','ON_ERROR_STOP=1'],input=query.encode()).decode().strip()
bindings={}
for purpose in ['text','vision','embedding']:
    m=request('/models',dict(name='Image coverage '+purpose,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,dimension=16 if purpose=='embedding' else None))
    bindings[purpose]=m['id']
request('/settings/model-bindings',bindings,method='PUT')
folder=Path(__file__).resolve().parents[1]/'test-results'/'image-fixtures'
documents=[]
for engine,extensions in [('anydoc',['docx','pptx','xlsx','doc','ppt','xls','odt','odp','ods','rtf']),('native',['pptx','xlsx'])]:
    kb=request('/knowledge-bases',{'name':'Image regression '+engine,'config':{'parser_engines':{'word':engine,'presentation':engine,'spreadsheet':engine},'image_caption':True,'image_embedding':False,'outline_enabled':False,'wiki_enabled':False,'graph_enabled':False}})['id']
    for ext in extensions:
        doc=upload(kb,'image-check.'+ext,(folder/('sample.'+ext)).read_bytes())
        task=wait_task(doc['task_id']);assert task['state']=='succeeded',task
        id=doc['knowledge_id'];documents.append(id)
        content=request('/knowledge/'+id+'/content');occurrences=content['image_occurrences']
        assert occurrences,(ext,engine,content)
        images=request('/knowledge/'+id+'/images');chunks=request('/knowledge/'+id+'/chunks?page_size=100')
        assert images and any(c['images'] for c in chunks)
        assert all(i['parse_version_id']==content['parse_version_id'] for o in occurrences for i in o['images'])
        for image in images:
            detail=request('/images/'+image['id']);assert detail['caption_ready']
            with urllib.request.urlopen(BASE+'/images/'+image['id']+'/content') as response:
                assert response.read().startswith(b'\x89PNG')
        if ext=='pptx':assert {o['images'][0]['locators'][0]['slide'] for o in occurrences}=={1,2}
        if ext=='xlsx':assert occurrences[0]['images'][0]['locators'][0]['cell_range']=='C4'
        check(True,ext+' / '+engine+': image API, inline occurrences, chunks, image bytes and captions')

# Missing legacy asset, while retaining its immutable parse text and metadata.
id=documents[0]
before_content=request('/knowledge/'+id+'/content')
parse_id=before_content['parse_version_id']
sql("BEGIN; DELETE FROM nebulaekno.chunks WHERE source_ref_id IN (SELECT id FROM nebulaekno.source_refs WHERE parse_version_id='"+parse_id+"' AND coalesce(metadata->>'image_path','')<>''); DELETE FROM nebulaekno.source_refs WHERE parse_version_id='"+parse_id+"' AND coalesce(metadata->>'image_path','')<>''; DELETE FROM nebulaekno.assets WHERE knowledge_id='"+id+"' AND kind='image'; COMMIT;")
snapshot=lambda:sql("SELECT jsonb_build_object('parse',(SELECT to_jsonb(p) FROM nebulaekno.parse_versions p WHERE id='"+parse_id+"'),'text_chunks',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM nebulaekno.chunks c JOIN nebulaekno.source_refs s ON s.id=c.source_ref_id WHERE c.parse_version_id='"+parse_id+"' AND coalesce(s.metadata->>'image_path','')=''))")
before=snapshot()
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from repair_embedded_images import repair
report=repair(id,APP,DB,True);assert report['new_images']==1 and report['applied'],report
assert snapshot()==before,'Repair modified existing content or chunks'
assert not repair(id,APP,DB,True)['applied'],'Repair must be idempotent'
content=request('/knowledge/'+id+'/content');assert content['content']==before_content['content']
assert content['image_occurrences'] and not content['image_occurrences'][0]['unplaced']
job=request('/knowledge/'+id+'/images/rebuild',{},expected=202)
assert wait_task(job['task_id'])['state']=='succeeded'
image=request('/knowledge/'+id+'/images')[0]
detail=request('/images/'+image['id']);assert detail['caption_ready']
caption=detail['source_refs']
job=request('/knowledge/'+id+'/images/rebuild',{},expected=202)
assert wait_task(job['task_id'])['state']=='succeeded'
assert request('/images/'+image['id'])['source_refs']==caption,'Repeated supplement must preserve successful captions'
assert snapshot()==before,'Supplement must preserve parse/text sources'
check(True,'Additive repair, idempotence, original text/IDs preservation and caption-only supplement')
print(json.dumps({'documents':documents,'repair':report},ensure_ascii=False))
