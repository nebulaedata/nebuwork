"""Isolated WPS acceptance; never run against user/development data."""
from client import *
import subprocess

assert BASE=='http://127.0.0.1:19081/api/v1','Only use isolated services'
folder=Path(__file__).resolve().parents[1]/'test-results'/'wps-fixtures'
formats=['wps','wpt','et','ett','dps','dpt']
available={item['extension'] for item in request('/file-formats')}
assert set(formats)<=available
bindings={}
for purpose in ['text','vision','embedding']:
    bindings[purpose]=request('/models',dict(name='WPS 验收 '+purpose,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,dimension=16 if purpose=='embedding' else None))['id']
documents=[]
for alternate in [False,True]:
    engines={ext:('anydoc' if alternate else 'excel') if ext in ('et','ett') else ('native' if alternate else 'anydoc') for ext in formats}
    kb=request('/knowledge-bases',{'name':'WPS 验收 '+('兼容引擎' if alternate else '默认引擎'),'config':{'parser_engines':engines,'model_bindings':bindings,'wiki_enabled':True,'graph_enabled':True,'outline_enabled':True,'image_caption':True,'image_embedding':False,'excel':{'header_rows':[]}}})['id']
    for ext in formats:
        raw=(folder/('sample.'+ext)).read_bytes()
        doc=upload(kb,'WPS 验收.'+ext,raw);kid=doc['knowledge_id'];documents.append(kid)
        task=wait_task(doc['task_id'],timeout=150)
        assert task['checkpoint'].get('parse')=='succeeded',task
        assert task['checkpoint'].get('wiki')=='succeeded' and task['checkpoint'].get('graph')=='succeeded',task
        content=request('/knowledge/'+kid+'/content');pid=content['parse_version_id'];fid=content['file_version_id']
        conversion=content['conversion'];assert conversion['source_format']==ext
        assert conversion['source_sha256']==hashlib.sha256(raw).hexdigest()
        assert urllib.request.urlopen(BASE+'/knowledge/'+kid+'/download?file_version_id='+fid).read()==raw
        chunks=request('/knowledge/'+kid+'/chunks?page_size=100')
        textchunk=next(c for c in chunks if 'NebulaeKno' in c['content'])
        source=request('/sources/'+textchunk['source_ref_id'])
        assert source['file_version_id']==fid and source['locators'][0]['source_format']==ext
        imagechunks=[c for c in chunks if c['images']];assert imagechunks
        image=request('/images/'+imagechunks[0]['images'][0]['id'])
        assert image['caption_ready'] and image['locators'][0]['source_format']==ext
        view=request('/knowledge/'+kid+'/preview/manifest?file_version_id='+fid+'&parse_version_id='+pid)
        if ext in ('et','ett'):
            assert view['type']=='spreadsheet'
            cells=request('/knowledge/'+kid+'/sheets/1/cells')
            entries={c['address']:c for row in cells['rows'] for c in row['cells']}
            assert entries['C2']['display']=='12.50%' and entries['D2']['display']=='00123'
            assert source['locators'][0]['mapping']=='exact'
            assert image['locators'][0]['mapping']=='converted_structure'
            saved=request('/knowledge/'+kid+'/spreadsheet-settings',{'file_version_id':fid,'excel':{'sheets':{'设备清单':{'header_rows':[1]}}}},method='PUT')
            assert saved['requires_reparse'] and request('/knowledge/'+kid+'/content')==content
        else:
            assert view['type']=='pdf',view
            assert source['mapping_method']=='converted_structure' and source['partial'] is True,source
            assert '转换副本' in source['mapping_reason']
        found=request('/search',{'query_text':'NebulaeKno','mode':'keyword','knowledge_base_ids':[kb],'knowledge_ids':[kid],'include_sources':True})
        assert found.get('results') or found.get('items') or found.get('hits'),found
        phases=task['checkpoint']['pipeline']['stages'][0]['children']
        assert any(p['name']=='inspect_wps' for p in phases),phases
        check(True,ext+' / '+engines[ext]+' 上传、图片、检索、来源与预览')
        if ext=='wps' and not alternate:
            # Simulate a damaged stored input only in this disposable environment,
            # then restore its bytes. Failed parsing must not replace successful
            # parse content, chunks, images, Wiki, graph or source references.
            query=f"SELECT path FROM nebulaekno.file_versions WHERE id='{fid}';"
            path=subprocess.run(['docker','exec','-i','nebulaekno-config-test-postgres-1','psql','-U','nebulaekno','-d','nebulaekno','-At'],input=query,text=True,encoding='utf-8',capture_output=True,check=True).stdout.strip()
            assert path.startswith('/data/files/') and path.endswith('.wps')
            wiki=request('/knowledge-bases/'+kb+'/wiki/pages');graph=request('/knowledge-bases/'+kb+'/graph')
            write=['docker','exec','-i','nebulaekno-config-test-app-1','python3','-c','import sys;from pathlib import Path;Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())',path]
            try:
                subprocess.run(write,input=b'invalid WPS container',check=True)
                failed=wait_task(request('/knowledge/'+kid+'/reparse',{},expected=202)['task_id'])
                assert failed['state']=='failed' and 'WPS_UNSUPPORTED_VARIANT' in json.dumps(failed),failed
                assert request('/knowledge/'+kid+'/content')==content
                assert request('/knowledge/'+kid+'/chunks?page_size=100')==chunks
                assert request('/sources/'+source['source_ref_id'])==source
                assert request('/knowledge-bases/'+kb+'/wiki/pages')==wiki
                assert request('/knowledge-bases/'+kb+'/graph')==graph
            finally:
                subprocess.run(write,input=raw,check=True)
            assert urllib.request.urlopen(BASE+'/knowledge/'+kid+'/download?file_version_id='+fid).read()==raw
            check(True,'处理失败保留原解析、分块、图片、Wiki、图谱和来源')
    for ext,raw,code in [('wps',b'unsupported old file','WPS_UNSUPPORTED_VARIANT'),('et',(folder/'sample.dps').read_bytes(),'WPS_FORMAT_MISMATCH'),('dpt',b'PK\x03\x04broken','WPS_CORRUPT_FILE')]:
        doc=upload(kb,'错误样本.'+ext,raw)
        task=wait_task(doc['task_id']);assert task['state']=='failed' and code in json.dumps(task),task
        assert urllib.request.urlopen(BASE+'/knowledge/'+doc['knowledge_id']+'/download').read()==raw
    check(True,'损坏、错配、不支持内部版本均明确失败且保留原文件')
(folder/'acceptance.json').write_text(json.dumps({'documents':documents},ensure_ascii=False),encoding='utf-8')
