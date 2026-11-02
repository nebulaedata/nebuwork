"""Upload/folder/archive acceptance. Run only against the isolated test stack."""
from client import *
import io
import stat
import subprocess
import zipfile

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Use the isolated settings test stack'
stamp = uuid.uuid4().hex[:8]
artifact_dir = Path(__file__).resolve().parent.parent / 'test-results' / 'upload-fixtures'
artifact_dir.mkdir(parents=True, exist_ok=True)

def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, body in entries:
            z.writestr(name, body)
    return data.getvalue()

def docs(kb):
    return request('/knowledge-bases/' + kb + '/knowledge?page_size=100')

def download(id):
    return urllib.request.urlopen(BASE + '/knowledge/' + id + '/download', timeout=30).read()

def resumable(kb, name, relative, payload):
    session = request('/knowledge-bases/' + kb + '/uploads', {
        'file_name': name, 'relative_path': relative, 'file_size': len(payload),
        'sha256': hashlib.sha256(payload).hexdigest(),
    }, expected=201)
    id = session['upload_id']
    check(request('/uploads/' + id)['relative_path'] == relative, '续传会话保留相对路径 ' + relative)
    for i, start in enumerate(range(0, len(payload), session['part_size']), 1):
        part = payload[start:start + session['part_size']]
        headers = {'Content-Type': 'application/octet-stream', 'X-Content-SHA256': hashlib.sha256(part).hexdigest()}
        request(f'/uploads/{id}/parts/{i}', part, method='PUT', headers=headers)
        check(request(f'/uploads/{id}/parts/{i}', part, method='PUT', headers=headers)['reused'], '分片重传不重复写入')
    result = request('/uploads/' + id + '/complete', {}, expected=202)
    check(result == request('/uploads/' + id + '/complete', {}), '合并提交幂等')
    return result

models = {}
for purpose in ['text', 'embedding']:
    model = request('/models', {'name': '上传验收 ' + purpose + stamp, 'purpose': purpose,
        'protocol': 'openai', 'base_url': 'http://model-fixture:9000/v1',
        'model_name': 'fixture-' + purpose, 'dimension': 16 if purpose == 'embedding' else None})
    models[purpose] = model['id']
request('/settings/model-bindings', models, method='PUT')
kb = request('/knowledge-bases', {'name': '文件与文件夹上传验收 ' + stamp,
    'config': {'wiki_enabled': False, 'graph_enabled': False, 'image_caption': False, 'image_embedding': False}})['id']

unknown = upload(kb, '设计源文件.custom', b'opaque\x00binary\xff')
check(unknown['state'] == 'stored' and not unknown['task_id'], '未知格式只存储、不创建解析任务')
check(download(unknown['knowledge_id']) == b'opaque\x00binary\xff', '未知格式下载字节完全一致')
check(request('/knowledge/' + unknown['knowledge_id'] + '/stages') == [], '未知格式没有后台任务')
request('/knowledge/' + unknown['knowledge_id'] + '/reparse', {}, expected=409)

folder_a = resumable(kb, 'same.bin', '上传目录/甲/same.bin', b'folder-a')
folder_b = resumable(kb, 'same.bin', '上传目录/乙/same.bin', b'folder-b')
check(folder_a['knowledge_id'] != folder_b['knowledge_id'], '不同目录下同名文件独立保存')
check(len(request('/knowledge-bases/' + kb + '/knowledge?q=' + urllib.parse.quote('上传目录/'))) == 2, '可以按文件夹路径搜索')
empty = resumable(kb, 'empty.txt', '上传目录/empty.txt', b'')
check(empty['state'] == 'stored' and empty['storage_reason'] == 'empty_file' and download(empty['knowledge_id']) == b'', '空文件保存但不解析')
request('/knowledge-bases/' + kb + '/uploads', {'file_name': 'evil.txt', 'relative_path': '../evil.txt', 'file_size': 1}, expected=400)
body, headers = multipart('../evil.txt', b'x')
request('/knowledge-bases/' + kb + '/knowledge/file', body, headers=headers, expected=400)

inner = archive([('二级/readme.txt', '目录测试数据库：递归解压后可以检索定位。'), ('模型.weights', b'weights')])
outer = archive([('文档/说明.md', '# 文件夹入库\n目录测试数据库支持来源定位。'),
    ('文档/未知格式.xyz', b'xyz'), ('嵌套.zip', inner), ('空文件.txt', b'')])
