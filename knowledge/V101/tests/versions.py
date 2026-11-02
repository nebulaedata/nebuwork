"""Additional acceptance for immutable sources, revisions, subtitles and sample model tests."""
from client import *

report=json.loads((Path(__file__).parent.parent/'test-results/functional.json').read_text(encoding='utf-8'))
kb=report['knowledge_base_id'];docs=report['documents'];models=report['models']
for purpose,ext in [('vision','.png'),('asr','.wav'),('multimodal_embedding','.png')]:
    body,headers=multipart('sample'+ext,(Path(__file__).parent/'fixtures'/('sample'+ext)).read_bytes())
    result=request('/models/'+models[purpose]+'/test-file',body,headers=headers)
    check(bool(result['tested']),purpose+' 样本输入测试')

document=docs['.md']['knowledge_id']
before=request('/knowledge/'+document+'/content');chunks=request('/knowledge/'+document+'/chunks')
source=request('/sources/'+chunks[0]['source_ref_id'])
outline=request('/knowledge/'+document+'/outline/rebuild',{},expected=202)
check(wait_task(outline['task_id'])['state']=='succeeded','独立目录重建')
check(request('/knowledge/'+document+'/content')['parse_version_id']==before['parse_version_id'],'目录重建不修改解析版本')
pdf=docs['.pdf']['knowledge_id'];before_pdf=request('/knowledge/'+pdf+'/content')
preview=request('/knowledge/'+pdf+'/preview/rebuild',{},expected=202)
check(wait_task(preview['task_id'])['state']=='succeeded','独立预览重建')
check(request('/knowledge/'+pdf+'/content')['parse_version_id']==before_pdf['parse_version_id'],'预览重建不修改内容版本')

reparse=request('/knowledge/'+document+'/reparse',{},expected=202)
check(wait_task(reparse['task_id'])['state']=='succeeded','重新解析完成')
after=request('/knowledge/'+document+'/content')
check(before['parse_version_id']!=after['parse_version_id'],'重解析产生新版本')
old=request('/sources/'+source['source_ref_id'])
check(old['parse_version_id']==before['parse_version_id'] and old['quote']==source['quote'],'旧来源保持原解析版本与原文')
check(request('/knowledge/'+document+'/content?parse_version_id='+before['parse_version_id'])['content']==before['content'],'旧解析正文仍可读取')
result=request('/search/wiki',{'query_text':'数据库','knowledge_base_ids':[kb],'rerank':{'mode':'disabled'}})
check(bool(result['results']),'重新解析后 Wiki 仍可检索')

wav=docs['.wav'];old_transcript=request('/knowledge/'+wav['knowledge_id']+'/transcript')
subtitle={'file_version_id':wav['file_version_id'],'format':'srt','offset_ms':100,'content':'1\n00:00:00,200 --> 00:00:01,500\n手工字幕定位数据库。\n'}
bad=dict(subtitle);bad['offset_ms']=5000
request('/knowledge/'+wav['knowledge_id']+'/subtitles',bad,expected=400)
job=request('/knowledge/'+wav['knowledge_id']+'/subtitles',subtitle,expected=202)
check(wait_task(job['task_id'])['state']=='succeeded','字幕绑定与索引重建')
transcript=request('/knowledge/'+wav['knowledge_id']+'/transcript')
check(transcript[0]['origin']=='subtitle' and transcript[0]['locators'][0]['start_ms']==300,'字幕偏移与来源类型')
original=request('/sources/'+old_transcript[0]['id'])
check(original['locators'][0]['start_ms']==200,'字幕更新不改写旧 ASR 引用')
frames=request('/knowledge/'+docs['.mp4']['knowledge_id']+'/frames')
check(bool(frames) and bool(frames[0]['source_refs']),'代表帧带来源')

stats=request('/knowledge-bases/'+kb+'/graph/stats');check(stats['nodes']>0 and stats['relations']>0,'图谱真实统计')
graph=request('/knowledge-bases/'+kb+'/graph/query',{'query':'NebulaeKno','max_hops':2,'limit':50})
check(bool(graph['relations']),'两跳图谱结构查询')
evidence=request('/knowledge-bases/'+kb+'/graph/evidence/'+graph['relations'][0]['evidence_id'])
check(bool(evidence['source_ref']),'图谱证据解析')

folder=request('/knowledge-bases/'+kb+'/wiki/folders',{'name':'人工资料'})
page=request('/knowledge-bases/'+kb+'/wiki/pages',{'title':'手工页面 '+uuid.uuid4().hex[:6],'content':'初版内容','source_ids':[],'folder_id':folder['id']})
path='/knowledge-bases/'+kb+'/wiki/pages/'+page['id'];history=request(path+'/revisions')
request(path,{'title':page['title'],'content':'第二版内容','source_ids':[],'folder_id':folder['id']},method='PUT')
request(path+'/revert',{'revision_id':history[0]['id']})
check(request(path)['content']=='初版内容','Wiki 编辑和历史回滚')
other=request('/knowledge-bases',{'name':'隔离范围 '+uuid.uuid4().hex[:6]})['id']
request('/knowledge-bases/'+other+'/wiki/pages/'+page['id'],expected=404)
request('/knowledge-bases/'+kb+'/wiki/folders/'+folder['id'],{'name':'循环','parent_id':folder['id']},method='PUT',expected=400)
check(True,'Wiki 路径范围与目录循环校验')

model=request('/models/'+models['vision']);model={k:model[k] for k in ['name','purpose','protocol','base_url','model_name','dimension','config']};model['clear_api_key']=True
updated=request('/models/'+models['vision'],model,method='PUT');check(not updated['has_api_key'],'可明确清除模型凭证')
req=urllib.request.Request(BASE+'/knowledge/'+docs['.mp4']['knowledge_id']+'/preview',headers={'Range':'bytes=0-99'})
response=urllib.request.urlopen(req);check(response.status==206 and len(response.read())==100,'媒体支持 HTTP Range')
spec=json.load(urllib.request.urlopen('http://127.0.0.1:18080/api/openapi.json'))
check(len(spec['paths'])>=70 and spec['security']==[],'OpenAPI 覆盖已注册接口且无调用方鉴权')
check('/health/ready' in spec['paths'],'健康接口文档')
print('All version and sample checks passed.',flush=True)
