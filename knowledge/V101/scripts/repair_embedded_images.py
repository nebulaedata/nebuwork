"""Add missing image assets/sources without replacing successful parse/model data.

Explicit document and containers required. Dry-run by default. Existing content,
chunk/source IDs, captions, Wiki and graph evidence are never rewritten.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import uuid


def repair(document_id, app, database, apply=False, backup_dir='test-results'):
    document_id=str(uuid.UUID(document_id))
    quote=lambda s:"'"+s.replace("'","''")+"'"
    encode=lambda value:quote(json.dumps(value,ensure_ascii=False))+'::jsonb'
    def sql(query):
        return subprocess.check_output(['docker','exec','-i',database,'psql','-X','-U','nebulaekno','-d','nebulaekno','-At','-v','ON_ERROR_STOP=1'],input=query.encode()).decode().strip()
    doc=json.loads(sql("SELECT jsonb_build_object('parse_id',p.id,'file_id',f.id,'path',f.path,'file_type',k.file_type,'engine',p.engine,'content',p.content,'metadata',p.metadata) FROM nebulaekno.knowledge k JOIN nebulaekno.parse_versions p ON p.id=k.current_parse_version_id JOIN nebulaekno.file_versions f ON f.id=k.current_file_version_id WHERE k.id="+quote(document_id)))
    if doc['engine']!='anydoc' or doc['file_type'] not in ('doc','docx','docm','ppt','pptx','pptm','xls','xlsx','xlsm','odt','odp','ods','epub','rtf'):
        raise ValueError('Only supported anydoc Office/archive repairs are allowed')
    parse_id=quote(doc['parse_id'])
    assets=json.loads(sql("SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM nebulaekno.assets a WHERE knowledge_id="+quote(document_id)+" AND file_version_id="+quote(doc['file_id'])+" AND kind='image' AND metadata->>'parse_version_id'="+parse_id))
    sources=json.loads(sql("SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM nebulaekno.source_refs s WHERE parse_version_id="+parse_id))
    script="""
