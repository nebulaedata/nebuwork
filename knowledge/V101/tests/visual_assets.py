"""Run --seed against the pre-region image, then verify after upgrading isolated app."""
from client import *
import io
import sys
from pypdf import PdfWriter

assert BASE == 'http://127.0.0.1:19081/api/v1', 'Only use the isolated test stack'
record=Path(__file__).parent.parent/'test-results/visual-assets.json'
if '--seed' in sys.argv:
    bindings={}
    for purpose in ['text','vision','embedding']:
        model=request('/models',dict(name='图片验收 '+purpose,purpose=purpose,protocol='openai',base_url='http://model-fixture:9000/v1',model_name='fixture-'+purpose,dimension=16 if purpose=='embedding' else None))
        bindings[purpose]=model['id']
    request('/settings/model-bindings',bindings,method='PUT')
    request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000/progress'}},method='PUT')
    kb=request('/knowledge-bases',{'name':'图片展示隔离验收','config':{'image_caption':True,'image_embedding':False,'outline_enabled':False,'wiki_enabled':False,'graph_enabled':False,'chunk_size':128,'chunk_overlap':32}})['id']
    writer=PdfWriter()
    for _ in range(2): writer.add_blank_page(width=300,height=400)
    stream=io.BytesIO();writer.write(stream)
    doc=upload(kb,'图片验收.pdf',stream.getvalue())
    task=wait_task(doc['task_id']);assert task['state']=='succeeded',task
    before=request('/knowledge/'+doc['knowledge_id']+'/content')
    legacy_chunks=request('/knowledge/'+doc['knowledge_id']+'/chunks?page_size=100')
    legacy_images=request('/knowledge/'+doc['knowledge_id']+'/images')
    record.write_text(json.dumps(dict(kb=kb,doc=doc,parse=before['parse_version_id'],legacy_caption_ids=[c['source_ref_id'] for c in legacy_chunks if c['content_origin']=='image_caption'],legacy_image_ids=[i['id'] for i in legacy_images]),ensure_ascii=False),encoding='utf-8')
    check(True,'旧版 PDF 已解析，保留用于验证升级补登记')
    sys.exit()

saved=json.loads(record.read_text(encoding='utf-8'));kb=saved['kb'];doc=saved['doc'];id=doc['knowledge_id'];old=saved['parse']
assert request('/knowledge/'+id+'/images')==[]
legacy=request('/knowledge/'+id+'/content')
assert legacy['requires_image_reparse'] and legacy['visual_layout_version']==0
legacy_chunks=request('/knowledge/'+id+'/chunks?page_size=100')
assert legacy_chunks and all(not c['images'] and c['content_origin']!='image_caption' for c in legacy_chunks)
for source in saved['legacy_caption_ids']:
    assert request('/sources/'+source)['source_ref_id']==source
for mode in ['keyword','vector','image_text']:
    hits=request('/search',{'mode':mode,'query_text':'数据库','knowledge_base_ids':[kb],'include_sources':True,'include_context':True,'rerank':{'mode':'disabled'}})['results']
    assert all(h.get('content_origin')!='image_caption' for h in hits)
    assert all(c['source_ref_id'] not in saved['legacy_caption_ids'] for h in hits for c in h.get('context',[]))
check(True,'升级后整页图退出图片列表与分块；旧描述不再参与召回，历史来源仍可访问')

from PIL import Image, ImageDraw
import subprocess

def observed():
    raw=subprocess.check_output(['docker','exec','nebulaekno-config-test-model-fixture-1','python3','-c',"import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:9000/observed').read().decode())"])
    return json.loads(raw)['requests']

def pdf_bytes():
    # Raster PDF fixture: colored regions provide verifiable crop pixels.
    image=Image.new('RGB',(400,600),'white');draw=ImageDraw.Draw(image)
    draw.text((20,20),'PDF LAYOUT: TEXT / TABLE / IMAGES',fill='black')
    draw.rectangle((0,60,399,239),outline='black',width=2)
    draw.text((20,90),'TABLE: preserve merged cells',fill='black')
    draw.rectangle((40,300,119,449),fill=(10,170,90))
    draw.rectangle((200,300,319,449),fill=(30,70,160))
    draw.text((50,340),'FIGURE',fill='white');draw.text((220,340),'CHART',fill='white')
    stream=io.BytesIO();image.save(stream,format='PDF',resolution=72,save_all=True,append_images=[image]);return stream.getvalue()

