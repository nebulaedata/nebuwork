import { modal, esc, creationKey } from '../workbench/ui.js';
import { mountSavedModelSelect } from '../../shared/savedModelSelect.jsx';
import { isExecutableModelProvider } from '../../shared/modelVendors.js';

export function editTask(project, task, valid, saved) {
  const requestKey = creationKey();
  modal(task ? '任务设置' : '新建任务', `<div class="field"><label>任务名称</label><input id="task-title" maxlength="300" value="${esc(task?.title || '')}" placeholder="例如：分析本周招标公告"></div><div class="field"><label>执行模型</label><div id="task-model"></div><div id="task-model-note" class="dim" role="status">正在加载本人模型…</div></div><p class="dim">由本项目的工作台智能体执行。创建后进入对话，发送目标才开始调用模型。</p><div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-save>${task ? '保存' : '创建任务'}</button></div>`, valid, ctx => {
    const picker = mountSavedModelSelect(ctx.box.querySelector('#task-model'), {}); ctx.onCleanup(picker.destroy);
    const note = ctx.box.querySelector('#task-model-note');
    Promise.all([API.fetchModelProviders(), API.fetchModelSettings()]).then(([providers, settings]) => {
      if (!ctx.live()) return; const available = providers.data.filter(isExecutableModelProvider); picker.setProviders(available); picker.setLoading(false);
      const selected = task?.context?.modelProviderId; if (available.some(p => p.id === selected)) picker.setValue(selected);
      note.innerHTML = available.length ? '留空使用已发布运行资源中的模型，或账号默认模型。' : '尚无可执行模型。<a href="#/settings?tab=model">前往模型配置</a>';
    }).catch(error => { if (ctx.live()) { picker.setLoading(false); note.textContent = error.message; ctx.error(error); } });
    ctx.action('[data-save]', async () => {
      const title = ctx.box.querySelector('#task-title').value.trim(), providerId = picker.getValue();
      if (!title) throw new Error('请填写任务名称');
      const payload = { title, context: providerId ? { modelProviderId: providerId } : {} };
      const result = task ? await API.editTask(task.id, payload) : await API.createTask(project.id, payload, requestKey(payload));
      if (!ctx.live()) return; UI.closeModal(); saved(result.data.task);
    });
  });
}
