"""Deterministic protocol fixture for isolated integration tests, never a production model."""
import hashlib
import json
import re
import time
import base64
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def vectors(value):
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    result = [0.01] * 16
    for char in text:
        result[hashlib.sha256(char.encode()).digest()[0] % 16] += 1
    return result

class Handler(BaseHTTPRequestHandler):
    observed=[]
    wiki_counts={}
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path.endswith('/models'):
            self.observed.append({'path':self.path,'authorization_sha256':hashlib.sha256(self.headers.get('Authorization','').encode()).hexdigest()})
        result={'data':[{'id':'fixture-text'},{'id':'fixture-vision'},{'id':'fixture-text'}]} if self.path.endswith('/models') else {'requests':self.observed} if self.path=='/observed' else {'ok':True}
        body=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
    def do_POST(self):
        self.observed.append({'path':self.path,'authorization_sha256':hashlib.sha256(self.headers.get('Authorization','').encode()).hexdigest()})
        raw = self.rfile.read(int(self.headers['Content-Length']))
        if self.path.endswith('/audio/transcriptions'):
            result = {'text':'这是用于数据库测试的音频。','segments':[{'start':0.2,'end':1.5,'text':'这是用于数据库测试的音频。'}]}
        else:
            data = json.loads(raw)
            if self.path in ('/layout-parsing', '/progress/layout-parsing', '/regions/layout-parsing', '/no-images/layout-parsing', '/bad-region/layout-parsing', '/whole-page/layout-parsing', '/ocr-anomaly/layout-parsing', '/ocr-loops/layout-parsing'):
                if self.path.startswith('/progress/'):
                    time.sleep(2)
                from PIL import Image
                image=Image.open(io.BytesIO(base64.b64decode(data['file'])))
                width,height=image.size
                result={'result':{'layoutParsingResults':[{'prunedResult':{'width':width,'height':height,'parsing_res_list':[{'block_content':'第一章','block_label':'doc_title','block_bbox':[0,0,width,height/4]},{'block_content':('数据库初始化。NebulaeKno 使用数据库。<table><tr><th>项目</th><th>状态</th></tr><tr><td colspan="2">合并单元格示例</td></tr></table>' if self.path.startswith('/progress/') else '数据库初始化。NebulaeKno 使用数据库。'),'block_label':'text','block_bbox':[0,height/4,width,height/2]}]}}]}}
                if self.path.startswith(('/regions/', '/no-images/', '/bad-region/', '/whole-page/', '/ocr-anomaly/', '/ocr-loops/')):
                    items=[{'block_label':'doc_title','block_content':'区域图片隔离验收','block_id':0,'block_order':0,'block_bbox':[0,0,width,height*.1]},
                           {'block_label':'table','block_content':'<table><tr><th>类型</th><th>说明</th></tr>'+''.join('<tr><td>数据库</td><td colspan="1">表格结构必须完整保存</td></tr>' for _ in range(10))+'</table>','block_id':1,'block_order':1,'block_bbox':[0,height*.1,width,height*.4]}]
                    if not self.path.startswith('/no-images/'):
                        items += [{'block_label':'image','block_content':'![](https://invalid/should-never-fetch.png)','block_id':2,'block_order':2,'block_bbox':[width*.1,height*.5,width*.3,height*.75]},
                                  {'block_label':'chart','block_content':'图表识别数据 绿色区域','block_id':3,'block_order':3,'block_bbox':[width*.5,height*.5,width*.8,height*.75]}]
                    if self.path.startswith('/ocr-anomaly/'):items[2]['block_content']='30 40 50 60 70 '*130
                    if self.path.startswith('/ocr-loops/'):
                        assert 'repetitionPenalty' not in data, 'Production must keep server-default sampling'
                        items[2]['block_content']='原图😀标题\n'+'智能体\n职业化能力\n\n'*100+'结束：正常内容。'
                    if self.path.startswith('/bad-region/'):items[2]['block_bbox']=[0,0,width+1,height]
                    if self.path.startswith('/whole-page/'):items= [{'block_label':'image','block_content':'','block_bbox':[0,0,width,height]}]
                    result['result']['layoutParsingResults'][0]['prunedResult']['parsing_res_list']=items
                self.observed.append({'pipeline':self.path,'layout_enabled':data.get('useLayoutDetection'),'ocr_image_enabled':data.get('useOcrForImageBlock'),'input_size':[width,height]})
                body=json.dumps(result,ensure_ascii=False).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body);return
            if "slow" in data.get("model", ""):time.sleep(10)
            if self.path.endswith('/embeddings'):
                result = {'data':[{'index':i,'embedding':vectors(value)} for i,value in enumerate(data['input'])]}
            elif self.path.endswith('/rerank'):
                result = {'results':[{'index':i,'relevance_score':1/(i+1)} for i in range(len(data['documents']))]}
            else:
                prompt = data['messages'][0]['content']
                self.observed.append({'model':data.get('model'),'prompt':prompt[0]['text'] if isinstance(prompt,list) else prompt,'image_count':sum(1 for part in prompt if part.get('type')=='image_url' and part.get('image_url',{}).get('url','').startswith('data:image/')) if isinstance(prompt,list) else 0})
                if isinstance(prompt,list):
                    from PIL import Image
                    sizes=[]
                    for part in prompt:
                        url=part.get('image_url',{}).get('url','')
                        if url.startswith('data:image/'):
                            with Image.open(io.BytesIO(base64.b64decode(url.split(',',1)[1]))) as im:sizes.append(list(im.size))
                    self.observed.append({'vision_sizes':sizes})
                    text = '测试画面包含绿色区域和数据库文字。'
                elif '你是 NebulaeKno 解析配置助手' in prompt:
                    if 'invalid-suggestion' in data.get('model', ''):
                        text = '{"image_instructions":"无效配置", "graph_enabled":false}'
                    elif 'nonjson-suggestion' in data.get('model', ''):
                        text = '这不是 JSON'
                    elif 'failure-suggestion' in data.get('model', ''):
                        self.send_response(503); self.end_headers(); return
                    elif '"image_instructions"' in prompt:
                        text = json.dumps({'image_instructions':'请用简体中文描述设备图片中可见的铭牌、部件及连接关系，原样记录可辨文字，模糊内容标注无法辨认，不推测未显示的事实。'}, ensure_ascii=False)
                    else:
                        text = json.dumps({'extract_config':{'tags':['设备','部件','项目','组织'],'relations':['包含','负责','用于','依赖'],'custom_instructions':'依据原文抽取设备、部件、项目和组织之间的关系，保留原文证据和来源位置；含糊指代不强行合并，示例不作为事实入库。','text':'【虚构示例】示例甲公司负责示例项目，项目使用示例设备，设备包含示例部件。'}}, ensure_ascii=False)
                elif '"headings"' in prompt: text = '{"headings":[]}'
                elif '"entities"' in prompt:
                    chunk = json.loads(prompt.split('材料：')[-1]);content=chunk['content'];source=chunk['source_ref_id']
                    entities = [{'name':name,'type':'概念','description':name,'quote':content} for name in ('NebulaeKno','数据库') if name in content]
                    relations = [{'source':'NebulaeKno','target':'数据库','relation':'使用','quote':content}] if len(entities)==2 else []
                    if '待修复项：' in prompt:
                        repair=json.JSONDecoder().raw_decode(prompt.split('待修复项：',1)[1])[0]
                        entities,relations=repair['entities'],repair['relations']
                        for item in entities+relations:item['quote']=content
                    if data['model'].startswith('fixture-repair-graph-fail') and '__GRAPH_FAIL__' in content:
                        for relation in relations:relation['quote']='NebulaeKno 不使用数据库，电压 999 kV。'
                    if data['model'].startswith('fixture-repair-graph-drop') and '待修复项：' in prompt:
                        entities=[];relations=[]
                    text = json.dumps({'entities':entities,'relations':relations},ensure_ascii=False)
                elif '"pages"' in prompt:
                    chunks=json.loads(prompt.split('材料：')[-1])
                    key=(data['model'],hashlib.sha256(json.dumps(chunks,sort_keys=True).encode()).hexdigest())
                    self.wiki_counts[key]=self.wiki_counts.get(key,0)+1
                    attempt=self.wiki_counts[key]
                    self.observed.append({'wiki_batch':key[1],'wiki_attempt':attempt,'model':data['model']})
                    page={'title':'测试资料','blocks':[{'content':c['content'],'source_ref_ids':[c['source_ref_id']]} for c in chunks]}
                    pages=[page]
                    failure=data['model'].startswith('fixture-wiki-fail') and any('__WIKI_FAIL__' in c['content'] for c in chunks)
                    if failure:
                        pages=[dict(page,title='已保留的有效页'),dict(page,title='失败页')]
                    if '待修复页面：' in prompt:
                        pages=json.JSONDecoder().raw_decode(prompt.split('待修复页面：',1)[1])[0]
                        for p in pages:
                            for block in p['blocks']:
                                block['source_ref_ids']=[next((c['source_ref_id'] for c in chunks if c['content']==block['content']),'S1')]
                    if failure or (data['model'].startswith('fixture-wiki-transient') and attempt<=2):
                        pages[-1]['blocks']=[dict(block) for block in pages[-1]['blocks']]
                        pages[-1]['blocks'][0]=dict(pages[-1]['blocks'][0],source_ref_ids=['S9999'])
                    if data['model'].startswith('fixture-wiki-pause'):time.sleep(4)
                    text=json.dumps({'pages':pages},ensure_ascii=False)
                else: text='连接成功。'
                result={'choices':[{'message':{'content':text}}]}
        body=json.dumps(result,ensure_ascii=False).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

ThreadingHTTPServer(('0.0.0.0',9000),Handler).serve_forever()