import sys,json
from pathlib import Path
sys.path.insert(0,'/app/reader')
from anydoc_adapter import parse_anydoc
from embedded_images import pixel_identity
request=json.loads(sys.stdin.read())
output=Path(request['output']);output.mkdir(parents=True,exist_ok=True)
blocks,assets=parse_anydoc(Path(request['path']),output,{},lambda:[])
print(json.dumps({'blocks':blocks,'assets':assets,'hashes':{a['path']:pixel_identity(a['path']) for a in assets+request['assets'] if a['kind']=='image'}},ensure_ascii=False))
"""
    output='/data/derived/'+document_id+'/'+doc['parse_id']+'/embedded-image-repair-v1'
    data=json.loads(subprocess.check_output(['docker','exec','-i',app,'python3','-c',script],input=json.dumps({'path':doc['path'],'output':output,'assets':assets}).encode()))
    originals={data['hashes'][a['path']]:a for a in assets}
    additions=[];updates={};new_sources=[];seen=set()
    old_blocks=[];offset=0
    clean=lambda text:re.sub(r'\s+','',text)
    for b in doc['metadata'].get('blocks',[]):
        old_blocks.append((b,offset));offset+=len(b.get('text',''))+1
    def position(b):
        loc=b['locator']
        originals=[(old,start) for old,start in old_blocks if old.get('image_path') and loc.get('part')
                   and old['locator'].get('part')==loc['part']
                   and all(old['locator'].get(k)==loc.get(k) for k in ('paragraph_id','table_id','row','slide','sheet'))]
        if len(originals)==1:
            old,start=originals[0]
            unplaced=old.get('layout',{}).get('unplaced',old['locator'].get('type')=='document' and 'asset_id' not in old.get('layout',{}))
            return start,unplaced
        anchor=b.get('layout',{}).get('anchor_before_text')
        candidates=[(block,start) for block,start in old_blocks if anchor and clean(block.get('text',''))==clean(anchor)]
        if len(candidates)==1:
            block,start=candidates[0]
            return min(len(doc['content']),start+len(block.get('text',''))+1),False
        return len(doc['content']),True
    for asset in data['assets']:
        if asset['kind']!='image':continue
        digest=data['hashes'][asset['path']]
        pictures=[b for b in data['blocks'] if b.get('image_path')==asset['path']]
        if digest in originals:
            existing=originals[digest]
            # A unique package occurrence can safely refine all old sources for
            # that asset, including captions; never assign repeated assets at random.
            if len(pictures)==1:
                loc=pictures[0]['locator']
                if loc.get('type')!='document':
                    for source in sources:
                        if source['metadata'].get('image_path')==existing['path'] and source['locators']!=[loc]:
                            updates[source['id']]=[loc]
            continue
        if digest in seen:continue
        seen.add(digest)
        asset_id=str(uuid.uuid5(uuid.NAMESPACE_URL,doc['parse_id']+':image-repair:'+digest))
        additions.append({**asset,'id':asset_id,'metadata':{**asset,'parse_version_id':doc['parse_id'],'repair':'embedded-images-v1'}})
        for index,b in enumerate(pictures):
            start,unplaced=position(b)
            source_id=str(uuid.uuid5(uuid.NAMESPACE_URL,asset_id+':occurrence:'+str(index)))
            new_sources.append({'id':source_id,'char_start':start,'locators':[b['locator']],
                                'metadata':{'image_path':asset['path'],'block_type':'image','visual_role':'embedded_image',
                                            'layout':{**b.get('layout',{}),'unplaced':unplaced,'binding_method':'verified_preceding_text' if not unplaced else 'package_image'}}})
    report={'document_id':document_id,'new_images':len(additions),'new_image_sources':len(new_sources),'refined_locations':len(updates),
            'new_image_parts':[a.get('origin_part') for a in additions],
            'warnings':[b.get('warning') for b in data['blocks'] if b.get('warning')], 'applied':False}
    if not apply or not (additions or updates):return report
    backup=Path(backup_dir)/('embedded-images-'+document_id+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')+'.json')
    backup.parent.mkdir(parents=True,exist_ok=True)
    backup.write_text(json.dumps({'document':doc,'assets':assets,'sources':sources,'additions':additions,'new_sources':new_sources,'updates':updates},ensure_ascii=False),encoding='utf-8')
    statements=['BEGIN;',"SELECT id FROM nebulaekno.knowledge WHERE id="+quote(document_id)+" FOR UPDATE;",
                "DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM nebulaekno.knowledge WHERE id="+quote(document_id)+" AND current_parse_version_id="+parse_id+" AND current_file_version_id="+quote(doc['file_id'])+") OR EXISTS(SELECT 1 FROM nebulaekno.tasks WHERE knowledge_id="+quote(document_id)+" AND state IN ('queued','running')) THEN RAISE EXCEPTION 'Document changed or active'; END IF; END $guard$;"]
    before={s['id']:s for s in sources}
    for source_id,locators in updates.items():
        statements.append("DO $repair$ BEGIN UPDATE nebulaekno.source_refs SET locators="+encode(locators)+" WHERE id="+quote(source_id)+" AND locators="+encode(before[source_id]['locators'])+"; IF NOT FOUND THEN RAISE EXCEPTION 'Source changed'; END IF; END $repair$;")
    for a in additions:
        statements.append("INSERT INTO nebulaekno.assets(id,knowledge_id,file_version_id,kind,path,metadata) VALUES("+','.join([quote(a['id']),quote(document_id),quote(doc['file_id']),quote('image'),quote(a['path']),encode(a['metadata'])])+") ON CONFLICT(id) DO NOTHING;")
    for s in new_sources:
        statements.append("INSERT INTO nebulaekno.source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) VALUES("+','.join([quote(s['id']),quote(document_id),quote(doc['file_id']),parse_id,encode(s['locators']),"''",quote('document' if s['metadata']['layout']['unplaced'] else 'range'),str(s['char_start']),str(s['char_start']),quote('image_repair'),encode(s['metadata'])])+") ON CONFLICT(id) DO NOTHING;")
        statements.append("INSERT INTO nebulaekno.chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) SELECT "+','.join([quote(s['id']),quote(document_id),parse_id,quote(s['id']),"coalesce(max(ordinal),-1)+1","' '","''::tsvector"])+" FROM nebulaekno.chunks WHERE parse_version_id="+parse_id+" ON CONFLICT(id) DO NOTHING;")
    statements.append('COMMIT;');sql('\n'.join(statements))
    report.update(applied=True,backup=str(backup));return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--document',required=True);p.add_argument('--app-container',required=True);p.add_argument('--database-container',required=True)
    p.add_argument('--apply',action='store_true');p.add_argument('--backup-dir',default='test-results')
    args=p.parse_args();print(json.dumps(repair(args.document,args.app_container,args.database_container,args.apply,args.backup_dir),ensure_ascii=False))
