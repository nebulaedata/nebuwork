"""公开接口 HTTP 客户端；不自动重试，不跟随重定向。"""
import json
import time
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

class Client:
    def __init__(self):
        self.opener=build_opener(NoRedirect())
        self.last=0

    def get(self, path, data=None):
        url=path if path.startswith('https://') else 'https://flk.npc.gov.cn'+path
        parts=urlsplit(url)
        if parts.scheme!='https' or parts.hostname not in ('flk.npc.gov.cn','flkoss.obs-bj2.cucloud.cn') or parts.port not in (None,443) or parts.username or parts.password:
            raise ValueError('仅支持已核实的官方 HTTPS 主机')
        time.sleep(max(0,15-(time.monotonic()-self.last)))
        req=Request(url,data=None if data is None else json.dumps(data).encode(),headers={'User-Agent':'NebulaePublicLawResearch/1.0','Accept-Encoding':'identity','Content-Type':'application/json'})
        self.last=time.monotonic()
        with self.opener.open(req,timeout=35) as r:
            raw=r.read(20*1024*1024+1)
            if len(raw)>20*1024*1024:
                raise ValueError('响应超过 20 MiB 上限')
            return raw

    def json(self,path,data=None):
        return json.loads(self.get(path,data))
