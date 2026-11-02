"""Verified package image occurrences and browser-compatible asset conversion."""
import hashlib
import io
import json
import os
import posixpath
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'


def package_part(base, target):
    part = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(base), target))
    return None if part == '..' or part.startswith('../') or '\\' in part else part


def relationships(archive, part):
    name = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part)+'.rels')
    if name not in archive.namelist():
        return {}
    return {r.get('Id'): package_part(part, r.get('Target', '')) for r in ET.fromstring(archive.read(name))
            if r.get('TargetMode') != 'External'}


def image_positions(path):
    ext = path.suffix.lower()
    if ext in ('.docx', '.docm'):
        from docx_images import image_positions as docx_positions
        return docx_positions(path)
    if ext in ('.odt','.ods','.odp'):
        return odf_positions(path)
    if ext not in ('.pptx', '.pptm', '.xlsx', '.xlsm'):
        return []
    found = []
    with zipfile.ZipFile(path) as archive:
        def add(part, locator):
            if part and part in archive.namelist():
                found.append({'part':part, 'locator':{**locator, 'part':part, 'image_occurrence':len(found)+1}})
        if ext in ('.pptx', '.pptm'):
            root = 'ppt/presentation.xml'
            refs = relationships(archive, root)
            for number, slide in enumerate(ET.fromstring(archive.read(root)).findall('./{*}sldIdLst/{*}sldId'), 1):
                part = refs.get(slide.get(R+'id'))
                if not part or part not in archive.namelist():
                    continue
                image_refs = relationships(archive, part)
                # Includes pictures in grouped shapes and picture fills. Positions
                # remain slide-level; group transforms must not be guessed as bbox.
                for blip in ET.fromstring(archive.read(part)).iter(A+'blip'):
                    add(image_refs.get(blip.get(R+'embed')), {'type':'slide','slide':number})
        else:
            root = 'xl/workbook.xml'
            refs = relationships(archive, root)
            for sheet in ET.fromstring(archive.read(root)).findall('./{*}sheets/{*}sheet'):
                part = refs.get(sheet.get(R+'id'))
                if not part or part not in archive.namelist():
                    continue
                sheet_refs = relationships(archive, part)
                for drawing in ET.fromstring(archive.read(part)).findall('{*}drawing'):
                    drawing_part = sheet_refs.get(drawing.get(R+'id'))
                    if not drawing_part or drawing_part not in archive.namelist():
                        continue
                    image_refs = relationships(archive, drawing_part)
                    for anchor in ET.fromstring(archive.read(drawing_part)):
                        loc = {'type':'sheet','sheet':sheet.get('name')}
                        start = anchor.find('{*}from')
                        if start is not None:
                            from openpyxl.utils import get_column_letter
                            col, row = int(start.findtext('{*}col', '0'))+1, int(start.findtext('{*}row', '0'))+1
                            loc.update(row=row, column=col, cell_range=get_column_letter(col)+str(row))
                        for blip in anchor.iter(A+'blip'):
                            add(image_refs.get(blip.get(R+'embed')), loc)
    return found


def odf_positions(path):
    found = []
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('content.xml'))
        xlink = '{http://www.w3.org/1999/xlink}'
        table = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
        def collect(node, loc):
            for image in node.findall('.//{*}image'):
                part = package_part('content.xml',image.get(xlink+'href',''))
                if part and part in archive.namelist():
                    found.append({'part':part,'locator':{**loc,'part':part,'image_occurrence':len(found)+1}})
        if path.suffix.lower()=='.odp':
            for index, page in enumerate(root.findall('.//{*}presentation/{*}page'),1):
                collect(page,{'type':'slide','slide':index})
        elif path.suffix.lower()=='.ods':
            from openpyxl.utils import get_column_letter
            for sheet in root.findall('.//{*}spreadsheet/{*}table'):
                row=1
                for tr in sheet.findall('{*}table-row'):
                    column=1
                    for cell in tr:
                        collect(cell,{'type':'sheet','sheet':sheet.get(table+'name'),'row':row,
                                      'cell_range':get_column_letter(column)+str(row)})
                        column+=int(cell.get(table+'number-columns-repeated','1'))
                    row+=int(tr.get(table+'number-rows-repeated','1'))
                # Drawings outside cells still have a verified sheet association.
                for shapes in sheet.findall('{*}shapes'):
                    collect(shapes,{'type':'sheet','sheet':sheet.get(table+'name')})
        else:
            collect(root,{'type':'document'})
    return found


