import re
from urllib.request import urlopen

def run(ctx):
    with urlopen('http://127.0.0.1:8765/api/v1/artifacts/c3e40591451f4161bc5d2d2974b65845/download',timeout=20) as r:
        text=r.read().decode()
    exports=text[text.rfind('export{'):]
    result={'exports':exports[-16000:]}
    for token in ['/law-search/search','/law-search/index','searchRange:','searchContent:""']:
        result[token]=[text[max(0,m.start()-180):m.start()+900] for m in list(re.finditer(re.escape(token),text))[:15]]
    ctx.task.save_json('inspection',result)
