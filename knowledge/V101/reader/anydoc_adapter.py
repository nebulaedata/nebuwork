"""Local anydoc binding with verified source matching, never invented page numbers."""
import io
import re
import subprocess
import progress


def inline_text(items, include_image_alt=True):
    out = []
    for item in items or []:
        if item.kind in ('text', 'math'):
            out.append(item.text or '')
        elif item.kind == 'link':
            out.append(inline_text(item.content, include_image_alt))
        elif item.kind == 'line_break':
            out.append('\n')
        elif item.kind == 'image':
            out.append((item.alt or '') if include_image_alt else '')
        elif item.kind == 'checkbox':
            out.append('[x]' if item.checked else '[ ]')
    return ''.join(out)


def flatten(items, depth=0, include_image_alt=True):
    if depth > 64:
        raise ValueError('DOCUMENT_DEPTH_LIMIT')
    for item in items:
        if item.kind in ('paragraph', 'heading'):
            yield inline_text(item.content, include_image_alt), item.level or 0
        elif item.kind in ('code_block', 'math'):
            yield item.text or '', 0
        elif item.kind == 'table':
            for row in item.table.grid:
                cells = [' '.join(text for text, _ in flatten(slot.cell.blocks, depth+1, include_image_alt))
                         if slot.kind == 'origin' else '' for slot in row]
                yield ' | '.join(cells), 0
        elif item.kind == 'list':
            for child in item.list.items:
                yield from flatten(child.blocks, depth+1, include_image_alt)
        elif item.kind == 'block_quote':
            yield from flatten(item.blocks or [], depth+1, include_image_alt)


def inline_segments(items):
    text = ''
    for item in items or []:
        if item.kind == 'image':
            if text:
                yield text, None
                text = ''
            yield '', item
        elif item.kind == 'link':
            for content, image in inline_segments(item.content):
                if image is None:
                    text += content
                else:
                    if text:
                        yield text, None
                        text = ''
                    yield '', image
        else:
            text += inline_text([item], False)
    if text:
        yield text, None


def rich_blocks(items, depth=0):
    if depth > 64:
        raise ValueError('DOCUMENT_DEPTH_LIMIT')
    for item in items:
        if item.kind in ('paragraph', 'heading'):
            for text, image in inline_segments(item.content):
                yield text, item.level or 0, image
        elif item.kind in ('code_block', 'math'):
            yield item.text or '', 0, None
        elif item.kind == 'table':
            for row in item.table.grid:
                cells = [' '.join(text for text, _ in flatten(slot.cell.blocks, depth+1, False))
                         if slot.kind == 'origin' else '' for slot in row]
                yield ' | '.join(cells), 0, None
                for slot in row:
                    if slot.kind == 'origin':
                        for text, level, image in rich_blocks(slot.cell.blocks, depth+1):
                            if image is not None:
                                yield '', 0, image
        elif item.kind == 'list':
            for child in item.list.items:
                yield from rich_blocks(child.blocks, depth+1)
        elif item.kind == 'block_quote':
            yield from rich_blocks(item.blocks or [], depth+1)


def load_document(path):
    import anydoc
    try:
        return anydoc.to_document(path.read_bytes(), anydoc.format_from_extension(path.suffix))
    except anydoc.ConvertError as error:
        code = re.sub(r'(?<!^)(?=[A-Z])', '_', type(error).__name__).upper()
        raise ValueError('ANYDOC_' + code) from None


