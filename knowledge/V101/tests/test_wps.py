"""Real WPS-compatible containers, both parsers and truthful source mapping."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'reader'))
from parse import parse
from wps import FORMATS, inspect, normalize
import progress


class WPSParsing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.samples=Path(__file__).resolve().parents[1]/'test-results'/'wps-fixtures'
        if not (cls.samples/'compatibility.json').exists():
            from tests.wps_compatibility import generate
            generate(cls.samples)

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        progress.configure(self.root,'wps')
        (self.root/'files').mkdir()
        self.environment=patch.dict(os.environ,{'NEBULAEKNO_DATA_DIR':str(self.root)})
        self.environment.start()

    def tearDown(self):
        self.environment.stop(); self.temp.cleanup()

    def read(self,ext,engine=None,raw=None,mode=None):
        path=self.root/'files'/('source.'+ext)
        path.write_bytes(raw if raw is not None else (self.samples/('sample.'+ext)).read_bytes())
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        result=parse({'path':str(path),'output':str(self.root/'derived'/('parsed-'+ext+'-'+str(engine))),
                      'mode':mode,'options':{'preview_enabled':False,'parser_engines':{ext:engine} if engine else {},'excel':{'header_rows':[1]}}})
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),digest)
        self.assertEqual(result['conversion']['source_sha256'],digest)
        return result

    def test_six_binary_formats_and_both_engines(self):
        for suffix,(family,_,_) in FORMATS.items():
            ext=suffix[1:]
            for engine in ['excel' if family=='spreadsheet' else 'native','anydoc']:
                with self.subTest(ext=ext,engine=engine):
                    result=self.read(ext,engine)
                    self.assertTrue(any('NebulaeKno' in b['text'] for b in result['blocks']))
                    images=[b for b in result['blocks'] if b.get('image_path')]
                    self.assertTrue(images)
                    self.assertTrue(all(Path(b['image_path']).is_file() for b in images))
                    self.assertTrue(all(b['locator'].get('source_format')==ext for b in result['blocks']))
                    if family=='spreadsheet':
                        self.assertEqual(result['conversion']['normalized_format'],'xls')
                        self.assertEqual(len(result['spreadsheet']['sheets']),2)
                        self.assertTrue(all(b['locator']['mapping']=='converted_structure' for b in images))
                        self.assertTrue(any(b['locator'].get('mapping')=='exact' for b in result['blocks']))
                    else:
                        self.assertEqual(result['conversion']['mapping'],'converted_structure')
                        self.assertTrue(all(b['locator'].get('mapping')=='converted_structure' for b in images if b['locator'].get('type')!='document'))
                        self.assertTrue(any(w['code']=='WPS_CONVERTED_SOURCE' for w in result['warnings']))
                    phases=json.loads((self.root/'derived'/('parsed-'+ext+'-'+engine)/'progress.json').read_text())['phases']
                    self.assertTrue(any(p['name']=='inspect_wps' for p in phases))

    def test_ooxml_content_is_identified_without_loss(self):
        for ext,base in [('wps','docx'),('wpt','docx'),('et','xlsx'),('ett','xlsx'),('dps','pptx'),('dpt','pptx')]:
            with self.subTest(ext=ext):
                result=self.read(ext,raw=(self.samples/('sample.'+base)).read_bytes())
                self.assertEqual(result['conversion']['source_sha256'],result['conversion']['normalized_sha256'])
                self.assertEqual(result['conversion']['mapping'],'source_structure')
                self.assertTrue(result['assets'])

    def test_wrong_family_corruption_and_old_variants_are_not_text(self):
        for ext,data,code in [('et',(self.samples/'sample.wps').read_bytes(),'WPS_FORMAT_MISMATCH'),
                              ('wps',b'not a document','WPS_UNSUPPORTED_VARIANT'),
                              ('dps',b'PK\x03\x04broken','WPS_CORRUPT_FILE'),
                              ('et',bytes.fromhex('d0cf11e0a1b11ae1')+b'broken','WPS_CORRUPT_FILE')]:
            with self.subTest(ext=ext,code=code),self.assertRaisesRegex(ValueError,code): self.read(ext,raw=data)

    def test_encrypted_word_is_rejected_before_conversion(self):
        import olefile
        path=self.root/'files'/'encrypted.wps'
        shutil.copyfile(self.samples/'sample.wps',path)
        with olefile.OleFileIO(path,write_mode=True) as compound:
            stream=bytearray(compound.openstream('WordDocument').read())
            flags=struct.unpack_from('<H',stream,10)[0]
            struct.pack_into('<H',stream,10,flags|0x100)
            compound.write_stream('WordDocument',bytes(stream))
        with self.assertRaisesRegex(ValueError,'WPS_ENCRYPTED'): inspect(path)

    def test_missing_output_and_timeout_are_explicit(self):
        import subprocess
        from types import SimpleNamespace
        path=self.samples/'sample.wps'
        output=self.root/'derived'; output.mkdir()
        with patch('wps.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout=b'Error',stderr=b'')):
            with self.assertRaisesRegex(ValueError,'WPS_CONVERSION_FAILED'): normalize(path,output)
        with patch('wps.subprocess.run',side_effect=subprocess.TimeoutExpired('libreoffice',300)):
            with self.assertRaisesRegex(ValueError,'WPS_CONVERSION_TIMEOUT'): normalize(path,output)

    def test_preview_and_structure_only(self):
        for ext in ['wps','wpt','dps','dpt']:
            with self.subTest(ext=ext):
                result=self.read(ext,mode='preview')
                self.assertTrue(Path(result['preview_path']).is_file())
        for ext in ['et','ett']:
            result=self.read(ext,mode='spreadsheet')
            self.assertEqual(result['blocks'],[])
            self.assertEqual(len(result['spreadsheet']['sheets']),2)

    def test_image_conversion_failure_preserves_original_table_and_reports_reason(self):
        from types import SimpleNamespace
        with patch('embedded_images.subprocess.run',return_value=SimpleNamespace(returncode=1,stdout=b'',stderr=b'conversion failed')):
            result=self.read('et','excel')
        self.assertTrue(any('NebulaeKno' in b['text'] for b in result['blocks']))
        self.assertEqual(len(result['spreadsheet']['sheets']),2)
        self.assertTrue(any('IMAGE_PACKAGE_CONVERSION_FAILED' in w.get('message','') for w in result['warnings']))


if __name__=='__main__': unittest.main()
