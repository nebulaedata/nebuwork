import { resolvePreviewKind, resolveFilePreviewExt, sniffPreview } from '../knowledge/source/filePreview';
export const EMPTY_LOCATE_REQUEST = Object.freeze({ locators: [], quotes: [] });
const mimeExt = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls', 'text/csv': 'csv', 'text/markdown': 'md', 'text/html': 'html', 'text/plain': 'txt', 'image/svg+xml': 'svg' };
export function documentType(name = '', type = '', mime = '') {
  for (const candidate of [mimeExt[type?.toLowerCase()], type, resolveFilePreviewExt(name), mimeExt[mime?.split(';')[0]?.toLowerCase()]]) {
    const ext = String(candidate || '').replace(/^\./, '').toLowerCase(), kind = resolvePreviewKind(ext);
    if (kind !== 'unsupported') return { ext, kind };
  }
  const match = /^(image|audio|video)\/([a-z0-9.+-]+)/i.exec(mime || type);
  return match ? { kind: match[1].toLowerCase(), ext: match[2].toLowerCase() } : { kind: 'unsupported', ext: '' };
}
export function hasCitation(request = EMPTY_LOCATE_REQUEST) { return !!(request.unavailable || request.locators?.length || request.quotes?.some(Boolean)); }
export async function needsServerPreview(blob, kind) {
  if (!['docx', 'pptx', 'excel'].includes(kind) || !blob?.arrayBuffer) return false;
  const prefix=new Uint8Array(await blob.slice(0,4).arrayBuffer());if(prefix[0]!==0x50||prefix[1]!==0x4b)return false;
  const {default:Zip}=await import('jszip');
  try { const zip=await Zip.loadAsync(new Uint8Array(await blob.arrayBuffer()));let expanded=0,slides=0;
    for(const entry of Object.values(zip.files)){const length=entry._data?.uncompressedSize||0;expanded+=length;if(length>32*1024**2||expanded>64*1024**2)return true;if(/^ppt\/slides\/slide\d+\.xml$/.test(entry.name))slides++;}return slides>200;
  }catch{return false;}
}
export async function sniffDocument(blob, declared) {
  if (!blob?.slice) return declared;
  const detected = sniffPreview(new Uint8Array(await blob.slice(0, 16384).arrayBuffer()));
  // Knowledge previews may be converted PDFs while the source identity and
  // filename still describe the immutable Office original.
  if (detected.kind === 'pdf') return detected;
  if (declared.kind !== 'unsupported') return declared;
  if (detected.kind !== 'unsupported') return detected;
  if (blob.size <= 20 * 1024 ** 2) {
    const { default: Zip } = await import('jszip');
    try { const zip = await Zip.loadAsync(new Uint8Array(await blob.arrayBuffer())); if (zip.file('word/document.xml')) return { ext: 'docx', kind: 'docx' }; if (zip.file('ppt/presentation.xml')) return { ext: 'pptx', kind: 'pptx' }; if (zip.file('xl/workbook.xml')) return { ext: 'xlsx', kind: 'excel' }; } catch {}
  }
  return declared;
}