def save_image(raw, output, name, media_type='', part=''):
    """Return a PNG path. Never fetch linked images or replace them with page shots."""
    from PIL import Image, ImageOps, UnidentifiedImageError
    target = output / (name+'.png')
    try:
        with Image.open(io.BytesIO(raw)) as original:
            rgba = ImageOps.exif_transpose(original).convert('RGBA')
            image = Image.new('RGB',rgba.size,'white')
            image.paste(rgba,mask=rgba.getchannel('A'))
            image.thumbnail((2000, 2000))
            image.save(target)
        return str(target)
    except (UnidentifiedImageError, OSError, ValueError):
        pass
    extension = Path(part).suffix.lower()
    extension = {'image/svg+xml':'.svg','image/x-emf':'.emf','image/emf':'.emf',
                 'image/x-wmf':'.wmf','image/wmf':'.wmf'}.get(media_type, extension)
    if extension not in ('.svg','.emf','.wmf'):
        return ''
    # Convert the individual vector asset, not an Office page. SVG external
    # resources and active content are removed before invoking the converter.
    if extension == '.svg':
        try:
            ET.register_namespace('', 'http://www.w3.org/2000/svg')
            root = ET.fromstring(raw)
            for parent in root.iter():
                for child in list(parent):
                    if child.tag.split('}')[-1] in ('script','foreignObject','style'):
                        parent.remove(child)
                for key, value in list(parent.attrib.items()):
                    if key.split('}')[-1].lower().startswith('on') or ('href' in key and not value.startswith('#')) or 'url(' in value:
                        del parent.attrib[key]
            raw = ET.tostring(root)
        except ET.ParseError:
            return ''
    try:
        with tempfile.TemporaryDirectory() as folder:
            temp = Path(folder)
            source = temp / ('asset'+extension)
            source.write_bytes(raw)
            converted = temp/'rendered'; converted.mkdir()
            subprocess.run(['libreoffice','-env:UserInstallation='+ (temp/'profile').as_uri(), '--headless',
                            '--convert-to','png:draw_png_Export','--outdir',str(converted),str(source)],
                           capture_output=True, check=True, timeout=60)
            with Image.open(converted/'asset.png') as preview:
                width,height=preview.size
            if max(width,height)<2000:
                scale=2000/max(width,height)
                settings={key:{'type':'long','value':str(round(value*scale))} for key,value in [('PixelWidth',width),('PixelHeight',height)]}
                subprocess.run(['libreoffice','-env:UserInstallation='+(temp/'profile').as_uri(),'--headless',
                                '--convert-to','png:draw_png_Export:'+json.dumps(settings),'--outdir',str(converted),str(source)],
                               capture_output=True,check=True,timeout=60)
            # Draw may add an empty page-sized canvas around a metafile. Trim
            # only that converter padding, never crop ordinary document images.
            from PIL import ImageChops
            with Image.open(converted/'asset.png') as rendered:
                rgba=rendered.convert('RGBA')
                image=Image.new('RGB',rgba.size,'white');image.paste(rgba,mask=rgba.getchannel('A'))
                bounds=ImageChops.difference(image,Image.new('RGB',image.size,'white')).getbbox()
                if bounds:
                    x0,y0,x1,y1=bounds
                    image=image.crop((max(0,x0-8),max(0,y0-8),min(image.width,x1+8),min(image.height,y1+8)))
                image.thumbnail((2000,2000));image.save(target)
            return str(target)
    except (OSError, subprocess.SubprocessError):
        return ''


