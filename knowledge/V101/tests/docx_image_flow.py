"""Isolated acceptance for inline DOCX images and metadata-only legacy repair."""
from client import *
import io
import subprocess
import sys
from docx import Document
from docx.shared import Inches

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from repair_docx_image_links import repair
from test_docx_images import fixture, image_bytes, ALT

assert BASE=='http://127.0.0.1:19081/api/v1', 'Only use the isolated test stack'
APP='nebulaekno-config-test-app-1'
DB='nebulaekno-config-test-postgres-1'

def sql(query):
    return subprocess.check_output(['docker','exec','-i',DB,'psql','-X','-U','nebulaekno','-d','nebulaekno','-At','-v','ON_ERROR_STOP=1'],input=query.encode()).decode().strip()

bindings={}
for purpose in ['text','vision','embedding']:
    model=request('/models',dict(name='DOCX image test '+purpose,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,dimension=16 if purpose=='embedding' else None))
    bindings[purpose]=model['id']
request('/settings/model-bindings',bindings,method='PUT')

def library(engine):
    return request('/knowledge-bases',{'name':'DOCX images '+engine,'config':{'parser_engines':{'word':engine},'image_caption':True,'image_embedding':False,'outline_enabled':False,'wiki_enabled':False,'graph_enabled':False}})['id']

def ingest(kb,name,data):
    doc=upload(kb,name,data)
    task=wait_task(doc['task_id'])
    assert task['state']=='succeeded',task
    return doc['knowledge_id']

for engine in ['anydoc','native']:
    kb=library(engine)
    id=ingest(kb,engine+'.docx',fixture())
    chunks=request('/knowledge/'+id+'/chunks?page_size=100')
    raw=[c for c in chunks if c['images'] and c['content_origin'] not in ('image_caption','frame_caption')]
    assert len(raw)==4,[(c['ordinal'],c['content_origin'],c['locators']) for c in raw]
    assert [c['locators'][0].get('paragraph_id') for c in raw]==['2','4','5',None]
    assert raw[-1]['locators'][0]['column']==2
    assert raw[0]['images'][0]['id']==raw[1]['images'][0]['id']
    assert all(c['images'][0]['locators']==c['locators'] for c in raw)
    assert all('page' not in c['locators'][0] for c in raw)
    assert all(ALT not in c['content'] for c in chunks)
    assert chunks[0]['content']=='开头' and chunks[1]['id']==raw[0]['id'] and chunks[2]['content']=='中间'
    images=request('/knowledge/'+id+'/images')
    assert len(images)==2
    for image in images:
        detail=request('/images/'+image['id'])
        assert detail['caption_ready'] and detail['recognized_text']==''
        assert any(s['origin']=='image_caption' for s in detail['source_refs'])
        with urllib.request.urlopen(BASE+'/images/'+image['id']+'/content') as response:
            assert response.read().startswith(b'\x89PNG\r\n\x1a\n')
    check(True,engine+': inline order, repeated images, table positions, image bytes and captions')

document=Document();document.add_paragraph('Before image')
shape=document.add_paragraph().add_run().add_picture(io.BytesIO(image_bytes('blue')),width=Inches(1))
shape._inline.docPr.set('descr',ALT)
document.add_paragraph('After image');stream=io.BytesIO();document.save(stream)
id=ingest(library('anydoc'),'legacy-image.docx',stream.getvalue())
chunks=request('/knowledge/'+id+'/chunks?page_size=100')
picture=next(c for c in chunks if c['images'] and c['content_origin']=='anydoc')
sql("BEGIN; UPDATE nebulaekno.chunks SET content='"+ALT+"' WHERE id='"+picture['id']+"'; UPDATE nebulaekno.source_refs SET quote='"+ALT+"',metadata=metadata-'image_path'-'layout'-'block_type',locators='[{\"type\":\"document\",\"parser\":\"anydoc\",\"parsed_block\":2}]'::jsonb,precision='document' WHERE id='"+picture['source_ref_id']+"'; COMMIT;")
def preserved():
    return sql("SELECT jsonb_agg(to_jsonb(c) ORDER BY ordinal)::text FROM nebulaekno.chunks c WHERE knowledge_id='"+id+"'; SELECT jsonb_agg(to_jsonb(p))::text FROM nebulaekno.parse_versions p WHERE knowledge_id='"+id+"'; SELECT jsonb_agg(jsonb_build_object('id',s.id,'quote',s.quote,'metadata',s.metadata) ORDER BY s.id)::text FROM nebulaekno.source_refs s WHERE knowledge_id='"+id+"' AND origin='image_caption';")
before=preserved()
dry=repair(id,APP,DB)
assert dry['updated_sources']>0 and not dry['applied']
assert preserved()==before
result=repair(id,APP,DB,True)
assert result['applied'] and Path(result['backup']).is_file()
assert preserved()==before, 'Repair must preserve chunks, parse metadata and captions exactly'
fixed=next(c for c in request('/knowledge/'+id+'/chunks?page_size=100') if c['id']==picture['id'])
assert fixed['layout']['reference_only'] and fixed['content']==ALT and len(fixed['images'])==1
assert fixed['locators'][0]['paragraph_id']=='2'
again=repair(id,APP,DB,True)
assert again['updated_sources']==0 and not again['applied'],again
check(True,'Legacy metadata repair is reversible and idempotent; content, IDs, parse data and captions unchanged')
print('DOCX image flow passed.',flush=True)