def legacy_image_bindings(path):
    """Exact old flatten indexes for metadata-only repair; never match by alt alone."""
    from collections import Counter
    from embedded_images import image_positions
    document = load_document(path)
    assets = {a.id: a for a in document.assets}

    def units(items, depth=0):
        if depth > 64:
            raise ValueError('DOCUMENT_DEPTH_LIMIT')
        for item in items:
            if item.kind in ('paragraph', 'heading'):
                images = [image for _, image in inline_segments(item.content) if image is not None]
                yield inline_text(item.content), images, not inline_text(item.content, False).strip()
            elif item.kind in ('code_block', 'math'):
                yield item.text or '', [], False
            elif item.kind == 'table':
                for row in item.table.grid:
                    nested = [list(units(slot.cell.blocks, depth+1)) if slot.kind == 'origin' else [] for slot in row]
                    text = ' | '.join(' '.join(v[0] for v in cell) for cell in nested)
                    yield text, [image for cell in nested for _, images, _ in cell for image in images], False
            elif item.kind == 'list':
                for child in item.list.items:
                    yield from units(child.blocks, depth+1)
            elif item.kind == 'block_quote':
                yield from units(item.blocks or [], depth+1)

    content = list(units(document.blocks))
    for note in document.notes:
        content.extend(units(note.blocks))
    occurrences = {}
    for p in image_positions(path):
        occurrences.setdefault(p['part'], []).append(p['locator'])
    counts = Counter(assets[image.source.asset_id].origin_part for _, images, _ in content for image in images
                     if image.source and image.source.kind == 'asset' and image.source.asset_id in assets)
    occurrences = {part: locators for part, locators in occurrences.items() if len(locators)==counts[part]}
    result = []
    for index, (text, images, reference_only) in enumerate(content, 1):
        bound = []
        for image in images:
            if not image.source or image.source.kind != 'asset' or image.source.asset_id not in assets:
                continue
            asset = assets[image.source.asset_id]
            positions = occurrences.get(asset.origin_part, [])
            locator = dict(positions.pop(0)) if positions else {'type':'document'}
            locator.update(parser='anydoc', parsed_block=index, asset_id=asset.id, part=asset.origin_part)
            bound.append({'part':asset.origin_part,'asset_id':asset.id,'alt':image.alt or '', 'locator':locator})
        if bound:
            result.append({'parsed_block':index,'text':text,'reference_only':reference_only,'images':bound})
    return result


