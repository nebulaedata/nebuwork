"""Interrupt only the isolated test application; verify PostgreSQL checkpoint recovery."""
from client import *
import subprocess

root=Path(__file__).resolve().parent.parent
def compose(*args):
    subprocess.run(['docker','compose','-f','tests/compose.yaml',*args],cwd=root,check=True,stdout=subprocess.DEVNULL)
def ready():
    end=time.monotonic()+90
    while time.monotonic()<end:
        try:
            if urllib.request.urlopen('http://127.0.0.1:18080/health/ready',timeout=2).status==200:return
        except (OSError,urllib.error.URLError):pass
        time.sleep(.5)
    raise AssertionError('application did not become ready')
def embedding_running(id):
    end=time.monotonic()+60
    while time.monotonic()<end:
        task=request('/tasks/'+id)
        if task['state']=='running' and task['stage']=='embedding':return task
        time.sleep(.2)
    raise AssertionError(('embedding stage not reached',task))

model=request('/models',{'name':'恢复验收慢速模型','purpose':'embedding','protocol':'openai','base_url':'http://model-fixture:9000/v1','model_name':'fixture-slow-embedding','dimension':16})
kb=request('/knowledge-bases',{'name':'任务恢复验收 '+uuid.uuid4().hex[:6],'config':{'graph_enabled':False,'wiki_enabled':False,'outline_enabled':False,'model_bindings':{'embedding':model['id']}}})['id']
doc=upload(kb,'recovery.md','# 持久化验收\n数据库检查点在进程重启之后应继续执行，不重复解析。'.encode())
task=embedding_running(doc['task_id']);parse_id=task['checkpoint']['parse_version_id']
try:
    compose('stop','-t','20','app')
    compose('exec','-T','redis','redis-cli','-a','integration-only','FLUSHDB')
finally:
    compose('up','-d','app')
ready()
task=wait_task(doc['task_id'])
check(task['state']=='succeeded','正常停止 + Redis 丢失队列后恢复任务')
check(task['checkpoint']['parse_version_id']==parse_id,'恢复沿用解析检查点')
chunks=request('/knowledge/'+doc['knowledge_id']+'/chunks')
check(len({c['source_ref_id'] for c in chunks})==len(chunks),'恢复没有重复分块或引用')

# Replay SSE from a durable event ID, without relying on Redis stream retention.
events=request('/tasks/'+doc['task_id']+'/logs')
cursor=min(e['id'] for e in events)
req=urllib.request.Request(BASE+'/tasks/'+doc['task_id']+'/events',headers={'Last-Event-ID':str(cursor)})
with urllib.request.urlopen(req,timeout=5) as stream:
    while True:
        line=stream.readline().decode().strip()
        if line.startswith('id:'):
            check(int(line[3:])>cursor,'任务事件支持 Last-Event-ID 续接')
            break

job=request('/knowledge/'+doc['knowledge_id']+'/reparse',{},expected=202)
embedding_running(job['task_id'])
request('/tasks/'+job['task_id']+'/cancel',{})
check(wait_task(job['task_id'])['state']=='cancelled','运行中任务可取消')
request('/tasks/'+job['task_id']+'/retry',{})
check(wait_task(job['task_id'])['state']=='succeeded','取消后从检查点重试')

deleted=request('/knowledge-bases/'+kb,method='DELETE',expected=202)
check(wait_task(deleted['task_id'])['state']=='succeeded','删除知识库清理文件与图谱后保留任务记录')
request('/knowledge/'+doc['knowledge_id'],expected=404)
request('/sources/'+chunks[0]['source_ref_id'],expected=404)
check(True,'删除后的来源明确返回不存在')
print('All task recovery checks passed.',flush=True)
