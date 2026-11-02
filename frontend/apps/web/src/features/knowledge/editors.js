import { esc, statusLabel, knowledgeModal, modalFooter } from './lifecycle.js';

export function openConnectionEditor({ connection = null, valid = () => true, onSaved = () => {} }) {
  const title = connection ? '编辑知识库连接' : '新增知识库连接';
  const c = connection || {};
  const content = '<div class="knowledge-form">' +
    '<div class="field"><label for="kc-name">连接名称</label><input id="kc-name" maxlength="160" value="' + esc(c.name) + '" placeholder="例如：公司知识库"></div>' +
    '<div class="field"><label>知识库驱动</label><div id="kc-driver"></div></div>' +
    '<div class="field" data-tenant-field><label for="kc-tenant">空间 ID（平台 Key 时必填）</label><input id="kc-tenant" maxlength="20" inputmode="numeric" value="' + esc(c.tenantId) + '"></div>' +
    '<div class="field"><label for="kc-published">使用范围</label><label class="knowledge-check"><input id="kc-published" type="checkbox" ' + (c.published ? 'checked' : '') + '>允许用户通过此连接新建自己的知识库</label></div>' +
    '<div class="field knowledge-wide"><label for="kc-url">连接地址</label><input id="kc-url" maxlength="2048" value="' + esc(c.endpoint) + '" placeholder="http://服务器:3001/mcp/common-knowledge"></div>' +
    '<div class="field"><label>认证方式</label><div id="kc-auth"></div></div>' +
    '<div class="field"><label for="kc-enabled">启用状态</label><label class="knowledge-check"><input type="checkbox" id="kc-enabled" ' + (c.enabled !== false ? 'checked' : '') + '><span>启用连接</span></label></div>' +
    '<div class="field" data-header-field><label for="kc-header">认证 Header</label><input id="kc-header" maxlength="128" value="' + esc(c.authHeader) + '" placeholder="例如 X-API-Key"></div>' +
    '<div class="field" data-secret-field><label for="kc-secret">认证信息</label><input id="kc-secret" type="password" autocomplete="new-password" maxlength="4096" placeholder="' + (c.hasSecret ? '留空保留已保存凭据' : '请输入认证值') + '"></div></div>' +
    '<div class="knowledge-connection-test"><div class="knowledge-actions"><button class="btn btn-ghost" data-test>测试连接并读取知识库</button><button class="btn btn-ghost" data-drivers>刷新驱动</button></div><div class="knowledge-note" data-test-result role="status" aria-live="polite"></div></div>' +
    '<p class="knowledge-connection-help">仅管理员可维护连接。开放连接不会共享其中的知识库；远端已有库需要明确分配。已有内容时服务地址和空间不可切换。</p>' +
    modalFooter('保存连接');
  knowledgeModal(title, content, valid, ctx => {
    ctx.box.classList.add('knowledge-connection-editor');
    ctx.cleanup(() => ctx.box.classList.remove('knowledge-connection-editor'));
    const note = ctx.box.querySelector('[data-test-result]');
    const invalidate = () => { note.textContent = ''; };
    const driver = ctx.select('#kc-driver', { label: '知识库驱动', value: c.driver || 'nebulae-v100-rest', onChange: () => { configureDriver(); invalidate(); } });
    const updateAuth = value => {
      ctx.box.querySelector('[data-header-field]').hidden = value !== 'header';
      ctx.box.querySelector('[data-secret-field]').hidden = value === 'none';
    };
    const auth = ctx.select('#kc-auth', { label: '认证方式', value: c.authType || 'none',
      options: [{ value: 'none', label: '无认证' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'header', label: '自定义认证 Header' }],
      onChange: value => { updateAuth(value); invalidate(); } });
    const configureDriver = () => {
      const rest = driver.getValue() === 'nebulae-v100-rest';
      ctx.box.querySelector('[data-tenant-field]').hidden = !rest;
      ctx.box.querySelector('#kc-url').placeholder = rest || driver.getValue() === 'nebulae-v101-rest' ? 'https://知识库服务器（或 /api/v1）' : 'http://服务器:3001/mcp/common-knowledge';
      auth.setOptions(rest ? [{ value: 'header', label: 'API Key' }] : [{ value: 'none', label: '无认证' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'header', label: '自定义认证 Header' }]);
      if(driver.getValue() === 'nebulae-v101-rest' && !connection) auth.setValue('none');
      if (rest) { auth.setValue('header'); ctx.box.querySelector('#kc-header').value = 'X-API-Key'; }
      ctx.box.querySelector('#kc-header').readOnly = rest; updateAuth(auth.getValue());
    };
    configureDriver();
    updateAuth(auth.getValue());
    ctx.box.querySelectorAll('input').forEach(input => input.addEventListener('input', invalidate));
    ctx.cleanup(() => { ctx.box.querySelector('#kc-secret').value = ''; });
    const payload = () => {
      const name = ctx.box.querySelector('#kc-name').value.trim(), endpoint = ctx.box.querySelector('#kc-url').value.trim();
      if (!name || !endpoint || !driver.getValue()) throw new Error('请填写名称、连接地址并选择知识库驱动');
      const rest = driver.getValue() === 'nebulae-v100-rest';
      const p = { name, endpoint, driver: driver.getValue(), authType: rest ? 'header' : auth.getValue(), authHeader: rest ? 'X-API-Key' : auth.getValue() === 'header' ? ctx.box.querySelector('#kc-header').value.trim() : '', enabled: ctx.box.querySelector('#kc-enabled').checked, published: ctx.box.querySelector('#kc-published').checked, tenantId: rest ? ctx.box.querySelector('#kc-tenant').value.trim() : '' };
      const secret = ctx.box.querySelector('#kc-secret').value;
      if (secret || !connection) p.secret = secret;
      if (connection) p.revision = connection.revision;
      return p;
    };
    const loadDrivers = async () => {
      const result = await API.fetchKnowledgeDrivers(ctx.signal); if (!ctx.live()) return;
      driver.setOptions(result.data.map(item => ({ value: item.id, label: item.name, disabled: !!connection && item.id !== c.driver })));
      if (!driver.getValue() && result.data.length === 1) driver.setValue(result.data[0].id);
      if (!result.data.length) throw new Error('暂无可用知识库驱动');
    };
    loadDrivers().catch(error => ctx.error(error));
    ctx.action('[data-drivers]', loadDrivers);
    ctx.action('[data-test]', async () => {
      const p = payload(); const result = await API.testKnowledgeDraft(p, connection?.id, ctx.signal);
      if (!ctx.live()) return;
      const rows = result.data.collections || [];
      note.textContent = rows.length ? '读取连接成功，发现 ' + rows.length + ' 个知识库；未测试写权限。' : '连接成功，目录为空；保存并开放后可新建知识库。';
    });
    ctx.action('[data-save]', async () => {
      const p = payload();
      if (connection) await API.updateKnowledgeConnection(connection.id, p, ctx.signal);
      else await API.createKnowledgeConnection(p, ctx.signal);
      if (!ctx.live()) return;
      UI.closeModal(); await onSaved();
    });
  });
}

