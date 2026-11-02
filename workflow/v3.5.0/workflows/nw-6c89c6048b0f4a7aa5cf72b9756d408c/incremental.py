"""分类列表 -> 详情 -> 官方原文件 -> 跨任务增量索引。站点规则必须先验证。"""
import hashlib
import json
import re
import zipfile
from io import BytesIO
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit
from law_http import Client, Links, html, url


def now():
    return datetime.now(timezone.utc).isoformat()


def load_state(ctx):
    # SDK 对不存在的产物报错；只接受明确的不存在错误，其他读取异常不能伪装成空状态。
    try:
        value = ctx.workflow.read('law_incremental_state')
    except Exception as exc:
        if isinstance(exc, (KeyError, FileNotFoundError)) or any(s in str(exc).lower() for s in ('not found', '不存在')):
            return {'schema': 1, 'records': {}, 'files': {}}
        raise
    if not isinstance(value, dict) or value.get('schema') != 1:
        raise ValueError('增量索引格式不兼容，禁止重置')
    return value


def prepare(ctx):
    a = ctx.input
    if not isinstance(a, dict):
        raise ValueError('输入必须为对象')
    cfg = dict(a)
    cfg.setdefault('dry_run', True)
    cfg.setdefault('interval_seconds', 15)
    cfg.setdefault('max_requests_per_stage', 20)
    cfg.setdefault('max_list_pages', 5)
    cfg.setdefault('max_documents', 5)
    cfg.setdefault('categories', [])
    if type(cfg['dry_run']) is not bool:
        raise ValueError('dry_run 必须为布尔值')
    for k, lo, hi in [('interval_seconds', 10, 120), ('max_requests_per_stage', 3, 50), ('max_list_pages', 1, 10), ('max_documents', 1, 10)]:
        if type(cfg[k]) is not int or not lo <= cfg[k] <= hi:
            raise ValueError(f'{k} 必须为 {lo}~{hi} 整数')
    if not cfg['dry_run']:
        contact = cfg.get('contact', '')
        if cfg.get('terms_reviewed') is not True or cfg.get('adapter_verified') is not True:
            raise ValueError('联网前必须核对条款及分类/列表/附件规则；要求 terms_reviewed、adapter_verified 为 true')
        if not isinstance(contact, str) or not contact.isascii() or len(contact) > 200 or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', contact):
            raise ValueError('须提供真实可联系的 ASCII 邮箱 contact')
        if not isinstance(cfg['categories'], list) or not 1 <= len(cfg['categories']) <= 10:
            raise ValueError('categories 应包含 1~10 个已验证分类')
        for cat in cfg['categories']:
            if not cat.get('name') or not cat.get('detail_url_regex') or not cat.get('attachment_url_regex'):
                raise ValueError('每个分类须含 name、list_urls、detail_url_regex、attachment_url_regex')
            if not isinstance(cat.get('list_urls'), list) or not 1 <= len(cat['list_urls']) <= 10:
                raise ValueError('每类 list_urls 应包含 1~10 个已验证列表页')
            for address in cat['list_urls']:
                url(address)
            for key in ('detail_url_regex', 'attachment_url_regex', 'next_url_regex'):
                if cat.get(key):
                    re.compile(cat[key])
    ctx.task.save_json('config', cfg)
    ctx.task.save_json('state', load_state(ctx))
    ctx.task.save_json('plan', {'goal': '下载官方法律法规原始文件', 'dry_run': cfg['dry_run'], 'adapter_verified': cfg.get('adapter_verified', False), 'note': '当前仅支持已验证的 HTML 链接规则，不猜测动态接口；缺失附件不算下载成功；不配置自动调度'})


def collect(ctx):
    cfg = ctx.task.read('prepare', 'config')
    state = ctx.task.read('prepare', 'state')
    output, audit, stop = [], [], None
    client = None
    if not cfg['dry_run']:
        try:
            client = Client(cfg)
            seen = set()
            for cat in cfg['categories']:
                queue = list(cat['list_urls'])
                while queue and len(seen) < cfg['max_list_pages']:
                    address = url(queue.pop(0))
                    if (cat['name'], address) in seen:
                        continue
                    seen.add((cat['name'], address))
                    raw, headers, status = client.get(address)
                    text = html(raw, headers)
                    found = 0
                    for href, label in Links(text).links:
                        try:
                            target = url(urljoin(address, href))
                        except ValueError:
                            continue
                        if re.search(cat['detail_url_regex'], target):
                            found += 1
                            key = hashlib.sha256((cat['name'] + '\n' + target).encode()).hexdigest()
                            entry = {'id': key, 'category': cat['name'], 'title': label, 'detail_url': target, 'attachment_url_regex': cat['attachment_url_regex'], 'last_seen': now()}
                            state['records'][key] = dict(state['records'].get(key, {}), **entry)
                            output.append(entry)
                        elif cat.get('next_url_regex') and re.search(cat['next_url_regex'], target) and len(queue) < 20:
                            queue.append(target)
                    if not found:
                        raise RuntimeError('列表未匹配到法规详情；不能视为采集完成，需核验站点适配')
            audit = client.audit
        except (RuntimeError, ValueError, OSError, LookupError) as exc:
            stop = str(exc)
            audit = client.audit if client else []
    ctx.task.save_json('listing', output)
    ctx.task.save_json('state', state)
    ctx.task.save_json('config', cfg)
    ctx.task.save_json('audit', {'stop': stop, 'requests': audit, 'status': 'dry_run' if cfg['dry_run'] else ('stopped' if stop else 'bounded_scan')})


