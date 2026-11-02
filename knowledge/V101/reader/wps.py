"""Content-checked WPS adapters. Never modify or rename the stored source file."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile
from xml.etree import ElementTree as ET

import progress

FORMATS = {
    '.wps': ('word', 'docx', 'MS Word 97'),
    '.wpt': ('word', 'docx', 'MS Word 97 Vorlage'),
    '.et': ('spreadsheet', 'xlsx', 'MS Excel 97'),
    '.ett': ('spreadsheet', 'xlsx', 'MS Excel 97 Vorlage/Template'),
    '.dps': ('presentation', 'pptx', 'MS PowerPoint 97'),
    '.dpt': ('presentation', 'pptx', 'MS PowerPoint 97 Vorlage'),
}
ROOTS = {'word':'word/document.xml','spreadsheet':'xl/workbook.xml','presentation':'ppt/presentation.xml'}
EXPORT = {'docx':'Office Open XML Text','pptx':'Impress MS PowerPoint 2007 XML'}
OLE_MAGIC = bytes.fromhex('d0cf11e0a1b11ae1')


def converter_capabilities():
    extensions=set()
    for registry in Path('/usr/lib/libreoffice/share/registry').glob('*.xcd'):
        for prop in ET.parse(registry).iter('prop'):
            if prop.get('{http://openoffice.org/2001/registry}name')=='Extensions':
                extensions.update((prop.findtext('value') or '').split())
    return {ext[1:]:ext[1:] in extensions for ext in FORMATS}


def inspect(path):
    """Return the actual container and family, rejecting ambiguous/foreign data."""
    with path.open('rb') as stream:
        magic = stream.read(8)
    if magic[:2] == b'PK':
        try:
            with zipfile.ZipFile(path) as package:
                entries = package.infolist()
                if len(entries)>20000 or sum(e.file_size for e in entries)>512*1024**2 or any(e.file_size>max(1,e.compress_size)*2000 for e in entries):
                    raise ValueError('ARCHIVE_LIMIT_EXCEEDED')
                if any(e.flag_bits & 1 for e in entries):
                    raise ValueError('WPS_ENCRYPTED')
                names=set(package.namelist())
                families=[key for key,part in ROOTS.items() if part in names]
                if len(families)!=1 or '[Content_Types].xml' not in names:
                    raise ValueError('WPS_UNSUPPORTED_VARIANT')
                ET.fromstring(package.read(ROOTS[families[0]]))
                content_types=package.read('[Content_Types].xml')
                return 'ooxml',families[0],b'template.main+xml' in content_types or b'macroEnabled' in content_types
        except (zipfile.BadZipFile,ET.ParseError,KeyError):
            raise ValueError('WPS_CORRUPT_FILE') from None
    if magic == OLE_MAGIC:
        import olefile
        try:
            with olefile.OleFileIO(path) as compound:
                names={parts[0] for parts in compound.listdir() if len(parts)==1}
                if names & {'EncryptedPackage','EncryptionInfo','EncryptedSummary'}:
                    raise ValueError('WPS_ENCRYPTED')
                families=[]
                if 'WordDocument' in names:
                    fib=compound.openstream('WordDocument').read(32)
                    if len(fib)<12: raise ValueError('WPS_CORRUPT_FILE')
                    if struct.unpack_from('<H',fib,10)[0] & 0x8100: raise ValueError('WPS_ENCRYPTED')
                    families.append('word')
                if names & {'Workbook','Book'}:
                    # FILEPASS appears in the globals substream, before cell data.
                    with compound.openstream('Workbook' if 'Workbook' in names else 'Book') as stream:
                        while True:
                            header=stream.read(4)
                            if len(header)!=4: raise ValueError('WPS_CORRUPT_FILE')
                            record,size=struct.unpack('<HH',header)
                            if record==0x2f: raise ValueError('WPS_ENCRYPTED')
                            if record==0x0a: break
                            if len(stream.read(size))!=size: raise ValueError('WPS_CORRUPT_FILE')
                    families.append('spreadsheet')
                if 'PowerPoint Document' in names: families.append('presentation')
                if len(families)!=1: raise ValueError('WPS_UNSUPPORTED_VARIANT')
                return 'ole',families[0],False
        except (OSError,IOError,struct.error):
            raise ValueError('WPS_CORRUPT_FILE') from None
    raise ValueError('WPS_UNSUPPORTED_VARIANT')


def normalize(path, output):
    family,target,input_filter=FORMATS[path.suffix.lower()]
    progress.report('inspect_wps')
    container,actual,template=inspect(path)
    if actual!=family:
        raise ValueError('WPS_FORMAT_MISMATCH')
    folder=output/'wps'; folder.mkdir(exist_ok=True)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    # Read BIFF spreadsheets directly: preserve saved values and original rows,
    # without triggering a converter's formula recalculation. Existing XLS image
    # extraction converts a separate copy and labels its anchors accordingly.
    direct = family=='spreadsheet' or container=='ooxml' and not template
    extension='xls' if family=='spreadsheet' and container=='ole' else target
    normalized=folder/('normalized.'+extension)
    mapping='source_structure' if direct else 'converted_structure'
    method='container_alias' if direct else 'libreoffice'
    if direct:
        progress.report('normalize_wps')
        shutil.copyfile(path,normalized)
    else:
        progress.report('convert_wps')
        with tempfile.TemporaryDirectory(dir=folder) as temporary:
            temp=Path(temporary); profile=temp/'profile'; (profile/'user').mkdir(parents=True)
            (profile/'user'/'registrymodifications.xcu').write_text(
                '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
                '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
                '</oor:items>',encoding='utf-8')
            command=['libreoffice','-env:UserInstallation='+profile.as_uri(),'--headless','--norestore']
            if container=='ole': command.append('--infilter='+input_filter)
            command += ['--convert-to', target+':'+EXPORT[target],'--outdir',str(temp),str(path)]
            try:
                result=subprocess.run(command,capture_output=True,timeout=300,
                                      env={**os.environ,'MALLOC_ARENA_MAX':'2','OMP_NUM_THREADS':'1'})
            except subprocess.TimeoutExpired:
                raise ValueError('WPS_CONVERSION_TIMEOUT') from None
            except OSError:
                raise ValueError('WPS_CONVERTER_UNAVAILABLE') from None
            (folder/'conversion.log').write_bytes(result.stdout+b'\n'+result.stderr)
            candidate=temp/(path.stem+'.'+target)
            if result.returncode or not candidate.is_file() or candidate.stat().st_size==0:
                raise ValueError('WPS_CONVERSION_FAILED')
            try:
                output_container,output_family,_=inspect(candidate)
            except ValueError:
                raise ValueError('WPS_CONVERSION_INVALID') from None
            if output_container!='ooxml' or output_family!=family:
                raise ValueError('WPS_CONVERSION_INVALID')
            shutil.copyfile(candidate,normalized)
    info=dict(source_format=path.suffix.lstrip('.').lower(),detected_container=container,
              normalized_format=extension,method=method,mapping=mapping,source_sha256=digest,
              normalized_sha256=hashlib.sha256(normalized.read_bytes()).hexdigest())
    (folder/'manifest.json').write_text(json.dumps(info,ensure_ascii=False),encoding='utf-8')
    progress.finish()
    return normalized,info


def decorate(result, info):
    """Qualify every locator including outline and supplementary table evidence."""
    def locator(loc):
        loc['source_format']=info['source_format']
        loc['normalized_format']=info['normalized_format']
        if info['mapping']=='converted_structure':
            # Unverified anydoc mappings must remain unverified even in the copy.
            if loc.get('mapping')!='unverified' and loc.get('type')!='document':
                loc['mapping']='converted_structure'
                loc['coordinate_space']='converted_document'
    for block in result.get('blocks',[]):
        locator(block['locator'])
        for context in block.get('context_sources',[]):
            locator(context['locator'])
    for item in result.get('outline',[]): locator(item['locator'])
    result['conversion']=info
    warnings=result.setdefault('warnings',[])
    if info['mapping']=='converted_structure':
        warnings.append({'code':'WPS_CONVERTED_SOURCE','message':'文字、图片和位置来自转换副本；未核验为原文件的精确页码或对象坐标，原文件保留供下载。'})
    if info['normalized_format']=='xls':
        warnings.append({'code':'WPS_BIFF_DIRECT','message':'直接读取原始表格行列及保存值；图片可能从转换副本补提，其位置单独标记。'})
    return result
