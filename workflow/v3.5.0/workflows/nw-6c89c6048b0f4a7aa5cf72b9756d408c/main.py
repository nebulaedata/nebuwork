"""公开 HTML 小规模采集；默认不联网，不绕过访问限制。"""
import csv
import io
import json
import re
import time
from collections import deque
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit, urljoin
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser

ORIGIN = 'https://flk.npc.gov.cn'
AGENT = 'NebulaePublicLawResearch'
MAX_BYTES = 2 * 1024 * 1024


def safe_url(value):
    p = urlsplit(str(value))
    if (p.scheme != 'https' or p.netloc != 'flk.npc.gov.cn'
            or p.username or p.password or '\\' in str(value)
            or any(ord(c) < 32 for c in str(value))):
        raise ValueError('仅允许 https://flk.npc.gov.cn 下的公开地址，不允许外站或自定义端口')
    return urlunsplit((p.scheme, p.netloc, p.path or '/', p.query, ''))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.title_mode = False
        self.title, self.text, self.links = [], [], []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
        if tag == 'title':
            self.title_mode = True
        if tag == 'a' and dict(attrs).get('href'):
            self.links.append(dict(attrs)['href'])

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'title':
            self.title_mode = False

    def handle_data(self, data):
        if self.title_mode:
            self.title.append(data.strip())
        if not self.hidden and data.strip():
            self.text.append(data.strip())


