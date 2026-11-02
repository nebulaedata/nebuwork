"""Isolated real API acceptance: two engines, versions, sources and table previews."""
from client import *
import subprocess

assert BASE=='http://127.0.0.1:19081/api/v1','Only use isolated services'
folder=Path(__file__).resolve().parents[1]/'test-results'/'excel-fixtures'
bindings={}
for purpose in ['text','vision','embedding']:
    bindings[purpose]=request('/models',dict(name='Excel '+purpose,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,dimension=16 if purpose=='embedding' else None))['id']
defaults=request('/settings/parser-defaults')
assert defaults['parser_engines']['spreadsheet']=='excel'
documents=[]
for engine in ['excel','anydoc']:
    kb=request('/knowledge-bases',{'name':'Excel 验收 '+engine,'config':{'parser_engines':{'spreadsheet':engine},'chunk_size':128,'chunk_overlap':20,'model_bindings':bindings,'excel':{'header_rows':[],'sheets':{'设备清单':{'header_rows':[1]}}},'wiki_enabled':True,'graph_enabled':True,'outline_enabled':True,'image_caption':True,'image_embedding':False}})['id']
    for ext in ['xlsx','xls']:
        doc=upload(kb,'表格验收.'+ext,(folder/('sample.'+ext)).read_bytes())
        task=wait_task(doc['task_id'],timeout=150);kid=doc['knowledge_id'];documents.append(kid)
        assert task['checkpoint'].get('parse')=='succeeded',task
        assert task['checkpoint'].get('wiki')=='succeeded' and task['checkpoint'].get('graph')=='succeeded',task
        content=request('/knowledge/'+kid+'/content');pid=content['parse_version_id'];fid=content['file_version_id']
        sheets=request('/knowledge/'+kid+'/sheets');assert 'path' not in sheets
        assert [s['name'] for s in sheets['sheets']]==['设备清单','预算']
        assert sheets['file_version_id']==fid and sheets['parse_version_id']==pid
        view=request('/knowledge/'+kid+'/preview/manifest');assert view['type']=='spreadsheet'
        cells=request('/knowledge/'+kid+'/sheets/1/cells?row_start=1&row_count=15&column_count=8')
        entries={c['address']:c for r in cells['rows'] for c in r['cells']}
        assert entries['D2']['display']=='00123' and entries['C2']['display']=='12.50%',entries
        assert any(m['range']=='A5:A7' and m['master']['value']=='华东区域' for m in cells['merged_ranges'])
        offscreen=request('/knowledge/'+kid+'/sheets/1/cells?row_start=6&row_count=1&column_count=2')
        assert offscreen['merged_ranges'][0]['master']['address']=='A5'
        request('/knowledge/'+kid+'/sheets/1/cells?row_count=201',expected=400)
        request('/knowledge/'+kid+'/sheets/1/cells?file_version_id='+str(uuid.uuid4()),expected=422)
        chunks=request('/knowledge/'+kid+'/chunks?page_size=100')
        target=next(c for c in chunks if '变压器' in c['content'])
        source=request('/sources/'+target['source_ref_id'])
        assert source['locators'][0]['sheet']=='设备清单',source
        assert source['context_sources'] and all(s['locators'][0]['role']=='header' for s in source['context_sources'])
        assert source['char_start']==target['char_start']
        assert content['content'][source['char_start']:source['char_end']].strip()==source['quote']
        assert all(s['source_ref_id'] in target['context_source_ref_ids'] for s in source['context_sources'])
        if ext=='xlsx':assert target['images'],target
        images=request('/knowledge/'+kid+'/images');assert images
        assert request('/images/'+images[0]['id'])['caption_ready'],task
        result=request('/search',{'query_text':'变压器','mode':'keyword','knowledge_base_ids':[kb],'knowledge_ids':[kid],'include_sources':True})
        assert result.get('results') or result.get('items') or result.get('hits'),result
        wiki=request('/knowledge-bases/'+kb+'/wiki/pages')
        cited=[sid for page in wiki for sid in page['source_ids']]
        assert target['source_ref_id'] in cited
        cited_source=request('/sources/'+target['source_ref_id'])
        assert cited_source['context_sources'] and cited_source['file_version_id']==fid
        graph=request('/knowledge-bases/'+kb+'/graph')
        assert graph['relations'],graph
        graph_sources=[request('/sources/'+r['source_ref_id']) for r in graph['relations']]
        assert any(s['locators'][0].get('sheet')=='预算' and s['file_version_id']==fid for s in graph_sources)
        outline=request('/knowledge/'+kid+'/outline');assert outline['status']=='ready',outline
        progress=task['checkpoint']['pipeline']['stages'][0]['children']
        assert any(c.get('progress',{}).get('sheet') for c in progress),progress
        check(True,engine+' / '+ext+': source cells, formats, merged areas, header references, images, search and outline')
        if engine=='excel' and ext=='xlsx':
            before=request('/knowledge/'+kid+'/content')
            saved=request('/knowledge/'+kid+'/spreadsheet-settings',{'file_version_id':fid,'excel':{'header_rows':[],'sheets':{'设备清单':{'header_rows':[1,2]}}}},method='PUT')
            assert saved['requires_reparse'] and request('/knowledge/'+kid+'/content')==before
            request('/knowledge/'+kid+'/spreadsheet-settings',{'file_version_id':str(uuid.uuid4()),'excel':{}},method='PUT',expected=409)
            request('/knowledge/'+kid+'/spreadsheet-settings',{'file_version_id':fid},method='PUT',expected=400)
            request('/knowledge/'+kid+'/spreadsheet-settings',{'file_version_id':fid,'excel':{'sheets':{'设备清单':{'header_rows':[999]}}}},method='PUT',expected=400)
            rerun=request('/knowledge/'+kid+'/reparse',{},expected=202)
            wait_task(rerun['task_id'],timeout=150)
            latest=request('/knowledge/'+kid+'/content');assert latest['parse_version_id']!=pid
            assert request('/knowledge/'+kid+'/content?parse_version_id='+pid)==before
            assert request('/sources/'+target['source_ref_id'])==source
            old=request('/knowledge/'+kid+'/sheets?parse_version_id='+pid);assert old['parse_version_id']==pid
            newchunks=request('/knowledge/'+kid+'/chunks?page_size=100')
            headerrefs=[request('/sources/'+i) for c in newchunks for i in c['context_source_ref_ids']]
            assert any(s['locators'][0]['row_start']==2 for s in headerrefs)
            check(True,'保存不重跑；显式重跑应用表头；旧解析和原文引用保持不变')
            # An older parse has no structure metadata: GET generates only a
            # source preview cache and leaves its content/refs unchanged.
            query=f"UPDATE nebulaekno.parse_versions SET metadata=metadata-'spreadsheet' WHERE id='{pid}';"
            subprocess.run(['docker','exec','-i','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-v','ON_ERROR_STOP=1'],input=query.encode(),check=True,stdout=subprocess.DEVNULL)
            assert request('/knowledge/'+kid+'/sheets?parse_version_id='+pid)['file_version_id']==fid
            assert request('/knowledge/'+kid+'/content?parse_version_id='+pid)==before
            assert request('/sources/'+target['source_ref_id'])==source
            check(True,'旧文件结构预览独立缓存，未改成功内容或引用')
(folder/'acceptance.json').write_text(json.dumps({'documents':documents},ensure_ascii=False),encoding='utf-8')
