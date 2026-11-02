import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import 'katex/dist/katex.min.css';
import './markdownExtras.css';

for (const [name, grammar] of Object.entries({javascript, typescript, json, xml, css, python, java, sql, bash, yaml})) hljs.registerLanguage(name, grammar);
export function addMarkdownExtras(md) {
  md.set({ highlight(code, language) { if (code.length > 200000 || !hljs.getLanguage(language)) return ''; try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch { return ''; } } });
  // Never share mutable macros between documents or enable resource-loading TeX commands.
  md.use(texmath, { delimiters: ['dollars', 'brackets'], engine: { renderToString(source, options) { return katex.renderToString(source, { ...options, macros: {}, trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20 }); } } });
  return md;
}
