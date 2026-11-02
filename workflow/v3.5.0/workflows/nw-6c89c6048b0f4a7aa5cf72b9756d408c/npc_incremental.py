"""已核实的公开前端接口，小批量串行增量采集。"""
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit
from site_adapter import Client

STATE = 'npc_incremental_state_v1'

def stamp():
    return datetime.now(timezone.utc).isoformat()

def checked(value):
    if not isinstance(value, dict) or value.get('code') != 200:
        raise ValueError('接口未成功：' + str(value)[:400])
    return value

def fingerprint(row):
    return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def public_url(value):
    u = urlsplit(value)
    return urlunsplit((u.scheme, u.netloc, u.path, '', ''))

def file_format(raw):
    if raw.startswith(b'%PDF-'):
        return 'pdf'
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if 'word/document.xml' in z.namelist() and z.testzip() is None:
                return 'docx'
    if raw.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
        return 'doc'
    raise ValueError('不是可识别的官方文档容器，拒绝保存为原文件')

def run(ctx):
    cfg = ctx.input
    if not isinstance(cfg, dict):
        raise ValueError('输入应为 JSON 对象')
    names = cfg.get('categories', ['宪法'])
    if not isinstance(names, list) or not names or len(names)>5 or any(not isinstance(n,str) for n in names):
        raise ValueError('categories 应为 1~5 个分类名称')
    max_docs = cfg.get('max_documents', 1)
    if type(max_docs) is not int or not 1 <= max_docs <= 3:
        raise ValueError('max_documents 必须为 1~3')
    dry = cfg.get('dry_run', True)
    recheck = cfg.get('recheck_files', False)
    if type(dry) is not bool or type(recheck) is not bool:
        raise ValueError('dry_run/recheck_files 必须是布尔值')
    ctx.task.save_json('plan', {'categories': names, 'max_documents':max_docs,'dry_run':dry,'recheck_files':recheck,'interval_seconds':15})
    if dry:
        ctx.task.save_text('report','演练：未联网、未改共享索引。正式小批量输入 {"dry_run":false}。')
        return
    try:
        state = ctx.workflow.read(STATE)
    except Exception as exc:
        if isinstance(exc,(KeyError,FileNotFoundError)) or any(t in str(exc).lower() for t in ['not found','不存在']):
            state = {'schema':1,'records':{},'cursors':{},'category_turn':0}
        else:
            raise
    if not isinstance(state,dict) or state.get('schema')!=1:
        raise ValueError('共享索引格式不兼容，不重置')
    c = Client()
    events=[]; index=[]; counts={'downloaded':0,'skipped':0,'unchanged_content':0,'failed':0,'requests':0}
    def request(path, data=None):
        if counts['requests']>=12:
            raise RuntimeError('本轮请求预算 12 已用尽')
        counts['requests']+=1
        return checked(c.json(path,data))
    stopped=None
    try:
        enums=request('/law-search/search/enumData')
        ctx.task.save_json('categories_response',enums)
        roots=enums['data']['flfgfl']['children']
        nodes=[]
        def walk(items):
            for node in items:
                nodes.append(node)
                walk(node.get('children') or [])
        walk(roots)
        selected=[]
        for name in names:
            matches=[n for n in nodes if n.get('name')==name]
            if len(matches)!=1:
                raise ValueError('分类名称未唯一匹配：'+name+'；可用名称：'+','.join(str(n.get('name')) for n in roots))
            selected.append(matches[0])
        # 一次只处理一个分类的一页；按分类轮转，页内未处理完不推进游标。
        turn=state.get('category_turn',0)%len(selected)
        node=selected[turn]; category=node['name']
        codes=node.get('codeIdList')
        if not isinstance(codes,list) or not codes:
            raise ValueError('分类缺少前端定义的 codeIdList')
        page=state['cursors'].get(category,1)
        body={'searchRange':1,'sxrq':[],'gbrq':[],'searchType':2,'sxx':[],'gbrqYear':[],
              'flfgCodeId':codes,'zdjgCodeId':[],'searchContent':'',
              'orderByParam':{'order':'-1','sort':''},'pageNum':page,'pageSize':20}
        listing=request('/law-search/search/list',body)
        ctx.task.save_json('listing',{'category':category,'page':page,'request':body,'response':listing})
        rows=listing.get('rows')
        if not isinstance(rows,list):
            raise ValueError('列表 rows 不是数组')
        processed=0; complete=True
        for row in rows:
            bbbs=row.get('bbbs')
            if not isinstance(bbbs,str) or not bbbs:
                raise ValueError('列表缺少 bbbs')
            title=re.sub('<[^>]*>','',row.get('title',''))
            key=bbbs; fp=fingerprint(row); old=state['records'].get(key,{})
            if old.get('status')=='downloaded' and old.get('listing_fingerprint')==fp and not recheck:
                counts['skipped']+=1
                index.append({'bbbs':bbbs,'title':title,'status':'skipped','reason':'列表元数据未变化；未重新传输附件','artifact':old['artifact']})
                continue
            if processed>=max_docs:
                complete=False
                break
            processed+=1
            try:
                detail=request('/law-search/search/flfgDetails?'+urlencode({'bbbs':bbbs}))
                ctx.task.save_json('detail_'+bbbs,detail)
                link=request('/law-search/download/pc?'+urlencode({'format':'docx','bbbs':bbbs,'fileId':''}))
                url=link['data']['url']
                if urlsplit(url).scheme!='https' or urlsplit(url).hostname not in ('flk.npc.gov.cn','flkoss.obs-bj2.cucloud.cn'):
                    raise ValueError('附件不是已核实的官方 HTTPS 主机')
                if counts['requests']>=12:
                    raise RuntimeError('请求预算已用尽')
                counts['requests']+=1
                raw=c.get(url); ext=file_format(raw)
                sha=hashlib.sha256(raw).hexdigest(); artifact='original_'+sha+'.'+ext
                versions=list(old.get('versions',[]))
                if old.get('sha256')==sha:
                    counts['unchanged_content']+=1
                else:
                    path=Path(ctx.work_dir)/artifact; path.write_bytes(raw)
                    ctx.task.save_file(artifact,str(path)); ctx.workflow.save_file(artifact,str(path))
                    versions.append({'sha256':sha,'artifact':artifact,'downloaded_at':stamp()})
                    counts['downloaded']+=1
                record={'bbbs':bbbs,'title':title,'category':category,'status':'downloaded','sha256':sha,
                        'bytes':len(raw),'format':ext,'artifact':artifact,'versions':versions,
                        'listing_fingerprint':fp,'last_checked':stamp(),
                        'detail_url':'https://flk.npc.gov.cn/detail?'+urlencode({'id':bbbs}),
                        'file_source':public_url(url)}
                state['records'][key]=record
                index.append(record)
            except Exception as exc:
                counts['failed']+=1; complete=False
                failed=dict(old)
                failed.update({'bbbs':bbbs,'title':title,'category':category,'status':'failed','error':str(exc)[:700],'last_checked':stamp()})
                state['records'][key]=failed
                events.append({'bbbs':bbbs,'error':str(exc)[:700]})
                # 不重试，不在访问失败后继续请求其他条目。
                stopped=str(exc)[:700]
                break
        if complete:
            total=listing.get('total')
            if type(total) is not int:
                raise ValueError('分页 total 不是整数')
            state['cursors'][category]=1 if page*20>=total or not rows else page+1
        state['category_turn']=(turn+1)%len(selected)
    except Exception as exc:
        stopped=str(exc)[:700]
        events.append({'error':stopped})
    state['updated_at']=stamp()
    ctx.workflow.save_json(STATE,state)
    ctx.task.save_json('file_index',index)
    ctx.task.save_json('audit',{'counts':counts,'stopped':stopped,'events':events,'cursors':state['cursors']})
    ctx.task.save_text('report',json.dumps({'counts':counts,'stopped':stopped,'note':'任务成功只表示审计和状态已发布；请以 downloaded 和 failed 计数判断下载结果。'},ensure_ascii=False,indent=2))
    ctx.log('本轮结果：'+json.dumps(counts,ensure_ascii=False))
