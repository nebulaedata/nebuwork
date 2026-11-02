"""Source-preserving parser subprocess. All offsets are Unicode code points."""
import csv
import ctypes
import io
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import subprocess
import sys
import tempfile
import zipfile
from parser_catalog import resolve
import progress


def run(args, timeout=300):
    env = {**os.environ, 'MALLOC_ARENA_MAX':'2', 'OMP_NUM_THREADS':'1'} if args[0] == 'libreoffice' else None
    result = subprocess.run(args, capture_output=True, timeout=timeout, env=env)
    if result.returncode:
        raise ValueError('CONVERSION_FAILED')
    return result.stdout


def ocr(image):
    return run(['tesseract', str(image), 'stdout', '-l', 'chi_sim+eng'], 90).decode('utf-8').strip()


def block(text, locator, precision='paragraph', level=0, **extra):
    return dict(text=str(text), locator=locator, precision=precision, level=level, **extra)


def check_archive(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 20000 or sum(e.file_size for e in entries) > 512 * 1024**2:
            raise ValueError('ARCHIVE_LIMIT_EXCEEDED')
        if any(e.file_size > max(1, e.compress_size) * 2000 for e in entries):
            raise ValueError('ARCHIVE_LIMIT_EXCEEDED')


def convert_pdf(path, output):
    progress.report('convert_preview')
    with tempfile.TemporaryDirectory() as profile:
        run(['libreoffice', '-env:UserInstallation=file://' + profile, '--headless', '--convert-to', 'pdf', '--outdir', str(output), str(path)], 300)
    result = output / (path.stem + '.pdf')
    if not result.is_file():
        raise ValueError('CONVERSION_FAILED')
    progress.finish()
    return result


def pdf_blocks(path, output, force_ocr=False, converted=False):
    import pdfplumber
    import pypdfium2
    from pypdf import PdfReader
    blocks, outline = [], []
    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) > 3000:
            raise ValueError('PAGE_LIMIT_EXCEEDED')
        for i, page in enumerate(pdf.pages):
            progress.report('read_pages', 'converted_page' if converted else 'page', i, len(pdf.pages), i+1)
            text = page.extract_text() or ''
            method = 'native'
            image_path = ''
            if force_ocr or len(text.strip()) < 20:
                rendered = pypdfium2.PdfDocument(path)
                image = rendered[i].render(scale=1.5).to_pil()
                target = output / f'page-{i+1}.png'
                image.save(target)
                image_path = str(target)
                text = ocr(target)
                method = 'ocr'
                image.close()
                rendered.close()
            blocks.append(block(text, {'type': 'page', 'page': i+1}, 'page', method=method, preview_image_path=image_path, block_type='text'))
            # Only embedded image objects; scanned full pages remain previews.
            for number, picture in enumerate([] if converted else page.images):
                x0, y0 = max(0, picture['x0']), max(0, picture['top'])
                x1, y1 = min(page.width, picture['x1']), min(page.height, picture['bottom'])
                if x1<=x0 or y1<=y0 or (x1-x0)/page.width>.9 and (y1-y0)/page.height>.9:
                    continue
                with pypdfium2.PdfDocument(path) as rendered:
                    image = rendered[i].render(scale=1.5).to_pil()
                    target = output / f'pdf-image-{i+1}-{number}.png'
                    image.crop((int(x0*image.width/page.width), int(y0*image.height/page.height),
                                math.ceil(x1*image.width/page.width), math.ceil(y1*image.height/page.height))).save(target)
                    image.close()
                blocks.append(block('', {'type':'page','page':i+1,'bbox':[x0/page.width,y0/page.height,x1/page.width,y1/page.height]},
                                    'region', image_path=str(target),block_type='image',visual_role='image_region'))
            progress.report('read_pages', 'converted_page' if converted else 'page', i+1, len(pdf.pages), i+1)
    reader = PdfReader(path)
    def visit(items, level=1):
        for item in items:
            if isinstance(item, list):
                visit(item, level+1)
            else:
                try:
                    page = reader.get_destination_page_number(item)+1
                    if 0 < page <= len(reader.pages):
                        outline.append({'title': item.title, 'level': level, 'locator': {'type': 'page', 'page': page}, 'method': 'native_bookmark'})
                except (ValueError, AttributeError, TypeError):
                    pass
    visit(reader.outline)
    return blocks, outline