export function openReferencePicker(scope, valid, onSaved, initial = null) {
  knowledgeModal('引用知识库', '<div class="field"><label>选择知识库连接</label><div id="kr-connection"></div></div><div class="knowledge-actions"><button class="btn btn-ghost btn-sm" data-load>刷新知识库目录</button></div><div class="knowledge-note" data-note></div><div class="field"><label>选择一个知识库</label><div id="kr-collection"></div></div>' + modalFooter('确认引用'), valid, ctx => {
    let generation = 0, loadingController;
    const collection = ctx.select('#kr-collection', { label: '选择一个知识库' });
    const load = async () => {
      const token = ++generation;
      loadingController?.abort(); loadingController = new AbortController();
      collection.setValue(undefined); collection.setOptions([]);
      const selected = connection.getValue();
      if (!selected) return;
      ctx.box.querySelector('[data-note]').textContent = '正在读取知识库目录…';
      try {
        const result = await API.fetchKnowledgeCollections(selected, loadingController.signal);
        if (!ctx.live() || token !== generation) return;
        const used = new Set(scope.knowledgeBases.filter(r => r.connectionId === selected).map(r => r.collectionId));
        const rows = result.data.collections || [];
        collection.setOptions(rows.map(item => ({ value: item.id, label: item.name + ' · ' + statusLabel(item.indexingStatus) + ' · ' + item.id, disabled: used.has(item.id) })));
        if (initial?.connectionId === selected && rows.some(item => item.id === initial.collectionId) && !used.has(initial.collectionId)) collection.setValue(initial.collectionId);
        ctx.box.querySelector('[data-note]').textContent = rows.length ? '每条引用只对应选中的一个知识库。已引用项不可重复选择。' : '此连接当前没有可见知识库。';
      } catch (error) {
        if (ctx.live() && token === generation && error.name !== 'AbortError') { ctx.box.querySelector('[data-note]').textContent = '目录读取失败，可点击刷新重试。'; ctx.error(error); }
      }
    };
    const connection = ctx.select('#kr-connection', { label: '选择知识库连接', value: initial?.connectionId,
      options: scope.connections.map(c => ({ value: c.id, label: c.name + ' · 统一连接' + (c.enabled ? '' : ' · 已禁用'), disabled: !c.enabled })),
      onChange: () => { ctx.clear(); void load(); } });
    ctx.cleanup(() => { generation++; loadingController?.abort(); });
    ctx.action('[data-load]', load);
    if (initial) void load();
    ctx.action('[data-save]', async () => {
      if (!connection.getValue() || !collection.getValue()) throw new Error('请选择连接和一个知识库');
      await API.bindKnowledge(scope.kind, scope.id, { revision: scope.revision, connectionId: connection.getValue(), collectionId: collection.getValue() }, ctx.signal);
      if (!ctx.live()) return; UI.closeModal(); await onSaved();
    });
  });
}
