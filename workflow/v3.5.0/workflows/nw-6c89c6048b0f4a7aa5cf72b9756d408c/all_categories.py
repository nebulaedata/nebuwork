"""默认全分类真实增量；显式 categories 的历史模板保留原行为。"""
import hashlib
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import urlencode
from site_adapter import Client
from npc_incremental import STATE, checked, stamp, file_format, public_url


def run(ctx):
    cfg = ctx.input
    if not isinstance(cfg, dict):
        raise ValueError('输入必须是对象')
    if 'categories' in cfg:
        from npc_incremental import run as legacy_run
        return legacy_run(ctx)
    dry = cfg.get('dry_run', False)
    limit = cfg.get('max_documents', 10)
    if type(dry) is not bool or type(limit) is not int or not 1 <= limit <= 10:
        raise ValueError('dry_run 必须是布尔值，max_documents 必须为 1～10')
    ctx.task.save_json('plan', {'dry_run':dry,'scope':'全部一级分类（包含所有子分类）','max_documents':limit,'interval_seconds':15,'max_requests':80})
    if dry:
        ctx.task.save_text('report', '全分类演练：不联网、不修改共享状态。')
        return
    try:
        state = ctx.workflow.read(STATE)
    except (KeyError, FileNotFoundError):
        state = {'schema':1,'records':{},'cursors':{},'category_turn':0}
    if not isinstance(state, dict) or state.get('schema') != 1:
        raise ValueError('索引格式不兼容，不重置')
    auto = state.setdefault('all_categories_v1', {'turn':0,'pages':{}})
    client = Client()
    counts = {'downloaded':0,'skipped':0,'failed':0,'requests':0,'duplicate_content':0}
    events = []; index = []; files = []; stopped = None
    def get(path, body=None, binary=False):
        if counts['requests'] >= 80:
            raise RuntimeError('本轮 80 次请求预算已用尽，下次继续')
        counts['requests'] += 1
        return client.get(path,body) if binary else checked(client.json(path,body))
    try:
        enums = get('/law-search/search/enumData')
        ctx.task.save_json('categories_response', enums)
        roots = enums['data']['flfgfl']['children']
        if not roots or any(not n.get('codeIdList') for n in roots):
            raise ValueError('官方分类结构不完整')
        cache = {}; visited = set(); exhausted = set()
        known_hashes = {r.get('sha256') for r in state['records'].values() if r.get('sha256')}
        while counts['downloaded'] < limit and len(exhausted) < len(roots):
            turn = auto['turn'] % len(roots)
            node = roots[turn]; key = str(node['codeId']); name = node['name']
            auto['turn'] = (turn+1) % len(roots)
            if key in exhausted:
                continue
            pos = auto['pages'].setdefault(key, {'page':1,'offset':0})
            page = pos['page']; ck = (key,page)
            if ck not in cache:
                if ck in visited:
                    exhausted.add(key)
                    continue
                body = {'searchRange':1,'sxrq':[],'gbrq':[],'searchType':2,'sxx':[],'gbrqYear':[],
                        'flfgCodeId':node['codeIdList'],'zdjgCodeId':[],'searchContent':'',
                        'orderByParam':{'order':'-1','sort':''},'pageNum':page,'pageSize':20}
                listing = get('/law-search/search/list',body)
                ctx.task.save_json('listing_'+key+'_'+str(page), {'category':name,'request':body,'response':listing})
                rows = listing.get('rows'); total = listing.get('total')
                if not isinstance(rows,list) or type(total) is not int:
                    raise ValueError('列表 rows/total 格式错误')
                cache[ck] = (rows,total); visited.add(ck)
            rows,total = cache[ck]
            if pos['offset'] >= len(rows):
                pos.update(page=1 if page*20 >= total or not rows else page+1, offset=0)
                if pos['page'] == 1:
                    exhausted.add(key)
                continue
            row = rows[pos['offset']]
            bbbs = row.get('bbbs')
            if not isinstance(bbbs,str) or not bbbs:
                raise ValueError('条目缺少 bbbs')
            old = state['records'].get(bbbs,{})
            title = re.sub('<[^>]*>','',row.get('title',''))
            # 自动批次只获取尚未成功的不同条目；旧版下载记录同样识别。
            if old.get('status') == 'downloaded':
                counts['skipped'] += 1; pos['offset'] += 1
                continue
            try:
                detail = get('/law-search/search/flfgDetails?'+urlencode({'bbbs':bbbs}))
                ctx.task.save_json('detail_'+bbbs, detail)
                link = get('/law-search/download/pc?'+urlencode({'format':'docx','bbbs':bbbs,'fileId':''}))
                url = link['data']['url']
                raw = get(url,binary=True); ext = file_format(raw)
                sha = hashlib.sha256(raw).hexdigest(); artifact = 'original_'+sha+'.'+ext
                record = {'bbbs':bbbs,'title':title,'category':name,'status':'downloaded','sha256':sha,
                          'bytes':len(raw),'format':ext,'artifact':artifact,'last_checked':stamp(),
                          'detail_url':'https://flk.npc.gov.cn/detail?'+urlencode({'id':bbbs}),
                          'file_source':public_url(url),'versions':[{'sha256':sha,'artifact':artifact,'downloaded_at':stamp()}]}
                if sha in known_hashes:
                    counts['duplicate_content'] += 1
                    record['note'] = '内容哈希与已有文件相同；引用已有共享文件，不计入本批新增10份'
                else:
                    path = Path(ctx.work_dir)/artifact; path.write_bytes(raw)
                    ctx.task.save_file(artifact,str(path)); ctx.workflow.save_file(artifact,str(path))
                    friendly = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', title)[:100]+'_'+bbbs+'.'+ext
                    files.append((path,friendly)); known_hashes.add(sha)
                    record['bundle_filename'] = friendly
                    counts['downloaded'] += 1
                    ctx.progress(counts['downloaded']*100/limit,'已保存新增原文件 '+str(counts['downloaded'])+'/'+str(limit))
                state['records'][bbbs] = record; index.append(record)
                pos['offset'] += 1
                ctx.log(name+'：'+title)
            except Exception as exc:
                counts['failed'] += 1
                events.append({'bbbs':bbbs,'category':name,'error':str(exc)[:700]})
                # 失败不推进此条游标，保留原成功记录；停止访问，不绕过拒绝。
                raise
    except Exception as exc:
        stopped = str(exc)[:700]
    state['updated_at'] = stamp()
    ctx.workflow.save_json(STATE,state)
    ctx.task.save_json('file_index',index)
    audit = {'counts':counts,'target':limit,'target_met':counts['downloaded']==limit,'stopped':stopped,'events':events,'progress':auto,
             'note':'自动模式只续采尚未成功的条目，不复查已成功条目的静默更新；禁止并发运行。'}
    ctx.task.save_json('audit',audit)
    ctx.task.save_text('report',json.dumps(audit,ensure_ascii=False,indent=2))
    if files:
        archive = Path(ctx.work_dir)/'本批法律法规原文件.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for path,name in files:
                z.write(path,name)
            z.writestr('文件索引.json',json.dumps(index,ensure_ascii=False,indent=2))
        ctx.task.save_file('本批法律法规原文件.zip',str(archive))
    ctx.log('本批审计：'+json.dumps(audit,ensure_ascii=False))
