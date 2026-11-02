"""公开页面/已观察到的脚本单请求测试，不规避访问控制。"""
import re
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from law_http import Links


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(ctx):
    if ctx.input.get('public_probe') is not True:
        ctx.task.save_json('public_probe_report', {'status': 'not_requested'})
        return
    script = ctx.input.get('inspect_observed_script') is True
    address = 'https://flk.npc.gov.cn/assets/index-BZ9XHUiV.js' if script else 'https://flk.npc.gov.cn/index'
    report = {'url': address, 'requests': 1, 'robots_check': 'skipped_by_explicit_user_request', 'note': '不绕过实际访问控制，不跟随重定向，无重试'}
    try:
        req = Request(address, headers={'User-Agent': 'NebulaePublicLawResearch/1.0 (limited-public-access-test)', 'Accept-Encoding': 'identity'})
        with build_opener(NoRedirect()).open(req, timeout=25) as response:
            raw = response.read(5 * 1024 * 1024 + 1)
            report.update(http_status=response.status, content_type=response.headers.get('Content-Type'), bytes=len(raw))
            if len(raw) > 5 * 1024 * 1024:
                raise ValueError('响应超过 5 MiB 上限')
            text = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            ctx.task.save_text('public_script_response' if script else 'public_homepage_response', text)
            if not script and any(x in text for x in ('请输入验证码', '请完成验证', '访问过于频繁', '访问被拒绝', '安全验证')):
                report.update(status='access_restriction', reason='检测到验证或限制提示，不继续')
            elif script:
                terms = ('baseURL', '/api/', 'download', 'flfg', 'list', '.pdf', 'axios', '全文', '下载')
                snippets = []
                for term in terms:
                    matches = list(re.finditer(re.escape(term), text))
                    for match in matches[:12]:
                        snippets.append({'term': term, 'offset': match.start(), 'text': text[max(0, match.start()-180):match.end()+260]})
                report.update(status='script_received', snippets=snippets)
                ctx.task.save_json('script_analysis', snippets)
            else:
                report.update(status='received', links=Links(text).links[:100])
    except HTTPError as exc:
        report.update(status='stopped', http_status=exc.code, location=exc.headers.get('Location'), reason='HTTP 错误或重定向；不规避、不重试')
        exc.close()
    except (URLError, OSError, ValueError) as exc:
        report.update(status='stopped', reason=str(exc))
    ctx.task.save_json('public_probe_report', report)