def set_engine(path):request('/settings/parser-engines',{'paddleocr_vl':{'endpoint':'http://model-fixture:9000/'+path}},method='PUT')

bindings=request('/settings/model-bindings')
model=request('/models',dict(name='图片向量验收',purpose='multimodal_embedding',protocol='jina',base_url='http://model-fixture:9000/v1',model_name='fixture-images',dimension=16))
bindings['multimodal_embedding']=model['id'];request('/settings/model-bindings',bindings,method='PUT')
newkb=request('/knowledge-bases',{'name':'PDF区域裁剪验收','config':{'image_caption':True,'image_embedding':True,'outline_enabled':False,'wiki_enabled':False,'graph_enabled':False,'chunk_size':128,'chunk_overlap':32}})['id']
set_engine('regions')
newdoc=upload(newkb,'版面区域与图片.pdf',pdf_bytes());result=wait_task(newdoc['task_id']);assert result['state']=='succeeded',result
nid=newdoc['knowledge_id']
newparse=request('/knowledge/'+nid+'/content')
assert newparse['visual_layout_version']==2 and not newparse['requires_image_reparse']

def verify(parse_id):
    images=request('/knowledge/'+nid+'/images?parse_version_id='+parse_id)
    assert len(images)==4,images
    assert [i['metadata']['page'] for i in images]==[1,1,2,2],images
    for image in images:
        assert image['kind']=='image' and image['metadata']['visual_role']=='image_region'
        assert 'path' not in image['metadata']
        detail=request('/images/'+image['id'])
        position=detail['locators'][0]
        assert position['type']=='image' and position['page'] in [1,2] and position['region_id']
        is_chart=image['metadata']['layout']['label']=='chart'
        assert position['bbox']==([.5,.5,.8,.75] if is_chart else [.1,.5,.3,.75]),position
        assert detail['recognized_text']==('图表识别数据 绿色区域' if is_chart else '')
        assert detail['caption_ready']
        assert len([s for s in detail['source_refs'] if s['origin']=='image_caption'])==1
        assert all(s['locators']==detail['locators'] for s in detail['source_refs'])
        source=request('/sources/'+detail['source_ref_id'])
        assert source['locators']==detail['locators'] and source['precision']=='region'
        with urllib.request.urlopen(BASE+'/images/'+image['id']+'/content') as response:
            crop=Image.open(io.BytesIO(response.read()));crop.load()
        assert crop.size==((240,300) if is_chart else (160,300)),crop.size
        pixel=crop.convert('RGB').getpixel((20,20))
        assert (pixel[2]>pixel[1] if is_chart else pixel[1]>pixel[2]),pixel
    chunks=request('/knowledge/'+nid+'/chunks?page_size=100&parse_version_id='+parse_id)
    tables=[c for c in chunks if c['block_type']=='table']
    assert len(tables)==2 and all(c['content'].startswith('<table>') and c['content'].endswith('</table>') and not c['images'] for c in tables)
    pictures=[c for c in chunks if c['block_type']=='image']
    assert len(pictures)==8,pictures
    assert all(len(c['images'])==1 for c in pictures)
    assert all(c['images'][0]['locators']==c['locators'] for c in pictures)
    assert all(not c['images'] for c in chunks if c['block_type']=='text')
    return images

