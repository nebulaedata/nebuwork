import MarkdownIt from 'markdown-it';
import { addMarkdownExtras } from '../../shared/markdownExtras.js';

const taskLink = /^(artifact|evidence):\/\/([a-zA-Z0-9_-]+)(?:\/([1-9][0-9]*))?$/;
const webLink = /^(https?:\/\/|mailto:)/i;
const internalLink = /^\/?#\/(?:task|project)\/[a-zA-Z0-9_-]+$/;
const md = addMarkdownExtras(new MarkdownIt({ html: false, breaks: true, linkify: true }));
const validateLink = md.validateLink.bind(md);

// Only task references and public web/mail links can become clickable model output.
md.validateLink = url => validateLink(url) && (taskLink.test(url) || webLink.test(url) || internalLink.test(url));
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const reference = taskLink.exec(token.attrGet('href') || '');
  if (reference) {
    token.attrSet('href', '#');
    if (reference[1] === 'artifact' && reference[3]) token.attrSet('data-artifact-version', reference[3]);
    token.attrSet(reference[1] === 'artifact' ? 'data-artifact-id' : 'data-knowledge-evidence', reference[2]);
  } else if (internalLink.test(token.attrGet('href') || '')) {
    token.attrSet('href', token.attrGet('href').replace(/^\/#/, '#'));
  } else {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return renderer.renderToken(tokens, index, options);
};

// Keep image descriptions without making automatic requests to model-supplied URLs.
md.renderer.rules.image = (tokens, index, options, env, renderer) =>
  md.utils.escapeHtml(renderer.renderInlineAsText(tokens[index].children || [], options, env));

md.renderer.rules.table_open = () => '<div class="task-markdown-table" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderTaskMarkdown(source = '') {
  return md.render(String(source ?? ''));
}
