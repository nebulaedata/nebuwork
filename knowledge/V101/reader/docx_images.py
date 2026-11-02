"""DOCX image occurrences from OOXML relationships, without guessed PDF pages."""
import posixpath
import zipfile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
V = '{urn:schemas-microsoft-com:vml}'


def image_positions(path):
    if path.suffix.lower() not in ('.docx', '.docm'):
        return []
    with zipfile.ZipFile(path) as archive:
        if 'word/_rels/document.xml.rels' not in archive.namelist():
            return []
        relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
        refs = {}
        for rel in relationships:
            if rel.get('TargetMode') == 'External' or not rel.get('Type', '').endswith('/image'):
                continue
            target = rel.get('Target', '')
            part = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join('word', target))
            if part.startswith('word/') and part in archive.namelist():
                refs[rel.get('Id')] = part
        body = ET.fromstring(archive.read('word/document.xml')).find(W+'body')
        found = []

        def paragraph_images(node, locator):
            # Standard drawings and legacy VML refer to package assets, not alt text.
            for image in node.iter():
                if image.tag == A+'blip':
                    rel_id = image.get(R+'embed')
                elif image.tag == V+'imagedata':
                    rel_id = image.get(R+'id')
                else:
                    continue
                part = refs.get(rel_id)
                if part:
                    found.append({'part': part, 'locator': {**locator, 'part': part,
                                  'image_occurrence': len(found)+1, 'relationship_id': rel_id}})

        paragraphs, tables = 0, 0
        if body is None:
            return found
        for child in body:
            if child.tag == W+'p':
                paragraphs += 1
                paragraph_images(child, {'type': 'paragraph', 'paragraph_id': str(paragraphs)})
            elif child.tag == W+'tbl':
                tables += 1
                for row, tr in enumerate(child.findall(W+'tr'), 1):
                    column = 1
                    for tc in tr.findall(W+'tc'):
                        for number, p in enumerate(tc.findall(W+'p'), 1):
                            paragraph_images(p, {'type': 'table', 'table_id': str(tables), 'row': row,
                                                'column': column, 'cell_paragraph': number,
                                                'after_paragraph_id': str(paragraphs)})
                        span = tc.find(W+'tcPr/'+W+'gridSpan')
                        column += int(span.get(W+'val', '1')) if span is not None else 1
        return found


def extract_native_images(path, output):
    import hashlib
    import io
    from embedded_images import save_image
    positions = image_positions(path)
    assets, files = [], {}
    with zipfile.ZipFile(path) as archive:
        for position in positions:
            part = position['part']
            if part not in files:
                raw = archive.read(part)
                name = hashlib.sha256(part.encode()).hexdigest()[:20]
                converted = save_image(raw, output, f'docx-image-{name}', part=part)
                if converted:
                    files[part] = converted
                    assets.append({'kind':'image','path':converted,'origin_part':part,'visual_role':'embedded_image'})
                else:
                    target = output / f'docx-object-{name}.bin'
                    target.write_bytes(raw)
                    files[part] = ''
                    assets.append({'kind':'embedded_object','path':str(target),'origin_part':part})
            position['image_path'] = files[part]
    return positions, assets
