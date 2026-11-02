"""Repair legacy anydoc image associations, preserving content/IDs/model results.

Run on the host with explicit Docker container names. Dry-run unless --apply.
Only exact old parsed-block indexes + full text + embedded asset parts qualify.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import uuid


def repair(document_id, app, database, apply=False, backup_dir='test-results'):
    document_id = str(uuid.UUID(document_id))

    def literal(value):
        return "'" + value.replace("'", "''") + "'"

    def sql(query):
        result = subprocess.run(['docker', 'exec', '-i', database, 'psql', '-X', '-U', 'nebulaekno', '-d', 'nebulaekno',
                                 '-At', '-v', 'ON_ERROR_STOP=1'], input=query.encode(), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=True)
        return result.stdout.decode().strip()

    record = json.loads(sql("SELECT json_build_object('parse_id',p.id,'file_id',f.id,'path',f.path,'engine',p.engine,"+
                            "'file_type',k.file_type) FROM nebulaekno.knowledge k JOIN nebulaekno.parse_versions p ON p.id=k.current_parse_version_id "+
                            "JOIN nebulaekno.file_versions f ON f.id=p.file_version_id WHERE k.id="+literal(document_id)+";"))
    if record['file_type'] not in ('docx','docm','pptx','pptm','xlsx','xlsm','doc','ppt','xls','odt','ods','odp','epub','rtf') or record['engine']!='anydoc':
        raise ValueError('Only anydoc documents with verifiable asset references can be repaired')
    code = "import sys,json;sys.path.insert(0,'/app/reader');from pathlib import Path;from anydoc_adapter import legacy_image_bindings;print(json.dumps(legacy_image_bindings(Path(sys.argv[1])),ensure_ascii=False))"
    bindings = json.loads(subprocess.check_output(['docker','exec',app,'python3','-c',code,record['path']]))
    parse_id = literal(record['parse_id'])
    assets = json.loads(sql("SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM nebulaekno.assets a WHERE knowledge_id="+
                            literal(document_id)+" AND file_version_id="+literal(record['file_id'])+
                            " AND kind='image' AND metadata->>'parse_version_id'="+parse_id+";"))
    sources = json.loads(sql("SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM nebulaekno.source_refs s WHERE parse_version_id="+parse_id+";"))
    by_part = {}
    for asset in assets:
        by_part.setdefault(asset['metadata'].get('origin_part'), []).append(asset)
    usage = Counter(image['part'] for binding in bindings for image in binding['images'])
    updates = {}
    matched = 0
    for binding in bindings:
        if len(binding['images'])!=1:
            continue  # A legacy row containing multiple images needs a fresh parse.
        image = binding['images'][0]
        candidates = by_part.get(image['part'], [])
        if len(candidates)!=1:
            continue
        asset = candidates[0]
        for source in sources:
            if source['origin']!='anydoc' or source['quote'].strip()!=binding['text'].strip():
                continue
            if not any(loc.get('parsed_block')==binding['parsed_block'] for loc in source['locators']):
                continue
            metadata = {**source['metadata'], 'image_path':asset['path'], 'visual_role':'embedded_image',
                        'layout':{**(source['metadata'].get('layout') or {}), 'image_alt':image['alt'],
                                  'reference_only':binding['reference_only'], 'binding_method':'anydoc_asset_reference'}}
            if binding['reference_only']:
                metadata['block_type']='image'
            updates[source['id']] = {'metadata':metadata, 'locators':[image['locator']],
                                      'precision':'range' if image['locator']['type']!='document' else 'document'}
            matched += 1
        # Reuse the same exact occurrence for old standalone image/caption sources
        # only if this asset occurs once; repeated assets keep their coarse location.
        if usage[image['part']]==1:
            for source in sources:
                if source['metadata'].get('image_path')==asset['path']:
                    updates[source['id']]={'metadata':source['metadata'],'locators':[image['locator']],
                                           'precision':'range' if image['locator']['type']!='document' else 'document'}
    original = {s['id']:s for s in sources}
    updates = {id:fields for id,fields in updates.items() if any(original[id][key]!=value for key,value in fields.items())}
    report={'document_id':document_id,'parse_version_id':record['parse_id'],'matched_image_blocks':matched,'updated_sources':len(updates),'applied':False}
    if apply and updates:
        backup = Path(backup_dir)/('docx-image-links-'+document_id+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')+'.json')
        backup.parent.mkdir(parents=True,exist_ok=True)
        backup.write_text(json.dumps({'document':record,'sources':[original[id] for id in updates]},ensure_ascii=False),encoding='utf-8')
        statements=["BEGIN;", "SELECT id FROM nebulaekno.knowledge WHERE id="+literal(document_id)+" FOR UPDATE;",
                    "DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM nebulaekno.knowledge WHERE id="+literal(document_id)+
                    " AND current_parse_version_id="+parse_id+" AND current_file_version_id="+literal(record['file_id'])+
                    ") OR EXISTS(SELECT 1 FROM nebulaekno.tasks WHERE knowledge_id="+literal(document_id)+
                    " AND state IN ('queued','running')) THEN RAISE EXCEPTION 'Document changed or has active tasks'; END IF; END $guard$;"]
        for id,fields in updates.items():
            before=original[id]
            statements.append("DO $repair$ BEGIN UPDATE nebulaekno.source_refs SET metadata="+literal(json.dumps(fields['metadata'],ensure_ascii=False))+"::jsonb,locators="+
                              literal(json.dumps(fields['locators'],ensure_ascii=False))+"::jsonb,precision="+literal(fields['precision'])+" WHERE id="+literal(id)+
                              " AND metadata="+literal(json.dumps(before['metadata'],ensure_ascii=False))+"::jsonb AND locators="+literal(json.dumps(before['locators'],ensure_ascii=False))+
                              "::jsonb; IF NOT FOUND THEN RAISE EXCEPTION 'Source changed'; END IF; END $repair$;")
        statements.append('COMMIT;')
        sql('\n'.join(statements))
        report.update(applied=True,backup=str(backup))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--document',required=True)
    parser.add_argument('--app-container',required=True)
    parser.add_argument('--database-container',required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--backup-dir',default='test-results')
    args=parser.parse_args()
    print(json.dumps(repair(args.document,args.app_container,args.database_container,args.apply,args.backup_dir),ensure_ascii=False))
