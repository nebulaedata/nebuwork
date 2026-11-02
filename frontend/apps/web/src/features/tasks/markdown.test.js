// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderTaskMarkdown } from './markdown.js';

function render(source) {
  const body = document.createElement('div');
  body.innerHTML = renderTaskMarkdown(source);
  return body;
}

describe('task Markdown', () => {
  it('renders the recommendation headings and lists without leaking heading markers', () => {
    const body = render('📋 **推荐总结**\n平台动态：近 10 日发布 104 条。\n\n#### 1. 供应链智慧工作台集成实施服务\n- 项目名称：供应链智慧工作台\n- URL：https://ecp.sgcc.com.cn/ecp2.0/portal/#/doc/doc-bid/260918\n- 核心内容：知识体系建设\n#### 2. 智能监控助手\n- 招标单位：某电力公司');
    expect([...body.querySelectorAll('h4')].map(node => node.textContent)).toEqual(['1. 供应链智慧工作台集成实施服务', '2. 智能监控助手']);
    expect(body.textContent).not.toContain('####');
    expect(body.querySelectorAll('ul')).toHaveLength(2);
    expect(body.querySelectorAll('li')).toHaveLength(4);
    expect(body.querySelector('strong').textContent).toBe('推荐总结');
    expect(body.querySelector('a').getAttribute('href')).toBe('https://ecp.sgcc.com.cn/ecp2.0/portal/#/doc/doc-bid/260918');
  });

  it('supports all heading levels, nested lists, quotations, tables and fenced code', () => {
    const body = render('# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级\n\n3. 第三项\n   - 子项\n\n> 引用 **内容**\n\n| 名称 | 数量 |\n| --- | ---: |\n| 项目 | 13 |\n\n```html\n<script>alert(1)</script>\n```');
    expect(body.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(6);
    expect(body.querySelector('ol').getAttribute('start')).toBe('3');
    expect(body.querySelector('ol li ul li').textContent).toBe('子项');
    expect(body.querySelector('blockquote strong').textContent).toBe('内容');
    expect(body.querySelector('.task-markdown-table table td').textContent).toBe('项目');
    expect(body.querySelector('pre code').textContent).toBe('<script>alert(1)</script>\n');
    expect(body.querySelector('script')).toBeNull();
  });

  it('keeps task references actionable and opens ordinary links separately', () => {
    const body = render('[报告](artifact://file_1) [证据](evidence://evidence-2) [来源](https://example.com/report?q=1&n=2)');
    expect(body.querySelector('[data-artifact-id="file_1"]').getAttribute('href')).toBe('#');
    expect(body.querySelector('[data-knowledge-evidence="evidence-2"]').getAttribute('href')).toBe('#');
    const external = body.querySelector('a[target="_blank"]');
    expect(external.getAttribute('href')).toBe('https://example.com/report?q=1&n=2');
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('escapes raw HTML and disallows executable URLs, local URLs and automatic image requests', () => {
    const body = render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[点击](javascript:alert(1))\n[转义](jav&#x61;script:alert(1))\n[本地](file:///secret)\n[数据](data:text/html,test)\n[无效引用](artifact://file-1/extra)\n![说明](https://example.com/image.png)');
    expect(body.querySelectorAll('script, img, iframe, a')).toHaveLength(0);
    expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(body.textContent).toContain('说明');
  });

  it('renders unfinished fences safely and handles empty content', () => {
    expect(render('```html\n<img src=x>').querySelector('pre code').textContent).toBe('<img src=x>');
    expect(renderTaskMarkdown(null)).toBe('');
  });
});
it('allows only explicit internal task/project links and preserves current-account authorization',()=>{
  expect(renderTaskMarkdown('[任务](/#/task/task-safe)')).toContain('href="#/task/task-safe"');
  expect(renderTaskMarkdown('[项目](#/project/project-safe)')).toContain('href="#/project/project-safe"');
  expect(renderTaskMarkdown('[写入](#/settings?delete=1)')).not.toContain('<a ');
});