before=verify(newparse['parse_version_id'])
check(True,'文字/表格/图片分别入库，HTML表格完整；4个区域裁剪像素、页码和坐标与原页一致')
records=observed();sizes=[size for r in records for size in r.get('vision_sizes',[])]
assert sizes==[[160,300],[240,300],[160,300],[240,300]],sizes
assert all(r['layout_enabled'] and r['ocr_image_enabled'] for r in records if 'pipeline' in r)
check(True,'模型仅收到4张区域裁剪图，未收到800×1200整页截图')
for mode in ['image_text','image_vector']:
    hits=request('/search',{'mode':mode,'query_text':'绿色区域','knowledge_base_ids':[newkb],'include_sources':True,'rerank':{'mode':'disabled'}})['results']
    assert hits,hits
    for hit in hits:
        assert all(s['locators'][0]['type']=='image' and s['locators'][0]['page'] in [1,2] and len(s['locators'][0]['bbox'])==4 for s in hit['source_refs'])
check(True,'图片文本与图片向量召回均可定位原PDF的页码和区域')

full=json.load(urllib.request.urlopen(BASE+'/knowledge/'+nid+'/images?page_size=1'))
assert full['meta']['total']==4 and full['meta']['has_more']
job=request('/knowledge/'+nid+'/reparse',{},expected=202);assert wait_task(job['task_id'])['state']=='succeeded'
new=request('/knowledge/'+nid+'/content')['parse_version_id']
after=verify(new);verify(newparse['parse_version_id'])
assert not {i['id'] for i in before}&{i['id'] for i in after}
assert {i['id'] for i in request('/knowledge-bases/'+newkb+'/images')}=={i['id'] for i in after}
check(True,'重解析版本隔离、历史区域图片可访问、当前列表与分页总数一致')

set_engine('no-images');calls=len([r for r in observed() if 'vision_sizes' in r])
textonly=upload(newkb,'仅文字和表格.pdf',pdf_bytes());assert wait_task(textonly['task_id'])['state']=='succeeded'
assert request('/knowledge/'+textonly['knowledge_id']+'/images')==[]
assert len([r for r in observed() if 'vision_sizes' in r])==calls
set_engine('whole-page')
whole=upload(newkb,'整页检测结果.pdf',pdf_bytes());assert wait_task(whole['task_id'])['state']=='succeeded'
assert request('/knowledge/'+whole['knowledge_id']+'/images')==[]
assert request('/knowledge/'+whole['knowledge_id']+'/content')['warnings']
assert len([r for r in observed() if 'vision_sizes' in r])==calls
set_engine('bad-region')
bad=upload(newkb,'越界图片坐标.pdf',pdf_bytes());bad_task=wait_task(bad['task_id'])
assert bad_task['state']=='failed' and '坐标' in bad_task['error']['message'],bad_task
assert len([r for r in observed() if 'vision_sizes' in r])==calls
check(True,'纯文字/表格不调用视觉模型；整页图片给出提示；错误坐标拒绝裁剪且不回退整页')

set_engine('no-images')
png=io.BytesIO();Image.new('RGB',(120,80),'green').save(png,format='PNG')
standalone=upload(newkb,'独立图片.png',png.getvalue());assert wait_task(standalone['task_id'])['state']=='succeeded'
assert len(request('/knowledge/'+standalone['knowledge_id']+'/images'))==1
from docx import Document
document=Document();document.add_paragraph('图片前的普通段落。');document.add_picture(io.BytesIO(png.getvalue()))
stream=io.BytesIO();document.save(stream)
word=upload(newkb,'内嵌图片.docx',stream.getvalue());assert wait_task(word['task_id'])['state']=='succeeded'
word_images=request('/knowledge/'+word['knowledge_id']+'/images');assert word_images
word_chunks=request('/knowledge/'+word['knowledge_id']+'/chunks')
assert any(c['images'] for c in word_chunks)
assert all(not c['images'] for c in word_chunks if '图片前的普通段落' in c['content'])
request('/knowledge/'+word['knowledge_id']+'/images?parse_version_id='+new,expected=404)
check(True,'独立图片与DOCX内嵌图片保持可用，普通文字不串图，不能跨文件读取解析版本')
Path('test-results/pdf-regions.json').write_text(json.dumps(dict(kb=newkb,doc=newdoc,parse=new,source=after[0]['source_ref_id'],image=after[0]['id'],legacy=doc),ensure_ascii=False,indent=2),encoding='utf-8')
print('All region extraction checks passed.',flush=True)
