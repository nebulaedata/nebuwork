import { renderModelSettings } from './modelSettings.js';
import { renderKnowledgeSettings } from '../knowledge/views.js';
import { authSession } from '../../services/authSession.js';
import { renderMemoryScope } from '../memory/views.js';
import { renderMemorySettings } from './memorySettings.js';
import { renderWorkflowSettings } from '../workflows/view.jsx';
import { renderEngineSettings } from './engineSettingsView.jsx';
import { renderPlatformMcpSettings } from '../runtime/PlatformMcpSettings.jsx';
/* views/settings.js — 设置:个人信息(名称/头像/大图预览)+ 用户设置(管理员开通权限) */
(function () {
  window.Views = window.Views || {};

  /* 头像大图预览弹窗 */
  function openAvatarPreview() {
    const inner = DB.user.avatar
      ? '<img src="' + UI.esc(DB.user.avatar) + '" alt="头像大图" style="width:260px;height:260px;border-radius:50%;object-fit:cover;display:block;margin:8px auto">'
      : '<div style="width:260px;height:260px;border-radius:50%;display:grid;place-items:center;font-size:96px;font-weight:600;color:#FFF;background:linear-gradient(135deg,var(--accent),var(--accent-2));margin:8px auto">' + UI.esc(DB.user.name.charAt(0)) + '</div>';
    UI.openModal(
      '<div class="modal-head"><span class="modal-title">' + ICON('image', 16) + '头像预览</span><button class="btn-icon" id="modal-close">' + ICON('x', 15) + '</button></div>' +
      '<div class="modal-body">' + inner + '</div>');
    document.getElementById('modal-close').addEventListener('click', UI.closeModal);
  }

  Views.settings = {
    async render(el, param, query) {
      const isAdmin = DB.user.role === 'admin';
      const validTabs = ['profile', 'model', 'agent-engine', 'platform-mcp', 'memory', 'memory-settings', 'workflow-settings', 'knowledge', 'channels', 'executor', 'extauth'];
      if (isAdmin) validTabs.push('users');
      const active = validTabs.includes(query.tab) ? query.tab : 'profile';

      /* 顶部功能页签(同项目二级菜单) */
      const tabs = [['profile', '个人信息', 'user'], ['model', '模型设置', 'cpu'],
        ['agent-engine', '智能体引擎', 'server'],
        ['platform-mcp', '系统 MCP', 'workflow'],
        ['memory', '我的记忆', 'brain'],
        ['memory-settings', '记忆设置', 'settings'],
        ['workflow-settings', 'Workflow 设置', 'workflow'],
        ['knowledge', '知识库', 'book-open'],
        ['channels', '频道', 'message-circle'], ['executor', '执行体', 'monitor-down'],
        ['extauth', '扩展管理', 'puzzle']];
      if (isAdmin) tabs.push(['users', '用户设置', 'users']);
      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        tabs.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-stab="${k}">${ICON(ic, 14)}${label}</button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-stab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/settings?tab=' + b.dataset.stab;
      }));

      if(active==='platform-mcp'){renderPlatformMcpSettings(el);return;}
      if (active === 'profile') {
        const avatarInner = DB.user.avatar
          ? '<img src="' + UI.esc(DB.user.avatar) + '" alt="头像" onerror="this.remove()">'
          : '';
        el.innerHTML = `
        <div class="page settings-page">
          <div class="card" style="padding:26px 28px">
            <div class="tc-title" style="margin-bottom:18px">${ICON('user', 16)}个人信息</div>
            <div style="display:flex;align-items:center;gap:20px;margin-bottom:22px">
              <div class="st-avatar" id="st-avatar" title="点击查看大图">
                <span class="st-avatar-fallback">${UI.esc(DB.user.name.charAt(0))}</span>
                ${avatarInner}
                <span class="st-avatar-zoom">${ICON('eye', 15)}</span>
              </div>
              <div>
                <div style="font-size:16px;font-weight:600;margin-bottom:4px">${UI.esc(DB.user.name)}</div>
                <div class="dim" style="font-size:12px;margin-bottom:10px">${UI.esc(DB.user.account)}</div>
                <button class="btn btn-ghost btn-sm" id="st-change-avatar">${ICON('camera', 13)}更换头像</button>
              </div>
            </div>
            <div class="st-form">
              <div class="field"><label>个人名称</label><input id="st-name" value="${UI.esc(DB.user.name)}" readonly></div>
              <div class="field"><label>账号</label><input value="${UI.esc(DB.user.account)}" disabled></div>
              <div class="field"><label>邮箱</label><input value="${UI.esc(DB.user.email || '')}" placeholder="未设置" readonly></div>
              <div class="field"><label>手机号</label><input value="${UI.esc(DB.user.phone || '')}" placeholder="未设置" readonly></div>
              <div class="dim" style="font-size:12px">资料由统一用户服务提供，修改功能暂未接入。</div>
            </div>
            <div class="st-actions">
              <button class="btn btn-ghost" id="st-logout" style="color:var(--danger)">${ICON('log-out', 14)}退出登录</button>
              <button class="btn btn-primary" id="st-save">${ICON('check', 14)}保存修改</button>
            </div>
          </div>
        </div>`;

        el.querySelector('#st-avatar').addEventListener('click', openAvatarPreview);
        const unavailable = () => UI.toast('个人资料修改暂未接入', 'err');
        el.querySelector('#st-change-avatar').addEventListener('click', unavailable);
        el.querySelector('#st-save').addEventListener('click', unavailable);
        el.querySelector('#st-logout').addEventListener('click', async event => {
          const button = event.currentTarget;
          if (button.disabled) return;
          button.disabled = true;
          try {
            await API.logout();
            UI.toast('已退出登录');
            location.hash = '#/login';
          } catch (error) { UI.toast(error.message || '退出失败，请重试', 'err'); }
          finally { button.disabled = false; }
        });
        return;
      }

      /* ---------- 模型设置 ---------- */
      if (active === 'workflow-settings') { renderWorkflowSettings(el); return; }
      if (active === 'agent-engine') { renderEngineSettings(el); return; }
      if (active === 'memory-settings') {
        await renderMemorySettings(el);
        return;
      }
      if (active === 'memory') {
        el.innerHTML = '<div class="page settings-page"><div data-memory-scope></div></div>';
        await renderMemoryScope(el.querySelector('[data-memory-scope]'), { kind: 'user', id: 'self' });
        return;
      }
      if (active === 'model') {
        await renderModelSettings(el, { api: API, db: DB, ui: UI, icon: ICON, sessionVersion: () => authSession.getSnapshot().version });
        return;
      }
      /* ---------- 频道:接入其他 IM 软件 ---------- */
      if (active === 'knowledge') {
        await renderKnowledgeSettings(el);
        return;
      }
      if (active === 'channels') {
        el.innerHTML = `
        <div class="page settings-page">
          <div class="section-title reveal">频道接入</div>
          <div class="section-desc reveal" style="margin-bottom:18px">把办公助手接入你日常使用的 IM 软件,在聊天中直接下发任务、接收结果与预警。</div>
          <div class="grid grid-3 reveal reveal-1">
            ${DB.channels.map(c => `
              <div class="card card-pad ch-card">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                  <span class="wb-icon" style="--wc:${c.color};width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center">${ICON(c.icon, 16)}</span>
                  <div style="flex:1">
                    <div style="font-size:13.5px;font-weight:600">${UI.esc(c.name)}</div>
                    <div class="dim" style="font-size:11px;margin-top:2px">${c.connected ? '已连接 · ' + UI.esc(c.account) : '未连接'}</div>
                  </div>
                  <span class="pill ${c.connected ? 'pill-success' : 'pill-dim'}">${c.connected ? '已接入' : '待配置'}</span>
                </div>
                <div class="sub" style="font-size:12px;line-height:1.6;min-height:38px">${UI.esc(c.desc)}</div>
                <div style="margin-top:12px;display:flex;gap:8px">
                  <button class="btn ${c.connected ? 'btn-ghost' : 'btn-primary'} btn-sm" data-ch="${c.id}">${c.connected ? '重新配置' : ICON('plus', 12) + '接入'}</button>
                  ${c.connected ? '<button class="btn btn-ghost btn-sm" data-ch-off="' + c.id + '" style="color:var(--danger)">断开</button>' : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>`;
        el.querySelectorAll('[data-ch]').forEach(b => b.addEventListener('click', () => {
          const c = DB.channels.find(x => x.id === b.dataset.ch);
          /* TODO: replace with OAuth / fetch('/api/channels/' + c.id + '/connect') */
          c.connected = true;
          c.account = c.account || '默认工作区';
          Views.settings.render(el, param, query);
          UI.toast('「' + c.name + '」频道已接入');
        }));
        el.querySelectorAll('[data-ch-off]').forEach(b => b.addEventListener('click', () => {
          const c = DB.channels.find(x => x.id === b.dataset.chOff);
          /* TODO: replace with fetch('/api/channels/' + c.id + '/disconnect', {method:'POST'}) */
          c.connected = false;
          c.account = '';
          Views.settings.render(el, param, query);
          UI.toast('已断开「' + c.name + '」频道');
        }));
        return;
      }

      /* ---------- 执行体:本地客户端(computer use) ---------- */
      if (active === 'executor') {
        el.innerHTML = `
        <div class="page settings-page">
          <div class="section-title reveal">执行体</div>
          <div class="section-desc reveal" style="margin-bottom:18px">下载并安装到你的电脑后,执行体可以帮助你进行 computer use 操作,接管用户电脑:在获得授权的前提下替你操作本地软件、整理文件、执行脚本,任务过程全程可审计、可随时中止。</div>
          <div class="grid grid-3 reveal reveal-1" style="margin-bottom:20px">
            ${DB.executors.map(x => `
              <div class="card card-pad ch-card">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                  <span class="wb-icon" style="--wc:#6C63F0;width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center">${ICON(x.icon, 16)}</span>
                  <div>
                    <div style="font-size:13.5px;font-weight:600">${UI.esc(x.platform)} 客户端</div>
                    <div class="dim mono" style="font-size:11px;margin-top:2px">${x.version} · ${x.size}</div>
                  </div>
                </div>
                <div class="sub" style="font-size:12px;line-height:1.6">${UI.esc(x.note)}</div>
                <div style="margin-top:12px">
                  <button class="btn btn-primary btn-sm" data-exe="${x.id}">${ICON('download', 12)}下载安装包</button>
                </div>
              </div>`).join('')}
          </div>
          <div class="card card-pad reveal reveal-2">
            <div class="tc-title" style="margin-bottom:10px">${ICON('shield', 15)}安全说明</div>
            <div class="sub" style="font-size:12.5px;line-height:1.8">
              · 执行体仅在你主动授权的任务范围内操作,敏感动作(删除、发送、支付)需二次确认;<br>
              · 所有操作写入审计日志,可在任务「审计留痕」面板回放;<br>
              · 随时可通过系统托盘或任务面板一键中止,中止后立即释放控制权。
            </div>
          </div>
        </div>`;
        el.querySelectorAll('[data-exe]').forEach(b => b.addEventListener('click', () => {
          const x = DB.executors.find(v => v.id === b.dataset.exe);
          /* TODO: replace with real installer url */
          const blob = new Blob(['(Mock) NebuWork Executor ' + x.platform + ' ' + x.version], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'NebuWork-Executor-' + x.id + '-' + x.version + '.txt';
          a.click();
          URL.revokeObjectURL(a.href);
          UI.toast('已开始下载 ' + x.platform + ' 执行体安装包');
        }));
        return;
      }

      // Preserve the old deep link while using the real, server-authorized market.
      if (active === 'extauth') {
        location.replace('#/plaza?tab=ext');
        return;
      }

      /* ---------- 用户设置(管理员):为其他用户开通权限 ---------- */
      el.innerHTML = `
      <div class="page settings-page">
        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:20px 24px 14px;display:flex;align-items:center;justify-content:space-between">
            <div class="tc-title">${ICON('users', 16)}用户设置</div>
            <span class="dim" style="font-size:11.5px">为成员开通各模块访问权限,即时生效</span>
          </div>
          <div class="st-user-list">
            ${DB.users.map(u => `
              <div class="st-user" data-user="${u.id}">
                <span class="msg-ava agent" style="width:34px;height:34px;background:${u.color};flex-shrink:0">${UI.esc(u.name.charAt(0))}</span>
                <div style="min-width:150px">
                  <div style="font-size:13px;font-weight:500">${UI.esc(u.name)}${u.role === '管理员' ? ' <span class="pill pill-info" style="font-size:10px">管理员</span>' : ''}</div>
                  <div class="dim" style="font-size:11px">${UI.esc(u.account)}</div>
                </div>
                <div class="st-perms">
                  ${DB.PERM_KEYS.map(p => `
                    <label class="st-perm">
                      <span class="dim" style="font-size:11.5px">${p.label}</span>
                      <button class="cron-switch ${u.perms[p.key] ? 'on' : ''}" data-perm="${u.id}:${p.key}" ${u.role === '管理员' ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}></button>
                    </label>`).join('')}
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;

      el.querySelectorAll('[data-perm]').forEach(sw => sw.addEventListener('click', () => {
        if (sw.disabled) return;
        const [uid, key] = sw.dataset.perm.split(':');
        const u = DB.users.find(x => x.id === uid);
        if (!u) return;
        u.perms[key] = !u.perms[key];
        sw.classList.toggle('on', u.perms[key]);
        const label = (DB.PERM_KEYS.find(p => p.key === key) || {}).label || key;
        UI.toast(u.perms[key] ? `已为 ${u.name} 开通「${label}」权限` : `已关闭 ${u.name} 的「${label}」权限`);
      }));
    }
  };
})();
