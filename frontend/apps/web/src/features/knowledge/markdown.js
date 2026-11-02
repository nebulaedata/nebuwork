import MarkdownIt from 'markdown-it';
import { addMarkdownExtras } from '../../shared/markdownExtras.js';

const md=addMarkdownExtras(new MarkdownIt({html:false,breaks:true,linkify:true}));
const validate=md.validateLink.bind(md);
md.validateLink=url=>validate(url)&&(/^(https?:\/\/|mailto:|wiki:|source:|resource:|local:)/i.test(url)||url.startsWith('#'));
md.linkify.set({fuzzyLink:false,fuzzyEmail:false});
// V101 uses these standalone comments as persisted provenance boundaries.
// Consume only the generated markers; raw HTML remains escaped and code
// examples remain literal because fences/code run before the paragraph rule.
md.block.ruler.before('paragraph','knowledge_source_document',(state,start,end,silent)=>{
  const line=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]);
  if(!/^<!--\s*(?:source-document:[a-f0-9-]{36}:\d+|\/source-document)\s*-->\s*$/i.test(line))return false;
  if(!silent)state.line=start+1;
  return true;
},{alt:['paragraph']});
md.inline.ruler.before('link','knowledge_wiki_link',(state,silent)=>{
  const raw=state.src.slice(state.pos);if(!raw.startsWith('[['))return false;
  const match=/^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(raw);if(!match)return false;
  if(!silent){const token=state.push('link_open','a',1);token.attrs=[['href','#'],['data-wiki-page',match[1].trim()]];state.push('text','',0).content=match[2]||match[1];state.push('link_close','a',-1);}
  state.pos+=match[0].length;return true;
});
md.renderer.rules.link_open=(tokens,index,options,env,renderer)=>{
  const token=tokens[index];const source=/^source:([a-f0-9-]{36})$/i.exec(token.attrGet('href')||'');if(source){token.attrSet('data-source-ref',source[1]);token.attrSet('href','#');}if(!source&&!token.attrGet('data-wiki-page')){if(!/^(https?:\/\/|mailto:|#)/i.test(token.attrGet('href')||''))token.attrSet('href','#');token.attrSet('target','_blank');token.attrSet('rel','noopener noreferrer');}return renderer.renderToken(tokens,index,options);
};
// Assets are opened through the authorized gallery/source reader. A storage
// handle must never become a browser request or technical copy in the reader.
md.renderer.rules.image=(tokens,index)=>'<span class="knowledge-inline-image">图片：'+md.utils.escapeHtml(md.renderer.renderInlineAsText(tokens[index].children||[],md.options,{}))+'</span>';
md.renderer.rules.table_open=()=>'<div class="task-markdown-table" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n';
md.renderer.rules.table_close=()=>'</table></div>\n';
export const renderKnowledgeMarkdown=source=>md.render(String(source||''));
export function wikiBodyText(content,title){
  const text=String(content||''), first=/^\s*#\s+([^\n]+)\r?\n/.exec(text);
  return first&&first[1].trim()===String(title||'').trim()?text.slice(first[0].length).trimStart():text;
}
export function wikiPageLabels(source){
  const labels=Object.create(null);for(const match of String(source||'').matchAll(/\[\[([^\]\n|]+)\|([^\]\n]+)\]\]/g))labels[match[1].trim()]=match[2];return labels;
}