def run(ctx):
    args = ctx.input
    if not isinstance(args, dict):
        raise ValueError('任务输入必须为 JSON 对象')
    seeds = args.get('seed_urls', [ORIGIN + '/index'])
    if not isinstance(seeds, list) or not 1 <= len(seeds) <= 5:
        raise ValueError('seed_urls 必须为含 1~5 个公开页面地址的数组')
    seeds = list(dict.fromkeys(safe_url(u) for u in seeds))
    dry_run = args.get('dry_run', True)
    if not isinstance(dry_run, bool):
        raise ValueError('dry_run 必须为布尔值')
    max_pages, max_requests = args.get('max_pages', 3), args.get('max_requests', 6)
    max_depth, interval = args.get('max_depth', 0), args.get('interval_seconds', 15)
    for key, value, low, high in (
        ('max_pages', max_pages, 1, 5), ('max_requests', max_requests, 2, 10),
        ('max_depth', max_depth, 0, 1), ('interval_seconds', interval, 10, 120)):
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f'{key} 必须为 {low}~{high} 的整数')
    ctx.task.save_json('collection_plan', {
        'site': ORIGIN, 'seed_urls': seeds, 'dry_run': dry_run,
        'max_pages': max_pages, 'max_requests_including_robots': max_requests,
        'max_depth': max_depth, 'interval_seconds': interval, 'concurrency': 1,
        'retries': 0, 'redirects': '不跟随',
        'scope': '公开 HTML 页面；不调用猜测接口、不下载附件、不执行脚本',
        'notice': 'robots 允许不等于法律授权；运行前须人工核对网站条款及使用目的。不得采集非公开信息或用于违法用途。',
    })
    records, audit = [], []
    status, reason = 'plan_only', '默认不联网；人工确认网站规则后方可采集'
    count, last_request, robots = 0, None, None
    opener = build_opener(NoRedirect())

    def fetch(url, ua):
        nonlocal count, last_request
        if count >= max_requests:
            raise RuntimeError('已达到请求总量上限')
        delay = interval
        if robots:
            delay = max(delay, robots.crawl_delay(AGENT) or 0)
            rate = robots.request_rate(AGENT)
            if rate and rate.requests > 0:
                # 更保守地按整个站点时间窗口间隔请求。
                delay = max(delay, rate.seconds)
        if delay > 120:
            raise RuntimeError('站点要求等待超过本工作流窗口，停止而不是缩短间隔')
        if last_request is not None:
            time.sleep(max(0, delay - (time.monotonic() - last_request)))
        count += 1
        last_request = time.monotonic()
        req = Request(url, headers={'User-Agent': ua, 'Accept': 'text/html,text/plain;q=0.9', 'Accept-Encoding': 'identity'})
        try:
            with opener.open(req, timeout=20) as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise RuntimeError('响应超过 2 MiB，停止采集')
                mime = response.headers.get_content_type()
                text = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
                audit.append({'url': url, 'status': response.status, 'bytes': len(raw), 'content_type': mime})
                return text, mime
        except HTTPError as exc:
            audit.append({'url': url, 'status': exc.code, 'action': '停止，不重试、不跟随重定向', 'retry_after': exc.headers.get('Retry-After')})
            code = exc.code
            exc.close()
            raise RuntimeError(f'HTTP {code}，停止采集') from None
        except URLError as exc:
            audit.append({'url': url, 'error': str(exc.reason), 'action': '停止，不重试'})
            raise RuntimeError('网络访问失败，停止采集') from None

    if not dry_run:
        contact = args.get('contact', '')
        if args.get('terms_reviewed') is not True or not isinstance(contact, str) or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', contact):
            raise ValueError('实际采集要求 terms_reviewed=true，并提供真实可联系的 contact 邮箱；仅在已核对网站条款允许本用途时设置')
        if len(contact) > 200 or not contact.isascii():
            raise ValueError('contact 请使用长度不超过 200 的 ASCII 邮箱')
        ua = f'{AGENT}/1.0 (+mailto:{contact})'
        status, reason = 'completed', None
        try:
            body, mime = fetch(ORIGIN + '/robots.txt', ua)
            if mime not in ('text/plain', 'text/x-robots') or '<html' in body.lower():
                raise RuntimeError('robots.txt 内容无法可靠识别，保守停止；未访问内容页面')
            robots = RobotFileParser()
            robots.set_url(ORIGIN + '/robots.txt')
            robots.parse(body.splitlines())
            queue, seen = deque((u, 0) for u in seeds), set()
            while queue and len(records) < max_pages:
                if count >= max_requests:
                    status, reason = 'limited', '已达到请求总量上限'
                    break
                url, depth = queue.popleft()
                if url in seen:
                    continue
                seen.add(url)
                if not robots.can_fetch(AGENT, url):
                    audit.append({'url': url, 'action': 'robots 禁止，跳过'})
                    continue
                text, mime = fetch(url, ua)
                if mime not in ('text/html', 'application/xhtml+xml'):
                    audit.append({'url': url, 'action': '非 HTML，不解析、不保存内容'})
                    continue
                parser = Page()
                parser.feed(text)
                visible = '\n'.join(parser.text)
                if any(marker in visible for marker in ('访问过于频繁', '请完成验证', '请输入验证码', '访问被拒绝', '安全验证')):
                    raise RuntimeError('检测到访问限制或验证提示，立即停止，不尝试绕过')
                records.append({
                    'source_url': url, 'title': ' '.join(parser.title), 'text': visible,
                    'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'content_kind': '网页可见文本，未经法律正文及效力核验',
                    'note': '不执行 JavaScript；动态正文可能缺失，不能视为完整法律条文',
                })
                ctx.log(f'已保存公开页面 {len(records)}/{max_pages}: {url}')
                if depth < max_depth:
                    for href in parser.links[:200]:
                        try:
                            target = safe_url(urljoin(url, href))
                        except ValueError:
                            continue
                        if urlsplit(target).path.lower().endswith(('.pdf', '.doc', '.docx', '.zip', '.xls', '.xlsx', '.jpg', '.png')):
                            continue
                        if target not in seen and len(queue) < 50:
                            queue.append((target, depth + 1))
                ctx.progress(min(90, int(len(records) / max_pages * 90)), '低频采集公开 HTML')
            if not records and status == 'completed':
                status, reason = 'no_content', '未获取可保存的 HTML 页面；请查看 robots 或内容类型审计'
        except (RuntimeError, ValueError, LookupError, OSError) as exc:
            status, reason = 'stopped', str(exc)
            ctx.log('保守停止：' + reason)

    ctx.task.save_json('collection_audit', {'status': status, 'reason': reason, 'requests': count, 'pages': len(records), 'audit': audit})
    ctx.task.save_json('pages', records)
    ctx.task.save_text('pages_jsonl', '\n'.join(json.dumps(r, ensure_ascii=False) for r in records))
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=['source_url', 'title', 'text', 'retrieved_at', 'content_kind', 'note'])
    writer.writeheader()
    for record in records:
        writer.writerow({k: ("'" + v if v.lstrip().startswith(('=', '+', '-', '@')) else v) for k, v in record.items()})
    csv_path = Path(ctx.work_dir) / 'pages.csv'
    csv_path.write_text(output.getvalue(), encoding='utf-8-sig')
    ctx.task.save_file('pages_csv', csv_path)
    ctx.task.save_text('report', f"状态：{status}\n原因：{reason or '达到本次有限采集范围'}\n请求：{count}，保存页面：{len(records)}\n仅为网页文本，不保证正文完整、时效或法律效力。robots/条款发生变化时须重新审核。")
    ctx.progress(100, '计划/有限采集报告已保存；实际是否获取内容请查看 collection_audit')