def text_blocks(text, markdown=False, image_loader=None):
    result = []
    fenced = False
    for i, line in enumerate(text.splitlines()):
        if line.lstrip().startswith(('```', '~~~')):
            fenced = not fenced
        match = re.match(r'^(#{1,6})\s+(.+?)\s*#*$', line) if markdown and not fenced else None
        pictures=list(re.finditer(r'!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)',line)) if markdown and not fenced and image_loader else []
        content=line
        for picture in reversed(pictures):
            content=content[:picture.start()]+content[picture.end():]
        loc={'type': 'text', 'line_start': i+1, 'line_end': i+1}
        result.append(block(content, loc, 'range', len(match[1]) if match else 0, title=match[2] if match else None))
        for picture in pictures:
            result.append(block('',loc,'range',**image_loader(picture[2])))
    return result


def html_blocks(text, chapter=None, main_content=True, image_loader=None):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(text, 'html.parser')
    for element in soup(['script', 'style']+(['nav','footer'] if main_content else [])):
        element.decompose()
    elements = soup.find_all(re.compile(r'^(h[1-6]|p|pre|li|tr|img)$'))
    result = []
    for i, element in enumerate(elements):
        if element.name == 'img':
            if image_loader:
                loc={'type':'html','element_index':i,'tag':'img'}
                if chapter: loc['chapter']=chapter
                data=image_loader(element.get('src',''))
                result.append(block('',loc,'range',**data))
            continue
        if element.find_parent(['pre', 'li', 'tr']):
            continue
        text = element.get_text(' ', strip=True)
        if not text:
            continue
        loc = {'type': 'html', 'element_index': i, 'tag': element.name}
        if chapter:
            loc['chapter'] = chapter
        level = int(element.name[1]) if element.name.startswith('h') else 0
        result.append(block(text, loc, level=level, title=text if level else None))
    if not result:
        result = [block(soup.get_text('\n', strip=True), {'type': 'document'}, 'document')]
    return result


