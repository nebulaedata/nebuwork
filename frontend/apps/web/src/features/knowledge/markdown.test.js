import { expect, it } from 'vitest';
import { renderKnowledgeMarkdown, wikiPageLabels } from './markdown.js';

it('renders Wiki page links as scoped actions and keeps literal code untouched',()=>{
  const html=renderKnowledgeMarkdown('阅读 [[entity/pump|水泵]]，代码 `[[literal/page]]`。');
  expect(html).toContain('data-wiki-page="entity/pump"');expect(html).toContain('>水泵</a>');expect(html).toContain('<code>[[literal/page]]</code>');expect(wikiPageLabels('[[entity/pump|水泵]]')).toEqual({'entity/pump':'水泵'});
});
it('never loads raw HTML or exposes internal image handles as URLs',()=>{
  const html=renderKnowledgeMarkdown('<script>alert(1)</script>\n\n![泵流程](resource://internal-object)');
  expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).not.toContain('resource://');expect(html).toContain('图片：泵流程');
});

it('keeps V101 immutable source links as local actions without allowing arbitrary schemes',()=>{
 const html=renderKnowledgeMarkdown('[依据](source:12345678-1234-1234-1234-123456789012) [坏地址](javascript:alert(1))');
 expect(html).toContain('data-source-ref="12345678-1234-1234-1234-123456789012"');expect(html).not.toContain('href="source:');expect(html).not.toContain('href="javascript:');
});
it('hides generated source boundaries without losing content, source actions or literal code',()=>{
 const marker='<!-- source-document:5ca82a83-8c9d-4410-a442-26643055b9ff:16 -->';
 const html=renderKnowledgeMarkdown(marker+'\n正文\n\n[来源](source:12345678-1234-1234-1234-123456789012)\n<!-- /source-document -->');
 expect(html).not.toContain('source-document');expect(html).toContain('正文');expect(html).toContain('data-source-ref=');
 expect(renderKnowledgeMarkdown('```html\n'+marker+'\n```')).toContain('source-document');
 expect(renderKnowledgeMarkdown('`'+marker+'`')).toContain('source-document');
 expect(renderKnowledgeMarkdown('<script>unsafe()</script>')).not.toContain('<script>');
});
