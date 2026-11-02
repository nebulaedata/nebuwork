import { esc, statusLabel } from './lifecycle.js';

export function collectionDetails(collection) {
  const hasCount = Number.isSafeInteger(collection.documentCount) && collection.documentCount >= 0;
  const description = typeof collection.description === 'string' ? collection.description.trim() : '';
  const countLabel = collection.documentCountSource === 'visible' ? '可见文件数' : '文件数';
  return '<p class="knowledge-collection-description' + (description ? '' : ' dim') + '">' + esc(description || '暂无说明') + '</p>' +
    '<div class="knowledge-collection-count"><span>' + countLabel + '</span><strong>' + (hasCount ? esc(collection.documentCount) : '暂不可用') + '</strong></div>' +
    (collection.documentCountError || collection.documentCountWarning ? '<p class="knowledge-collection-hint">' + esc(collection.documentCountError || collection.documentCountWarning) + '</p>' : '');
}

/** Load each connection independently; a slow remote must not block saved connection management. */
export async function renderConnectionCollections(host, connections, life) {
  const jobs = connections.map((connection, index) => {
    const panel = host.querySelector('[data-connection-collections="' + index + '"]');
    if (!panel) return null;
    if (!connection.enabled) {
      panel.innerHTML = '<p class="knowledge-collection-state dim">连接已禁用，启用后可查看知识库。</p>';
      return null;
    }
    panel.innerHTML = '<div class="knowledge-collections-head"><h4>包含的知识库 <span class="pill pill-dim" data-collection-count>—</span></h4><button class="btn btn-ghost btn-sm" data-collections-refresh>刷新知识库</button></div>' +
      '<div data-collection-items aria-live="polite"><p class="knowledge-collection-state dim">正在读取知识库…</p></div>';
    const items = panel.querySelector('[data-collection-items]'), counter = panel.querySelector('[data-collection-count]');
    const refresh = panel.querySelector('[data-collections-refresh]');
    refresh.disabled = true;
    let generation = 0, controller;
    life.cleanup(() => { generation++; controller?.abort(); });
    const load = async () => {
      if (!life.live()) return;
      const current = ++generation;
      controller?.abort(); controller = new AbortController();
      const live = () => life.live() && panel.isConnected && current === generation;
      counter.textContent = '—'; refresh.disabled = true;
      items.setAttribute('aria-busy', 'true');
      items.innerHTML = '<p class="knowledge-collection-state dim">正在读取知识库…</p>';
      try {
        const result = await API.fetchKnowledgeCollections(connection.id, controller.signal, true);
        if (!live()) return;
        const collections = result.data?.collections;
        if (!Array.isArray(collections)) throw new Error('知识库目录格式无效，请刷新重试');
        counter.textContent = String(collections.length);
        items.innerHTML = collections.length ? '<div class="knowledge-collection-grid">' + collections.map(collection =>
          '<article class="knowledge-collection-card"><div class="knowledge-collection-title"><span class="knowledge-collection-icon">' + ICON('book-open', 16) + '</span><h5>' + esc(collection.name || collection.id) + '</h5><span class="pill pill-dim">' + esc(statusLabel(collection.indexingStatus)) + '</span></div>' +
          collectionDetails(collection) + '</article>').join('') + '</div>' : '<p class="knowledge-collection-state dim">此连接暂无可见知识库。</p>';
        refresh.textContent = '刷新知识库';
      } catch (error) {
        if (live() && error.name !== 'AbortError') {
          items.innerHTML = '<p class="knowledge-collection-state knowledge-error" role="alert">' + esc(error.message || '知识库读取失败') + '</p>';
          refresh.textContent = '重试';
        }
      } finally {
        if (live()) { refresh.disabled = false; items.setAttribute('aria-busy', 'false'); }
      }
    };
    refresh.addEventListener('click', load);
    return load;
  }).filter(Boolean);
  let next = 0;
  // Bound initial discovery concurrency when many connections are configured.
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (life.live() && next < jobs.length) await jobs[next++]();
  }));
}
