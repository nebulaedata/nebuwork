"""Image-bearing format/engine regression using real local parsers."""
import io
import base64
import email.message
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'reader'))
from parse import parse
from embedded_images import image_positions, save_image
from PIL import Image


def fixtures(folder):
    from docx import Document
    from docx.shared import Inches
    from pptx import Presentation
    from pptx.util import Inches as PptInches
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image as SheetImage
    data=io.BytesIO();Image.new('RGB',(160,90),'#00b578').save(data,'PNG')
    picture=folder/'picture.png';picture.write_bytes(data.getvalue())
    doc=Document();doc.add_paragraph('Before picture');doc.add_picture(str(picture),width=Inches(1));doc.add_paragraph('After picture');doc.save(folder/'sample.docx')
    ppt=Presentation()
    for i in range(2):
        slide=ppt.slides.add_slide(ppt.slide_layouts[5]);slide.shapes.title.text='Slide '+str(i+1)
        group=slide.shapes.add_group_shape() if i else slide.shapes
        group.shapes.add_picture(str(picture),PptInches(1),PptInches(2),width=PptInches(2)) if i else group.add_picture(str(picture),PptInches(1),PptInches(2),width=PptInches(2))
    ppt.save(folder/'sample.pptx')
    book=Workbook();book.active.title='Sheet pictures';book.active['A1']='Before picture';book.active.add_image(SheetImage(str(picture)),'C4');book.save(folder/'sample.xlsx')


class EmbeddedImagesTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.files=self.root/'files';self.files.mkdir();fixtures(self.files)
        self.env=patch.dict(os.environ,NEBULAEKNO_DATA_DIR=str(self.root));self.env.start()

    def tearDown(self):
        self.env.stop();self.temp.cleanup()

    def read(self,ext,engine='anydoc'):
        from parser_catalog import resolve
        category,_=resolve(ext,{})
        return parse({'path':str(self.files/('sample.'+ext)), 'output':str(self.root/'derived'/(ext+'-'+engine)),
                      'options':{'preview_enabled':False,'parser_engines':{category:engine}}})

    def assert_images(self,result,minimum=1):
        images=[b for b in result['blocks'] if b.get('image_path')]
        self.assertGreaterEqual(len(images),minimum,(result['engine'],[a.get('kind') for a in result['assets']]))
        for b in images:
            self.assertTrue(Path(b['image_path']).read_bytes().startswith(b'\x89PNG'))
            self.assertEqual(b['block_type'],'image')
        return images

    def test_modern_office_images_and_occurrences(self):
        for engine in ('anydoc','native'):
            for ext in ('docx','pptx','xlsx'):
                with self.subTest(ext=ext,engine=engine):
                    images=self.assert_images(self.read(ext,engine),2 if ext=='pptx' else 1)
                    if ext=='pptx':
                        self.assertEqual([b['locator'].get('slide') for b in images],[1,2])
                    elif ext=='xlsx':
                        self.assertEqual(images[0]['locator']['sheet'],'Sheet pictures')
                        self.assertEqual(images[0]['locator']['cell_range'],'C4')
                    else:
                        self.assertEqual(images[0]['locator']['paragraph_id'],'2')

    def test_legacy_and_opendocument_images(self):
        for ext,source in [('doc','docx'),('ppt','pptx'),('xls','xlsx'),('odt','docx'),('odp','pptx'),('ods','xlsx'),('rtf','docx')]:
            with self.subTest(ext=ext):
                subprocess.run(['libreoffice','-env:UserInstallation='+(self.root/('profile-'+ext)).as_uri(),'--headless',
                                '--convert-to',ext,'--outdir',str(self.files),str(self.files/('sample.'+source))],
                               check=True,capture_output=True,timeout=60)
                self.assert_images(self.read(ext))
                self.assert_images(self.read(ext,'libreoffice'))

    def test_vector_asset_is_converted_individually(self):
        output=self.root/'derived';output.mkdir()
        image=save_image(b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="100" height="70" fill="green"/></svg>',output,'vector','image/svg+xml')
        self.assertTrue(image)
        self.assertTrue(Path(image).read_bytes().startswith(b'\x89PNG'))

    def test_archives_and_html_images(self):
        picture=(self.files/'picture.png').read_bytes()
        def archive(ext,parts):
            with zipfile.ZipFile(self.files/('sample.'+ext),'w') as z:
                for name,data in parts.items():z.writestr(name,data)
        encoded=base64.b64encode(picture).decode()
        (self.files/'sample.html').write_text('<p>Before</p><img src="data:image/png;base64,'+encoded+'"><img src="https://example.invalid/tracker.png"><p>After</p>')
        result=self.read('html','native');self.assert_images(result)
        self.assertIn('EXTERNAL_IMAGE_NOT_FETCHED',[w['code'] for w in result['warnings']])
        (self.files/'sample.md').write_text('Before\n![embedded](data:image/png;base64,'+encoded+')\nAfter')
        result=self.read('md','native');self.assert_images(result)
        self.assertFalse(any('base64' in b['text'] for b in result['blocks']))
        message=email.message.EmailMessage();message.set_content('<p>Before</p><img src="cid:figure"><p>After</p>',subtype='html')
        message.add_related(picture,maintype='image',subtype='png',cid='<figure>')
        (self.files/'sample.mhtml').write_bytes(message.as_bytes());self.assert_images(self.read('mhtml','native'))
        archive('epub',{'mimetype':'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
            'book.opf':'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="picture.png" media-type="image/png"/></manifest><spine><itemref idref="c"/></spine></package>',
            'chapter.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before</p><img src="picture.png"/><p>After</p></body></html>','picture.png':picture})
        for engine in ('native','anydoc'):self.assert_images(self.read('epub',engine))
        archive('xmind',{'content.json':json.dumps([{'id':'sheet','rootTopic':{'id':'topic','title':'Title','image':{'src':'xap:resources/picture.png'}}}]),'resources/picture.png':picture})
        self.assert_images(self.read('xmind','native'))
        archive('ofd',{'OFD.xml':'<OFD><DocBody><DocRoot>Doc/Document.xml</DocRoot></DocBody></OFD>',
                      'Doc/Document.xml':'<Document><CommonData><DocumentRes>Res.xml</DocumentRes></CommonData><Pages><Page BaseLoc="page.xml"/></Pages></Document>',
                      'Doc/Res.xml':'<Res BaseLoc="Res"><MultiMedias><MultiMedia ID="2"><MediaFile>picture.png</MediaFile></MultiMedia></MultiMedias></Res>',
                      'Doc/page.xml':'<Page><Content><Layer><ImageObject ID="3" ResourceID="2"/></Layer></Content></Page>',
                      'Doc/Res/picture.png':picture})
        self.assert_images(self.read('ofd','native'))

    def test_native_pdf_excludes_whole_page_images(self):
        import pypdfium2 as pdfium
        # A real Office PDF has text and an embedded figure.
        subprocess.run(['libreoffice','-env:UserInstallation='+(self.root/'pdf-profile').as_uri(),'--headless','--convert-to','pdf',
                        '--outdir',str(self.files),str(self.files/'sample.docx')],check=True,capture_output=True,timeout=60)
        self.assert_images(self.read('pdf','native'))
        # Pillow writes a full-page raster PDF; it must never become a figure.
        Image.open(self.files/'picture.png').save(self.files/'sample.pdf','PDF')
        from unittest.mock import patch
        with patch('parse.ocr',return_value='Scanned page text'):
            result=self.read('pdf','native')
        self.assertFalse(any(b.get('image_path') for b in result['blocks']))


if __name__=='__main__':unittest.main()
