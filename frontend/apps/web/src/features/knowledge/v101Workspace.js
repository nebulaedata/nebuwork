import { esc, lifetime, knowledgeModal, modalFooter } from './lifecycle.js';
import { field, operationKey } from './managementForms.js';

export const v101WorkspaceHref = (connection, path = '/knowledge-bases') => '#/knowledge?' + new URLSearchParams({ connection, workspace: '1', path });

export async function renderV101Workspace(host, query) {
  const life = lifetime(host);
  host.innerHTML = '<div class="page knowledge-detail-page"><header class="knowledge-detail-header"><div><a class="btn btn-ghost" href="#/settings?tab=knowledge">返回知识库</a><h1>Nebulae V101</h1><p>资料处理、检索、Wiki、图谱、图片、知识库问答与条款参数提取。</p></div><button class="btn btn-ghost" data-reload>刷新工作区</button></header><div data-workspace role="status">正在检查连接…</div></div>';
  try {
    const { data: connections } = await API.fetchKnowledgeConnections('user', '', life.signal);
    if (!life.live()) return;
    const connection = connections.find(c => c.id === query.connection && c.driver === 'nebulae-v101-rest' && c.enabled);
    if (!connection) throw new Error('V101 连接不可用或当前账号未获授权');
    const requested = query.path || '/knowledge-bases';
    const path = /^\/(knowledge-bases|documents|qa|extractions|search|tasks|settings|system)(\/[^\r\n#]*)?(\?[^\r\n#]*)?$/.test(requested) ? requested : '/knowledge-bases';
    const frame = document.createElement('iframe');
    frame.title = connection.name + ' · Nebulae V101';
    frame.className = 'knowledge-v101-frame';
    frame.style.cssText = 'display:block;width:100%;height:calc(100vh - 240px);min-height:600px;border:1px solid var(--border,#e5e7eb);border-radius:12px;background:var(--bg,#fff)';
    frame.src = API.knowledgeV101Url(connection.id, path);
    host.querySelector('[data-workspace]').replaceWith(frame);
    host.querySelector('[data-reload]').onclick = () => { frame.src = API.knowledgeV101Url(connection.id, path); };
    life.cleanup(() => { frame.src = 'about:blank';frame.remove(); });
  } catch (error) { if (life.live() && error.name !== 'AbortError') host.querySelector('[data-workspace]').innerHTML = '<p role="alert">' + esc(error.message) + '</p>'; }
}

export function openV101Create(connections, valid, onCreated, other) {
  const available = connections.filter(c => c.driver === 'nebulae-v101-rest' && c.enabled && c.published);
  knowledgeModal('新增知识库', '<p class="dim">V101 按现有解析与模型默认配置建库，可在内容管理中调整。文件、Wiki、图谱和图片属于同一个知识库。</p><div class="field"><label>V101 连接</label><div data-connection></div></div>' + field('name', '名称') + field('description', '说明', '', 'textarea') + (other ? '<button class="btn btn-ghost" data-other>使用 V100 模板 / FAQ / Wiki</button>' : '') + modalFooter('创建 V101 知识库'), valid, ctx => {
    const picker = ctx.select('[data-connection]', { label: 'V101 连接', value: available[0]?.id, options: available.map(c => ({value:c.id,label:c.name})) });
    const key = operationKey();
    ctx.box.querySelector('[data-other]')?.addEventListener('click', () => { UI.closeModal();other(); });
    ctx.action('[data-save]', async () => {
      const name = ctx.box.querySelector('[name=name]').value.trim();
      if (!name || !picker.getValue()) throw new Error('请选择连接并填写名称');
      const { data } = await API.manageKnowledge(picker.getValue(), { operation:'kb.create', requestKey:key, payload:{name,description:ctx.box.querySelector('[name=description]').value} }, ctx.signal);
      if (!ctx.live()) return;
      const library = data.result.data || data.result;
      const connectionId=picker.getValue();UI.closeModal();await onCreated({...library,connectionId,collectionId:library.id,type:'document'});
    });
  });
}
