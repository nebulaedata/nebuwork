"""仅使用已公开并获准访问的同站链接；不执行脚本、不跟随重定向。"""
import time
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.robotparser import RobotFileParser

ORIGIN = 'https://flk.npc.gov.cn'
AGENT = 'NebulaePublicLawResearch'


def url(value):
    p = urlsplit(value)
    if p.scheme != 'https' or p.netloc != 'flk.npc.gov.cn' or any(ord(c) < 33 for c in value) or '\\' in value:
        raise ValueError('仅允许本站 HTTPS 公开地址：' + value)
    return urlunsplit((p.scheme, p.netloc, p.path or '/', p.query, ''))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Links(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links, self.active, self.label = [], None, []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.active = dict(attrs).get('href')
            self.label = []

    def handle_data(self, data):
        if self.active:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag == 'a' and self.active:
            self.links.append((self.active, ''.join(self.label).strip()))
            self.active = None


class Client:
    def __init__(self, cfg):
        self.cfg, self.audit, self.count = cfg, [], 0
        self.last, self.robots = None, None
        self.opener = build_opener(NoRedirect())
        self.ua = AGENT + '/1.0 (+mailto:' + cfg['contact'] + ')'
        raw, headers, status = self.get(ORIGIN + '/robots.txt', robots_request=True)
        if headers.get_content_type() != 'text/plain' or b'<html' in raw.lower():
            raise RuntimeError('robots.txt 无法可靠识别，停止')
        self.robots = RobotFileParser()
        self.robots.parse(raw.decode('utf-8-sig').splitlines())

    def get(self, address, validators=None, robots_request=False):
        address = url(address)
        if not robots_request and not self.robots.can_fetch(AGENT, address):
            raise RuntimeError('robots 禁止访问：' + address)
        if self.count >= self.cfg['max_requests_per_stage']:
            raise RuntimeError('本阶段请求预算耗尽；保留已完成数据，下次增量继续')
        delay = self.cfg['interval_seconds']
        if self.robots:
            delay = max(delay, self.robots.crawl_delay(AGENT) or 0)
            rate = self.robots.request_rate(AGENT)
            if rate:
                delay = max(delay, rate.seconds)
        if delay > 120:
            raise RuntimeError('站点要求更长等待，保守停止')
        if self.last is not None:
            time.sleep(max(0, delay - (time.monotonic() - self.last)))
        self.last = time.monotonic()
        self.count += 1
        headers = {'User-Agent': self.ua, 'Accept-Encoding': 'identity'}
        headers.update(validators or {})
        try:
            with self.opener.open(Request(address, headers=headers), timeout=30) as response:
                raw = response.read(20 * 1024 * 1024 + 1)
                if len(raw) > 20 * 1024 * 1024:
                    raise RuntimeError('文件超过 20 MiB，停止')
                self.audit.append({'url': address, 'status': response.status, 'bytes': len(raw)})
                return raw, response.headers, response.status
        except HTTPError as exc:
            self.audit.append({'url': address, 'status': exc.code})
            code, hdr = exc.code, exc.headers
            exc.close()
            if code == 304 and validators:
                return b'', hdr, 304
            raise RuntimeError(f'HTTP {code}，不重试、不绕过、不跟随重定向') from None


def html(raw, headers):
    if headers.get_content_type() not in ('text/html', 'application/xhtml+xml'):
        raise RuntimeError('列表/详情返回的不是 HTML；需要验证站点适配')
    text = raw.decode(headers.get_content_charset() or 'utf-8', errors='replace')
    if any(x in text for x in ('请输入验证码', '请完成验证', '访问过于频繁', '访问被拒绝', '安全验证')):
        raise RuntimeError('检测到访问限制，立即停止')
    return text
