"""Probe installed LibreOffice filters using controlled binary Office-compatible WPS samples.

These are generated with the documented WPS-compatible filters, not claimed to
cover every proprietary version ever emitted by WPS. No user files are used.
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import zipfile

FORMATS = {
    'wps': ('docx', 'MS Word 97'), 'wpt': ('docx', 'MS Word 97 Vorlage'),
    'et': ('xlsx', 'MS Excel 97'), 'ett': ('xlsx', 'MS Excel 97 Vorlage/Template'),
    'dps': ('pptx', 'MS PowerPoint 97'), 'dpt': ('pptx', 'MS PowerPoint 97 Vorlage'),
}
EXPORT = {'docx':'Office Open XML Text', 'xlsx':'Calc MS Excel 2007 XML', 'pptx':'Impress MS PowerPoint 2007 XML'}


def convert(source, out, extension, export_filter, input_filter=None):
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as profile:
        command = ['libreoffice', '-env:UserInstallation='+Path(profile).as_uri(), '--headless']
        if input_filter:
            command.append('--infilter='+input_filter)
        command += ['--convert-to', extension+':'+export_filter, '--outdir', str(out), str(source)]
        result = subprocess.run(command, capture_output=True, timeout=90,
                                env={**os.environ,'MALLOC_ARENA_MAX':'2','OMP_NUM_THREADS':'1'})
    path = out / (source.stem+'.'+extension)
    if result.returncode or not path.is_file():
        raise RuntimeError(f'{extension}: {result.stdout!r} {result.stderr!r}')
    return path


def generate(root):
    from PIL import Image
    from docx import Document
    from docx.shared import Inches
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image as CellImage
    from pptx import Presentation
    from pptx.util import Inches as SlideInches
    root.mkdir(parents=True, exist_ok=True)
    picture = root/'picture.png'
    Image.new('RGB',(120,80),(23,170,110)).save(picture)
    doc = Document(); doc.add_heading('WPS 兼容性验收', 1)
    doc.add_paragraph('NebulaeKno 使用数据库。保留中文与原文图片。')
    table = doc.add_table(rows=2, cols=2)
    for row, values in zip(table.rows, [('设备','数量'),('变压器','12')]):
        for cell, value in zip(row.cells, values): cell.text=value
    doc.add_picture(str(picture), width=Inches(1)); doc.save(root/'sample.docx')
    book=Workbook(); sheet=book.active; sheet.title='设备清单'
    sheet.append(['设备','数量','比例','编号'])
    sheet.append(['NebulaeKno 使用数据库',12,.125,'00123']); sheet['C2'].number_format='0.00%'
    sheet['A4']='合并区域'; sheet.merge_cells('A4:A5'); sheet['B5']='保留行号'
    sheet.add_image(CellImage(str(picture)),'E2')
    book.create_sheet('预算').append(['第二工作表',42]); book.save(root/'sample.xlsx')
    deck=Presentation(); slide=deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text='WPS 演示验收'
    slide.shapes.add_textbox(SlideInches(1),SlideInches(2),SlideInches(6),SlideInches(1)).text='NebulaeKno 使用数据库。保留中文与原文图片。'
    slide.shapes.add_picture(str(picture),SlideInches(1),SlideInches(3))
    deck.save(root/'sample.pptx')
    results=[]
    for ext,(target,filter_name) in FORMATS.items():
        binary=convert(root/('sample.'+target),root,ext,filter_name)
        assert binary.read_bytes().startswith(bytes.fromhex('d0cf11e0a1b11ae1')),ext
        converted=convert(binary,root/('converted-'+ext),target,EXPORT[target],filter_name)
        with zipfile.ZipFile(converted) as archive:
            media=[name for name in archive.namelist() if '/media/' in name and not name.endswith('/')]
            assert media, (ext,'images lost')
        if target=='docx':
            parsed=Document(converted)
            assert any('NebulaeKno' in p.text for p in parsed.paragraphs) and len(parsed.tables)==1
        elif target=='xlsx':
            from openpyxl import load_workbook
            parsed=load_workbook(converted)
            assert parsed.sheetnames==['设备清单','预算'] and parsed.worksheets[0]['D2'].value=='00123'
            assert 'A4:A5' in [str(m) for m in parsed.worksheets[0].merged_cells.ranges]
        else:
            parsed=Presentation(converted)
            assert len(parsed.slides)==1 and any('NebulaeKno' in s.text for s in parsed.slides[0].shapes if s.has_text_frame)
        results.append({'extension':ext,'filter':filter_name,'target':target,'images':len(media),'status':'passed'})
        print('PASS',ext,'->',target,'Chinese/text/structure/images',flush=True)
    (root/'compatibility.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    return root


if __name__=='__main__':
    import sys
    generate(Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/wps-compatibility'))
