"""Versioned workbook structure, table chunks and verified spreadsheet locations.

The preview always comes from source cells, never from an anydoc text reconstruction.
No formula evaluation, macro execution, or edits to the uploaded workbook occur here.
"""
import datetime
import json
import math
import re
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

import progress
from openpyxl.utils import get_column_letter, range_boundaries, coordinate_to_tuple

PAGE_ROWS = 200
MAX_ROWS = 200000
MAX_CELLS = 2000000
IMAGE_FUNCTION = re.compile(r'^=?(?:_xlfn\.)?(DISPIMG|IMAGE)\(', re.I)


def scalar(value):
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def display_value(value, fmt):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.strftime('%Y-%m-%d %H:%M:%S') if isinstance(value, datetime.datetime) and value.time() != datetime.time() else value.strftime('%Y-%m-%d')
    if isinstance(value, datetime.time):
        return value.isoformat()
    if not isinstance(value, (float, int)):
        return str(value)
    pattern = fmt.split(';')[0].strip()
    if pattern.lower() in ('general', '@', ''):
        return str(int(value)) if float(value).is_integer() else str(value)
    # Only implement formats whose semantics are unambiguous. Retain every
    # original format and report unsupported formats instead of guessing units.
    if re.fullmatch(r'0+(?:\.0+)?%', pattern):
        decimals = len(pattern.split('.')[1].rstrip('%')) if '.' in pattern else 0
        return f'{value * 100:.{decimals}f}%'
    if re.fullmatch(r'(?:#,##)?0+(?:\.[0#]+)?', pattern):
        decimals = len(pattern.split('.')[1]) if '.' in pattern else 0
        text = format(value, f'{"," if "," in pattern else ""}.{decimals}f')
        if '.' in pattern and '#' in pattern.split('.')[1]:
            text = text.rstrip('0').rstrip('.')
        if re.fullmatch('0+', pattern) and float(value).is_integer():
            text = ('-' if value < 0 else '') + str(abs(int(value))).zfill(len(pattern))
        return text
    return str(int(value)) if float(value).is_integer() else str(value)


def make_cell(row, col, value, fmt='General', formula=None, warning=None):
    cell = {'address': f'{get_column_letter(col)}{row}', 'row': row, 'column': col,
            'value': scalar(value), 'display': display_value(value, fmt), 'format': fmt}
    if formula:
        cell['formula'] = formula
        if value is None:
            cell.update(display=formula, warning='FORMULA_CACHE_MISSING')
    if IMAGE_FUNCTION.match(formula or str(value or '')):
        cell['image_formula'] = formula or value
        cell['display'] = ''
    if warning:
        cell['warning'] = warning
    if isinstance(value, (int, float)) and not isinstance(value, bool) and fmt not in ('General', '@', '') and not re.fullmatch(r'(?:#,##)?0+(?:\.[0#]+)?%?', fmt.split(';')[0]):
        cell['warning'] = 'NUMBER_FORMAT_UNSUPPORTED'
    return cell


