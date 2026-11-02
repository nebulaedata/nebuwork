import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Compile the actual component with the project's TypeScript, without a browser
// or a second renderer implementation.
const source=new URL('../src/ParsedContent.tsx',import.meta.url);
const compiled=new URL('../.parsed-content-test.mjs',import.meta.url);
try {
  await writeFile(compiled,ts.transpileModule(await readFile(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
  const {RichContent,ParsedContent,IllustratedContent,OCRText,ocrDisplayText}=await import(compiled.href);
  const html=renderToStaticMarkup(React.createElement(RichContent,{text:'标题\n\n<table><tr><td colspan="2">合并单元格</td></tr><tr><td>甲</td><td>乙</td></tr></table>\n\n| 列 | 数值 |\n|---|---|\n| 一 | 12 |'}));
  assert.ok(html.includes('<table>') && html.includes('colSpan="2"'));
  assert.equal((html.match(/<table>/g)||[]).length,2);
  const unsafe=renderToStaticMarkup(React.createElement(RichContent,{text:'<script>window.bad=1</script><iframe src="https://example.com"></iframe><img src="https://example.com/tracker" onerror="bad()"><a href="javascript:bad()">链接</a><table style="position:fixed" onclick="bad()"><tr><td>安全内容</td></tr></table>'}));
  assert.ok(unsafe.includes('安全内容'));
  for(const forbidden of ['<script','<iframe','<img','javascript:','onclick','onerror','position:fixed','tracker'])assert.ok(!unsafe.includes(forbidden),forbidden);
  const highlighted=renderToStaticMarkup(React.createElement(ParsedContent,{text:'中文😀来源结束',start:3,end:5}));
  assert.ok(highlighted.includes('<mark id="source-highlight">来源</mark>'));
  const pictures=renderToStaticMarkup(React.createElement(IllustratedContent,{
    text:'前😀文\n占位符\n后文',occurrences:[{char_start:4,char_end:7,reference_only:true,images:[{id:'registered-picture'}]},
    {char_start:11,char_end:11,unplaced:true,images:[{id:'unplaced-picture'}]}],
    renderImages:images=>React.createElement('figure',{},images.map(i=>i.id).join(','))}));
  assert.ok(pictures.indexOf('前😀文')<pictures.indexOf('registered-picture'));
  assert.ok(pictures.indexOf('registered-picture')<pictures.indexOf('后文'));
  assert.ok(!pictures.includes('占位符'));
  assert.ok(pictures.includes('未提供可核验的正文插入位置')&&pictures.includes('unplaced-picture'));
  const raw='前😀文\n正常标签\n循环重复\n后文';
  const begin=Array.from('前😀文\n正常标签\n').length;
  const end=begin+Array.from('循环重复\n').length;
  const cleanup={algorithm:'region-loop-v1',message:'已清理重复，原始 OCR 和定位已保留，内容仍需核验。',needs_review:true,removed_characters:end-begin,removals:[{char_start:begin,char_end:end}]};
  assert.equal(ocrDisplayText(raw,cleanup),'前😀文\n正常标签\n后文');
  const cleaned=renderToStaticMarkup(React.createElement(OCRText,{text:raw,cleanup}));
  assert.ok(cleaned.includes('查看原始 OCR')&&cleaned.includes('仍需核验')&&cleaned.includes('正常标签')&&!cleaned.includes('循环重复'));
  const layout=renderToStaticMarkup(React.createElement(IllustratedContent,{text:raw,ocrCleanup:cleanup,
    occurrences:[{char_start:end,char_end:end,images:[{id:'after-loop-picture'}]}],renderImages:()=>React.createElement('figure',{},'after-loop-picture')}));
  assert.ok(!layout.includes('循环重复')&&layout.indexOf('正常标签')<layout.indexOf('after-loop-picture')&&layout.indexOf('after-loop-picture')<layout.indexOf('后文'));
  const rawHighlighted=renderToStaticMarkup(React.createElement(ParsedContent,{text:raw,ocrCleanup:cleanup,start:begin,end}));
  assert.ok(rawHighlighted.includes('<mark id="source-highlight">循环重复\n</mark>'));
  console.log('PASS: HTML/Markdown tables, merged cells, safe HTML, Unicode source offsets');
} finally {await unlink(compiled).catch(()=>{});}