def pixel_identity(path):
    from PIL import Image
    with Image.open(path) as image:
        image=image.convert('RGB')
        return hashlib.sha256(str(image.size).encode()+image.tobytes()).hexdigest()


def package_images(path, output):
    """Extract OOXML images, including those omitted by the content parser."""
    legacy={'.xls':'xlsx','.doc':'docx','.ppt':'pptx'}
    if path.suffix.lower() in legacy:
        # Legacy readers can omit vector drawings and BIFF pictures. Convert
        # only to recover embedded assets, retaining the selected text parser.
        extension=legacy[path.suffix.lower()]
        converted=output/'image-package';converted.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory() as folder:
            try:
                result = subprocess.run(['libreoffice','-env:UserInstallation='+Path(folder).as_uri(),'--headless',
                                         '--convert-to',extension,'--outdir',str(converted),str(path)],
                                        capture_output=True,timeout=300,
                                        env={**os.environ, 'MALLOC_ARENA_MAX':'2', 'OMP_NUM_THREADS':'1'})
            except subprocess.TimeoutExpired:
                raise ValueError('IMAGE_PACKAGE_CONVERSION_TIMEOUT') from None
            except OSError:
                raise ValueError('IMAGE_PACKAGE_CONVERTER_UNAVAILABLE') from None
            (converted/'conversion.log').write_bytes(result.stdout+b'\n'+result.stderr)
            if result.returncode:
                raise ValueError('IMAGE_PACKAGE_CONVERSION_FAILED')
        package=converted/(path.stem+'.'+extension)
        if not package.is_file():
            raise ValueError('IMAGE_PACKAGE_CONVERSION_FAILED')
        positions, assets=package_images(package,output)
        if extension=='docx':
            with zipfile.ZipFile(package) as archive:
                paragraphs=ET.fromstring(archive.read('word/document.xml')).findall('./{*}body/{*}p')
                for position in positions:
                    number=int(position['locator'].get('paragraph_id','0'))
                    # Original text can verify the preceding paragraph; a
                    # converted paragraph number alone is not an original anchor.
                    for paragraph in reversed(paragraphs[:max(0,number-1)]):
                        text=''.join(n.text or '' for n in paragraph.findall('.//{*}t')).strip()
                        if text:
                            position['anchor_before_text']=text
                            break
        for position in positions:
            position['locator']['mapping']='converted_structure'
        return positions,assets
    positions = image_positions(path)
    if not positions:
        return [], []
    assets, files = [], {}
    with zipfile.ZipFile(path) as archive:
        for position in positions:
            part = position['part']
            if part not in files:
                name = 'embedded-'+hashlib.sha256(part.encode()).hexdigest()[:20]
                files[part] = save_image(archive.read(part), output, name, part=part)
                if files[part]:
                    assets.append({'kind':'image','path':files[part],'origin_part':part,'visual_role':'embedded_image'})
            position['image_path'] = files[part]
    return positions, assets


def insert_image_blocks(blocks, images):
    """Insert at a verified structural position; otherwise keep an explicit appendix."""
    after, unplaced = {}, []
    for image in images:
        loc = image['locator']
        keys = ('slide',) if loc.get('slide') else ('sheet',) if loc.get('sheet') else ('paragraph_id',) if loc.get('paragraph_id') else ()
        matches = [i for i,b in enumerate(blocks) if keys and loc.get('mapping')!='converted_structure' and all(b['locator'].get(k)==loc[k] for k in keys)]
        anchor=image.get('layout',{}).get('anchor_before_text')
        if anchor:
            import re
            clean=lambda text:re.sub(r'\s+','',text)
            exact=[i for i,b in enumerate(blocks) if clean(b['text'])==clean(anchor)]
            if len(exact)==1: matches=exact
        if matches:
            after.setdefault(matches[-1], []).append(image)
        else:
            image['layout'] = {**image.get('layout',{}), 'unplaced':True}
            unplaced.append(image)
    result = []
    for i, block in enumerate(blocks):
        result.append(block)
        result.extend(after.get(i, []))
    return result + unplaced
