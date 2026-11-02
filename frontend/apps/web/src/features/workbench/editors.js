import { createUuid } from '../../lib/uuid.js';
import { esc, modal, footer, creationKey, markdown } from './ui.js';

const icons = [['package','通用工作台'],['file-check','文件审查'],['bar-chart-3','业务分析'],['activity','舆情监测'],['terminal','研发协同'],['wrench','系统运维'],['file-text','法律文书'],['briefcase','业务管理'],['layers','资源协作'],['book-open','知识整理']];
export function editWorkbench(wb, valid, onSaved) {
  const key = creationKey();
  modal(wb ? '编辑工作台' : '定制新工作台', `
    <p class="wbc-dialog-note">${wb ? '更新工作台的名称、说明与显示样式。' : '创建业务工作台，再发布智能体运行资源。'}</p>
    <section class="card wbc-form-card">
      <div class="tc-head"><h3 class="tc-title">${ICON('file-text',15)}基本信息</h3></div>
      <div class="wbc-form-body">
        <div class="field"><label for="wc-name">工作台名称</label><input id="wc-name" maxlength="160" value="${esc(wb?.name)}" placeholder="例如：业务分析工作台"></div>
        <div class="field"><label for="wc-desc">工作台说明</label><textarea id="wc-desc" maxlength="2000" rows="3" placeholder="描述工作台面向的业务与使用场景">${esc(wb?.desc)}</textarea></div>
        <div class="wbc-appearance-grid">
          <div class="field"><label>工作台图标</label><div class="wbc-icon-picker"><span class="wb-icon" id="wc-icon-preview"></span><div id="wc-icon"></div></div></div>
          <div class="field"><label for="wc-color">主题颜色</label><div class="wbc-color-picker"><input id="wc-color" type="color" value="${esc(wb?.color || '#6C63F0')}"><code id="wc-color-value"></code></div></div>
        </div>
      </div>
    </section>
    ${footer(wb ? '保存修改' : '创建工作台')}`, valid, ctx => {
    const field = name => ctx.box.querySelector('#wc-' + name);
    const updateIcon = value => { field('icon-preview').innerHTML = ICON(value,17); };
    const updateColor = () => { field('icon-preview').style.setProperty('--wc',field('color').value); field('color-value').textContent = field('color').value.toUpperCase(); };
    const icon = ctx.select('#wc-icon', { label: '工作台图标', options: icons.map(([value,label]) => ({ value,label })), value: wb?.icon || 'package', onChange: updateIcon });
    updateIcon(icon.getValue()); updateColor(); field('color').addEventListener('input',updateColor);
    ctx.action('[data-save]', async () => {
      const payload = { name: field('name').value.trim(), desc: field('desc').value.trim(), color: field('color').value, icon: icon.getValue() };
      if (!payload.name) throw new Error('请输入工作台名称');
      if (wb) payload.revision = wb.revision;
      const result = wb ? await API.updateWorkbench(wb.id, payload) : await API.createWorkbench(payload, key(payload));
      if (!ctx.live()) return; UI.closeModal(); UI.toast(wb ? '工作台已更新' : '工作台已创建'); onSaved(result.data);
    });
  }, 'workbench-create-modal');
}

