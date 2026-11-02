// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderTaskMarkdown } from '../features/tasks/markdown.js';
import { renderKnowledgeMarkdown } from '../features/knowledge/markdown.js';

for (const [name, render] of [['task', renderTaskMarkdown], ['knowledge', renderKnowledgeMarkdown]]) {
  it(`${name} renders formulas and known code without allowing TeX resources or unknown-language HTML`, () => {
    const div=document.createElement('div');
    div.innerHTML=render('$a^2+b^2=c^2$\n\n$$\\frac{1}{2}$$\n\n```javascript\nconst total = 42;\n```\n\n```unknown-language\n<img src=x onerror=evil()>\n```\n\n$\\includegraphics{https://example.invalid/secret}$\n\n$\\badcommand{<script>}$');
    expect(div.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(div.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(div.querySelector('img,script')).toBeNull();
    expect(div.textContent).toContain('<img src=x onerror=evil()>');
    expect(div.textContent).toContain('badcommand');
  });
}
