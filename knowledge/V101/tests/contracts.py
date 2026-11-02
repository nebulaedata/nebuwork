"""Configuration snapshots, missing capabilities and superseded task protection."""
from client import *

saved={key:request('/settings/'+key) for key in ['preview-defaults','media-defaults','wiki-defaults','retrieval-defaults']}
base=request('/knowledge-bases',{'name':'默认值快照原库'})
try:
    request('/settings/preview-defaults',{'enabled':False},method='PUT')
    request('/settings/media-defaults',{'frame_interval_seconds':45},method='PUT')
    request('/settings/wiki-defaults',{'enabled':False},method='PUT')
    request('/settings/retrieval-defaults',{'top_k':7},method='PUT')
    changed=request('/knowledge-bases',{'name':'默认值快照新库','config':{'graph_enabled':False}})
finally:
    for key,value in saved.items():request('/settings/'+key,value,method='PUT')
old=request('/knowledge-bases/'+base['id'])
check(old['config']==base['config'],'全局默认值修改不覆盖旧知识库')
cfg=changed['config']
check(cfg['preview_enabled']==False and cfg['frame_interval_seconds']==45 and cfg['wiki_enabled']==False and cfg['retrieval_config']['top_k']==7,'新知识库完整继承配置快照')
document=upload(changed['id'],'snapshot.md','# 默认配置\n数据库默认值仅在新建时继承。'.encode())
task=wait_task(document['task_id']);check(task['state']=='succeeded' and task['checkpoint']['wiki']=='disabled','关闭 Wiki 的设置实际生效')
check(request('/knowledge/'+document['knowledge_id']+'/preview/manifest')['state']=='disabled','关闭预览明确返回 disabled')
request('/knowledge/'+document['knowledge_id']+'/preview/rebuild',{},expected=409)
for mode in ['wiki','graph']:
    request('/search/'+mode,{'query_text':'数据库','knowledge_base_ids':[base['id']]},expected=409)
check(True,'未建立的 Wiki/图谱索引明确返回 INDEX_NOT_READY')

# A deliberately missing model is allowed as an unconfigured per-library binding.
waiting=request('/knowledge-bases',{'name':'旧任务保护验收','config':{'wiki_enabled':False,'graph_enabled':False,'outline_enabled':False,'model_bindings':{'embedding':str(uuid.uuid4())}}})
doc=upload(waiting['id'],'waiting.md','数据库等待配置之后仍应保留原文。'.encode())
job=wait_task(doc['task_id']);check(job['state']=='waiting_configuration','缺少模型时保留文件及解析结果')
preview=request('/knowledge/'+doc['knowledge_id']+'/preview/rebuild',{},expected=202)
check(wait_task(preview['task_id'])['state']=='succeeded','待配置文档可以独立重建预览')
check(request('/tasks/'+doc['task_id'])['state']=='waiting_configuration','预览重建不取消原待配置任务')
replacement=request('/knowledge/'+doc['knowledge_id']+'/reparse',{},expected=202)
check(wait_task(replacement['task_id'])['state']=='waiting_configuration','重新解析独立保存新检查点')
request('/tasks/'+doc['task_id']+'/retry',{},expected=409)
check(True,'拒绝旧版本任务覆盖新解析结果')
for kb in [base['id'],changed['id'],waiting['id']]:
    removal=request('/knowledge-bases/'+kb,method='DELETE',expected=202)
    check(wait_task(removal['task_id'])['state']=='succeeded','清理合同测试知识库')
print('All contract checks passed.',flush=True)
