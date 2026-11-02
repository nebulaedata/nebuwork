"""Real parser tests, with installed anydoc (no protocol mock)."""
import email.message
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'reader'))
from parse import parse
from parser_catalog import FORMATS, resolve


class FileParsers(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_root = os.environ.get('NEBULAEKNO_DATA_DIR')
        os.environ['NEBULAEKNO_DATA_DIR'] = self.temp.name
        (self.root / 'files').mkdir()

    def tearDown(self):
        if self.old_root is None:
            os.environ.pop('NEBULAEKNO_DATA_DIR', None)
        else:
            os.environ['NEBULAEKNO_DATA_DIR'] = self.old_root
        self.temp.cleanup()

    def read(self, name, data, engines=None):
        path = self.root / 'files' / name
        path.write_bytes(data)
        return parse(dict(path=str(path), output=str(self.root / 'derived' / name),
                          options={'preview_enabled': False, 'parser_engines': engines or {'spreadsheet':'anydoc'}}))

    def archive(self, entries):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            for name, value in entries.items():
                archive.writestr(name, value)
        return out.getvalue()

    def test_catalog_independent_defaults(self):
        exts = [ext for f in FORMATS for ext in f['extensions']]
        self.assertEqual(len(exts), len(set(exts)))
        choices = {'word': 'libreoffice', 'csv': 'anydoc', 'audio': 'ffmpeg', 'image': 'tesseract'}
        self.assertEqual(resolve('docx', choices), ('word', 'libreoffice'))
        for ext, engine in [('xlsx', 'excel'), ('xls', 'excel'), ('epub', 'anydoc'), ('odt', 'anydoc'), ('txt', 'simple'),
                            ('mp4', 'simple'), ('pdf', 'paddleocr_vl'), ('html', 'native')]:
            self.assertEqual(resolve(ext, choices)[1], engine)
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_PARSER_ENGINE'):
            resolve('mp3', {'audio': 'anydoc'})

    def test_real_anydoc_locations(self):
        for ext, location in [('docx', 'paragraph'), ('pptx', 'slide'), ('xlsx', 'sheet')]:
            with self.subTest(ext=ext):
                result = self.read('test.'+ext, (Path(__file__).parent/'fixtures'/('sample.'+ext)).read_bytes())
                self.assertEqual(result['engine'], 'anydoc')
                self.assertTrue(any(b['locator']['type'] == location for b in result['blocks']))
                self.assertTrue(all(b['method'] == 'anydoc' for b in result['blocks']))

    def test_duplicate_paragraphs_are_not_given_arbitrary_positions(self):
        from docx import Document
        document = Document()
        document.add_paragraph('相同段落')
        document.add_paragraph('相同段落')
        out = io.BytesIO(); document.save(out)
        result = self.read('duplicate.docx', out.getvalue())
        self.assertTrue(all(b['precision'] == 'document' for b in result['blocks']))
        self.assertTrue(all('page' not in b['locator'] for b in result['blocks']))

    def test_macro_office_aliases(self):
        for ext, base, kind in [('docm', 'docx', 'word'), ('pptm', 'pptx', 'presentation'), ('xlsm', 'xlsx', 'sheet')]:
            with self.subTest(ext=ext):
                with zipfile.ZipFile(Path(__file__).parent/'fixtures'/('sample.'+base)) as source:
                    parts = {name: source.read(name) for name in source.namelist()}
                old = {'docx': b'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
                       'pptx': b'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
                       'xlsx': b'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}[base]
                new = ('application/vnd.ms-'+kind+'.macroEnabled.main+xml').encode()
                parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(old, new)
                result = self.read('macro.'+ext, self.archive(parts))
                self.assertEqual(result['engine'], 'anydoc')
                self.assertTrue(result['blocks'])

    def test_epub_and_rtf_anydoc(self):
        epub = self.archive({'mimetype': 'application/epub+zip',
            'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
            'book.opf': '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>',
            'chapter.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>独立章节</h1><p>电子书内容。</p></body></html>'})
        result = self.read('book.epub', epub)
        self.assertEqual(result['engine'], 'anydoc')
        self.assertTrue(any('电子书' in b['text'] for b in result['blocks']))
        result = self.read('document.rtf', b'{\\rtf1\\ansi NebulaeKno document.}')
        self.assertEqual(result['engine'], 'anydoc')
        self.assertTrue(any('NebulaeKno' in b['text'] for b in result['blocks']))

    def test_legacy_and_opendocument_anydoc(self):
        for ext, source in [('doc', 'docx'), ('odt', 'docx'), ('ppt', 'pptx'),
                            ('odp', 'pptx'), ('xls', 'xlsx'), ('ods', 'xlsx')]:
            with self.subTest(ext=ext):
                output = self.root / ext
                output.mkdir()
                subprocess.run(['libreoffice', '-env:UserInstallation=file://'+str(self.root / ('profile-'+ext)),
                                '--headless', '--convert-to', ext, '--outdir', str(output),
                                str(Path(__file__).parent/'fixtures'/('sample.'+source))],
                               check=True, capture_output=True, timeout=60)
                result = self.read('converted.'+ext, (output/('sample.'+ext)).read_bytes())
                self.assertEqual(result['engine'], 'anydoc')
                self.assertTrue(any('数据库' in b['text'] for b in result['blocks']))

    def test_mhtml_root_part_and_xmind(self):
        message = email.message.EmailMessage()
        message.set_content('<html><h1>归档标题</h1><p>归档内容。</p></html>', subtype='html', charset='utf-8')
        result = self.read('page.mhtml', message.as_bytes())
        self.assertTrue(any('归档内容' in b['text'] for b in result['blocks']))
        mind = [{'id': 'sheet1', 'rootTopic': {'id': 'root', 'title': '中心主题', 'children':
            {'attached': [{'id': 'child', 'title': '子主题'}]}}}]
        result = self.read('map.xmind', self.archive({'content.json': json.dumps(mind)}))
        self.assertEqual([b['locator']['node_id'] for b in result['blocks']], ['root', 'child'])
        self.assertEqual(len(result['outline']), 2)

    def test_ofd_pages_and_no_text_error(self):
        entries = {'OFD.xml': '<OFD><DocBody><DocRoot>Doc_0/Document.xml</DocRoot></DocBody></OFD>',
                   'Doc_0/Document.xml': '<Document><Pages><Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/></Pages></Document>',
                   'Doc_0/Pages/Page_0/Content.xml': '<Page><Content><Layer><TextObject ID="4"><TextCode>OFD 原文</TextCode></TextObject></Layer></Content></Page>'}
        result = self.read('test.ofd', self.archive(entries), {'ofd': 'native'})
        self.assertEqual(result['blocks'][0]['locator']['page'], 1)
        self.assertEqual(result['blocks'][0]['text'], 'OFD 原文')
        entries['Doc_0/Pages/Page_0/Content.xml'] = '<Page/>'
        with self.assertRaisesRegex(ValueError, 'OFD_NO_TEXT_LAYER'):
            self.read('scan.ofd', self.archive(entries), {'ofd': 'native'})

    def test_simple_and_anydoc_are_real_distinct_csv_paths(self):
        data = b'name,value\nexample,42\n'
        for engine in ['simple', 'anydoc']:
            result = self.read(engine+'.csv', data, {'csv': engine})
            self.assertEqual(result['engine'], engine)
            self.assertTrue(any('42' in b['text'] for b in result['blocks']))


if __name__ == '__main__':
    unittest.main()
