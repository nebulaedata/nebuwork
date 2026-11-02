"""Read bundled/data images only. Never fetch arbitrary document URLs."""
import base64
import hashlib
from urllib.parse import unquote, unquote_to_bytes, urljoin
from embedded_images import save_image


def image_loader(output, resources=None, base=''):
    resources=resources or {}
    def load(source):
        raw, media, part = None, '', source
        if source.startswith('data:image/') and ',' in source:
            header,data=source.split(',',1)
            if len(data)>32*1024*1024:
                return {'warning':'IMAGE_ASSET_UNAVAILABLE'}
            try:
                raw=base64.b64decode(data,validate=True) if ';base64' in header else unquote_to_bytes(data)
            except ValueError:
                return {'warning':'IMAGE_ASSET_UNAVAILABLE'}
            media=header[5:].split(';')[0];part='embedded-data-image'
        else:
            key=unquote(source)
            resource=resources.get(key) or resources.get(urljoin(base,key))
            if resource is not None:
                raw,media=resource
        if raw is None:
            return {'warning':'EXTERNAL_IMAGE_NOT_FETCHED'}
        name='html-image-'+hashlib.sha256(raw).hexdigest()[:20]
        path=save_image(raw,output,name,media,part)
        if not path:
            return {'warning':'IMAGE_ASSET_UNAVAILABLE'}
        return {'image_path':path, 'block_type':'image', 'visual_role':'embedded_image'}
    return load
