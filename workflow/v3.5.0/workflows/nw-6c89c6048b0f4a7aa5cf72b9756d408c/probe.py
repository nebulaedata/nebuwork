"""用户授权的小批量无邮箱探测：最多四次请求，无重试，无重定向。"""
import json
import time
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.robotparser import RobotFileParser
from urllib.parse import urljoin
from html.parser import HTMLParser
from law_http import Links, url


class RedirectStop(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Scripts(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.sources = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('src'):
            self.sources.append(dict(attrs)['src'])


def run(ctx):
    if not isinstance(ctx.input, dict) or ctx.input.get('probe') is not True:
        ctx.task.save_json('probe_report', {'status': 'not_requested'})
        return
    opener = build_opener(RedirectStop())
    audit, last, robot = [], None, None
    ua = 'NebulaePublicLawResearch/1.0 (limited-public-access-test; no-contact-provided)'

    def get(address):
        nonlocal last
        address = url(address)
        if len(audit) >= 4:
            raise RuntimeError('达到四次请求上限')
        delay = 15
        if robot:
            if not robot.can_fetch('NebulaePublicLawResearch', address):
                raise RuntimeError('robots 禁止访问：' + address)
            delay = max(delay, robot.crawl_delay('NebulaePublicLawResearch') or 0)
            rate = robot.request_rate('NebulaePublicLawResearch')
            if rate:
                delay = max(delay, rate.seconds)
        if delay > 120:
            raise RuntimeError('robots 要求等待超过探测窗口，停止')
        if last is not None:
            time.sleep(max(0, delay - (time.monotonic() - last)))
        last = time.monotonic()
        event = {'url': address}
        audit.append(event)
        try:
            with opener.open(Request(address, headers={'User-Agent': ua, 'Accept-Encoding': 'identity'}), timeout=25) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                event.update(status=response.status, bytes=len(raw), content_type=response.headers.get('Content-Type'))
                if len(raw) > 2 * 1024 * 1024:
                    raise RuntimeError('响应超过探测大小上限')
                text = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
                if any(x in text for x in ('请输入验证码', '请完成验证', '访问过于频繁', '访问被拒绝', '安全验证')):
                    raise RuntimeError('检测到访问限制，停止')
                return text, response.headers.get_content_type()
        except HTTPError as exc:
            event.update(status=exc.code, location=exc.headers.get('Location'))
            exc.close()
            raise RuntimeError('HTTP 错误或重定向，停止，不绕过') from None

    report = {'status': 'started', 'requests': audit, 'note': '仅探测公开入口；未表示已核验网站全部条款或已下载原文'}
    try:
        text, mime = get('https://flk.npc.gov.cn/robots.txt')
        ctx.task.save_text('robots_txt', text)
        if mime != 'text/plain' or '<html' in text.lower():
            raise RuntimeError('robots 内容不能可靠识别，停止访问其他页面')
        robot = RobotFileParser()
        robot.parse(text.splitlines())
        text, mime = get('https://flk.npc.gov.cn/index')
        if mime not in ('text/html', 'application/xhtml+xml'):
            raise RuntimeError('首页不是 HTML')
        ctx.task.save_text('homepage_html', text)
        report['links'] = Links(text).links[:150]
        sources = Scripts(text).sources
        report['scripts'] = sources
        for i, source in enumerate(sources[:2]):
            target = url(urljoin('https://flk.npc.gov.cn/index', source))
            script, mime = get(target)
            ctx.task.save_text('public_script_' + str(i), script)
        report['status'] = 'probe_completed'
    except (RuntimeError, ValueError, OSError, LookupError) as exc:
        report['status'], report['reason'] = 'stopped', str(exc)
        ctx.log('探测停止：' + str(exc))
    ctx.task.save_json('probe_report', report)