(artifact_dir / '递归上传.zip').write_bytes(outer)
result = resumable(kb, '递归上传.zip', '上传目录/递归上传.zip', outer)
task = wait_task(result['task_id'])
check(task['state'] == 'succeeded' and task['checkpoint']['archive_report']['files'] == 6, 'ZIP 递归展开两层并逐个保存全部文件')
check(download(result['knowledge_id']) == outer, '原始 ZIP 保留且可下载')
children = [d for d in docs(kb) if d.get('relative_path', '').startswith('上传目录/递归上传.zip/')]
check(len(children) == 6, '压缩包内所有子文件可在知识库中查看')
for d in children:
    check(bool(d['source_archive_id']), '解压文件关联来源压缩包 ' + d['name'])
    if d['file_type'] in ['xyz', 'weights'] or d['name'] == '空文件.txt':
        check(d['status'] == 'stored' and not request('/knowledge/' + d['id'] + '/stages'), '压缩包内未知格式/空文件不解析 ' + d['name'])
    elif d['file_type'] == 'zip':
        check(d['status'] == 'extracted', '嵌套 ZIP 标记已解压')
    else:
        jobs = request('/knowledge/' + d['id'] + '/stages')
        check(wait_task(jobs[0]['id'])['state'] == 'succeeded', '解压后支持的文件完成真实解析 ' + d['name'])
hits = request('/search', {'knowledge_base_ids': [kb], 'query_text': '数据库', 'mode': 'keyword', 'include_sources': True, 'rerank': {'mode': 'disabled'}})
check(bool(hits['results']) and all(h['source_refs'] for h in hits['results']), '解压文件可检索并定位原文')

# Partial extraction must report rejected members and keep the complete original.
link = zipfile.ZipInfo('linked'); link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
partial_bytes = archive([('../越界.txt', b'x'), (link, b'../outside'), ('坏包.zip', b'bad'), ('正常.custom', b'kept')])
partial = upload(kb, '部分可解压.zip', partial_bytes)
failed = wait_task(partial['task_id'])
check(failed['state'] == 'partially_failed' and failed['checkpoint']['archive_report']['issue_count'] == 3, '越界、链接、损坏的嵌套 ZIP 如实报告部分解压')
before = {d['id'] for d in docs(kb)}
request('/tasks/' + partial['task_id'] + '/retry', {})
check(wait_task(partial['task_id'])['state'] == 'partially_failed' and {d['id'] for d in docs(kb)} == before, '重复解压不重复创建文档')
check(download(partial['knowledge_id']) == partial_bytes, '部分解压时原 ZIP 完整保留')
bad = upload(kb, '损坏.zip', b'not a zip')
check(wait_task(bad['task_id'])['state'] == 'failed' and download(bad['knowledge_id']) == b'not a zip', '损坏 ZIP 保存原件并报告解压失败')

# Repeated file fields in one request must not share a single idempotency record.
boundary = 'batch' + stamp
parts = []
for name, body in [('批量/甲.bin', b'one'), ('批量/乙.bin', b'two')]:
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n\r\n').encode() + body + b'\r\n')
payload = b''.join(parts) + f'--{boundary}--\r\n'.encode()
headers = {'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Idempotency-Key': stamp}
batch = request('/knowledge-bases/' + kb + '/knowledge/files', payload, headers=headers, expected=202)
check(len(batch) == 2 and all(x['success'] for x in batch), '批量上传全部文件且保留目录')
check(batch == request('/knowledge-bases/' + kb + '/knowledge/files', payload, headers=headers, expected=202), '批量上传按文件幂等')

# Exercise durable extraction under cancellation and an actual container restart.
recovery_kb = request('/knowledge-bases', {'name': '解压恢复验收 ' + stamp})['id']
recovery = upload(recovery_kb, '恢复.zip', archive([(f'目录/{n}.bin', str(n).encode()) for n in range(400)]))
end = time.monotonic() + 90
while time.monotonic() < end:
    current = request('/tasks/' + recovery['task_id'])
    if current.get('checkpoint', {}).get('archive_report', {}).get('files', 0) >= 5: break
    time.sleep(.1)
request('/tasks/' + recovery['task_id'] + '/cancel', {})
check(wait_task(recovery['task_id'])['state'] == 'cancelled', '递归解压可取消且保留已落盘文件')
request('/tasks/' + recovery['task_id'] + '/retry', {})
subprocess.run(['docker', 'compose', '-f', 'tests/compose.yaml', '-f', 'tests/compose.settings.yaml', 'restart', 'app'], cwd=Path(__file__).resolve().parent.parent, check=True, capture_output=True)
end = time.monotonic() + 90
while True:
    try:
        request('/uploads/policy'); break
    except Exception:
        assert time.monotonic() < end, 'isolated app failed to recover'
        time.sleep(.5)
check(wait_task(recovery['task_id'])['state'] == 'succeeded', '容器重启后继续解压')
check(request('/knowledge-bases/' + recovery_kb + '/stats')['documents'] == 401, '取消、重试和重启后文档不重复、不遗漏')

# Browser fixtures: keep test artifacts separate from user data.
folder = artifact_dir / '上传目录'
for relative, content in [('甲/same.bin', b'one'), ('乙/same.bin', b'two'), ('空文件.txt', b''), ('递归上传.zip', outer)]:
    target = folder / relative; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)
(artifact_dir / 'acceptance.json').write_text(json.dumps({'knowledge_base_id': kb, 'archive_id': result['knowledge_id'], 'stored_id': unknown['knowledge_id']}, ensure_ascii=False), encoding='utf-8')
print('ALL UPLOAD ACCEPTANCE CHECKS PASSED', flush=True)
