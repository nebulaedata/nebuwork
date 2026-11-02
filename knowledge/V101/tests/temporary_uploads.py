"""Office temporary-file filtering, only against the isolated test stack."""
from client import *
import io
import zipfile

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Use the isolated settings test stack'
stamp = uuid.uuid4().hex[:8]
kb = request('/knowledge-bases', {'name': '临时文件过滤验收 ' + stamp})['id']
root = '/knowledge-bases/' + kb

def documents():
    return request(root + '/knowledge?page_size=100')

def check_skipped(result):
    check(result['state'] == 'skipped' and result['skip_reason'] == 'office_temporary_file'
          and not result.get('upload_id') and not result.get('knowledge_id') and not result.get('task_id'),
          '临时文件明确跳过，不产生上传会话、文档或任务 ID')

check(request('/uploads/policy')['ignored_file_prefixes'] == ['~$'], '上传策略公开过滤规则')
for name in ['~$任务书.docx', '~$表格.xlsx', '~$无扩展名']:
    check_skipped(request(root + '/uploads', {'file_name': name, 'relative_path': '资料/' + name, 'file_size': 4}))
    body, headers = multipart('资料/' + name, b'lock')
    check_skipped(request(root + '/knowledge/file', body, headers=headers))
check(documents() == [], '被过滤的文件未入库')

boundary = 'batch' + stamp
parts = []
for name in ['~$临时.docx', '目录/~$临时.xlsx', '正常.custom', '~$目录/正常.custom', '报告~$备份.custom']:
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n\r\n').encode() + b'bytes\r\n')
payload = b''.join(parts) + f'--{boundary}--\r\n'.encode()
headers = {'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Idempotency-Key': stamp}
batch = request(root + '/knowledge/files', payload, headers=headers, expected=202)
check([entry['data']['state'] for entry in batch] == ['skipped', 'skipped', 'stored', 'stored', 'stored'],
      '混合批量过滤临时文件，正常文件和未知格式继续保存')
check(request(root + '/knowledge/files', payload, headers=headers, expected=202) == batch and len(documents()) == 3,
      '过滤后批量重试仍然幂等')

def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, value in entries:
            z.writestr(name, value)
    return data.getvalue()

inner = archive([('二级/~$表格.xlsx', b'lock'), ('二级/数据.custom', b'normal')])
outer = archive([('~$任务书.docx', b'lock'), ('附件/~$损坏.zip', b'broken'), ('内层.zip', inner), ('~$目录/正常.custom', b'normal')])
uploaded = upload(kb, '递归过滤.zip', outer)
task = wait_task(uploaded['task_id'])
report = task['checkpoint']['archive_report']
check(task['state'] == 'succeeded' and report['files'] == 3 and report['skipped_files'] == 3 and report['issue_count'] == 0,
      '递归 ZIP 各层过滤临时文件，跳过不计为解压失败')
check(len(documents()) == 7 and not any(d['name'].startswith('~$') for d in documents()), '临时文件未创建子文档')
check(urllib.request.urlopen(BASE + '/knowledge/' + uploaded['knowledge_id'] + '/download').read() == outer,
      '原 ZIP 内容完整保留')
empty = upload(kb, '只有临时文件.zip', archive([('~$临时.docx', b'lock')]))
empty_task = wait_task(empty['task_id'])
check(empty_task['state'] == 'succeeded' and empty_task['checkpoint']['archive_report']['files'] == 0
      and empty_task['checkpoint']['archive_report']['skipped_files'] == 1, '全为临时文件的 ZIP 正常结束')

artifacts = Path(__file__).resolve().parent.parent / 'test-results' / 'temporary-upload-fixtures'
folder = artifacts / '上传目录'
folder.mkdir(parents=True, exist_ok=True)
(folder / '~$任务书.docx').write_bytes(b'lock')
(folder / '正常.custom').write_bytes(b'normal')
(artifacts / 'acceptance.json').write_text(json.dumps({'knowledge_base_id': kb, 'archive_id': uploaded['knowledge_id']}, ensure_ascii=False), encoding='utf-8')
print('ALL TEMPORARY UPLOAD CHECKS PASSED', flush=True)
