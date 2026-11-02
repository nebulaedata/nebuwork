"""Protocol fixtures validate source mapping; no real OCR accuracy is claimed."""
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'reader'))
from paddle import parse_image, layout_blocks

class PaddleAdapterTests(unittest.TestCase):
    def test_regions_and_title_keep_source_page(self):
        payloads=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_): pass
            def do_POST(self):
                payloads.append((self.path,json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'result':{'layoutParsingResults':[{'prunedResult':{'width':200,'height':400,'parsing_res_list':[
                    {'block_content':'第一章','block_label':'doc_title','block_bbox':[10,20,100,80]},
                    {'block_content':'内容','block_bbox':[0,0,999,900]}
                ]}}]}}).encode())
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                path=Path(temp)/'page.png';path.write_bytes(b'fixture')
                blocks=parse_image(path,{'endpoint':f'http://127.0.0.1:{server.server_port}'},{'type':'page','page':7},(200,400))
            self.assertEqual(payloads[0][0],'/layout-parsing')
            self.assertEqual(payloads[0][1]['fileType'],1)
            self.assertFalse(payloads[0][1]['useDocUnwarping'])
            self.assertEqual(blocks[0]['locator'],{'type':'page','page':7,'bbox':[.05,.05,.5,.2]})
            self.assertEqual(blocks[0]['level'],1)
            self.assertEqual(blocks[0]['image_path'],'')
            self.assertEqual(blocks[0]['block_type'],'text')
            self.assertTrue(payloads[0][1]['useLayoutDetection'])
            self.assertTrue(payloads[0][1]['useOcrForImageBlock'])
            self.assertEqual(blocks[1]['precision'],'page')
            self.assertNotIn('bbox',blocks[1]['locator'])
        finally:server.shutdown();server.server_close();thread.join()

    def test_unconfigured_does_not_fall_back(self):
        with self.assertRaisesRegex(ValueError,'PARSER_NOT_CONFIGURED'):
            parse_image(Path('missing'),{}, {'type':'image'}, (100,100))


    def test_page_regions_are_distinct_crops_with_original_coordinates(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'page-7.png'
            image=Image.new('RGB',(200,400),'white')
            draw=ImageDraw.Draw(image)
            draw.rectangle((20,200,79,299),fill='red')
            draw.rectangle((100,200,179,299),fill='blue')
            image.save(path)
            table='<table><tr><td colspan="2">合并单元格</td></tr></table>'
            # Pipeline canvas is half the local raster size.
            items=[{'block_label':'text','block_content':'正文','block_bbox':[0,0,100,20]},
                   {'block_label':'table','block_content':table,'block_bbox':[0,20,100,80]},
                   {'block_label':'image','block_content':'![](https://invalid/image.png)','block_bbox':[10,100,40,150],'block_id':5,'block_order':2},
                   {'block_label':'chart','block_content':'图表内文字','block_bbox':[50,100,90,150],'block_id':9,'block_order':3}]
            blocks=layout_blocks(path,{'prunedResult':{'width':100,'height':200,'parsing_res_list':items}}, {'type':'page','page':7},image.size)
            self.assertEqual([b['block_type'] for b in blocks],['text','table','image','image'])
            self.assertTrue(all(not b['image_path'] for b in blocks[:2]))
            self.assertEqual(blocks[1]['text'],table)
            self.assertEqual(blocks[2]['text'],'')
            self.assertEqual(blocks[3]['text'],'图表内文字')
            self.assertEqual(blocks[2]['locator']['bbox'],[.1,.5,.4,.75])
            self.assertEqual(blocks[2]['locator']['page'],7)
            self.assertEqual(blocks[2]['locator']['type'],'image')
            self.assertEqual(blocks[2]['layout'],{'label':'image','id':5,'order':2,'index':2})
            self.assertNotEqual(blocks[2]['image_path'],blocks[3]['image_path'])
            for b,size,color in [(blocks[2],(60,100),(255,0,0)),(blocks[3],(80,100),(0,0,255))]:
                with Image.open(b['image_path']) as crop:
                    self.assertEqual(crop.size,size)
                    self.assertEqual(crop.getpixel((0,0)),color)
                    self.assertEqual(crop.getpixel((size[0]-1,size[1]-1)),color)
                self.assertEqual(b['visual_role'],'image_region')
                self.assertEqual(b['precision'],'region')
            # Re-running a page overwrites deterministic crop paths, not duplicates.
            again=layout_blocks(path,{'prunedResult':{'width':100,'height':200,'parsing_res_list':items}}, {'type':'page','page':7},image.size)
            self.assertEqual([b['image_path'] for b in blocks],[b['image_path'] for b in again])

    def test_missing_layout_and_invalid_picture_coordinates_do_not_use_full_page(self):
        with self.assertRaisesRegex(ValueError,'PADDLE_LAYOUT_REQUIRED'):
            layout_blocks(Path('unused'),{'markdown':{'text':'文字'}},{'type':'page','page':1},(100,100))
        for bbox in [None,[-1,0,10,10],[0,0,101,10],[0,0,float('nan'),10],[10,10,10,20],[False,0,10,10]]:
            with self.subTest(bbox=bbox), self.assertRaisesRegex(ValueError,'PADDLE_IMAGE_BBOX_INVALID'):
                layout_blocks(Path('unused'),{'prunedResult':{'parsing_res_list':[{'block_label':'image','block_bbox':bbox}]}},{'type':'page','page':1},(100,100))

    def test_full_page_picture_is_preview_only(self):
        b=layout_blocks(Path('unused'),{'prunedResult':{'parsing_res_list':[{'block_label':'image','block_bbox':[0,0,100,100]}]}},{'type':'page','page':1},(100,100))[0]
        self.assertEqual(b['image_path'],'')
        self.assertEqual(b['warning'],'PAGE_IMAGE_NOT_CROPPED')

    def test_standalone_image_still_uses_original(self):
        path=Path('standalone.png')
        b=layout_blocks(path,{'prunedResult':{'parsing_res_list':[{'block_label':'text','block_content':'图片文字','block_bbox':[0,0,50,50]}]}},{'type':'image'},(100,100))[0]
        self.assertEqual(b['image_path'],str(path))
        self.assertEqual(b['visual_role'],'standalone_image')

if __name__=='__main__':unittest.main()
