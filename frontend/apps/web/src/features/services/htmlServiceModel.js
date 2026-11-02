export const isHtmlArtifact = file => /\.html?$/i.test(file?.name || '') || /\.html?$/i.test(String(file?.source?.path || '')) || file?.mediaType?.split(';')[0] === 'text/html';
const staticFile = /\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|otf)$/i;
const originalPath = file => String(file.source?.path || file.name).replace(/^\/?workspace\//, '').replaceAll('\\', '/');
export function initialHtmlResources(entry, items) {
  const path = originalPath(entry), folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  return { entryPath: folder ? path.slice(folder.length) : path, resources: items.filter(f => f.id !== entry.id && (staticFile.test(originalPath(f)) || staticFile.test(f.name || ''))).map(file => ({ ...file, selected: false, path: folder && originalPath(file).startsWith(folder) ? originalPath(file).slice(folder.length) : originalPath(file) })) };
}
export function validateHtmlResources(entryPath, resources, entry) {
  const seen = new Set(), selected = resources.filter(r => r.selected);
  if (selected.length >= 100) throw new Error('页面最多包含 100 个文件（含 HTML 入口）。');
  for (const path of [entryPath, ...selected.map(r => r.path)]) {
    if (!path || /[\\\u0000-\u001f:?#%]/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('请填写有效的包内相对路径：' + path);
    if (seen.has(path)) throw new Error('资源路径重复：' + path);
    seen.add(path);
  }
  if (!/\.html?$/i.test(entryPath)) throw new Error('入口路径须以 .html 或 .htm 结尾。');
  if (entry.size > 2 * 1024 ** 2) throw new Error('HTML 入口不能超过 2 MiB。');
  if (entry.size + selected.reduce((sum, r) => sum + r.size, 0) > 20 * 1024 ** 2) throw new Error('产物总计不能超过 20 MiB。');
  return selected.map(({ path, id, version }) => ({ path, artifactId: id, version }));
}
/** Suggestions only; the server compiler validates the complete dependency graph. */
export async function suggestHtmlResources(entry, entryPath, resources, loadText, live) {
  const byPath = new Map();
  for (const r of resources) { const group = byPath.get(r.path) || []; group.push(r); byPath.set(r.path, group); }
  const selected = new Set(), queue = [{ ...entry, path: entryPath }];
  while (queue.length && live()) {
    const current = queue.shift();
    if (!/\.(?:html?|css|m?js)$/i.test(current.path)) continue;
    const source = await loadText(current); if (!live()) break;
    const strings = [...source.matchAll(/["'`]([^"'`\r\n]+)["'`]|\b(?:src|href|poster)\s*=\s*([^\s>"']+)|url\(\s*([^)'"\s]+)\s*\)/g)];
    for (const match of strings) for (const value of (match[1] || match[2] || match[3]).split(/[,\s]+/)) {
      if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) continue;
      let path; try { path = decodeURIComponent(new URL(value, 'https://artifact.invalid/' + current.path).pathname.slice(1)); } catch { continue; }
      const candidates = byPath.get(path);
      if (candidates?.length !== 1) continue;
      const r = candidates[0];
      if (entry.sessionId && r.sessionId !== entry.sessionId || !entry.sessionId && entry.runId && r.runId !== entry.runId) continue;
      if (!selected.has(r.id)) { selected.add(r.id); queue.push(r); }
    }
  }
  return resources.map(r => ({ ...r, selected: selected.has(r.id) }));
}
export function mergeHtmlPage(definition, page, replace) {
  const next = structuredClone(definition), existing = next.pages.find(p => p.key === page.key);
  if (existing && !replace) throw new Error('页面标识已存在，请选择替换或修改标识。');
  next.pages = existing ? next.pages.map(p => p.key === page.key ? page : p) : [...next.pages, page];
  return next;
}