def media_parse(path, output, options):
    progress.report('inspect_media')
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]))
    duration = float(probe.get('format', {}).get('duration', 0))
    if not math.isfinite(duration) or duration <= 0 or duration > options.get('max_duration_seconds', 14400):
        raise ValueError('MEDIA_DURATION_INVALID')
    origin = float(probe.get('format', {}).get('start_time', 0))
    streams = probe['streams']
    videos = [s for s in streams if s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic')]
    audios = [s for s in streams if s['codec_type'] == 'audio']
    assets, blocks = [], []
    if audios and not options.get('preview_only'):
        progress.report('split_audio')
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'segment', '-segment_time', '300', '-reset_timestamps', '1', str(output / 'audio-%04d.wav')], 1200)
        position = max(0, float(audios[0].get('start_time', origin))-origin)
        for part in sorted(output.glob('audio-*.wav')):
            seconds = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(part)]))
            assets.append({'kind': 'audio_segment', 'path': str(part), 'start_ms': round(position*1000), 'end_ms': round((position+seconds)*1000)})
            position += seconds
    if not options.get('preview_only') and not options.get('subtitle_path') and any(s['codec_type'] == 'subtitle' for s in streams):
        try:
            subtitle = run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:s:0', '-f', 'srt', 'pipe:1']).decode('utf-8')
            def timestamp(s):
                h, m, sec = s.replace(',', '.').split(':')
                return round((int(h)*3600+int(m)*60+float(sec))*1000)
            for start, end, text in re.findall(r'(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})[^\n]*\n(.*?)(?=\n\s*\n|\Z)', subtitle, re.S):
                a,b=timestamp(start),timestamp(end)
                if 0 <= a < b <= math.ceil(duration*1000)+1000:
                    blocks.append(block(re.sub('<[^>]+>', '', text).strip(), {'type': 'time', 'start_ms': a, 'end_ms': b}, 'time_segment', method='embedded_subtitle'))
        except (ValueError, subprocess.TimeoutExpired):
            pass
    if options.get('subtitle_path') and not options.get('preview_only'):
        subtitle_path=Path(options['subtitle_path']).resolve()
        if not subtitle_path.is_relative_to(Path(os.environ.get('NEBULAEKNO_DATA_DIR','/data')).resolve()/'media'):
            raise ValueError('INVALID_SUBTITLE_PATH')
        for part in json.loads(subtitle_path.read_text(encoding='utf-8')):
            if not (0 <= part['start_ms'] < part['end_ms'] <= duration*1000+1):
                raise ValueError('SUBTITLE_TIME_INVALID')
            blocks.append(block(part['text'],{'type':'time','start_ms':part['start_ms'],'end_ms':part['end_ms']},'time_segment',method='subtitle'))
    if videos and not options.get('preview_only'):
        progress.report('extract_frames')
        maximum = min(240, int(options.get('max_frames', 240)))
        interval = max(float(options.get('frame_interval_seconds', 30)), duration/maximum)
        result = subprocess.run(['ffmpeg', '-v', 'info', '-y', '-copyts', '-i', str(path), '-map', '0:v:0', '-vf', f"select='isnan(prev_selected_t)+gte(t-prev_selected_t,{interval})',scale='min(1280,iw)':-2,showinfo", '-vsync', 'vfr', '-frames:v', str(maximum), str(output / 'frame-%05d.jpg')], capture_output=True, timeout=1200)
        if result.returncode:
            raise ValueError('FRAME_EXTRACTION_FAILED')
        stamps = re.findall(r'\bn:\s*\d+.*?pts_time:([\d.eE+-]+)', result.stderr.decode('utf-8', errors='replace'))
        frame_items = list(zip(sorted(output.glob('frame-*.jpg')), stamps))
        for index, (image, stamp) in enumerate(frame_items):
            progress.report('frame_ocr', 'frame', index, len(frame_items), index+1)
            at = max(0, round((float(stamp)-origin)*1000))
            if at > duration*1000:
                continue
            assets.append({'kind': 'video_frame', 'path': str(image), 'time_ms': at})
            text=ocr(image) if options.get('frame_ocr',True) else ''
            blocks.append(block(text, {'type': 'frame', 'time_ms': at, 'bbox': [0,0,1,1]}, 'frame', method='frame_ocr', image_path=str(image)))
    progress.finish()
    playable = (videos and videos[0].get('codec_name') == 'h264' and all(a.get('codec_name') in ('aac','mp3') for a in audios) and path.suffix.lower() == '.mp4') or (not videos and path.suffix.lower() in ('.mp3','.wav','.ogg'))
    preview = str(path) if playable else None
    if not playable and options.get('preview_enabled',True):
        progress.report('convert_media')
        target = output / ('playback.mp4' if videos else 'playback.mp3')
        args = ['ffmpeg', '-v', 'error', '-y', '-i', str(path)]
        args += ['-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','fast','-crf','24','-c:a','aac','-movflags','+faststart'] if videos else ['-vn','-c:a','libmp3lame']
        try:
            run(args+[str(target)], 1200)
            preview = str(target)
        except (ValueError, subprocess.TimeoutExpired):
            pass
    return {'blocks':blocks,'outline':[],'assets':assets,'media':{'duration_ms':round(duration*1000),'streams':streams,'has_audio':bool(audios),'has_video':bool(videos),'source_origin_seconds':origin,'frame_sampling':{'count':sum(a['kind']=='video_frame' for a in assets),'requested_interval_seconds':options.get('frame_interval_seconds',30),'actual_interval_seconds':interval if videos and not options.get('preview_only') else None,'budget_adjusted':bool(videos and not options.get('preview_only') and interval>float(options.get('frame_interval_seconds',30)))}},'preview_path':preview,'engine':'ffmpeg'}


