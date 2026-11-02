import { knowledgeHref } from './routes.js';

/** Keep every catalog/reference entry on the same permission-scoped detail page. */
export function openKnowledgeBrowser(reference, _read, valid = () => true) {
  if (valid()) location.hash = knowledgeHref(reference);
}
