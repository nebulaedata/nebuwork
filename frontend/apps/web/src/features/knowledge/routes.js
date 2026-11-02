export const knowledgeTabs = [
  ['search', '检索', 'search'], ['document', '原文', 'file-text'],
  ['wiki', 'Wiki', 'book-open'], ['graph', '图谱', 'git-branch'], ['gallery', '图片', 'image'],
];

export function knowledgeReturnTo(value) {
  return typeof value === 'string' && /^#\/(?:settings|agents?|workbench|projects?)(?:[/?][^\r\n]*)?$/.test(value)
    ? value : '#/settings?tab=knowledge';
}

export function knowledgeHref(reference, options = {}) {
  const query = new URLSearchParams();
  if (reference.scopeKind && reference.scopeId && reference.id) {
    query.set('kind', reference.scopeKind);query.set('scope', reference.scopeId);query.set('reference', reference.id);
  } else {
    query.set('connection', reference.connectionId || '');query.set('collection', reference.collectionId || '');
  }
  query.set('tab', options.tab || reference.initialMode || (reference.initialDocumentId ? reference.contentKind === 'wiki' ? 'wiki' : 'document' : 'search'));
  if (reference.initialDocumentId) { query.set('document', reference.initialDocumentId);query.set('content', reference.contentKind || 'document'); }
  query.set('from', knowledgeReturnTo(options.from ?? (typeof location !== 'undefined' ? location.hash : '')));
  return '#/knowledge?' + query;
}