def parse(request):
    root = Path(os.environ.get('NEBULAEKNO_DATA_DIR', '/data')).resolve()
    path = Path(request['path']).resolve()
    output = Path(request['output']).resolve()
    if not path.is_relative_to(root / 'files') or not output.is_relative_to(root / 'derived'):
        raise ValueError('INVALID_FILE_PATH')
    output.mkdir(parents=True, exist_ok=True)
    return parse_document(path, output, request.get('options', {}), request.get('mode'))


def parse_document(path, output, options, mode=None, configure=True):
    # Only parse() is exposed to the HTTP worker; normalized derived paths are
    # passed here by the content-checked adapter, never accepted from clients.
    ext = path.suffix.lower()
    engines = options.get('parser_engines', {})
    category, selected_engine = resolve(ext, engines)
    if configure:
        progress.configure(output, selected_engine)
    from wps import FORMATS as WPS_FORMATS, normalize as normalize_wps, decorate as decorate_wps
    if ext in WPS_FORMATS:
        normalized, conversion = normalize_wps(path, output)
        target_category = WPS_FORMATS[ext][0]
        converted_options = {**options, 'parser_engines': {**engines, target_category: selected_engine}}
        try:
            result = parse_document(normalized, output, converted_options, mode, configure=False)
        except Exception as error:
            if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)):
                raise
            raise ValueError('WPS_PARSE_FAILED') from None
        return decorate_wps(result, conversion)
    progress.report('read_document')
    blocks, outline, assets, preview = [], [], [], None
    if ext in ('.xls', '.xlsx') and mode != 'preview' and (selected_engine in ('excel', 'anydoc') or mode == 'spreadsheet'):
        from spreadsheet import parse_spreadsheet
        if mode == 'spreadsheet':
            options['_structure_only'] = True
        try:
            if ext == '.xlsx':
                with path.open('rb') as source:
                    if source.read(8) == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
                        raise ValueError('SPREADSHEET_ENCRYPTED_OR_MISNAMED')
                check_archive(path)
            return parse_spreadsheet(path, output, options, selected_engine if not options.get('_structure_only') else 'excel')
        except MemoryError:
            raise ValueError('SPREADSHEET_MEMORY_LIMIT_EXCEEDED') from None
        except Exception as error:
            if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)):
                raise
            code = 'SPREADSHEET_ENCRYPTED' if 'encrypt' in str(error).lower() else 'SPREADSHEET_READ_FAILED'
            raise ValueError(code) from None
    if mode=='preview':
        options['preview_only']=True
        if ext == '.ofd':
            from ofd import parse_ofd
            _, _, preview = parse_ofd(path, output, {}, preview_only=True)
            return {'preview_path': preview, 'engine': 'preview'}
        if ext not in ('.mp3','.wav','.ogg','.flac','.m4a','.aac','.mp4','.mkv','.mov','.webm','.avi','.m4v'):
            native=ext in ('.pdf','.png','.jpg','.jpeg','.webp')
            target=path if native else convert_pdf(path,output) if ext in ('.doc','.docx','.docm','.ppt','.pptx','.pptm','.xls','.xlsx','.xlsm','.odt','.ods','.odp','.rtf') else None
            return {'preview_path':str(target) if target else None,'engine':'preview'}
    if ext in ('.mp3','.wav','.ogg','.flac','.m4a','.aac','.mp4','.mkv','.mov','.webm','.avi','.m4v'):
        result = media_parse(path, output, options)
        result['engine'] = selected_engine
        return result
    if ext in ('.docx','.docm','.xlsx','.xlsm','.pptx','.pptm','.epub','.odt','.ods','.odp','.ofd','.xmind'):
        check_archive(path)
    office_type = ext in ('.doc','.docx','.docm','.xls','.xlsx','.xlsm','.ppt','.pptx','.pptm','.odt','.ods','.odp','.rtf')
    if selected_engine == 'anydoc':
        from anydoc_adapter import parse_anydoc
        def native_reference():
            if ext not in ('.docx','.xlsx','.pptx','.epub'):
                return []
            # Never substitute native content after an anydoc failure; this is location verification only.
            try:
                reference_options = {**options, '_reference_only':True, 'preview_enabled': False, 'parser_engines': {**engines, category: 'native'}}
                with progress.suspended():
                    return parse_document(path, output, reference_options)['blocks']
            except Exception:
                return []
        blocks, assets = parse_anydoc(path, output, options, native_reference)
        if office_type and options.get('preview_enabled', True):
            try: preview = str(convert_pdf(path, output))
            except (ValueError, subprocess.TimeoutExpired): progress.finish('failed')
    elif ext == '.pdf' and selected_engine == 'paddleocr_vl':
        from paddle import parse_pdf
        from pypdf import PdfReader
        blocks, assets = parse_pdf(path, output, options.get('paddleocr_vl', {}))
        selected_engine = 'paddleocr_vl'
        preview = str(path)
        book = PdfReader(path)
        def bookmarks(items, level=1):
            for item in items:
                if isinstance(item, list): bookmarks(item, level+1)
                else:
                    try:
                        page = book.get_destination_page_number(item)+1
                        if 0<page<=len(book.pages): outline.append({'title':item.title,'level':level,'locator':{'type':'page','page':page},'method':'native_bookmark'})
                    except (ValueError, TypeError, AttributeError): pass
        bookmarks(book.outline)
    elif ext in ('.pdf','.doc','.ppt','.xls','.odt','.ods','.odp','.rtf') or office_type and selected_engine=='libreoffice':
        pdf = path if ext == '.pdf' else convert_pdf(path, output)
        blocks, outline = pdf_blocks(pdf, output, ext=='.pdf' and selected_engine=='tesseract', ext!='.pdf')
        selected_engine = 'libreoffice' if ext!='.pdf' else 'tesseract' if selected_engine=='tesseract' else 'native'
        preview = str(pdf)
    elif ext == '.docx':
        from docx import Document
        from docx.oxml.ns import qn
        from docx.text.paragraph import Paragraph
        from docx.table import Table
        document = Document(path)
        from docx_images import extract_native_images
        occurrences, docx_assets = ([], []) if options.get('_reference_only') else extract_native_images(path, output)
        assets.extend(docx_assets)
        def append_pictures(locator):
            for occurrence in occurrences:
                loc = occurrence['locator']
                if all(loc.get(key) == value for key, value in locator.items()):
                    if occurrence['image_path']:
                        blocks.append(block('', loc, 'range', image_path=occurrence['image_path'], block_type='image', visual_role='embedded_image'))
                    else:
                        blocks.append(block('',loc,'range',warning='IMAGE_ASSET_UNAVAILABLE'))
        index = 0
        children = [c for c in document.element.body if c.tag in (qn('w:p'), qn('w:tbl'))]
        tables = 0
        for position, child in enumerate(children):
            progress.report('read_docx', 'docx_block', position, len(children), position+1, paragraphs=index, tables=tables)
            if child.tag == qn('w:p'):
                paragraph = Paragraph(child, document)
                index += 1
                match = re.search(r'(?:Heading|标题)\s*(\d)', paragraph.style.name or '', re.I)
                level = int(match[1]) if match else 0
                blocks.append(block(paragraph.text, {'type':'paragraph','paragraph_id':str(index)}, level=level, title=paragraph.text if level else None))
                append_pictures({'type':'paragraph','paragraph_id':str(index)})
            elif child.tag == qn('w:tbl'):
                tables += 1
                table = Table(child, document)
                for row_index,row in enumerate(table.rows):
                    blocks.append(block(' | '.join(c.text for c in row.cells), {'type':'table','table_id':str(tables),'after_paragraph_id':str(index),'row':row_index+1}, 'range'))
                    append_pictures({'type':'table','table_id':str(tables),'row':row_index+1})
        progress.report('read_docx', 'docx_block', len(children), len(children), paragraphs=index, tables=tables)
        try: preview = str(convert_pdf(path, output)) if options.get('preview_enabled',True) else None
        except (ValueError, subprocess.TimeoutExpired): progress.finish('failed')
    elif ext == '.xlsx':
        import openpyxl
        book = openpyxl.load_workbook(path, read_only=True, data_only=False)
        cached = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for sheet in book:
            if sheet.max_row and sheet.max_row > 200000:
                raise ValueError('SHEET_LIMIT_EXCEEDED')
            for row_number,(row, cached_row) in enumerate(zip(sheet.iter_rows(), cached[sheet.title].iter_rows()),1):
                cells=[]
                for column_number,(cell, value_cell) in enumerate(zip(row,cached_row),1):
                    value = value_cell.value if cell.data_type == 'f' and value_cell.value is not None else cell.value
                    text = str(value) if value is not None else ''
                    if options.get('excel_preserve_percentage',True) and isinstance(value,(int,float)) and '%' in cell.number_format:
                        match = re.search(r'0\.(0+)%',cell.number_format)
                        text = f'{value*100:.{len(match[1]) if match else 0}f}%'
                    cells.append({'cell':openpyxl.utils.get_column_letter(column_number)+str(row_number),'raw':str(cell.value) if cell.value is not None else None,'format':cell.number_format,'display':text})
                if any(c['display'] for c in cells):
                    blocks.append(block(' | '.join(c['display'] for c in cells), {'type':'sheet','sheet':sheet.title,'cell_range':cells[0]['cell']+':'+cells[-1]['cell']}, 'range', cells=cells))
        book.close();cached.close()
    elif ext == '.pptx':
        from pptx import Presentation
        for i,slide in enumerate(Presentation(path).slides):
            text='\n'.join(shape.text for shape in slide.shapes if shape.has_text_frame)
            title=slide.shapes.title.text if slide.shapes.title else None
            blocks.append(block(text, {'type':'slide','slide':i+1},'page',1 if title else 0,title=title))
        try: preview=str(convert_pdf(path,output)) if options.get('preview_enabled',True) else None
        except (ValueError, subprocess.TimeoutExpired): progress.finish('failed')
    elif ext in ('.png','.jpg','.jpeg','.webp','.tif','.tiff','.bmp','.gif'):
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS=int(os.environ.get('NEBULAEKNO_PREPROCESS_MAX_PIXELS','16000000'))
        with Image.open(path) as original:
            image=ImageOps.exif_transpose(original).convert('RGB');image.thumbnail((2000,2000));target=output/'image.png';image.save(target)
        if selected_engine=='paddleocr_vl':
            from paddle import parse_image
            blocks=parse_image(target,options.get('paddleocr_vl',{}),{'type':'image'},image.size)
            selected_engine='paddleocr_vl'
        else:
            text=ocr(target);blocks=[block(text,{'type':'image','bbox':[0,0,1,1]},'region',image_path=str(target),method='ocr')]
            selected_engine='tesseract'
        assets=[{'kind':'image','path':str(target)}];preview=str(target)
    elif ext == '.epub':
        from bs4 import BeautifulSoup
        with zipfile.ZipFile(path) as archive:
            container=BeautifulSoup(archive.read('META-INF/container.xml'),'xml')
            package=container.find('rootfile')['full-path'];opf=BeautifulSoup(archive.read(package),'xml')
            manifest={i['id']:i['href'] for i in opf.find_all('item')};base=Path(package).parent
            from html_images import image_loader
            resources={name:(archive.read(name),'') for name in archive.namelist() if not name.endswith('/')}
            for item in opf.find_all('itemref'):
                chapter=str(base/manifest[item['idref']]);blocks.extend(html_blocks(archive.read(chapter).decode('utf-8'),chapter,image_loader=image_loader(output,resources,chapter)))
    elif ext in ('.mhtml','.mht'):
        from structured_formats import mhtml_blocks
        blocks=mhtml_blocks(path,html_blocks,options.get('html_main_content',True),output)
    elif ext == '.xmind':
        from structured_formats import xmind_blocks
        blocks=xmind_blocks(path,block,output)
    elif ext == '.ofd':
        if selected_engine == 'paddleocr_vl':
            from ofd import parse_ofd
            blocks, assets, preview = parse_ofd(path, output, options.get('paddleocr_vl', {}))
        else:
            from structured_formats import ofd_blocks
            blocks=ofd_blocks(path,block,output)
    elif ext in ('.html','.htm'):
        from html_images import image_loader
        blocks=html_blocks(path.read_text(encoding='utf-8-sig'), main_content=options.get('html_main_content',True),image_loader=image_loader(output))
    elif ext in ('.csv','.tsv'):
        for i,row in enumerate(csv.reader(io.StringIO(path.read_text(encoding='utf-8-sig')),delimiter='\t' if ext=='.tsv' else ',')):
            blocks.append(block(' | '.join(row),{'type':'sheet','sheet':'Sheet1','row':i+1},'range'))
    elif ext in ('.txt','.md','.markdown','.json','.xml','.yaml','.yml','.log','.py','.js','.ts','.java','.go','.sql'):
        from html_images import image_loader
        blocks=text_blocks(path.read_text(encoding='utf-8-sig'),ext in ('.md','.markdown'),image_loader(output))
    else:
        raise ValueError('UNSUPPORTED_FORMAT')
    # Text-oriented readers use the same image pipeline without substituting
    # their text or assigning converted-PDF pages to original Office objects.
    if not options.get('_reference_only') and selected_engine != 'anydoc' and ext in ('.pptx','.xlsx','.doc','.ppt','.xls','.docm','.pptm','.xlsm','.odt','.odp','.ods','.rtf'):
        from anydoc_adapter import parse_anydoc
        from embedded_images import insert_image_blocks
        try:
            with progress.suspended():
                picture_blocks, picture_assets = parse_anydoc(path, output, options, lambda: blocks)
        except (OSError, ValueError, subprocess.SubprocessError):
            picture_blocks,picture_assets=[block('',{'type':'document'},'document',warning='IMAGE_EXTRACTION_FAILED')],[]
        blocks = insert_image_blocks(blocks, [b for b in picture_blocks if b.get('image_path') or b.get('warning')])
        assets.extend(picture_assets)
    if not outline:
        outline=[{'title':b.get('title') or b['text'],'level':b['level'],'locator':b['locator'],'method':'paddle_layout_heading' if b.get('method')=='paddleocr_vl' else 'anydoc_heading' if b.get('method')=='anydoc' else 'native_heading'} for b in blocks if b.get('level')]
    # Every image occurrence must have a registered asset even for structured
    # readers without a separate attachment list (HTML/OFD/XMind/native PDF).
    known={a['path'] for a in assets}
    for b in blocks:
        if b.get('image_path') and b['image_path'] not in known:
            assets.append({'kind':'image','path':b['image_path'],'visual_role':b.get('visual_role','embedded_image')})
            known.add(b['image_path'])
    return {'blocks':blocks,'outline':outline,'assets':assets,'preview_path':preview,
            'visual_layout_version': 2 if ext in ('.pdf', '.ofd') and selected_engine == 'paddleocr_vl' else 0,
            'warnings': [{'code': b['warning'], 'page': b['locator'].get('page')} for b in blocks if b.get('warning')], 'engine':'native+ocr' if selected_engine=='native' and any(b.get('method')=='ocr' for b in blocks) else selected_engine}


if __name__ == '__main__':
    ctypes.CDLL(None).prctl(1, signal.SIGKILL)
    if os.getppid() == 1:
        sys.exit(1)
    limit=int(os.environ.get('NEBULAEKNO_PREPROCESS_MEMORY_MB','2048'))*1024**2
    resource.setrlimit(resource.RLIMIT_AS,(limit,limit))
    try:
        result=parse(json.load(sys.stdin))
        progress.finish()
        print(json.dumps(result,ensure_ascii=False,default=str))
    except Exception as error:
        progress.finish('failed')
        print(json.dumps({'error':str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z_]+',str(error)) else 'PARSE_FAILED'}))
        sys.exit(1)
