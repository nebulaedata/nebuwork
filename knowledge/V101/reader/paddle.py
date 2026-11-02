"""Adapter for the PaddleOCR-VL pipeline /layout-parsing API (not a chat endpoint).

Reference: https://www.paddleocr.ai/v3.6.0/en/version3.x/pipeline_usage/PaddleOCR-VL.html
Pages are submitted separately so source page numbers never depend on upstream truncation.
"""
import base64
import json
import math
import re
import progress
from urllib import request, error


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def parse_image(path, config, locator, image_size):
    endpoint = config.get('endpoint', '').rstrip('/')
    if not endpoint:
        raise ValueError('PARSER_NOT_CONFIGURED')
    if not endpoint.endswith('/layout-parsing'):
        endpoint += '/layout-parsing'
    payload = {
        'file': base64.b64encode(path.read_bytes()).decode('ascii'), 'fileType': 1,
        # Keep coordinates in the submitted image frame for source highlighting.
        'useDocOrientationClassify': False, 'useDocUnwarping': False,
        'useLayoutDetection': True, 'useOcrForImageBlock': True,
        'useSealRecognition': config.get('use_seal_recognition', True),
        'useChartRecognition': config.get('use_chart_recognition', False),
        'visualize': False,
    }
    req = request.Request(endpoint, json.dumps(payload).encode(), {'Content-Type': 'application/json'})
    try:
        with request.build_opener(NoRedirect()).open(req, timeout=300) as response:
            raw = response.read(32*1024**2+1)
            if len(raw)>32*1024**2:
                raise ValueError('PADDLE_RESPONSE_TOO_LARGE')
            result = json.loads(raw)
    except (error.URLError, TimeoutError, OSError):
        raise ValueError('PADDLE_REQUEST_FAILED') from None
    except json.JSONDecodeError:
        raise ValueError('PADDLE_RESPONSE_INVALID') from None
    if not isinstance(result, dict) or result.get('errorCode', 0) != 0:
        raise ValueError('PADDLE_REQUEST_FAILED')
    pages = result.get('result', {}).get('layoutParsingResults')
    if not isinstance(pages, list) or len(pages) != 1:
        raise ValueError('PADDLE_RESPONSE_INVALID')
    return layout_blocks(path, pages[0], locator, image_size)


VISUAL_LABELS = {'image', 'figure', 'chart', 'seal', 'header_image', 'footer_image'}


def layout_blocks(path, page, locator, image_size):
    """Keep page coordinates; crop only detected visual regions, never PDF pages."""
    pruned = page.get('prunedResult', {})
    items = pruned.get('parsing_res_list')
    is_page = 'page' in locator
    if not isinstance(items, list):
        if is_page:
            raise ValueError('PADDLE_LAYOUT_REQUIRED')
        text = page.get('markdown', {}).get('text')
        if not isinstance(text, str):
            raise ValueError('PADDLE_RESPONSE_INVALID')
        items = [{'block_content': text}]
    width, height = pruned.get('width', image_size[0]), pruned.get('height', image_size[1])
    blocks = []
    for index, item in enumerate(items):
        text = item.get('block_content', '')
        if not isinstance(text, str):
            raise ValueError('PADDLE_RESPONSE_INVALID')
        label = str(item.get('block_label', 'text')).lower()
        kind = 'image' if label in VISUAL_LABELS else 'table' if label == 'table' else 'text'
        position = dict(locator)
        precision = 'page' if is_page else 'region'
        bbox = item.get('block_bbox')
        if (isinstance(bbox, list) and len(bbox) == 4 and
                all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in bbox) and
                all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in (width, height)) and
                0 <= bbox[0] < bbox[2] <= width and 0 <= bbox[1] < bbox[3] <= height):
            position['bbox'] = [bbox[0]/width, bbox[1]/height, bbox[2]/width, bbox[3]/height]
            precision = 'region'
        image_path, role, warning = '', '', ''
        if is_page and kind == 'image':
            if 'bbox' not in position:
                raise ValueError('PADDLE_IMAGE_BBOX_INVALID')
            # Image links are placeholders, not OCR text; never fetch upstream URLs.
            text = re.sub(r'!\[[^\]]*\]\([^\n]*?\)|<img\b[^>]*>', '', text, flags=re.I).strip()
            normalized = position['bbox']
            if (normalized[2]-normalized[0])*(normalized[3]-normalized[1]) >= .98:
                warning = 'PAGE_IMAGE_NOT_CROPPED'
            else:
                from PIL import Image
                with Image.open(path) as original:
                    w, h = original.size
                    box = (math.floor(normalized[0]*w), math.floor(normalized[1]*h),
                           math.ceil(normalized[2]*w), math.ceil(normalized[3]*h))
                    target = path.with_name(f'{path.stem}-region-{index+1}.png')
                    with original.crop(box) as cropped:
                        cropped.save(target)
                image_path, role = str(target), 'image_region'
                position.update(type='image', region_id=f'page-{locator["page"]}-block-{index+1}')
        elif not is_page:
            image_path, role = str(path), 'standalone_image'
        level = 1 if label == 'doc_title' else 2 if label in ('paragraph_title', 'section_title') else 0
        blocks.append(dict(text=text, locator=position, precision=precision, level=level,
                           title=text if level else None, method='paddleocr_vl', image_path=image_path,
                           block_type=kind, visual_role=role, warning=warning,
                           layout={'label': label, 'id': item.get('block_id'),
                                   'order': item.get('block_order'), 'index': index}))
    return blocks


def parse_pdf(path, output, config):
    import pypdfium2
    blocks, assets = [], []
    with pypdfium2.PdfDocument(path) as pdf:
        if len(pdf)>3000:
            raise ValueError('PAGE_LIMIT_EXCEEDED')
        for index in range(len(pdf)):
            progress.report('paddle_pages', 'page', index, len(pdf), index+1)
            page = pdf[index]
            scale = min(2, 2400/max(page.get_size()))
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            target = output / f'paddle-page-{index+1}.png'
            image.save(target)
            assets.append({'kind': 'pdf_page', 'path': str(target), 'page': index+1, 'visual_role': 'page_preview'})
            try:
                blocks.extend(parse_image(target, config, {'type': 'page', 'page': index+1}, image.size))
            finally:
                image.close(); bitmap.close(); page.close()
            progress.report('paddle_pages', 'page', index+1, len(pdf), index+1)
    return blocks, assets
