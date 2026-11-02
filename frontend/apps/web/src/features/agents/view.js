import { mountRuntimeEditor } from '../runtime/RuntimeEditor.jsx';
import { mountDatabaseScope } from '../databases/databaseMount.js';
import { openCreateExpertModal } from './createExpertModal.js';
import { expertSettingsForm, mountExpertSettings } from './expertSettings.js';
import { openRemoveExpertModal } from './removeExpertModal.js';
import { renderKnowledgeScope } from '../knowledge/views.js';
import { renderMemoryScope } from '../memory/views.js';
import { mountWorkflowCanvas } from './workflowCanvas.js';
import { materializeWorkflowEdges } from './workflowGraph.js';
import { mountSopWorkflow, workflowRoute } from '../workflows/sopWorkflow.js';
import { renderSopLayout, sopConfigValues } from './sopLayout.js';
import { mountProcessCanvas } from './processCanvas.js';
import './sopLayout.css';
import { lifetime } from '../knowledge/lifecycle.js';
import { usageText, tokenCount, usageTrend, taskDistribution } from '../tasks/usage.js';
import { workflowKey } from '../../services/workflowKey.js';
/* views/agents.js — 专家智能体管理(能力核心)+ 专家详情 */
(function () {
  window.Views = window.Views || {};

  const successRate = a => a.stats.successRate == null ? '暂无数据' : Number(a.stats.successRate).toFixed(1) + '%';
  const displayTime = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
  const removeButton = a => a.sourceMarketId ? `<button class="btn btn-ghost btn-sm" data-remove-expert="${a.id}">${ICON('x', 12)}从我的专家移除</button>` : '';
  function onAction(button, operation) {
    button.addEventListener('click', async event => {
      if (button.disabled) return;
      button.disabled = true;
      try { await operation(event); }
      catch (error) { if (button.isConnected) UI.toast(error.message || '保存失败，请重试', 'err'); }
      finally { button.disabled = false; }
    });
  }

  /* ---------- 列表页 ---------- */
  Views.agents = {
    async render(el) {
      el.viewCleanup?.(); el.viewCleanup=null;
      const route = location.hash, stamp = {};
      el.expertRender = stamp;
      const live = () => el.isConnected && el.expertRender === stamp && location.hash === route;
      el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
      let agents;
      try { ({ data: agents } = await API.fetchAgents()); }
      catch (error) {
        if (!live()) return;
        el.innerHTML = '<div class="page"><div class="card empty"><div>' + UI.esc(error.message || '专家列表加载失败') + '</div><button class="btn btn-ghost btn-sm" data-retry-experts>重新加载</button></div></div>';
        el.querySelector('[data-retry-experts]').addEventListener('click', () => Views.agents.render(el));
        return;
      }
      if (!live()) return;

      el.innerHTML = `
      <div class="page">
        <div class="pd-head reveal">
          <div>
            <div class="pd-title">专家智能体</div>
            <div class="pd-sub">能力核心:为每位专家配置知识库、记忆、插件与 SOP 工作流,在项目任务中按需调用,能力随数据回流持续提升。</div>
          </div>
          <button class="btn btn-primary" id="btn-new-agent">${ICON('plus', 14)}创建专家</button>
        </div>
        <div class="grid grid-3 reveal reveal-1">
          ${agents.map(a => `
            <div class="card clickable agent-card" data-agent="${a.id}">
              <div class="agent-head">
                <span class="agent-ava" style="background:${a.color}">${UI.esc(a.initials)}</span>
                <div style="flex:1;min-width:0">
                  <div class="agent-name">${UI.esc(a.name)}</div>
                  <div class="agent-role">${UI.esc(a.role)}</div>
                </div>
                <span class="pill pill-dim mono">${UI.esc(a.model)}</span>
              </div>
              <div class="agent-tagline">${UI.esc(a.tagline)}</div>
              <div class="agent-kv">
                <div class="kv"><b>${tokenCount(a.stats.tasks)}</b><span>累计任务</span></div>
                <div class="kv"><b>${successRate(a)}</b><span>成功率</span></div>
                <div class="kv"><b>${UI.esc(usageText(a.stats))}</b><span>消耗</span></div>
              </div>
              <div class="lvl-bar">
                <span class="mono">Lv.${a.level}</span>
                <div class="bar"><i style="width:${a.xp}%"></i></div>
                <span class="mono">${a.xp}%</span>
              </div>
              <div class="chip-row">
                ${a.plugins.slice(0, 3).map(p => '<span class="chip" title="历史引用，未安装">' + ICON('puzzle', 11) + UI.esc(p) + ' · 历史引用</span>').join('')}
                ${a.kbIds.length ? '<span class="chip">' + ICON('book-open', 11) + a.kbIds.length + ' 个知识库</span>' : ''}
              </div>
              ${a.sourceMarketId ? '<div class="agent-foot">' + removeButton(a) + '</div>' : ''}
            </div>`).join('')}
        </div>
        ${agents.length ? '' : '<div class="card empty">暂无专家，可创建专家或<a href="#/plaza?tab=agent">前往专家市场添加</a>。</div>'}
      </div>`;

      el.querySelectorAll('[data-agent]').forEach(c =>
        c.addEventListener('click', () => location.hash = '#/agent/' + c.dataset.agent));
      el.querySelector('#btn-new-agent').addEventListener('click', () => this.openCreateModal());
      el.querySelectorAll('[data-remove-expert]').forEach(b => onAction(b, event => {
        event.stopPropagation();
        openRemoveExpertModal({ expert: agents.find(a => a.id === b.dataset.removeExpert), api: API, ui: UI, icon: ICON,
          onRemoved: () => { if (live()) return Views.agents.render(el); } });
      }));
    },

    openCreateModal() {
      openCreateExpertModal({ api: API, ui: UI, icon: ICON });
    }
  };

  /* ---------- 详情页(顶部二级菜单含专家设置) ---------- */
  const AG_TABS = [
    ['overview', '概览', 'layout-dashboard'], ['sop', 'SOP', 'layers'],
    ['kb', '知识库', 'book-open'], ['databases', '数据库', 'database'], ['ext', '扩展', 'puzzle'],
    ['tasks', '参与任务', 'message-square'], ['usage', '消耗统计', 'bar-chart-3'],
    ['tpls', '引用模板', 'layout-template'], ['rules', '规则库', 'shield'],
    ['memory', '经验记忆', 'brain'],
    ['settings', '设置', 'settings']
  ];

  function agHeadCard(a, showRemove = true) {
    return `
      <div class="card card-pad reveal" style="margin-bottom:20px">
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <span class="agent-ava" style="width:60px;height:60px;font-size:22px;border-radius:16px;background:${a.color}">${UI.esc(a.initials)}</span>
          <div style="flex:1;min-width:220px">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="pd-title" style="font-size:22px">${UI.esc(a.name)}</span>
              <span class="pill pill-primary">Lv.${a.level}</span>
            </div>
            <div class="sub" style="font-size:13px;margin-top:6px">${UI.esc(a.tagline)}</div>
            <div class="dim" style="font-size:12px;margin-top:6px">${UI.esc(a.role)} · 基础模型 <span class="mono">${UI.esc(a.model)}</span></div>
          </div>
          <div class="agent-kv" style="min-width:300px">
            <div class="kv"><b>${tokenCount(a.stats.tasks)}</b><span>累计任务</span></div>
            <div class="kv"><b>${successRate(a)}</b><span>成功率</span></div>
            <div class="kv"><b>${UI.esc(usageText(a.stats))}</b><span>累计消耗</span></div>
          </div>
          ${showRemove ? removeButton(a) : ''}
        </div>
      </div>`;
  }

  function agTabSettings(a) {
    const market = Boolean(a.sourceMarketId);
    return `<div data-expert-settings-header>${agHeadCard(a, false)}</div>
      <section class="card expert-settings-card">
        <div class="tc-head"><div class="tc-title">${ICON('settings',16)}专家设置</div></div>
        <div data-expert-profile>${expertSettingsForm(a, UI, ICON)}</div>
        <div class="expert-settings-runtime" data-runtime-settings></div>
        <div class="expert-settings-danger">
          <span class="expert-settings-danger-icon">${ICON('trash-2',20)}</span>
          <div class="expert-settings-danger-copy">
            <h3>${market ? '从我的专家移除' : '删除专家'}</h3>
            <p>${market ? '从当前账号的专家列表中移除，之后可在专家市场重新添加。' : '删除后，该专家将从当前账号的列表中移除，无法再查看或配置。'}</p>
            <p class="expert-settings-note">历史发布版本和项目快照保留。若工作台仍在引用，请先解除引用。</p>
          </div>
          <button class="btn btn-danger" ${market ? 'data-remove-expert' : 'data-delete-expert'}="${UI.esc(a.id)}">${ICON('trash-2',14)}${market ? '从我的专家移除' : '删除专家'}</button>
        </div>
      </section>`;
  }

  function agTabOverview(a, d, kbs, exts) {
    return agHeadCard(a) + `
      <div class="grid grid-2">
        <div class="card card-pad reveal reveal-1">
          <div class="tc-title" style="margin-bottom:6px">${ICON('trending-up', 15)}能力提升 · 数据回流</div>
          <div class="section-desc" style="margin-bottom:8px">记录经确认的任务经验与规则改进。</div>
          ${d.growth.length ? d.growth.map(g => `
            <div class="growth-item">
              <span class="growth-icon">${ICON('sparkles', 15)}</span>
              <div>
                <div style="font-size:13px"><span class="pill pill-primary" style="margin-right:8px">${g.kind}</span>${UI.esc(g.desc)}</div>
                <div class="dim" style="font-size:11px;margin-top:5px">${g.time} · 来自任务:${UI.esc(g.from)}</div>
              </div>
            </div>`).join('') : '<div class="empty" style="padding:24px">暂无成长记录；经验草稿和审核记录请查看「经验记忆」</div>'}
        </div>
        <div class="card card-pad reveal reveal-2">
          <div class="tc-title" style="margin-bottom:12px">${ICON('puzzle', 15)}能力配置摘要</div>
          <div class="file-row"><span class="file-icon">${ICON('layers', 15)}</span><div style="flex:1;font-size:13px">SOP 工作流</div><span class="mono dim">${a.sop.length} 步</span></div>
          <div class="file-row"><span class="file-icon">${ICON('book-open', 15)}</span><div style="flex:1;font-size:13px">挂载知识库</div><span class="mono dim">${kbs.length} 个</span></div>
          <div class="file-row"><span class="file-icon">${ICON('puzzle', 15)}</span><div style="flex:1;font-size:13px">运行扩展</div><span class="mono dim">${d.runtimeExtensionCount == null ? '—' : d.runtimeExtensionCount + ' 个'}</span></div>
          <div class="lvl-bar" style="margin-top:16px">
            <span class="mono">Lv.${a.level}</span>
            <div class="bar"><i style="width:${a.xp}%"></i></div>
            <span class="mono">${a.xp}%</span>
          </div>
          <div class="dim" style="font-size:11px;margin-top:8px">暂无成长记录</div>
        </div>
      </div>`;
  }

  /* ---------- SOP 集:支持工作流编排与标准化流程两种形态 ---------- */
  function sopSetsOf(a) {
    return DB.sopSets[a.id] || [];
  }

  function agTabSop(a) {
    const sets = sopSetsOf(a);
    return agHeadCard(a) + `
      <div class="card expert-sop reveal reveal-1">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('layers', 15)}SOP 集<span class="pill pill-dim" id="sop-count" style="margin-left:8px">${sets.length}</span></span>
          <button class="btn btn-primary btn-sm" id="btn-sop-new">${ICON('plus', 13)}新建 SOP 集</button>
        </div>
        <div class="audit-filter" id="sop-chips" style="position:static"></div>
        <div class="tc-body" id="sop-detail"></div>
      </div>`;
  }

  function sopWfDetail(set, agentId) {
    return renderSopLayout(set, agentId, { ui: UI, icon: ICON, api: API });
  }

  function sopProcDetail(set, agentId) {
    return renderSopLayout(set, agentId, { ui: UI, icon: ICON, api: API });
  }

  function bindSopTab(a, el) {
    const chipsEl = el.querySelector('#sop-chips');
    const detailEl = el.querySelector('#sop-detail');
    if (!detailEl) return;
    let selId = '', renderedSop = '', cleanupCanvas;
    const sets = () => sopSetsOf(a);
    const cur = () => sets().find(s => s.id === selId);
    const paintChips = () => {
      el.querySelector('#sop-count').textContent = sets().length;
      chipsEl.innerHTML = sets().map(s =>
        '<button class="af-chip' + (selId === s.id ? ' on' : '') + '" data-sop-sel="' + s.id + '">' +
        (s.kind === 'workflow' ? ICON('workflow', 11) + ' ' : ICON('list-todo', 11) + ' ') + UI.esc(s.name) + '</button>').join('');
      chipsEl.querySelectorAll('[data-sop-sel]').forEach(b => b.addEventListener('click', () => { selId = b.dataset.sopSel; paintChips(); paintDetail(); }));
    };
    const paintDetail = () => {
      const viewport = detailEl.querySelector('.wf-viewport');
      const scroll = renderedSop === selId && viewport ? { x: viewport.scrollLeft, y: viewport.scrollTop } : null;
      cleanupCanvas?.();
      const set = cur();
      renderedSop = selId;
      if (!set) { detailEl.innerHTML = '<div class="empty" style="padding:26px">请选择一个 SOP 集查看详情</div>'; return; }
      detailEl.innerHTML = `
        <div class="sop-detail-heading">
          <div style="min-width:0">
            <div style="font-size:14px;font-weight:600">${UI.esc(set.name)}
              <span class="pill ${set.kind === 'workflow' ? '' : 'pill-success'}" style="margin-left:8px;${set.kind === 'workflow' ? 'background:var(--accent-dim);color:var(--accent)' : ''}">${set.kind === 'workflow' ? 'Workflow' : '标准化流程'}</span>
            </div>
            <div class="dim" style="font-size:12px;margin-top:4px;line-height:1.5">${UI.esc(set.desc)}</div>
            <div class="dim mono" style="font-size:10.5px;margin-top:4px">更新 ${displayTime(set.updatedAt)}</div>
          </div>
          <div class="sop-heading-actions">
            <button class="btn btn-ghost btn-sm" id="btn-sop-cfg">${ICON('settings', 12)}${set.kind === 'workflow' && set.workflow ? '运行场景' : '编排配置'}</button>
            <button class="btn btn-ghost btn-sm" id="btn-sop-del" style="color:var(--danger)">${ICON('trash-2', 12)}删除</button>
          </div>
        </div>
        ${set.kind === 'workflow' ? sopWfDetail(set, a.id) : sopProcDetail(set, a.id)}`;
      if (set.kind === 'workflow') {
        const workflowCleanup = mountSopWorkflow(detailEl, set, a.id, API, UI);
        const historyCleanup = !set.workflow ? mountWorkflowCanvas(detailEl.querySelector('#wf-canvas'), set, {
          save: mutate => API.updateSop(a.id, set.id, mutate), editNode: node => openNodeModal(set, node), refresh: paintDetail, ui: UI,
        }) : null;
        cleanupCanvas = () => { workflowCleanup?.(); historyCleanup?.(); };
      }
      if (set.kind === 'process') cleanupCanvas = mountProcessCanvas(detailEl.querySelector('#wf-canvas'), set, {
        save: mutate => API.updateSop(a.id, set.id, mutate), editNode: node => openStepModal(set, node), refresh: paintDetail, ui: UI,
      });
      if (scroll) {
        const next = detailEl.querySelector('.wf-viewport');
        if (next) { next.scrollLeft = scroll.x; next.scrollTop = scroll.y; }
      }
      onAction(detailEl.querySelector('#btn-sop-del'), async () => {
        await API.deleteSop(a.id, set.id);
        selId = sets().length ? sets()[0].id : '';
        paintChips(); paintDetail();
        UI.toast('SOP 集已删除');
      });
      const cfgBtn = detailEl.querySelector('#btn-sop-cfg');
      if (cfgBtn) cfgBtn.addEventListener('click', () => openSopCfgModal(set));
      const upBtn = detailEl.querySelector('[data-sop-upload]');
      if (upBtn) upBtn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.addEventListener('change', async () => {
          if (!inp.files.length) return;
          upBtn.disabled = true;
          try { await API.uploadSopMaterial(a.id, set.id, inp.files[0]); paintDetail(); UI.toast('素材已上传'); }
          catch (error) { UI.toast(error.message || '上传失败', 'err'); }
          finally { upBtn.disabled = false; }
        });
        inp.click();
      });
      detailEl.querySelectorAll('[data-sop-rm-mat]').forEach(b => onAction(b, async () => {
        await API.removeSopMaterial(a.id, set.id, b.dataset.sopRmMat);
        paintDetail();
        UI.toast('素材已移除');
      }));
      const specBtn = detailEl.querySelector('[data-sop-add-spec]');
      if (specBtn) specBtn.addEventListener('click', () => {
        UI.modal('引用流程规范', `
          <div class="field"><label>规范名称</label><input id="sp-name" placeholder="如:经营分析制度(2025 修订)"></div>
          <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="sp-submit">引用</button></div>`, m => {
          onAction(m.querySelector('#sp-submit'), async () => {
            const v = m.querySelector('#sp-name').value.trim();
            if (!v) { UI.toast('请填写规范名称', 'err'); return; }
            await API.updateSop(a.id, set.id, draft => { draft.proc.specRefs.push(v); });
            UI.closeModal(); paintDetail(); UI.toast('已引用规范');
          });
        });
      });
      const nodeBtn = detailEl.querySelector('[data-sop-add-node]');
      if (nodeBtn && !set.workflow) nodeBtn.addEventListener('click', () => openNodeModal(set, null));
      const stepBtn = detailEl.querySelector('[data-sop-add-step]');
      if (stepBtn) stepBtn.addEventListener('click', () => openStepModal(set, null));
    };
    const openStepModal = (set, step) => {
      const edit = !!step;
      UI.modal(edit ? '编辑流程步骤' : '添加流程步骤', `
        <div class="field"><label>步骤名称</label><input id="st-t" placeholder="如:数据核对" value="${UI.esc(step?.t || '')}"></div>
        <div class="field"><label>操作说明</label><textarea id="st-d" placeholder="步骤的操作指引">${UI.esc(step?.d || '')}</textarea></div>
        <div class="field"><label>业务系统（选填）</label><input id="st-sys" placeholder="如:ERP 系统" value="${UI.esc(step?.sys || '')}"></div>
        <div class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="st-rpa" style="width:auto" ${step?.rpa ? 'checked' : ''}><label for="st-rpa" style="margin:0">RPA 操作标记</label></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="st-submit">${edit ? '保存' : '添加'}</button></div>`, m => {
        onAction(m.querySelector('#st-submit'), async () => {
          const t = m.querySelector('#st-t').value.trim();
          if (!t) { UI.toast('请填写步骤名称', 'err'); return; }
          const value = { t, d: m.querySelector('#st-d').value.trim(), sys: m.querySelector('#st-sys').value.trim(), rpa: m.querySelector('#st-rpa').checked };
          await API.updateSop(a.id, set.id, draft => {
            if (!edit) draft.proc.steps.push(value);
            else {
              const current = draft.proc.steps.find(node => node.id === step.id);
              if (!current) throw new Error('步骤已不存在，请重新加载');
              Object.assign(current, value);
            }
          });
          UI.closeModal(); paintDetail(); UI.toast(edit ? '流程步骤已保存' : '流程步骤已添加');
        });
      });
    };
    /* 节点新建/编辑弹窗 */
    const openNodeModal = (set, node) => {
      const isEdit = !!node;
      UI.modal(isEdit ? '编辑节点' : '添加工作流节点', `
        <div class="field"><label>节点名称</label><input id="nd-t" placeholder="如:数据拉取" value="${isEdit ? UI.esc(node.t) : ''}"></div>
        <div class="field"><label>节点说明</label><textarea id="nd-d" placeholder="节点职责与处理逻辑">${isEdit ? UI.esc(node.d) : ''}</textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="nd-submit">${isEdit ? '保存' : '添加'}</button></div>`, m => {
        onAction(m.querySelector('#nd-submit'), async () => {
          const t = m.querySelector('#nd-t').value.trim();
          if (!t) { UI.toast('请填写节点名称', 'err'); return; }
          const d = m.querySelector('#nd-d').value.trim();
          await API.updateSop(a.id, set.id, draft => {
            materializeWorkflowEdges(draft.wf);
            if (isEdit) {
              const current = draft.wf.nodes.find(n => n.id === node.id);
              if (!current) throw new Error('节点已不存在，请重新加载');
              Object.assign(current, { t, d });
            } else draft.wf.nodes.push({ t, d });
          });
          UI.closeModal(); paintDetail(); UI.toast(isEdit ? '节点已保存' : '节点已添加');
        });
      });
    };
    const openSopCfgModal = set => {
      if (set.kind === 'workflow' && set.workflow) { location.hash = workflowRoute(set.workflow.id, a.id) + '&configure=inputs'; return; }
      const values = sopConfigValues(set);
      UI.modal('SOP 编排配置 · ' + set.name, `
        <div class="field"><label>数据源</label><textarea id="cf-source">${UI.esc(values.source)}</textarea></div>
        <div class="field"><label>处理规则</label><textarea id="cf-rules">${UI.esc(values.rules)}</textarea></div>
        <div class="field"><label>输入</label><textarea id="cf-input">${UI.esc(values.input)}</textarea></div>
        <div class="field"><label>输出</label><textarea id="cf-output">${UI.esc(values.output)}</textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="cf-submit">保存配置</button></div>`, m => {
        onAction(m.querySelector('#cf-submit'), async () => {
          const config = Object.fromEntries(['source', 'rules', 'input', 'output'].map(key => [key, m.querySelector('#cf-' + key).value.trim()]));
          await API.updateSop(a.id, set.id, draft => { Object.assign(draft.kind === 'workflow' ? draft.wf : draft.proc, config); });
          UI.closeModal(); paintDetail(); UI.toast('编排配置已保存');
        });
      });
    };
    el.querySelector('#btn-sop-new').addEventListener('click', () => {
      UI.modal('新建 SOP 集', `
        <div class="field"><label>SOP 集名称</label><input id="ns-name" placeholder="如:合同起草流水线"></div>
        <div class="field"><label>形态</label><select id="ns-kind">
          <option value="workflow">Workflow（在 Workflow 中配置真实工作流）</option>
          <option value="process">标准化流程(参考素材/规范引用/操作步骤)</option>
        </select></div>
        <div class="field"><label>描述</label><textarea id="ns-desc" placeholder="该 SOP 集的适用场景与目标"></textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="ns-submit">创建</button></div>`, m => {
        const life = lifetime(m);
        UI.setModalCleanup(life.dispose);
        let attemptKey = workflowKey(), fingerprint;
        onAction(m.querySelector('#ns-submit'), async () => {
          const name = m.querySelector('#ns-name').value.trim();
          if (!name) { UI.toast('请填写 SOP 集名称', 'err'); return; }
          const kind = m.querySelector('#ns-kind').value;
          const payload = { name, kind, desc: m.querySelector('#ns-desc').value.trim() };
          const next = JSON.stringify(payload);
          if (fingerprint && fingerprint !== next) attemptKey = workflowKey();
          fingerprint = next;
          const { data: set } = await API.createSop(a.id, payload, kind === 'workflow' ? attemptKey : undefined);
          if (!life.live()) return;
          selId = set.id;
          UI.closeModal();
          if (set.workflow) { location.hash = workflowRoute(set.workflow.id, a.id); return; }
          paintChips(); paintDetail();
          UI.toast('SOP 集已创建');
        });
      });
    });
    selId = sets().length ? sets()[0].id : '';
    paintChips(); paintDetail();
  }

  function agTabKb(a, kbs) {
    return agHeadCard(a) + `
      <div class="reveal reveal-1" data-knowledge-scope></div>`;
  }

  function agTabTasks(a, d) {
    const total = d.taskTotal ?? a.stats.tasks;
    return agHeadCard(a) + '<div class="card reveal reveal-1"><div class="tc-head"><span class="tc-title">'+ICON('history',15)+'参与任务列表</span><span class="pill pill-dim">'+tokenCount(total)+'</span></div>'+
      (d.usage.unavailable?'<div class="empty">参与记录暂不可用</div>':d.tasks.length?d.tasks.map(t=>'<a class="sess-item" href="#/task/'+encodeURIComponent(t.id)+'"><div class="s-title">'+UI.esc(t.title)+'</div><div class="s-meta"><span>'+UI.esc(t.project)+'</span><span>·</span><span>'+UI.esc(t.role?.includes('primary')?'主专家':'协作专家')+'</span><span>·</span><span>'+UI.esc(displayTime(t.time))+'</span><span style="flex:1"></span>'+UI.statusPill(t.status)+'</div><div class="s-meta">'+UI.esc(usageText(t))+'</div></a>').join(''):'<div class="empty">暂无任务记录</div>')+
      ((d.offset||d.hasMore)?'<div class="config-actions" style="padding:16px">'+(d.offset?'<a class="btn btn-ghost btn-sm" href="#/agent/'+encodeURIComponent(a.id)+'?tab=tasks&taskOffset='+Math.max(0,d.offset-50)+'">上一页</a>':'')+(d.hasMore?'<a class="btn btn-ghost btn-sm" href="#/agent/'+encodeURIComponent(a.id)+'?tab=tasks&taskOffset='+((d.offset||0)+50)+'">下一页</a>':'')+'</div>':'')+'</div>';
  }

  function agTabUsage(a, d) {
    const stats=a.stats;
    const cards=[['累计消耗',usageText(stats),'全部实际调用'],['输入 Tokens',tokenCount(stats.inputTokens),'不含单列的缓存用量'],['输出 Tokens',tokenCount(stats.outputTokens),'包含模型报告的推理用量'],['任务成功率',successRate(a),'按每个参与任务的最近一次执行统计']];
    return agHeadCard(a)+'<div class="grid grid-4 reveal reveal-1" style="margin-bottom:20px">'+cards.map(([label,value,foot])=>'<div class="card stat-card"><div class="s-label">'+label+'</div><div class="s-value"'+(label==='累计消耗'?' style="font-size:20px;line-height:1.4"':'')+'>'+UI.esc(value)+'</div><div class="s-foot">'+foot+'</div></div>').join('')+'</div><div class="dim" style="margin-bottom:16px">模型调用 '+tokenCount(stats.callCount)+' 次 · 缓存读取 '+tokenCount(stats.cacheReadTokens)+' Tokens · 缓存写入 '+tokenCount(stats.cacheWriteTokens)+' Tokens</div><div class="grid grid-2"><div class="card card-pad"><div class="tc-title">近 14 日 Tokens 消耗</div>'+usageTrend(d.usage)+'</div><div class="card card-pad"><div class="tc-title">参与任务状态</div>'+(d.usage.unavailable?'<div class="empty">统计暂不可用</div>':taskDistribution(d.usage.taskStates||d.tasks))+'</div></div>';
  }

  function agTabTpls(a) {
    const ids = DB.agentTpls[a.id] || [];
    const tpls = ids.map(id => DB.plazaTemplates.find(t => t.id === id)).filter(Boolean);
    return agHeadCard(a) + `
      <div class="card reveal reveal-1">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('layout-template', 15)}引用的案例模板<span class="pill pill-dim" style="margin-left:8px">${tpls.length}</span></span>
          <button class="btn btn-primary btn-sm" id="btn-ref-more">${ICON('plus', 13)}从广场引用</button>
        </div>
        <div class="tc-body">
          ${tpls.length ? tpls.map(t => `
            <div class="file-row" style="align-items:flex-start">
              <span class="file-icon" style="color:${t.color};background:${t.color}1A">${ICON('layout-template', 15)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px">${UI.esc(t.name)}<span class="pill pill-dim" style="margin-left:8px">${UI.esc(t.scene)}</span></div>
                <div class="dim" style="font-size:11.5px;margin-top:3px;line-height:1.5">${UI.esc(t.desc)}</div>
                <div class="dim mono" style="font-size:10.5px;margin-top:3px">${ICON('download', 10)} ${t.uses} 次使用 · ${t.agents} 个专家协同</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-untpl="${t.id}" style="flex-shrink:0;color:var(--danger)">取消引用</button>
            </div>`).join('') : '<div class="empty" style="padding:26px">暂未引用案例模板,点击右上角「从广场引用」添加</div>'}
        </div>
      </div>`;
  }

  /* ---------- 规则库:业务规则创建/维护,支持规则场景集 ---------- */
  function agTabRules(a) {
    const rules = DB.agentRules[a.id] || [];
    return agHeadCard(a) + `
      <div class="card reveal reveal-1">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('shield', 15)}业务规则库<span class="pill pill-dim" id="agent-rule-count" style="margin-left:8px">${rules.length}</span></span>
          <span style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" id="btn-ruleset-new">${ICON('plus', 13)}新建规则集</button>
            <button class="btn btn-primary btn-sm" id="btn-rule-new">${ICON('plus', 13)}新建规则</button>
          </span>
        </div>
        <div class="audit-filter" id="rule-scenes" style="position:static"></div>
        <div class="tc-body" id="rule-list"></div>
      </div>`;
  }

  function ruleRow(r) {
    return `
      <div class="file-row" style="align-items:flex-start">
        <span class="file-icon" style="color:var(--accent);background:var(--accent-dim)">${ICON('shield', 14)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${UI.esc(r.name)}<span class="pill pill-dim">${UI.esc(r.scene)}</span>${r.enabled ? '' : '<span class="pill pill-danger">已停用</span>'}</div>
          <div class="dim" style="font-size:11.5px;margin-top:3px;line-height:1.5">${UI.esc(r.content)}</div>
          <div class="dim mono" style="font-size:10.5px;margin-top:3px">命中 ${r.hits} 次 · 更新 ${displayTime(r.updatedAt)}</div>
        </div>
        <button class="cron-switch ${r.enabled ? 'on' : ''}" data-rule-tg="${r.id}" title="${r.enabled ? '停用' : '启用'}"></button>
        <button class="btn-icon" data-rule-edit="${r.id}" title="编辑">${ICON('pencil', 13)}</button>
        <button class="btn-icon" data-rule-del="${r.id}" title="删除" style="color:var(--danger)">${ICON('trash-2', 13)}</button>
      </div>`;
  }

  /* 规则编辑/新建弹窗(scene 为空串表示新建场景集) */
  function ruleSceneNames(a) {
    /* 规则集注册表 ∪ 规则中实际出现的场景集 */
    const reg = (DB.ruleSets[a.id] || []).map(s => s.name);
    const used = (DB.agentRules[a.id] || []).map(r => r.scene);
    return [...new Set(reg.concat(used))];
  }

  function openRuleModal(a, rule, onSaved) {
    const scenes = ruleSceneNames(a);
    const isEdit = !!rule;
    const body = `
      <div class="field"><label>规则名称</label><input id="rl-name" placeholder="如:违约金上限校验" value="${isEdit ? UI.esc(rule.name) : ''}"></div>
      <div class="field"><label>规则场景集</label>
        <select id="rl-scene">
          ${scenes.map(s => '<option' + (isEdit && rule.scene === s ? ' selected' : '') + '>' + UI.esc(s) + '</option>').join('')}
          <option value="__new__">+ 新建场景集</option>
        </select>
      </div>
      <div class="field" id="rl-scene-new-wrap" style="display:none"><label>新场景集名称</label><input id="rl-scene-new" placeholder="如:合规校验"></div>
      <div class="field"><label>规则内容</label><textarea id="rl-content" placeholder="用自然语言描述业务规则，当前保存为配置草稿">${isEdit ? UI.esc(rule.content) : ''}</textarea></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="rl-submit">${isEdit ? '保存修改' : '创建规则'}</button>
      </div>`;
    UI.modal(isEdit ? '编辑规则' : '新建规则', body, m => {
      const sel = m.querySelector('#rl-scene');
      m.querySelector('#rl-scene-new-wrap').style.display = sel.value === '__new__' ? '' : 'none';
      sel.addEventListener('change', () => {
        m.querySelector('#rl-scene-new-wrap').style.display = sel.value === '__new__' ? '' : 'none';
      });
      onAction(m.querySelector('#rl-submit'), async () => {
        const name = m.querySelector('#rl-name').value.trim();
        const scene = sel.value === '__new__' ? m.querySelector('#rl-scene-new').value.trim() : sel.value;
        const content = m.querySelector('#rl-content').value.trim();
        if (!name || !scene || !content) { UI.toast('请填写完整规则信息', 'err'); return; }
        const selectedSet = (DB.ruleSets[a.id] || []).find(s => s.name === scene);
        await API.saveAgentRule(a.id, rule, { name, scene, content, ...(selectedSet ? { ruleSetId: selectedSet.id } : {}) });
        UI.closeModal();
        onSaved();
        UI.toast(isEdit ? '规则已更新' : '规则已创建并启用');
      });
    });
  }

  function bindRulesTab(a, el) {
    const scenesEl = el.querySelector('#rule-scenes');
    const listEl = el.querySelector('#rule-list');
    if (!listEl) return;
    let scene = '';
    const rules = () => DB.agentRules[a.id] || [];
    const paintScenes = () => {
      const names = ruleSceneNames(a);
      scenesEl.innerHTML = '<button class="af-chip' + (scene === '' ? ' on' : '') + '" data-rscene="">全部 ' + rules().length + '</button>' +
        names.map(n => '<button class="af-chip' + (scene === n ? ' on' : '') + '" data-rscene="' + UI.esc(n) + '">' + UI.esc(n) + ' ' + rules().filter(r => r.scene === n).length + '</button>').join('');
      scenesEl.querySelectorAll('[data-rscene]').forEach(b => b.addEventListener('click', () => {
        scene = b.dataset.rscene;
        paintScenes(); paintList();
      }));
    };
    const paintList = () => {
      el.querySelector('#agent-rule-count').textContent = rules().length;
      const tabCount = document.querySelector('[data-agtab="rules"] .cnt');
      if (tabCount) tabCount.textContent = rules().length;
      const list = rules().filter(r => !scene || r.scene === scene);
      listEl.innerHTML = list.length ? list.map(ruleRow).join('') : '<div class="empty" style="padding:26px">该场景集暂无规则,点击右上角「新建规则」创建</div>';
      listEl.querySelectorAll('[data-rule-tg]').forEach(b => onAction(b, async () => {
        const r = rules().find(x => x.id === b.dataset.ruleTg);
        const { data: saved } = await API.saveAgentRule(a.id, r, { enabled: !r.enabled });
        paintList();
        UI.toast(saved.enabled ? '规则已启用' : '规则已停用');
      }));
      listEl.querySelectorAll('[data-rule-edit]').forEach(b => b.addEventListener('click', () => {
        openRuleModal(a, rules().find(x => x.id === b.dataset.ruleEdit), () => { paintScenes(); paintList(); });
      }));
      listEl.querySelectorAll('[data-rule-del]').forEach(b => onAction(b, async () => {
        await API.deleteAgentRule(a.id, rules().find(x => x.id === b.dataset.ruleDel));
        if (scene && !ruleSceneNames(a).includes(scene)) scene = '';
        paintScenes(); paintList();
        UI.toast('规则已删除');
      }));
    };
    paintScenes(); paintList();
    el.querySelector('#btn-ruleset-new').addEventListener('click', () => {
      UI.modal('新建规则集', `
        <div class="field"><label>规则集名称</label><input id="rs-name" placeholder="如:合同文件审查规则"></div>
        <div class="field"><label>规则集说明</label><textarea id="rs-desc" placeholder="该规则集适用的业务场景"></textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="rs-submit">创建</button></div>`, m => {
        onAction(m.querySelector('#rs-submit'), async () => {
          const name = m.querySelector('#rs-name').value.trim();
          if (!name) { UI.toast('请填写规则集名称', 'err'); return; }
          if (ruleSceneNames(a).includes(name)) { UI.toast('规则集已存在', 'err'); return; }
          await API.createRuleSet(a.id, { name, desc: m.querySelector('#rs-desc').value.trim() });
          UI.closeModal();
          scene = name;
          paintScenes(); paintList();
          UI.toast('规则集已创建,可开始添加规则');
        });
      });
    });
    el.querySelector('#btn-rule-new').addEventListener('click', () => {
      openRuleModal(a, null, () => { paintScenes(); paintList(); });
    });
  }

  Views.agent = {
    async render(el, agentId, query) {
      el.viewCleanup?.(); el.viewCleanup = null;
      const route = location.hash, stamp = {};
      el.expertRender = stamp;
      el.innerHTML = '<div class="page">' + UI.skeleton(5) + '</div>';
      const offset = Math.max(0, Number(query?.taskOffset) || 0);
      const { data: d } = await API.fetchAgentDetail(agentId, offset);
      if (!el.isConnected || el.expertRender !== stamp || location.hash !== route) return;
      if (!d.agent) {
        el.innerHTML = '<div class="page"><div class="card empty">' + ICON('alert-triangle', 34) + '<div>专家不存在</div><a class="btn btn-ghost btn-sm" href="#/agents">返回列表</a></div></div>';
        return;
      }
      const a = d.agent;
      document.getElementById('topbar-title').innerHTML = '<a class="crumb-link" href="#/agents">专家智能体</a>';
      document.getElementById('topbar-crumb').innerHTML = ' / <b>' + UI.esc(a.name) + '</b>';
      const kbs = d.knowledgeBases;
      const exts = (DB.agentExts[a.id] || []).map(id => DB.extensions.find(x => x.id === id)).filter(Boolean);
      const counts = { kb: kbs.length, ext: d.runtimeExtensionCount ?? '—', tasks: d.taskTotal ?? d.agent.stats.tasks ?? "—", tpls: (DB.agentTpls[a.id] || []).length, rules: (DB.agentRules[a.id] || []).length };
      const active = AG_TABS.some(t => t[0] === (query && query.tab)) ? query.tab : 'overview';

      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        AG_TABS.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-agtab="${k}">${ICON(ic, 14)}${label}${counts[k] !== undefined ? '<span class="cnt">' + counts[k] + '</span>' : ''}</button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-agtab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/agent/' + agentId + '?tab=' + b.dataset.agtab;
      }));

      const painters = {
        overview: () => agTabOverview(a, d, kbs, exts), sop: () => agTabSop(a),
        kb: () => agTabKb(a, kbs), ext: () => agHeadCard(a) + '<div data-runtime-editor></div>',
        tasks: () => agTabTasks(a, d), usage: () => agTabUsage(a, d),
        tpls: () => agTabTpls(a), rules: () => agTabRules(a), settings: () => agTabSettings(a),
        memory: () => agHeadCard(a) + '<div data-memory-scope></div>',
        databases: () => agHeadCard(a) + '<div data-database-scope></div>'
      };
      el.innerHTML = '<div class="page">' + painters[active]() + '</div>';
      if (active === 'ext') el.viewCleanup=mountRuntimeEditor(el.querySelector('[data-runtime-editor]'), 'expert', a.id, { section: 'extensions', onExtensionCount: count => { if (el.isConnected && el.expertRender === stamp && location.hash === route) document.querySelector('#topbar-tabs [data-agtab="ext"] .cnt').textContent=String(count); } });
      if (active === 'databases' && API.fetchDatabaseScope) el.viewCleanup=mountDatabaseScope(el.querySelector('[data-database-scope]'),{kind:'expert',id:a.id,initialDatabase:query?.database});
      if (active === 'settings') {
        const disposeProfile = mountExpertSettings(el.querySelector('[data-expert-profile]'), a, { api: API, ui: UI, onSaved: updated => {
          if (!el.isConnected || el.expertRender !== stamp || location.hash !== route) return;
          Object.assign(a, updated);
          el.querySelector('[data-expert-settings-header]').innerHTML = agHeadCard(a, false);
          document.getElementById('topbar-crumb').innerHTML = ' / <b>' + UI.esc(a.name) + '</b>';
        } });
        const disposeRuntime = mountRuntimeEditor(el.querySelector('[data-runtime-settings]'), 'expert', a.id, { section: 'settings' });
        el.viewCleanup = () => { disposeProfile?.(); disposeRuntime(); };
      }
      if (active === 'memory') void renderMemoryScope(el.querySelector('[data-memory-scope]'), { kind: 'expert', id: a.id, valid: () => el.isConnected && el.expertRender === stamp && location.hash === route });
      el.querySelectorAll('[data-remove-expert], [data-delete-expert]').forEach(b => onAction(b, () => {
        openRemoveExpertModal({ expert: a, api: API, ui: UI, icon: ICON, mode: b.hasAttribute('data-delete-expert') ? 'delete' : 'remove',
          onRemoved: () => { location.hash = '#/agents'; } });
      }));

      const refMore = el.querySelector('#btn-ref-more');
      if (refMore) refMore.addEventListener('click', () => { location.hash = '#/plaza?tab=tpl&agentId=' + encodeURIComponent(a.id); });
      el.querySelectorAll('[data-untpl]').forEach(b => onAction(b, async () => {
        await API.setExpertBinding(a.id, 'tpls', b.dataset.untpl, false);
        await Views.agent.render(el, agentId, query);
        UI.toast('已取消引用');
      }));
      if (active === 'rules') bindRulesTab(a, el);
      if (active === 'kb') await renderKnowledgeScope(el.querySelector('[data-knowledge-scope]'), {
        kind: 'expert', id: a.id, onChanged: () => Views.agent.render(el, agentId, query)
      });
      if (active === 'sop') bindSopTab(a, el);
    }
  };
})();
