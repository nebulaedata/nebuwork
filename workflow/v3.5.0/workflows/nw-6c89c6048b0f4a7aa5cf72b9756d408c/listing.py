"""持久化分类分页游标，扫描完成后下一轮从分类首页复查新增。"""
import hashlib
import re
from urllib.parse import urljoin
from incremental import now
from law_http import Client, Links, html, url


def run(ctx):
    cfg = ctx.task.read('prepare', 'config')
    state = ctx.task.read('prepare', 'state')
    output, audit, stop, client = [], [], None, None
    if not cfg['dry_run']:
        try:
            client = Client(cfg)
            cursors = state.setdefault('list_cursors', {})
            scanned = 0
            # 轮转分类，避免总预算长期只用于第一个分类。
            cats = cfg['categories']
            start = state.get('category_cursor', 0) % len(cats)
            for offset in range(len(cats)):
                cat = cats[(start + offset) % len(cats)]
                fingerprint = hashlib.sha256(str((cat['list_urls'], cat.get('next_url_regex'), cat['detail_url_regex'])).encode()).hexdigest()
                cursor = cursors.get(cat['name'])
                if not cursor or cursor.get('fingerprint') != fingerprint or not cursor['queue']:
                    cursor = {'queue': list(cat['list_urls']), 'seen': [], 'fingerprint': fingerprint}
                    cursors[cat['name']] = cursor
                while cursor['queue'] and scanned < cfg['max_list_pages']:
                    address = url(cursor['queue'][0])
                    if address in cursor['seen']:
                        cursor['queue'].pop(0)
                        continue
                    raw, headers, status = client.get(address)
                    text = html(raw, headers)
                    found, entries, next_pages = 0, [], []
                    for href, label in Links(text).links:
                        try:
                            target = url(urljoin(address, href))
                        except ValueError:
                            continue
                        if re.search(cat['detail_url_regex'], target):
                            found += 1
                            key = hashlib.sha256((cat['name'] + '\n' + target).encode()).hexdigest()
                            entries.append({'id': key, 'category': cat['name'], 'title': label, 'detail_url': target, 'attachment_url_regex': cat['attachment_url_regex'], 'last_seen': now()})
                        elif cat.get('next_url_regex') and re.search(cat['next_url_regex'], target):
                            if target not in cursor['seen'] and target not in cursor['queue'] and target not in next_pages:
                                next_pages.append(target)
                    if not found:
                        raise RuntimeError('列表未发现法规详情，保留当前游标，需核验站点适配')
                    for entry in entries:
                        state['records'][entry['id']] = dict(state['records'].get(entry['id'], {}), **entry)
                        output.append(entry)
                    cursor['queue'].pop(0)
                    cursor['seen'].append(address)
                    cursor['queue'].extend(next_pages)
                    scanned += 1
                state['category_cursor'] = (start + offset + 1) % len(cats)
                if scanned >= cfg['max_list_pages']:
                    break
            audit = client.audit
        except (RuntimeError, ValueError, OSError, LookupError) as exc:
            stop = str(exc)
            audit = client.audit if client else []
    ctx.task.save_json('listing', output)
    ctx.task.save_json('state', state)
    ctx.task.save_json('config', cfg)
    ctx.task.save_json('audit', {'stop': stop, 'requests': audit, 'status': 'dry_run' if cfg['dry_run'] else ('stopped' if stop else 'bounded_scan'), 'note': '游标跨任务保存；分页完成后从首页重新扫描。不推断删除或失效。'})