def read_workbook(path):
    """Read both formats without converting legacy XLS text or renumbering rows."""
    sheets = []
    count = 0
    if path.suffix.lower() == '.xls':
        import xlrd
        book = xlrd.open_workbook(str(path), formatting_info=True, on_demand=True)
        try:
            for index, sheet in enumerate(book.sheets(), 1):
                if sheet.nrows > MAX_ROWS or sheet.nrows * sheet.ncols + count > MAX_CELLS:
                    raise ValueError('SPREADSHEET_CELL_LIMIT_EXCEEDED')
                rows = []
                for r in range(sheet.nrows):
                    cells = []
                    for c in range(sheet.ncols):
                        src = sheet.cell(r, c)
                        if src.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                            continue
                        value = src.value
                        if src.ctype == xlrd.XL_CELL_DATE:
                            value = xlrd.xldate.xldate_as_datetime(value, book.datemode)
                        elif src.ctype == xlrd.XL_CELL_BOOLEAN:
                            value = bool(value)
                        elif src.ctype == xlrd.XL_CELL_ERROR:
                            value = xlrd.error_text_from_code.get(value, '#ERROR')
                        fmt = book.format_map[book.xf_list[src.xf_index].format_key].format_str
                        cells.append(make_cell(r+1, c+1, value, fmt))
                    if cells:
                        rows.append({'row': r+1, 'cells': cells})
                    progress.report('read_spreadsheet', 'row', r+1, sheet.nrows, r+1, sheet=sheet.name, sheet_index=index, sheets=len(book.sheet_names()))
                count += sheet.nrows * sheet.ncols
                merges = [f'{get_column_letter(c1+1)}{r1+1}:{get_column_letter(c2)}{r2}' for r1,r2,c1,c2 in sheet.merged_cells]
                sheets.append(dict(id=str(index), name=sheet.name, rows=rows, row_count=sheet.nrows, column_count=sheet.ncols, merged_ranges=merges, hidden=bool(sheet.visibility)))
        finally:
            book.release_resources()
    else:
        import openpyxl
        # Merged ranges are absent from read-only worksheets; read only these
        # descriptors from the package, while streaming values using openpyxl.
        from embedded_images import relationships
        with zipfile.ZipFile(path) as archive:
            refs = relationships(archive, 'xl/workbook.xml')
            desc = ET.fromstring(archive.read('xl/workbook.xml'))
            merges, dimensions = {}, {}
            for sheet in desc.findall('./{*}sheets/{*}sheet'):
                part = refs.get(sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'))
                ranges, last_row, last_col = [], 0, 0
                if part:
                    with archive.open(part) as stream:
                        for _, elem in ET.iterparse(stream, events=('end',)):
                            if elem.tag.endswith('}mergeCell'):
                                ranges.append(elem.get('ref'))
                                _,_,c,r = range_boundaries(elem.get('ref'))
                                last_row,last_col=max(last_row,r),max(last_col,c)
                            elif elem.tag.endswith('}c') and elem.get('r'):
                                r,c = coordinate_to_tuple(elem.get('r'))
                                last_row,last_col=max(last_row,r),max(last_col,c)
                            if last_row > MAX_ROWS or last_row * last_col > MAX_CELLS:
                                raise ValueError('SPREADSHEET_CELL_LIMIT_EXCEEDED')
                            elem.clear()
                merges[sheet.get('name')] = ranges
                dimensions[sheet.get('name')] = (last_row,last_col)
        book = openpyxl.load_workbook(path, read_only=True, data_only=False)
        cached = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            for index, sheet in enumerate(book, 1):
                actual_row,actual_col = dimensions.get(sheet.title,(0,0))
                max_row, max_col = max(sheet.max_row or 0,actual_row), max(sheet.max_column or 0,actual_col)
                if max_row > MAX_ROWS or max_row * max_col + count > MAX_CELLS:
                    raise ValueError('SPREADSHEET_CELL_LIMIT_EXCEEDED')
                rows = []
                for r, (row, values) in enumerate(zip(sheet.iter_rows(max_row=max_row,max_col=max_col), cached[sheet.title].iter_rows(max_row=max_row,max_col=max_col)), 1):
                    cells = []
                    for c, (src, result) in enumerate(zip(row, values), 1):
                        if src.value is None:
                            continue
                        formula = str(src.value) if src.data_type == 'f' else None
                        cells.append(make_cell(r, c, result.value if formula else src.value, src.number_format, formula))
                    if cells:
                        rows.append({'row': r, 'cells': cells})
                    progress.report('read_spreadsheet', 'row', r, max_row, r, sheet=sheet.title, sheet_index=index, sheets=len(book.sheetnames))
                count += max_row * max_col
                sheets.append(dict(id=str(index), name=sheet.title, rows=rows, row_count=max_row, column_count=max_col, merged_ranges=merges.get(sheet.title, []), hidden=sheet.sheet_state != 'visible'))
        finally:
            book.close()
            cached.close()
    return sheets


def save_structure(sheets, output):
    folder = output / 'spreadsheet'
    folder.mkdir(exist_ok=True)
    result = {'version': 1, 'page_rows': PAGE_ROWS, 'path': str(folder), 'sheets': []}
    for sheet in sheets:
        pages = {}
        for row in sheet['rows']:
            page = (row['row']-1)//PAGE_ROWS
            pages.setdefault(page, []).append(row)
        for page, rows in pages.items():
            (folder / f'{sheet["id"]}-{page}.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        meta = {k:v for k,v in sheet.items() if k != 'rows'}
        meta['pages'] = sorted(pages)
        result['sheets'].append(meta)
    manifest = folder / 'manifest.tmp'
    manifest.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    manifest.replace(folder / 'manifest.json')
    return result


def locator(sheet, r1, r2, c1, c2, **extra):
    return dict(type='sheet', sheet_id=sheet['id'], sheet=sheet['name'], row_start=r1, row_end=r2,
                column_start=c1, column_end=c2, cell_range=f'{get_column_letter(c1)}{r1}:{get_column_letter(c2)}{r2}', mapping='exact', **extra)


def table_text(rows, columns):
    def escape(value):
        return str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('|', '&#124;').replace('\r\n', '\n').replace('\n', '<br>')
    return '| ' + ' | '.join(get_column_letter(c) for c in columns) + ' |\n|' + '|'.join(' --- ' for _ in columns) + '|\n' + '\n'.join('| ' + ' | '.join(escape(row.get(c, '')) for c in columns) + ' |' for row in rows)


def header_rows(options, sheet):
    strategy = options.get('excel', {})
    selected = strategy.get('sheets', {}).get(sheet['name'], {})
    return selected.get('header_rows', strategy.get('header_rows', []))


def source_rows(sheets):
    result = []
    for sheet in sheets:
        for row in sheet['rows']:
            values = {c['column']: c['display'] for c in row['cells'] if c['display']}
            if values:
                result.append({'sheet': sheet, 'row': row['row'], 'values': values, 'cells': row['cells']})
    return result


def anydoc_rows(document, sheets):
    """Only an unambiguous match establishes a source location, including repeats."""
    from anydoc_adapter import flatten, inline_text
    reference = source_rows(sheets)
    normalize = lambda values: re.sub(r'\s+', '', '\x1f'.join(str(v) for v in values))
    by_signature = {}
    for row in reference:
        values = [row['values'].get(c, '') for c in range(1, max(row['values'])+1)]
        by_signature.setdefault(normalize(values), []).append(row)
    out = []
    scope = None
    table_index = 0
    def walk(items):
        nonlocal scope, table_index
        for item in items:
            if item.kind == 'heading':
                text = inline_text(item.content)
                scope = next((s['name'] for s in sheets if text.strip() == s['name']), None)
            elif item.kind == 'table':
                table_index += 1
                for row in item.table.grid:
                    values = [' '.join(t for t,_ in flatten(slot.cell.blocks, include_image_alt=False)) if slot.kind == 'origin' else '' for slot in row]
                    values = ['' if IMAGE_FUNCTION.match(v) else v for v in values]
                    while values and not values[-1]:
                        values.pop()
                    if not any(values):
                        continue
                    candidates = by_signature.get(normalize(values), [])
                    if scope:
                        candidates = [r for r in candidates if r['sheet']['name'] == scope]
                    matched = candidates[0] if len(candidates) == 1 else None
                    out.append({**(matched or {}), 'values': {i+1:v for i,v in enumerate(values)}, 'table_index':table_index})
            elif item.kind in ('paragraph', 'code_block', 'math'):
                text = inline_text(item.content, False) if item.kind == 'paragraph' else item.text
                if text and text.strip():
                    out.append({'unmatched_text':text})
            elif item.kind == 'list':
                for child in item.list.items:
                    walk(child.blocks)
            elif item.kind == 'block_quote':
                walk(item.blocks or [])
    walk(document.blocks)
    return out


def chunks(rows, options, engine):
    size = int(options.get('chunk_size', 512))
    blocks, group = [], []
    sheet_context = {}
    for row in rows:
        sheet = row.get('sheet')
        if sheet and sheet['id'] not in sheet_context:
            selected = set(header_rows(options, sheet))
            sheet_context[sheet['id']] = ([r for r in sheet['rows'] if r['row'] in selected], {c['address']:c for r in sheet['rows'] for c in r['cells']})
    def emit():
        if not group:
            return
        first = group[0]
        sheet = first.get('sheet')
        columns = sorted({c for row in group for c in row['values']})
        refs = []
        context = ''
        if sheet:
            context = '工作表：' + sheet['name'] + '\n'
            for hr in sheet_context[sheet['id']][0]:
                vals = {c['column']:c['display'] for c in hr['cells'] if c['display']}
                if vals:
                    label = '；'.join(f'{get_column_letter(c)}：{v}' for c,v in vals.items())
                    refs.append({'text':label, 'locator':locator(sheet, hr['row'],hr['row'],min(vals),max(vals),role='header')})
                    context += '表头：' + label + '\n'
        loc = locator(sheet, first['row'], group[-1]['row'], min(columns), max(columns)) if sheet else {'type':'document','mapping':'unverified','parsed_block':len(blocks)+1}
        # Merged context is appended with its own source, never copied into the
        # physical cells exposed by the preview or assigned the child's address.
        if sheet:
            cells_by_address = sheet_context[sheet['id']][1]
            for merged in sheet['merged_ranges']:
                c1,r1,c2,r2 = range_boundaries(merged)
                if r1 < first['row'] <= r2:
                    master = cells_by_address.get(f'{get_column_letter(c1)}{r1}')
                    if master and master['display']:
                        text = master['address'] + '：' + master['display']
                        refs.append({'text':text,'locator':locator(sheet,r1,r1,c1,c1,role='merged_master',merged_range=merged)})
                        context += '合并区域上下文：' + text + '\n'
        blocks.append(dict(text=table_text([r['values'] for r in group], columns), method=engine, block_type='spreadsheet',
                           locator=loc, precision='range' if sheet else 'document', level=0,
                           cells=[c for r in group for c in r.get('cells', [])], context_text=context, context_sources=refs,
                           warning=None if sheet else 'SPREADSHEET_POSITION_UNVERIFIED'))
        group.clear()
    for row in rows:
        if 'unmatched_text' in row:
            emit()
            blocks.append(dict(text=row['unmatched_text'], method=engine, locator={'type':'document','mapping':'unverified'}, precision='document', level=0, warning='SPREADSHEET_POSITION_UNVERIFIED'))
            continue
        # A long cell is split as text, with exactly the same verified cell
        # address on each segment. Do not split serialized markup.
        if any(len(v) > size for v in row['values'].values()):
            emit()
            for col, value in row['values'].items():
                for start in range(0, len(value), size):
                    part = dict(row, values={col:value[start:start+size]})
                    group.append(part)
                    emit()
            continue
        if group:
            previous = group[-1]
            same_sheet = row.get('sheet') is previous.get('sheet')
            contiguous = row.get('row',0) == previous.get('row',0)+1 if row.get('sheet') else row.get('table_index') == previous.get('table_index')
            length = sum(sum(len(v) for v in r['values'].values())+len(r['values'])*5 for r in group+[row])
            headers = set(header_rows(options, row['sheet'])) if row.get('sheet') else set()
            header_boundary = (row.get('row') in headers) != (previous.get('row') in headers)
            if not same_sheet or not contiguous or length > size or header_boundary:
                emit()
        group.append(row)
    emit()
    return blocks


def images(path, output, sheets, document=None):
    from embedded_images import package_images, relationships, save_image
    blocks, assets, warnings = [], [], []
    try:
        occurrences, assets = package_images(path, output)
    except Exception as error:
        occurrences = []
        reason = str(error) if re.fullmatch('[A-Z_]+',str(error)) else type(error).__name__
        warnings.append({'code':'SPREADSHEET_IMAGE_EXTRACTION_FAILED','reason':reason,
                         'message':'表格文字与原始行列已保留，但图片补提失败（'+reason+'）；请检查转换工具或文件内的图片对象。'})
    # WPS DISPIMG stores images in a separate OOXML cellimages part, not in
    # the worksheet drawing relationship used by regular embedded pictures.
    if path.suffix.lower() == '.xlsx':
        with zipfile.ZipFile(path) as archive:
            part = 'xl/cellimages.xml'
            cell_images = {}
            if part in archive.namelist():
                rels = relationships(archive, part)
                for pic in ET.fromstring(archive.read(part)).findall('.//{*}pic'):
                    prop, blip = pic.find('.//{*}cNvPr'), pic.find('.//{*}blip')
                    if prop is not None and blip is not None:
                        target = rels.get(blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'))
                        if target and target in archive.namelist():
                            cell_images[prop.get('name')] = target
            for sheet in sheets:
                for row in sheet['rows']:
                    for cell in row['cells']:
                        if not cell.get('image_formula'):
                            continue
                        match = re.search(r'DISPIMG\("([^"]+)"', cell['image_formula'], re.I)
                        part = cell_images.get(match[1]) if match else None
                        target = save_image(archive.read(part), output, 'cell-image-'+str(sheet['id'])+'-'+cell['address'], part=part) if part else None
                        if target:
                            assets.append(dict(kind='image',path=str(target),origin_part=part,visual_role='embedded_image'))
                            occurrences.append(dict(image_path=str(target),locator=locator(sheet,cell['row'],cell['row'],cell['column'],cell['column']),part=part))
                        else:
                            cell['warning'] = 'CELL_IMAGE_UNAVAILABLE'
                            warnings.append(dict(code='CELL_IMAGE_UNAVAILABLE',sheet=sheet['name'],cell=cell['address']))
            if any(n.startswith('xl/charts/') and n.endswith('.xml') for n in archive.namelist()):
                warnings.append({'code':'CHART_OBJECT_NOT_RENDERED','message':'工作簿包含图表对象；单元格数据已读取，图表未作为图片还原。'})
    for i, item in enumerate(occurrences):
        loc = dict(item['locator'])
        sheet = next((s for s in sheets if s['name'] == loc.get('sheet')), None)
        if sheet:
            loc['sheet_id'] = sheet['id']
            if loc.get('row') and loc.get('column'):
                loc.update(row_start=loc['row'], row_end=loc['row'], column_start=loc['column'],column_end=loc['column'])
            loc.setdefault('mapping', 'exact')
        if item['image_path']:
            blocks.append(dict(text='',method='excel',block_type='image',visual_role='embedded_image',image_path=str(item['image_path']),locator=loc,
                               precision='range' if loc.get('mapping')=='exact' else 'document',level=0,layout={'unplaced':not sheet or loc.get('mapping')!='exact'}))
        else:
            warnings.append(dict(code='IMAGE_ASSET_UNAVAILABLE',sheet=loc.get('sheet')))
        progress.report('extract_assets','asset',i+1,len(occurrences),i+1)
    if document is not None:
        # Retain anydoc-only assets as explicitly unplaced images; no invented
        # cell address, and no duplicate bytes of already extracted pictures.
        from embedded_images import pixel_identity
        known = {pixel_identity(a['path']) for a in assets if a.get('path')}
        for asset in document.assets:
            if not asset.media_type.startswith('image/'):
                continue
            target = save_image(asset.data,output,'anydoc-'+asset.id,asset.media_type,asset.origin_part or '')
            if target and pixel_identity(target) not in known:
                known.add(pixel_identity(target))
                assets.append(dict(kind='image',path=str(target),visual_role='embedded_image'))
                blocks.append(dict(text='',method='anydoc',block_type='image',visual_role='embedded_image',image_path=str(target),locator={'type':'document','mapping':'unverified'},precision='document',level=0,layout={'unplaced':True}))
    return blocks, assets, warnings


def parse_spreadsheet(path, output, options, engine):
    # anydoc failure must remain a failure. Structure extraction is verification,
    # not a silent alternative implementation of the chosen engine.
    sheets = read_workbook(path)
    document = None
    if engine == 'anydoc':
        from anydoc_adapter import load_document
        progress.report('anydoc_extract')
        document = load_document(path)
    if options.get('_structure_only'):
        return {'spreadsheet':save_structure(sheets,output),'engine':engine,'blocks':[],'assets':[],'outline':[]}
    rows = anydoc_rows(document,sheets) if document is not None else source_rows(sheets)
    blocks = chunks(rows,options,engine)
    picture_blocks, assets, warnings = images(path,output,sheets,document)
    # Place at a verified row range. Converted anchors remain an explicit
    # appendix, and the API does not associate them with original row chunks.
    for picture in picture_blocks:
        loc = picture['locator']
        anchor = loc.get('row_start')
        at = next((i for i,b in enumerate(blocks) if anchor and loc.get('mapping')=='exact' and b['locator'].get('sheet_id')==loc.get('sheet_id') and b['locator'].get('row_start',0)<=anchor<=b['locator'].get('row_end',0)),None)
        if at is None:
            picture['layout']['unplaced'] = True
            blocks.append(picture)
        else:
            blocks.insert(at+1,picture)
    for sheet in sheets:
        counts = Counter(c['warning'] for row in sheet['rows'] for c in row['cells'] if c.get('warning'))
        warnings.extend({'code':code,'sheet':sheet['name'],'count':n} for code,n in counts.items())
    if path.suffix.lower()=='.xls':
        warnings.append({'code':'XLS_FORMULA_TEXT_UNAVAILABLE','message':'XLS 读取已保存的计算值，不提供原始公式文本。'})
    return dict(blocks=blocks,assets=assets,engine=engine,spreadsheet=save_structure(sheets,output),warnings=warnings,
                outline=[dict(title=s['name'],level=1,locator=locator(s,1,max(1,s['row_count']),1,max(1,s['column_count'])),method='sheet_structure') for s in sheets])
