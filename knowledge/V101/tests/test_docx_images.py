"""Image occurrence order, exact DOCX positions, and legacy binding evidence."""
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'reader'))
from anydoc_adapter import parse_anydoc, legacy_image_bindings, load_document, flatten
from docx_images import image_positions
from docx import Document
from docx.shared import Inches
from PIL import Image

ALT='518e07f366a2cd691e0fe6e49e822326'


def image_bytes(color):
    out=io.BytesIO()
    Image.new('RGB',(120,80),color).save(out,format='PNG')
    return out.getvalue()


def fixture():
    document=Document()
    document.add_paragraph('开头')
    a,b=image_bytes('red'),image_bytes('green')
    shape=document.add_paragraph().add_run().add_picture(io.BytesIO(a),width=Inches(1))
    shape._inline.docPr.set('descr',ALT)
    document.add_paragraph('中间')
    document.add_paragraph().add_run().add_picture(io.BytesIO(a),width=Inches(1))
    mixed=document.add_paragraph('图片前文')
    mixed.add_run().add_picture(io.BytesIO(b),width=Inches(1))
    mixed.add_run('图片后文')
    table=document.add_table(rows=1,cols=2)
    table.cell(0,0).text='表格文字'
    table.cell(0,1).paragraphs[0].add_run().add_picture(io.BytesIO(b),width=Inches(1))
    document.add_paragraph('结尾')
    out=io.BytesIO();document.save(out)
    return out.getvalue()


class DocxImagesTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.path=self.root/'files'/'test.docx';self.path.parent.mkdir()
        self.path.write_bytes(fixture())
        self.output=self.root/'derived';self.output.mkdir()
        self.env=patch.dict(os.environ,NEBULAEKNO_DATA_DIR=str(self.root));self.env.start()

    def tearDown(self):
        self.env.stop();self.temp.cleanup()

    def test_anydoc_keeps_images_at_occurrence_and_does_not_index_alt(self):
        blocks,assets=parse_anydoc(self.path,self.output,{},lambda:[])
        images=[b for b in blocks if b.get('image_path')]
        self.assertEqual(len(images),4)
        self.assertEqual(len([a for a in assets if a['kind']=='image']),2)
        self.assertEqual([b['locator'].get('paragraph_id') for b in images],['2','4','5',None])
        self.assertEqual(images[-1]['locator']['row'],1)
        self.assertEqual(images[-1]['locator']['column'],2)
        self.assertEqual(images[-1]['locator']['table_id'],'1')
        self.assertEqual(images[0]['image_path'],images[1]['image_path'])
        self.assertTrue(all(b['visual_role']=='embedded_image' and b['block_type']=='image' for b in images))
        self.assertTrue(all('page' not in b['locator'] for b in images))
        self.assertNotIn(ALT,'\n'.join(b['text'] for b in blocks))
        self.assertEqual(blocks[0]['text'],'开头')
        self.assertEqual(blocks[1],images[0])
        self.assertEqual(blocks[2]['text'],'中间')
        self.assertTrue(all(Path(b['image_path']).is_file() for b in images))

    def test_native_extracts_repeated_and_table_images(self):
        from parse import parse
        result=parse({'path':str(self.path),'output':str(self.output),'options':{'parser_engines':{'word':'native'},'preview_enabled':False}})
        self.assertEqual(result['engine'],'native')
        images=[b for b in result['blocks'] if b.get('image_path')]
        self.assertEqual(len(images),4)
        self.assertEqual(images[0]['locator']['paragraph_id'],'2')
        self.assertEqual(images[1]['locator']['paragraph_id'],'4')
        self.assertEqual(images[-1]['locator']['column'],2)
        self.assertEqual(len([a for a in result['assets'] if a['kind']=='image']),2)

    def test_legacy_bindings_use_old_index_and_actual_asset_part(self):
        bindings=legacy_image_bindings(self.path)
        old=list(flatten(load_document(self.path).blocks))
        for binding in bindings:
            self.assertEqual(binding['text'],old[binding['parsed_block']-1][0])
            self.assertTrue(binding['images'][0]['part'].startswith('word/media/'))
        self.assertEqual(bindings[0]['text'],ALT)
        self.assertTrue(bindings[0]['reference_only'])
        self.assertFalse(next(b for b in bindings if '图片前文' in b['text'])['reference_only'])

    def test_relationship_order_is_not_image_order(self):
        positions=image_positions(self.path)
        self.assertEqual(len(positions),4)
        self.assertEqual(positions[0]['part'],positions[1]['part'])
        self.assertNotEqual(positions[0]['part'],positions[2]['part'])
        self.assertEqual([p['locator']['image_occurrence'] for p in positions],[1,2,3,4])


if __name__=='__main__':
    unittest.main()
