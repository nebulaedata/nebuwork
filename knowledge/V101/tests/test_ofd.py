"""Real OFD rasterizer + HTTP layout fixture, without model charges."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'reader'))
from ofd import validate_archive, parse_ofd
from parser_catalog import resolve


def fixture(path, scan=False):
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (240, 160), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((20, 20, 220, 140), fill='red')
    data = io.BytesIO(); image.save(data, 'PNG')
    ns = 'http://www.ofdspec.org/2016'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('OFD.xml', f'<ofd:OFD xmlns:ofd="{ns}" Version="1.0" DocType="OFD"><ofd:DocBody><ofd:DocInfo><ofd:DocID>0123456789abcdef0123456789abcdef</ofd:DocID></ofd:DocInfo><ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>')
        z.writestr('Doc_0/Document.xml', f'<ofd:Document xmlns:ofd="{ns}"><ofd:CommonData><ofd:MaxUnitID>99</ofd:MaxUnitID><ofd:PageArea><ofd:PhysicalBox>0 0 210 297</ofd:PhysicalBox></ofd:PageArea><ofd:DocumentRes>Res.xml</ofd:DocumentRes></ofd:CommonData><ofd:Pages><ofd:Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/><ofd:Page ID="2" BaseLoc="Pages/Page_1/Content.xml"/></ofd:Pages></ofd:Document>')
        z.writestr('Doc_0/Res.xml', f'<ofd:Res xmlns:ofd="{ns}" BaseLoc="Res"><ofd:Fonts><ofd:Font ID="10" FontName="Noto Sans CJK SC" FamilyName="Noto Sans CJK SC"/></ofd:Fonts><ofd:MultiMedias><ofd:MultiMedia ID="20" Type="Image" Format="PNG"><ofd:MediaFile>picture.png</ofd:MediaFile></ofd:MultiMedia></ofd:MultiMedias></ofd:Res>')
        z.writestr('Doc_0/Res/picture.png', data.getvalue())
        for p in (1, 2):
            text = '' if scan else f'<ofd:TextObject ID="{30+p}" Boundary="20 20 170 15" Font="10" Size="5"><ofd:TextCode X="0" Y="6">OFD 正文页面 {p}</ofd:TextCode></ofd:TextObject>'
            z.writestr(f'Doc_0/Pages/Page_{p-1}/Content.xml', f'<ofd:Page xmlns:ofd="{ns}"><ofd:Content><ofd:Layer ID="{40+p}" Type="Body">{text}<ofd:ImageObject ID="{50+p}" ResourceID="20" Boundary="21 148.5 63 59.4" CTM="63 0 0 59.4 0 0"/></ofd:Layer></ofd:Content></ofd:Page>')


class OfdTests(unittest.TestCase):
    def test_default_requires_paddle_never_silently_uses_xml(self):
        self.assertEqual(resolve('ofd', {}), ('ofd', 'paddleocr_vl'))
        with self.assertRaisesRegex(ValueError, 'PARSER_NOT_CONFIGURED'):
            parse_ofd(Path('unused'), Path('unused'), {})

    def test_rejects_archive_traversal_and_external_entities(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'bad.ofd'
            for name, data, expected in [('../escape', 'x', 'INVALID_ARCHIVE_PATH'),
                                          ('OFD.xml', '<!DOCTYPE OFD SYSTEM "file:///etc/passwd"><OFD/>', 'OFD_UNSAFE_XML')]:
                with zipfile.ZipFile(path, 'w') as z: z.writestr(name, data)
                with self.assertRaisesRegex(ValueError, expected): validate_archive(path)

    def test_real_render_and_page_layout_preserve_regions_and_preview(self):
        from parse import parse
        from PIL import Image
        from pypdf import PdfReader
        received = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                with Image.open(io.BytesIO(base64.b64decode(request['file']))) as image:
                    w, h = image.size
                    self_test.assertGreater(w, 1000)
                    self_test.assertGreater(h, 2000)
                    # Real renderer must preserve the embedded red figure in place.
                    r, g, b = image.convert('RGB').getpixel((round(w*.25), round(h*.6)))
                    self_test.assertGreater(r, 200); self_test.assertLess(g, 100)
                received.append(request)
                items=[{'block_label':'doc_title','block_content':f'第 {len(received)} 页完整标题','block_bbox':[.1*w,.05*h,.9*w,.15*h]},
                       {'block_label':'table','block_content':'<table><tr><td>表格</td></tr></table>','block_bbox':[.1*w,.2*h,.8*w,.4*h]},
                       {'block_label':'image','block_content':'![图片](ignored)','block_bbox':[.1*w,.5*h,.4*w,.7*h]}]
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'result':{'layoutParsingResults':[{'prunedResult':{'width':w,'height':h,'parsing_res_list':items}}]}}).encode())
        self_test = self
        server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'NEBULAEKNO_DATA_DIR': temp}):
                root=Path(temp); (root/'files').mkdir()
                path=root/'files'/'scan.ofd'; fixture(path, scan=True)
                output=root/'derived'/'parsed'
                result=parse({'path':str(path),'output':str(output),'options':{'paddleocr_vl':{'endpoint':f'http://127.0.0.1:{server.server_port}'}}})
                self.assertEqual(result['engine'],'paddleocr_vl')
                self.assertEqual(result['visual_layout_version'],2)
                self.assertEqual(len(result['blocks']),6)
                self.assertEqual(len(received),2)
                self.assertTrue(all(r['useLayoutDetection'] and not r['useDocUnwarping'] for r in received))
                self.assertEqual([b['block_type'] for b in result['blocks']],['text','table','image']*2)
                for index, b in enumerate(result['blocks']):
                    self.assertEqual(b['locator']['page'],index//3+1)
                    self.assertEqual(b['locator']['source_format'],'ofd')
                    self.assertEqual(b['precision'],'region')
                picture=result['blocks'][2]
                self.assertEqual(picture['locator']['bbox'],[.1,.5,.4,.7])
                self.assertEqual(picture['visual_role'],'image_region')
                self.assertTrue(Path(picture['image_path']).exists())
                self.assertTrue(all(not b['image_path'] for b in result['blocks'] if b['block_type']!='image'))
                previews=[a for a in result['assets'] if a['visual_role']=='page_preview']
                self.assertEqual([a['page'] for a in previews],[1,2])
                self.assertTrue(all(a['kind']=='pdf_page' for a in previews))
                pdf=PdfReader(result['preview_path'])
                self.assertEqual(len(pdf.pages),2)
                self.assertAlmostEqual(float(pdf.pages[0].mediabox.width),210*72/25.4,places=4)
                phases=json.loads((output/'progress.json').read_text())['phases']
                self.assertEqual([p['name'] for p in phases],['read_document','ofd_render_pages','paddle_pages'])
                self.assertTrue(all(p['progress']['completed']==2 for p in phases[1:]))
                # Preview-only generation works without a model/Paddle connection.
                prev=parse({'mode':'preview','path':str(path),'output':str(root/'derived'/'preview'),'options':{}})
                self.assertEqual(len(PdfReader(prev['preview_path']).pages),2)
                self.assertEqual(len(received),2)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
