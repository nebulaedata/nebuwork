"""Real XLS/XLSX engines and immutable source-structure regression tests."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
import io

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'reader'))
from spreadsheet import parse_spreadsheet, read_workbook, display_value
import progress
from openpyxl import Workbook
from openpyxl.drawing.image import Image as SheetImage
from PIL import Image


def fixture(folder):
    book=Workbook();sheet=book.active;sheet.title='设备清单'
    sheet.append(['设备名称','数量','合格率','设备编号'])
    sheet.append(['变压器',2,0.125,'00123']);sheet['C2'].number_format='0.00%'
    sheet.append(['开关',5,1,'00124']);sheet['C3'].number_format='0%'
    sheet['A5']='华东区域';sheet.merge_cells('A5:A7');sheet['B5']='合同甲';sheet['B6']='合同乙';sheet['B7']='合同丙'
    sheet['A9']='重复值';sheet['A10']='重复值'
    sheet['F12']='=SUM(B2:B3)'
    sheet['G12']=datetime.datetime(2026,10,24)
    sheet['B14']='长单元格😀'*160
    pic=folder/'picture.png';Image.new('RGB',(40,30),'green').save(pic);sheet.add_image(SheetImage(str(pic)),'E2')
    second=book.create_sheet('预算');second.append(['项目','金额']);second.append(['NebulaeKno 使用数据库',123.5])
    book.save(folder/'sample.xlsx')
    return folder/'sample.xlsx'


class SpreadsheetTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name);self.file=fixture(self.folder)
        progress.configure(self.folder,'excel')
    def tearDown(self):self.temp.cleanup()
    def parse(self,engine='excel',file=None,**opts):
        out=self.folder/('out-'+engine);out.mkdir(exist_ok=True)
        return parse_spreadsheet(file or self.file,out,{'chunk_size':128,**opts},engine)

    def test_source_cells_formats_and_merges(self):
        original=self.file.read_bytes();result=self.parse()
        self.assertEqual(self.file.read_bytes(),original)
        structure=result['spreadsheet'];self.assertEqual(len(structure['sheets']),2)
        meta=structure['sheets'][0];self.assertEqual(meta['merged_ranges'],['A5:A7'])
        rows=json.loads((Path(structure['path'])/'1-0.json').read_text())
        cells={c['address']:c for r in rows for c in r['cells']}
        self.assertEqual(cells['C2']['display'],'12.50%');self.assertEqual(cells['D2']['display'],'00123')
        self.assertNotIn('A6',cells);self.assertEqual(cells['F12']['formula'],'=SUM(B2:B3)')
        self.assertEqual(cells['F12']['warning'],'FORMULA_CACHE_MISSING')
        self.assertEqual(cells['G12']['display'],'2026-10-24')
        self.assertTrue(any(b.get('image_path') for b in result['blocks']))
        for b in result['blocks']:
            if b.get('block_type')=='spreadsheet':
                self.assertEqual(b['locator']['mapping'],'exact')
                self.assertEqual(b['locator']['sheet_id'],'1' if b['locator']['sheet']=='设备清单' else '2')
        long=[b for b in result['blocks'] if b['locator'].get('cell_range')=='B14:B14']
        self.assertGreater(len(long),1)
        self.assertEqual(sum(b['text'].count('😀') for b in long),160)

    def test_headers_and_merged_context_are_separate(self):
        result=self.parse(excel={'sheets':{'设备清单':{'header_rows':[1]}}})
        body=next(b for b in result['blocks'] if b['locator'].get('row_start')==2)
        self.assertIn('设备名称',body['context_text'])
        self.assertNotIn('设备名称',body['text'])
        self.assertEqual(body['context_sources'][0]['locator']['row_start'],1)
        self.assertEqual(body['locator']['row_start'],2)

    def test_merged_master_context_and_repeated_images(self):
        from openpyxl import load_workbook
        book=load_workbook(self.file);sheet=book['设备清单']
        sheet['B5']='合同条款'*30
        sheet.add_image(SheetImage(str(self.folder/'picture.png')),'E6')
        book.save(self.file);book.close()
        result=self.parse()
        body=next(b for b in result['blocks'] if b['locator'].get('row_start')==6 and b['block_type']=='spreadsheet')
        self.assertIn('华东区域',body['context_text'])
        self.assertNotIn('华东区域',body['text'])
        ref=next(s for s in body['context_sources'] if s['locator']['role']=='merged_master')
        self.assertEqual(ref['locator']['cell_range'],'A5:A5')
        self.assertEqual(ref['locator']['merged_range'],'A5:A7')
        pictures=[b for b in result['blocks'] if b.get('image_path')]
        self.assertEqual({b['locator']['row_start'] for b in pictures},{2,6})

    def test_large_sheet_pages_and_reader_errors(self):
        book=Workbook();sheet=book.active
        for r in range(1,251):sheet.cell(r,1,f'原始行{r}')
        book.save(self.file)
        result=self.parse();meta=result['spreadsheet']['sheets'][0]
        self.assertEqual(meta['pages'],[0,1])
        page=json.loads((Path(result['spreadsheet']['path'])/'1-1.json').read_text())
        self.assertEqual(page[0]['row'],201);self.assertEqual(page[-1]['row'],250)
        from parse import parse
        from unittest.mock import patch
        import progress
        (self.folder/'files').mkdir();file=self.folder/'files'/'invalid.xlsx'
        with patch.dict(os.environ,NEBULAEKNO_DATA_DIR=str(self.folder)),progress.suspended():
            file.write_bytes(self.file.read_bytes())
            preview=parse({'path':str(file),'output':str(self.folder/'derived'),'mode':'preview','options':{'parser_engines':{'spreadsheet':'excel'}}})
            self.assertTrue(Path(preview['preview_path']).is_file())
            self.assertEqual(preview['engine'],'preview')
            for raw,code in [(b'broken workbook','SPREADSHEET_READ_FAILED'),(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1','SPREADSHEET_ENCRYPTED_OR_MISNAMED')]:
                file.write_bytes(raw)
                with self.assertRaisesRegex(ValueError,code):
                    parse({'path':str(file),'output':str(self.folder/'derived'),'options':{'parser_engines':{'spreadsheet':'excel'}}})

    def test_anydoc_real_structure_and_ambiguous_rows(self):
        result=self.parse('anydoc')
        self.assertEqual(result['engine'],'anydoc')
        self.assertTrue(any(b['locator'].get('sheet')=='预算' for b in result['blocks']))
        repeats=[b for b in result['blocks'] if '重复值' in b['text']]
        self.assertTrue(repeats)
        self.assertTrue(all(b['locator'].get('mapping')=='unverified' for b in repeats))
        self.assertTrue(any(b.get('image_path') for b in result['blocks']))

    def test_incorrect_declared_dimensions_do_not_drop_rows(self):
        import re
        raw=self.file.read_bytes();target=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(raw)) as src,zipfile.ZipFile(target,'w') as out:
            for item in src.infolist():
                data=src.read(item.filename)
                if item.filename=='xl/worksheets/sheet1.xml':
                    data=re.sub(rb'<dimension ref="[^"]+"',b'<dimension ref="A1"',data)
                out.writestr(item,data)
        self.file.write_bytes(target.getvalue())
        sheets=read_workbook(self.file)
        self.assertEqual(sheets[0]['row_count'],14)
        self.assertTrue(any(c['address']=='B14' for row in sheets[0]['rows'] for c in row['cells']))

    def test_real_xls_both_engines(self):
        output=self.folder/'legacy';output.mkdir()
        subprocess.run(['libreoffice','-env:UserInstallation='+str((self.folder/'profile').as_uri()),'--headless','--convert-to','xls','--outdir',str(output),str(self.file)],check=True,stdout=subprocess.DEVNULL,timeout=120)
        file=output/'sample.xls'
        for engine in ['excel','anydoc']:
            with self.subTest(engine=engine):
                result=self.parse(engine,file)
                self.assertEqual(result['engine'],engine)
                self.assertEqual(result['spreadsheet']['sheets'][0]['name'],'设备清单')
                self.assertTrue(any('变压器' in b['text'] for b in result['blocks']))
                pictures=[b for b in result['blocks'] if b.get('image_path')]
                self.assertTrue(pictures)
                self.assertTrue(all(b['locator'].get('mapping')=='converted_structure' and b['precision']=='document' for b in pictures))

    def test_wps_cell_picture(self):
        book=Workbook();book.active['A1']='=DISPIMG("ID_picture",1)';book.save(self.file)
        raw=self.file.read_bytes();target=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(raw)) as src,zipfile.ZipFile(target,'w') as out:
            for item in src.infolist():out.writestr(item,src.read(item.filename))
            out.writestr('xl/cellimages.xml','<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="ID_picture"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>')
            out.writestr('xl/_rels/cellimages.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="media/cell.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/></Relationships>')
            out.writestr('xl/media/cell.png',(self.folder/'picture.png').read_bytes())
        self.file.write_bytes(target.getvalue())
        result=self.parse();pictures=[b for b in result['blocks'] if b.get('image_path')]
        self.assertEqual(len(pictures),1);self.assertEqual(pictures[0]['locator']['cell_range'],'A1:A1')
        self.assertFalse(any('DISPIMG' in b['text'] for b in result['blocks']))

    def test_limit_and_corruption_are_not_partial_success(self):
        book=Workbook();book.active['A200001']='beyond limit';book.save(self.file)
        with self.assertRaisesRegex(ValueError,'SPREADSHEET_CELL_LIMIT'):self.parse()
        self.file.write_bytes(b'broken workbook')
        for engine in ['excel','anydoc']:
            with self.assertRaises(Exception):self.parse(engine)

if __name__=='__main__':unittest.main()
