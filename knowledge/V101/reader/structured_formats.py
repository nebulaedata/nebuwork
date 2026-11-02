"""Built-in parsers for archived HTML, XMind and text-bearing OFD documents."""
import email
from email import policy
import json
import posixpath
import xml.etree.ElementTree as ET
import zipfile


def mhtml_blocks(path, html_blocks, main_content=True, output=None):
    message = email.message_from_bytes(path.read_bytes(), policy=policy.default)
    parts = [p for p in message.walk() if p.get_content_type() == 'text/html']
    start = (message.get_param('start') or '').strip('<>')
    root = next((p for p in parts if (p.get('Content-ID') or '').strip('<>') == start), None) if start else None
    root = root or (parts[0] if parts else None)
    if root is None:
        raise ValueError('MHTML_NO_HTML_CONTENT')
    from html_images import image_loader
    resources={}
    for part in message.walk():
        if not part.get_content_type().startswith('image/'):
            continue
        resource=(part.get_payload(decode=True),part.get_content_type())
        if part.get('Content-ID'): resources['cid:'+part['Content-ID'].strip('<>')]=resource
        if part.get('Content-Location'): resources[part['Content-Location']]=resource
    base=root.get('Content-Location') or 'root'
    return html_blocks(root.get_content(), chapter=base, main_content=main_content,
                       image_loader=image_loader(output,resources,base) if output else None)


def xmind_blocks(path, block, output=None):
    out = []
    def add(title, node_id, sheet, depth):
        if depth > 64 or len(out) >= 100000:
            raise ValueError('DOCUMENT_DEPTH_LIMIT')
        if title:
            out.append(block(title, {'type': 'mindmap', 'sheet': sheet, 'node_id': node_id},
                             'paragraph', min(depth, 6), title=title))
    with zipfile.ZipFile(path) as archive:
        def picture(source, node_id, sheet):
            if not source or output is None: return
            from embedded_images import save_image
            import hashlib
            part=source.removeprefix('xap:').lstrip('/')
            if part not in archive.namelist(): return
            image=save_image(archive.read(part),output,'mindmap-'+hashlib.sha256(part.encode()).hexdigest()[:20],part=part)
            loc={'type':'mindmap','sheet':sheet,'node_id':node_id,'part':part}
            out.append(block('',loc,'range',image_path=image,block_type='image',visual_role='embedded_image',
                             **({} if image else {'warning':'IMAGE_ASSET_UNAVAILABLE'})))
        if 'content.json' in archive.namelist():
            def visit(node, sheet, depth=1):
                add(node.get('title', ''), node.get('id'), sheet, depth)
                picture((node.get('image') or {}).get('src'),node.get('id'),sheet)
                for children in node.get('children', {}).values():
                    for child in children:
                        visit(child, sheet, depth+1)
            for sheet in json.loads(archive.read('content.json')):
                visit(sheet['rootTopic'], sheet.get('id'))
        else:
            def visit_xml(node, sheet, depth=1):
                add(node.findtext('{*}title', ''), node.get('id'), sheet, depth)
                for image in node.findall('{*}img'):
                    picture(image.get('src'),node.get('id'),sheet)
                for child in node.findall('./{*}children/{*}topics/{*}topic'):
                    visit_xml(child, sheet, depth+1)
            for sheet in ET.fromstring(archive.read('content.xml')).findall('{*}sheet'):
                topic = sheet.find('{*}topic')
                if topic is not None:
                    visit_xml(topic, sheet.get('id'))
    return out


def ofd_blocks(path, block, output=None):
    out = []
    def join(base, value):
        value = value.replace('\\', '/')
        result = posixpath.normpath(value.lstrip('/') if value.startswith('/') else posixpath.join(base, value))
        if result.startswith('../') or result == '..':
            raise ValueError('INVALID_ARCHIVE_PATH')
        return result
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('OFD.xml'))
        page_number = 0
        for docroot in root.findall('./{*}DocBody/{*}DocRoot'):
            document_path = join('', docroot.text or '')
            document = ET.fromstring(archive.read(document_path))
            resources={}
            for ref in document.findall('./{*}CommonData/{*}PublicRes')+document.findall('./{*}CommonData/{*}DocumentRes'):
                res_path=join(posixpath.dirname(document_path),ref.text or '')
                res=ET.fromstring(archive.read(res_path))
                base=join(posixpath.dirname(res_path),res.get('BaseLoc',''))
                for media in res.findall('./{*}MultiMedias/{*}MultiMedia'):
                    resources[media.get('ID')]=join(base,media.findtext('{*}MediaFile',''))
            for page in document.findall('./{*}Pages/{*}Page'):
                page_number += 1
                if page_number > 3000:
                    raise ValueError('PAGE_LIMIT_EXCEEDED')
                page_path = join(posixpath.dirname(document_path), page.get('BaseLoc', ''))
                content = ET.fromstring(archive.read(page_path))
                for obj in content.iter():
                    loc={'type':'page','page':page_number,'object_id':obj.get('ID'),'part':page_path}
                    if obj.tag.split('}')[-1]=='TextObject':
                        text = ''.join(''.join(n.itertext()) for n in obj.findall('{*}TextCode'))
                        if text.strip(): out.append(block(text,loc,'page'))
                    elif obj.tag.split('}')[-1]=='ImageObject' and output is not None:
                        from embedded_images import save_image
                        import hashlib
                        part=resources.get(obj.get('ResourceID'))
                        image=save_image(archive.read(part),output,'ofd-'+hashlib.sha256(part.encode()).hexdigest()[:20],part=part) if part in archive.namelist() else ''
                        out.append(block('',loc,'page',image_path=image,block_type='image',visual_role='embedded_image',
                                         **({} if image else {'warning':'IMAGE_ASSET_UNAVAILABLE'})))
    if not out:
        raise ValueError('OFD_NO_TEXT_LAYER')
    return out