export function editOntology(data, valid, onSaved) {
  const c = data.config, entities = structuredClone(c.entities), relations = structuredClone(c.relations), pickers = new Map();
  const area = (id, label, value, preview = false) => `<div class="field"><label for="oc-${id}">${label}</label><textarea id="oc-${id}" rows="5" maxlength="24000">${esc(value)}</textarea>${preview ? `<button class="btn btn-ghost btn-sm" data-preview="${id}" type="button">预览 Markdown</button><div class="config-markdown" data-preview-body="${id}" hidden></div>` : ''}</div>`;
  modal('编辑业务本体定义 · ' + data.workbench.name, `
    <p class="wbc-dialog-note">保存为草稿，发布后用于新建项目。</p>
    <section class="card wbc-form-card">
      <div class="tc-head"><h3 class="tc-title">${ICON('file-text',15)}业务本体定义</h3><span class="wbc-field-help">发布前需完整填写</span></div>
      <div class="wbc-form-body">
        <div class="grid grid-2"><div class="field"><label for="oc-bizName">业务名称</label><input id="oc-bizName" maxlength="240" value="${esc(c.bizName)}" placeholder="例如：业务分析业务"></div><div class="field"><label for="oc-domain">业务领域</label><input id="oc-domain" maxlength="240" value="${esc(c.domain)}" placeholder="例如：经营分析"></div></div>
        ${area('bizDef', '业务本体定义', c.bizDef)}
      </div>
    </section>
    <details class="config-editor-section wbc-editor-section"><summary>${ICON('book-open',15)}术语 wiki${ICON('chevron-down',14)}</summary><div class="wbc-form-body">${area('wikiMd', '术语与业务语义（Markdown）', c.wikiMd, true)}</div></details>
    <details class="config-editor-section wbc-editor-section"><summary>${ICON('layers',15)}业务实体与关系${ICON('chevron-down',14)}</summary><div class="wbc-form-body">
      <div class="config-table-wrap"><table class="table"><thead><tr><th>实体名称</th><th>说明</th><th></th></tr></thead><tbody id="oc-entities"></tbody></table></div><button class="btn btn-ghost btn-sm" id="oc-add-entity" type="button">添加实体</button>
      <div class="config-table-wrap"><table class="table"><thead><tr><th>关系名称</th><th>源实体</th><th>目标实体</th><th>说明</th><th></th></tr></thead><tbody id="oc-relations"></tbody></table></div><button class="btn btn-ghost btn-sm" id="oc-add-relation" type="button">添加关系</button>
    </div></details>
    <details class="config-editor-section wbc-editor-section"><summary>${ICON('file-check',15)}适用与排除规则${ICON('chevron-down',14)}</summary><div class="wbc-form-body">${area('applicabilityMd', '适用规则（Markdown）', c.applicabilityMd, true)}${area('exclusionsMd', '排除规则（Markdown）', c.exclusionsMd, true)}</div></details>
    <details class="config-editor-section wbc-editor-section"><summary>${ICON('bot',15)}系统提示词与默认专家${ICON('chevron-down',14)}</summary><div class="wbc-form-body">${area('systemPrompt', '系统提示词', c.systemPrompt)}<div class="field"><label>默认专家</label><div id="oc-default"></div><p class="wbc-field-help">仅可选择已引用的专家，也可保持未选择。</p></div></div></details>
    ${footer('保存草稿')}`, valid, ctx => {
    const field = id => ctx.box.querySelector('#oc-' + id);
    const defaultAgent = ctx.select('#oc-default', { label: '默认专家', value: c.defaultAgentId || undefined, allowClear: true, options: data.agents.map(a => ({ value: a.id, label: a.name + ' · ' + a.role })) });
    const options = () => entities.map(e => ({ value: e.id, label: e.name || '未命名实体' }));
    const updateOptions = () => pickers.forEach(pair => pair.forEach(p => p.setOptions(options())));
    function entityRow(entity) {
      const row = document.createElement('tr');
      row.innerHTML = `<td><input aria-label="实体名称" maxlength="160" value="${esc(entity.name)}"></td><td><input aria-label="实体说明" maxlength="2000" value="${esc(entity.description)}"></td><td><button class="btn-icon" type="button" title="移除实体">${ICON('trash-2', 13)}</button></td>`;
      field('entities').appendChild(row);
      row.querySelectorAll('input').forEach((input, index) => input.addEventListener('input', () => { entity[index ? 'description' : 'name'] = input.value; updateOptions(); }));
      row.querySelector('button').addEventListener('click', () => {
        if (relations.some(r => r.sourceEntityId === entity.id || r.targetEntityId === entity.id)) { ctx.error(new Error('请先移除引用该实体的关系')); return; }
        entities.splice(entities.indexOf(entity), 1); row.remove(); updateOptions();
      });
    }
    function relationRow(relation) {
      const row = document.createElement('tr');
      row.innerHTML = `<td><input aria-label="关系名称" maxlength="160" value="${esc(relation.name)}"></td><td><div id="rs-${relation.id}"></div></td><td><div id="rt-${relation.id}"></div></td><td><input aria-label="关系说明" maxlength="2000" value="${esc(relation.description)}"></td><td><button class="btn-icon" type="button" title="移除关系">${ICON('trash-2', 13)}</button></td>`;
      field('relations').appendChild(row);
      const pair = ['sourceEntityId', 'targetEntityId'].map((key, i) => ctx.select('#' + (i ? 'rt-' : 'rs-') + relation.id, { label: i ? '目标实体' : '源实体', options: options(), value: relation[key] || undefined, onChange: value => { relation[key] = value; } }));
      pickers.set(relation.id, pair);
      // Ant Design also creates inputs; only edit the two explicit text cells.
      [row.cells[0].querySelector('input'), row.cells[3].querySelector('input')].forEach((input, i) => input.addEventListener('input', () => { relation[i ? 'description' : 'name'] = input.value; }));
      row.querySelector('button').addEventListener('click', () => { pair.forEach(p => p.destroy()); pickers.delete(relation.id); relations.splice(relations.indexOf(relation), 1); row.remove(); });
    }
    entities.forEach(entityRow); relations.forEach(relationRow);
    field('add-entity').addEventListener('click', () => { const entity = { id: createUuid(), name: '', description: '' }; entities.push(entity); entityRow(entity); updateOptions(); });
    field('add-relation').addEventListener('click', () => {
      if (!entities.length) { ctx.error(new Error('请先添加实体')); return; }
      const relation = { id: createUuid(), name: '', description: '', sourceEntityId: '', targetEntityId: '' }; relations.push(relation); relationRow(relation);
    });
    ctx.box.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => {
      const preview = ctx.box.querySelector(`[data-preview-body="${button.dataset.preview}"]`); preview.hidden = false; preview.innerHTML = markdown(field(button.dataset.preview).value);
    }));
    ctx.action('[data-save]', async () => {
      const payload = { revision: c.revision, defaultAgentId: defaultAgent.getValue() || null, entities, relations };
      for (const name of ['bizName','domain','bizDef','wikiMd','applicabilityMd','exclusionsMd','systemPrompt']) payload[name] = field(name).value;
      const result = await API.saveWorkbenchConfig(data.workbench.id, payload);
      if (!ctx.live()) return; UI.closeModal(); UI.toast('业务本体草稿已保存'); onSaved(result.data);
    });
  }, 'workbench-ontology-modal');
}
