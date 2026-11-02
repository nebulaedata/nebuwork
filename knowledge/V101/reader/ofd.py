"""OFD source pages -> raster preview -> the same Paddle layout adapter as PDF."""
import json
import math
import os
from pathlib import Path, PurePosixPath
import selectors
import subprocess
import time
import zipfile
import zlib
import xml.etree.ElementTree as ET

import progress


def renderer_command():
    return ['java', '-Djava.awt.headless=true', '-Xms32m', '-Xmx512m',
            '-XX:+UseSerialGC', '-XX:CompressedClassSpaceSize=64m',
            '-XX:ReservedCodeCacheSize=64m', '-XX:ActiveProcessorCount=2', '-Xss512k',
            '-cp', '/app/ofd-renderer/ofd-renderer-1.0.0.jar:/app/ofd-renderer/lib/*',
            'nebulaekno.OfdRenderer']


def validate_archive(path):
    # OFDRW unpacks the archive itself; reject unsafe names and XML entities
    # before handing an uploaded package to the renderer.
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if (len(entries) > 20000 or sum(e.file_size for e in entries) > 512 * 1024**2 or
                any(e.file_size > max(1, e.compress_size) * 2000 for e in entries)):
            raise ValueError('ARCHIVE_LIMIT_EXCEEDED')
        for entry in entries:
            name = entry.filename.replace('\\', '/')
            if (PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or
                    ':' in name or (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('INVALID_ARCHIVE_PATH')
            if name.lower().endswith('.xml'):
                data = archive.read(entry)
                # Also catches UTF-16/32 ASCII markup after removing NUL bytes.
                upper = data.replace(b'\0', b'').upper()
                if b'<!DOCTYPE' in upper or b'<!ENTITY' in upper:
                    raise ValueError('OFD_UNSAFE_XML')
        try:
            root = ET.fromstring(archive.read('OFD.xml'))
            documents = root.findall('./{*}DocBody/{*}DocRoot')
            if len(documents) != 1:
                raise ValueError('OFD_DOCUMENT_STRUCTURE_UNSUPPORTED')
            document = ET.fromstring(archive.read(documents[0].text.lstrip('/')))
            count = len(document.findall('./{*}Pages/{*}Page'))
        except (KeyError, ET.ParseError, AttributeError):
            raise ValueError('OFD_DOCUMENT_INVALID') from None
        if not 0 < count <= 3000:
            raise ValueError('PAGE_LIMIT_EXCEEDED')
        return count


def render_pages(path, output):
    count = validate_archive(path)
    progress.report('ofd_render_pages', 'page', 0, count, 1)
    pages = []
    # The renderer remains in the parser's process group: cancellation/shutdown
    # kills both. Keep diagnostics privately, outside the public asset registry.
    with (output / 'ofd-render.log').open('wb') as log:
        try:
            process = subprocess.Popen(renderer_command() + [str(path), str(output)],
                                       stdout=subprocess.PIPE, stderr=log, bufsize=0,
                                       env={**os.environ, 'MALLOC_ARENA_MAX': '2'})
        except OSError:
            raise ValueError('OFD_RENDERER_UNAVAILABLE') from None
        deadline, pending = time.monotonic() + 600, b''
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    if time.monotonic() > deadline:
                        raise ValueError('OFD_RENDER_TIMEOUT')
                    if log.tell() > 16 * 1024**2:
                        raise ValueError('OFD_RENDER_FAILED')
                    if not selector.select(timeout=1):
                        continue
                    data = os.read(process.stdout.fileno(), 65536)
                    if not data:
                        break
                    pending += data
                    if len(pending) > 1024 * 1024:
                        raise ValueError('OFD_RENDER_FAILED')
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        if not line.startswith(b'{'):
                            log.write(line + b'\n'); log.flush()
                            continue
                        try:
                            event = json.loads(line)
                        except ValueError:
                            continue
                        done = event.get('completed', 0)
                        if not done:
                            continue
                        if event.get('total') != count or done != len(pages) + 1:
                            raise ValueError('OFD_PAGE_MAPPING_INVALID')
                        width, height = event.get('width_mm'), event.get('height_mm')
                        if not all(isinstance(v, (float, int)) and math.isfinite(v) and v > 0 for v in (width, height)):
                            raise ValueError('OFD_PAGE_MAPPING_INVALID')
                        target = output / f'ofd-page-{done:04d}.png'
                        if not target.is_file():
                            raise ValueError('OFD_RENDER_FAILED')
                        pages.append(dict(path=target, page=done, width_mm=width, height_mm=height))
                        progress.report('ofd_render_pages', 'page', done, count, min(done+1, count))
            if process.wait(timeout=max(1, deadline-time.monotonic())) != 0:
                raise ValueError('OFD_RENDER_FAILED')
            if len(pages) != count:
                raise ValueError('OFD_PAGE_MAPPING_INVALID')
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
    progress.finish()
    return pages


def raster_preview(pages, output):
    """Lossless raster PDF for the existing page viewer; never reflows the OFD."""
    from PIL import Image
    from pypdf import PdfWriter
    from pypdf.generic import (DictionaryObject, NameObject, NumberObject,
                              DecodedStreamObject, EncodedStreamObject)
    writer = PdfWriter()
    for item in pages:
        width, height = item['width_mm'] * 72/25.4, item['height_mm'] * 72/25.4
        page = writer.add_blank_page(width=width, height=height)
        with Image.open(item['path']) as original:
            rgba = original.convert('RGBA')
            rgb = Image.new('RGB', rgba.size, 'white')
            rgb.paste(rgba, mask=rgba.getchannel('A'))
            stream = EncodedStreamObject()
            stream._data = zlib.compress(rgb.tobytes())
            stream.update({NameObject('/Type'): NameObject('/XObject'),
                           NameObject('/Subtype'): NameObject('/Image'),
                           NameObject('/Width'): NumberObject(rgb.width), NameObject('/Height'): NumberObject(rgb.height),
                           NameObject('/ColorSpace'): NameObject('/DeviceRGB'), NameObject('/BitsPerComponent'): NumberObject(8),
                           NameObject('/Filter'): NameObject('/FlateDecode')})
            rgb.close(); rgba.close()
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/XObject'): DictionaryObject({NameObject('/PageImage'): writer._add_object(stream)})})
        content = DecodedStreamObject()
        content.set_data(f'q {width:.6f} 0 0 {height:.6f} 0 0 cm /PageImage Do Q'.encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(content)
    target = output / 'ofd-preview.pdf'
    temporary = target.with_suffix('.tmp')
    writer.write(temporary)
    writer.close()
    temporary.replace(target)
    return target


def parse_ofd(path, output, config, preview_only=False):
    from PIL import Image
    from paddle import parse_image
    if not preview_only and not config.get('endpoint', '').strip():
        raise ValueError('PARSER_NOT_CONFIGURED')
    pages = render_pages(path, output)
    preview = raster_preview(pages, output)
    blocks, assets = [], []
    for item in pages:
        page, target = item['page'], item['path']
        # Page screenshots are only OCR inputs/previews, never image-understanding sources.
        assets.append(dict(kind='pdf_page', path=str(target), page=page,
                           visual_role='page_preview', source_format='ofd'))
        if preview_only:
            continue
        progress.report('paddle_pages', 'page', page-1, len(pages), page)
        with Image.open(target) as image:
            blocks.extend(parse_image(target, config, {'type': 'page', 'page': page,
                                      'source_format': 'ofd', 'mapping': 'source_page_raster'}, image.size))
        progress.report('paddle_pages', 'page', page, len(pages), page)
    return blocks, assets, str(preview)