def signature(raw):
    if raw.startswith(b'%PDF-'):
        return '.pdf'
    if raw.startswith(bytes.fromhex('D0CF11E0A1B11AE1')):
        return '.doc'
    if raw.startswith(b'{\\rtf'):
        return '.rtf'
    if raw.startswith(b'PK'):
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            if 'word/document.xml' in archive.namelist():
                return '.docx'
    raise ValueError('不是已支持的 PDF/Word/RTF 文件，拒绝把 HTML 或错误页当成原件')


def download(ctx):
    cfg = ctx.task.read('collect', 'config')
    state = ctx.task.read('collect', 'state')
    scan = ctx.task.read('collect', 'audit')
    events, stop, client = [], scan['stop'], None
    if not cfg['dry_run'] and not stop:
        try:
            client = Client(cfg)
            # 从未成功的条目优先；其余按上次检查时间轮转，避免每次只处理第一页。
            pending = sorted(state['records'].values(), key=lambda r: (r.get('download_status') == 'downloaded', r.get('last_checked', '')))
            for record in pending[:cfg['max_documents']]:
                raw, hdr, status = client.get(record['detail_url'])
                text = html(raw, hdr)
                attachments = []
                for href, label in Links(text).links:
                    try:
                        target = url(urljoin(record['detail_url'], href))
                    except ValueError:
                        continue
                    if re.search(record['attachment_url_regex'], target) and target not in attachments:
                        attachments.append(target)
                if not attachments:
                    record.update(download_status='no_public_attachment', last_checked=now())
                    events.append({'id': record['id'], 'status': 'no_public_attachment', 'note': '未下载成功，不转换网页冒充原件'})
                    continue
                completed = []
                for target in attachments[:5]:
                    old = state['files'].get(target, {})
                    validators = {}
                    if old.get('artifact_name'):
                        if old.get('etag'):
                            validators['If-None-Match'] = old['etag']
                        if old.get('last_modified'):
                            validators['If-Modified-Since'] = old['last_modified']
                    content, headers, code = client.get(target, validators)
                    if code == 304:
                        completed.append(target)
                        old['last_checked'] = now()
                        events.append({'url': target, 'status': 'unchanged_304', 'artifact_name': old['artifact_name']})
                        continue
                    ext = signature(content)
                    digest = hashlib.sha256(content).hexdigest()
                    name = 'original_' + digest + ext
                    changed = old.get('sha256') != digest
                    if changed or not old.get('artifact_name'):
                        path = Path(ctx.work_dir) / name
                        path.write_bytes(content)
                        ctx.task.save_file(name, path)
                        ctx.workflow.save_file(name, path)
                    state['files'][target] = {'sha256': digest, 'artifact_name': name, 'source_url': target, 'etag': headers.get('ETag'), 'last_modified': headers.get('Last-Modified'), 'last_checked': now(), 'downloaded_at': now() if changed else old.get('downloaded_at'), 'bytes': len(content)}
                    completed.append(target)
                    events.append({'url': target, 'status': 'downloaded' if changed else 'unchanged_hash', 'artifact_name': name, 'category': record['category'], 'title': record['title']})
                record.update(download_status='downloaded' if len(completed) == len(attachments) else 'partial', file_urls=completed, last_checked=now())
        except (RuntimeError, ValueError, OSError, LookupError, zipfile.BadZipFile) as exc:
            stop = str(exc)
            events.append({'status': 'stopped', 'reason': stop, 'note': '未完成条目不标记成功，下次重新检查'})
    if not cfg['dry_run']:
        # 与新文件同一步发布；步骤失败不会发布超前索引。禁止并发运行本流程。
        state['updated_at'] = now()
        ctx.workflow.save_json('law_incremental_state', state)
    ctx.task.save_json('file_index', state)
    ctx.task.save_json('download_events', events)
    ctx.task.save_json('download_audit', {'status': 'dry_run' if cfg['dry_run'] else ('stopped' if stop else 'bounded_batch_finished'), 'stop': stop, 'requests': client.audit if client else [], 'note': '批次结束不表示全站下载完成；没有自动调度，需重复运行继续增量。'})
    ctx.task.save_text('report', json.dumps({'stop': stop, 'events': events, 'known_records': len(state['records']), 'known_files': len(state['files'])}, ensure_ascii=False, indent=2))