def parse_anydoc(path, output, options, native_reference):
    from embedded_images import image_positions, save_image, package_images, insert_image_blocks, pixel_identity
    progress.report('anydoc_extract')
    document = load_document(path)
    progress.report('source_positions')
    reference = native_reference()
    normalized = lambda text: re.sub(r'\s+', '', text)
    refs = [(normalized(b['text']), b) for b in reference if b['text'].strip()]
    positions = image_positions(path)
    available = {}
    for position in positions:
        available.setdefault(position['part'], []).append(position['locator'])
    blocks, assets, images = [], [], {}
    for index, asset in enumerate(document.assets):
        progress.report('extract_assets', 'asset', index, len(document.assets), index+1)
        if not asset.media_type.startswith('image/'):
            continue
        target = save_image(asset.data, output, f'anydoc-image-{asset.id}', asset.media_type, asset.origin_part or '')
        if not target:
            target = output / f'anydoc-asset-{asset.id}.bin'
            target.write_bytes(asset.data)
            assets.append(dict(kind='embedded_object', path=str(target), media_type=asset.media_type, origin_part=asset.origin_part))
            continue
        images[asset.id] = {'path': str(target), 'part': asset.origin_part}
        assets.append(dict(kind='image', path=str(target), origin_part=asset.origin_part, visual_role='embedded_image'))
    if document.assets:
        progress.report('extract_assets', 'asset', len(document.assets), len(document.assets))
    content = list(rich_blocks(document.blocks))
    for note in document.notes:
        content.extend(rich_blocks(note.blocks))
    # Only use occurrence order when both readers report the same number of uses.
    # An omitted drawing must not shift the location of later instances.
    from collections import Counter
    counts = Counter(images[image.source.asset_id]['part'] for _, _, image in content
                     if image is not None and image.source and image.source.kind == 'asset' and image.source.asset_id in images)
    all_positions = {part:list(locators) for part,locators in available.items()}
    available = {part: locators for part, locators in available.items() if len(locators) == counts[part]}
    used = set()
    for index, (text, level, image) in enumerate(content, 1):
        progress.report('match_blocks', 'block', index-1, len(content), index)
        if image is not None:
            asset_id = image.source.asset_id if image.source and image.source.kind == 'asset' else None
            asset = images.get(asset_id)
            if not asset:
                blocks.append(dict(text=image.alt or '图片资源不可用', locator={'type':'document','parsed_block':index},
                                   precision='document', level=0, method='anydoc', warning='IMAGE_ASSET_UNAVAILABLE'))
                continue
            used.add(asset_id)
            candidates = available.get(asset['part'], [])
            locator = dict(candidates.pop(0)) if candidates else {'type':'document'}
            locator.update(parser='anydoc', parsed_block=index, asset_id=asset_id, part=asset['part'])
            blocks.append(dict(text='', locator=locator, precision='range' if locator['type']!='document' else 'document',
                               level=0, method='anydoc', image_path=asset['path'], block_type='image',
                               visual_role='embedded_image', layout={'image_alt':image.alt or '', 'asset_id':asset_id}))
            continue
        if not text.strip():
            continue
        needle = normalized(text)
        exact = [b for original, b in refs if needle == original]
        candidates = exact if exact else [b for original, b in refs if needle and needle in original]
        source = candidates[0] if len(candidates) == 1 else None
        locator = dict(source['locator']) if source else {'type': 'document', 'parsed_block': index}
        locator['parser'] = 'anydoc'
        blocks.append(dict(text=text, locator=locator, precision=source['precision'] if source else 'document',
                           level=level, title=text if level else None, method='anydoc',
                           **({'cells': source['cells']} if source and source.get('cells') else {})))
    # Retain images not represented in the content tree. Verify their structural
    # location when possible; never treat the end of the text as their position.
    supplemental = []
    for asset_id, asset in images.items():
        if asset_id not in used:
            for loc in all_positions.get(asset['part']) or [{'type':'document','part':asset['part']}]:
                supplemental.append(dict(text='', locator={**loc,'asset_id':asset_id},
                                         precision='range' if loc['type']!='document' else 'document', level=0,
                                         method='anydoc', image_path=asset['path'], block_type='image', visual_role='embedded_image'))
    # Some readers (notably spreadsheets) omit drawings from both their content
    # tree and assets. Read the package relationships rather than guessing by alt.
    known = {a.get('origin_part') for a in assets if a['kind']=='image'}
    missing = [p for p in positions if p['part'] not in known]
    if missing or path.suffix.lower() in ('.xls','.doc','.ppt'):
        try:
            occurrences, extracted = package_images(path, output)
        except (OSError, ValueError, subprocess.SubprocessError):
            occurrences, extracted = [], []
            supplemental.append(dict(text='',locator={'type':'document'},precision='document',level=0,
                                     method='anydoc',warning='IMAGE_EXTRACTION_FAILED'))
        originals={pixel_identity(a['path']):a for a in assets if a['kind']=='image'}
        recovered={}
        for asset in extracted:
            if asset['origin_part'] in known:
                continue
            same=originals.get(pixel_identity(asset['path']))
            if same:
                recovered[asset['path']]=same
            else:
                assets.append(asset)
        # Replace coarse orphan locations with verified occurrences when exact
        # decoded image content matches. Do not add duplicate copies of pictures.
        reused={a['path'] for a in recovered.values()}
        supplemental=[b for b in supplemental if b['image_path'] not in reused]
        for p in occurrences:
            if not p['image_path']:
                supplemental.append(dict(text='',locator=p['locator'],precision='document',level=0,method='anydoc',warning='IMAGE_ASSET_UNAVAILABLE'))
                continue
            if p['part'] not in known and p['image_path']:
                same=recovered.get(p['image_path'])
                if same and any(b.get('image_path')==same['path'] for b in blocks):
                    continue
                supplemental.append(dict(text='', locator=p['locator'], precision='range', level=0, method='anydoc',
                                         image_path=same['path'] if same else p['image_path'],block_type='image',visual_role='embedded_image',
                                         layout={'anchor_before_text':p['anchor_before_text']} if p.get('anchor_before_text') else {}))
    blocks = insert_image_blocks(blocks, supplemental)
    progress.report('match_blocks', 'block', len(content), len(content))
    return blocks, assets
