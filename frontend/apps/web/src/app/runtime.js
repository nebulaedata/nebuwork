import { createWorkbenchEmployee } from '../features/tasks/workbenchEmployee.js';
import { authSession, rememberReturnTo, consumeReturnTo } from '../services/authSession.js';

/* app.js — 路由 + Shell 装配 + 共享 UI 工具(视图逻辑在 views/*.js) */
(function () {
  window.Views = window.Views || {};

  /* ---------- Shell 装配(一次性) ---------- */
  document.getElementById('logo-icon').innerHTML = '<img src="assets/logo.svg" alt="NebuWork">';
  document.querySelectorAll('#nav-links .ni-ic').forEach(el => {
    el.innerHTML = ICON(el.dataset.ic, 17);
  });
  document.getElementById('btn-search').innerHTML = ICON('search', 15);

  /* ---------- 主题切换(浅色 / 深色,localStorage 持久化;入口在侧栏头像菜单) ---------- */
  const themeBtns = [document.getElementById('up-theme')].filter(Boolean);
  function paintThemeIcon() {
    const ic = ICON(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 15);
    themeBtns.forEach(b => { b.innerHTML = ic; });
  }
  themeBtns.forEach(b => b.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ah-theme', next);
    paintThemeIcon();
  }));
  paintThemeIcon();

  /* ---------- 侧栏头像滑出菜单:图标 / 用量 / 帮助 ---------- */
  document.querySelectorAll('#user-pop [data-up-ic]').forEach(el => {
    el.innerHTML = ICON(el.dataset.upIc, 15);
  });
  document.getElementById('up-quota').innerHTML =
    '<div class="upq-line"><a class="upq-title" href="#/workbench?tab=stats">Token 消耗统计</a><span class="dim">按实际执行记录</span></div>';
  document.getElementById('up-help').addEventListener('click', () => {
    UI.openModal(`
      <div class="modal-head"><span class="modal-title">${ICON('help-circle', 16)}帮助与反馈</span><button class="btn-icon" id="modal-close">${ICON('x', 15)}</button></div>
      <div class="modal-body">
        <a class="file-row" style="cursor:pointer" data-help="doc">
          <span class="file-icon" style="color:#4C9AFF;background:#4C9AFF1A">${ICON('book-open', 15)}</span>
          <div style="flex:1"><div style="font-size:13px">帮助中心</div><div class="dim" style="font-size:11px">使用指南 · 常见问题</div></div>
          ${ICON('chevron-right', 14, 'dim')}
        </a>
        <a class="file-row" style="cursor:pointer" data-help="feedback">
          <span class="file-icon" style="color:#B074E8;background:#B074E81A">${ICON('message-square', 15)}</span>
          <div style="flex:1"><div style="font-size:13px">问题反馈</div><div class="dim" style="font-size:11px">提交 Bug 或功能建议</div></div>
          ${ICON('chevron-right', 14, 'dim')}
        </a>
      </div>`);
    document.getElementById('modal-close').addEventListener('click', UI.closeModal);
    document.querySelectorAll('[data-help]').forEach(r => r.addEventListener('click', () => {
      UI.closeModal();
      UI.toast(r.dataset.help === 'doc' ? '帮助中心将在后续版本上线' : '反馈通道将在后续版本接入', 'err');
    }));
  });

  /* ---------- 全局搜索面板(按钮触发,检索会话标题与消息内容) ---------- */
  const searchMask = document.getElementById('search-mask');
  const spInput = document.getElementById('sp-input');
  const spList = document.getElementById('sp-list');
  document.getElementById('sp-icon').innerHTML = ICON('search', 15);
  function sessionMatches(s, kw) {
    if (s.title.toLowerCase().includes(kw)) return true;
    return (DB.messages[s.id] || []).some(m => (m.content || '').toLowerCase().includes(kw));
  }
  function renderSearchList() {
    const kw = spInput.value.trim().toLowerCase();
    const list = DB.sessions.filter(s => !kw || sessionMatches(s, kw));
    spList.innerHTML = list.length ? list.map(s => {
      const p = UI.projectById(s.projectId);
      return `<div class="sp-item" data-sess="${s.id}">
        <span class="sp-ic">${ICON('code', 14)}</span>
        <div class="sp-title">${UI.esc(s.title)}</div>
        <span class="sp-proj">${ICON('folder', 12)}${UI.esc(p.name)}</span>
      </div>`;
    }).join('') : '<div class="empty">' + ICON('search', 28) + '<div>没有匹配「' + UI.esc(spInput.value.trim()) + '」的任务</div></div>';
    spList.querySelectorAll('[data-sess]').forEach(item => item.addEventListener('click', () => {
      closeSearch();
      location.hash = '#/task/' + item.dataset.sess;
    }));
  }
  function openSearch() {
    searchMask.classList.add('open');
    spInput.value = '';
    renderSearchList();
    setTimeout(() => spInput.focus(), 0);
  }
  function closeSearch() { searchMask.classList.remove('open'); }
  document.getElementById('btn-search').addEventListener('click', openSearch);
  searchMask.addEventListener('click', e => { if (e.target === searchMask) closeSearch(); });
  spInput.addEventListener('input', renderSearchList);
  spInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = spList.querySelector('[data-sess]');
      if (first) { closeSearch(); location.hash = '#/task/' + first.dataset.sess; }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearch(); closeNotif(); }
  });

  /* ---------- 通知消息面板(顶栏铃铛) ---------- */
  const notifMask = document.getElementById('notif-mask');
  const btnNotify = document.getElementById('btn-notify');
  btnNotify.innerHTML = ICON('bell', 15);
  document.getElementById('ntf-close').innerHTML = ICON('x', 15);
  function renderNotifs() {
    const list = DB.notifications;
    btnNotify.classList.toggle('has-unread', list.some(n => n.unread));
    document.getElementById('ntf-list').innerHTML = list.length ? list.map(n => `
      <div class="ntf-item${n.unread ? ' unread' : ''}">
        <span class="file-icon ntf-ic">${ICON('message-square', 14)}</span>
        <div class="ntf-main">
          <div class="ntf-line">
            <span class="ntf-t">${UI.esc(n.title)}</span>
            <span class="ntf-date">${n.date}</span>
            <button class="btn-icon ntf-del" data-ntf-del="${n.id}" title="删除">${ICON('trash-2', 13)}</button>
          </div>
          <div class="ntf-body">${UI.esc(n.body)}</div>
          <button class="btn btn-ghost btn-sm ntf-act" data-ntf-act="${n.id}">${UI.esc(n.action)}</button>
        </div>
      </div>`).join('') : '<div class="empty">' + ICON('bell', 28) + '<div>暂无消息</div></div>';
    document.querySelectorAll('[data-ntf-del]').forEach(b => b.addEventListener('click', () => {
      const i = DB.notifications.findIndex(n => n.id === b.dataset.ntfDel);
      if (i > -1) DB.notifications.splice(i, 1);
      renderNotifs();
    }));
    document.querySelectorAll('[data-ntf-act]').forEach(b => b.addEventListener('click', () => {
      const n = DB.notifications.find(x => x.id === b.dataset.ntfAct);
      if (!n) return;
      n.unread = false;
      closeNotif();
      if (n.link) location.hash = n.link; else UI.toast('「' + n.action + '」将在后续版本接入', 'err');
      renderNotifs();
    }));
  }
  function openNotif() {
    DB.notifications.forEach(n => { n.unread = false; });
    renderNotifs();
    notifMask.classList.add('open');
  }
  function closeNotif() { notifMask.classList.remove('open'); }
  btnNotify.addEventListener('click', () => notifMask.classList.contains('open') ? closeNotif() : openNotif());
  notifMask.addEventListener('click', e => { if (e.target === notifMask) closeNotif(); });
  document.getElementById('ntf-close').addEventListener('click', closeNotif);

  /* ---------- 共享 UI 工具 ---------- */
  let modalCleanup = null;

  window.UI = {
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

    statusPill(st) {
      const map = {
        running: ['pill-info', '运行中'], done: ['pill-success', '已完成'],
        failed: ['pill-danger', '已失败'], waiting: ['pill-dim', '排队中'],
        waiting_input: ['pill-warning', '等待补充'], waiting_children: ['pill-info', '专家协作'], preparing: ['pill-dim', '准备上下文'], recovering: ['pill-warning', '恢复中'], cancelled: ['pill-dim', '已取消'],
        interrupted: ['pill-warning', '已中断'],
        idle: ['pill-dim', '未运行'], queued: ['pill-dim', '排队中'], completed: ['pill-success', '已完成'],
        active: ['pill-success', '进行中'], paused: ['pill-warning', '已暂停'],
        archived: ['pill-dim', '已归档'],
        connected: ['pill-success', '已连接'], error: ['pill-danger', '异常']
      };
      const m = map[st] || ['pill-dim', st];
      return '<span class="pill ' + m[0] + '"><span class="dot"></span>' + m[1] + '</span>';
    },

    agentById(id) {
      const agent = DB.agents.find(a => a.id === id);
      if (agent) return agent;
      const prefix = 'workbench-employee:';
      if (typeof id === 'string' && id.startsWith(prefix)) {
        const workbench = DB.workbenches.find(item => item.id === id.slice(prefix.length));
        return createWorkbenchEmployee(workbench);
      }
      return { name: '未指定', initials: '?', color: '#6C63F0' };
    },
    projectById(id) { return DB.projects.find(p => p.id === id) || { name: '未知项目' }; },
    wbById(id) { return DB.workbenches.find(w => w.id === id) || { name: '通用' }; },

    agentAvatar(agent, size) {
      const s = size || 30;
      return '<span class="msg-ava agent" style="width:' + s + 'px;height:' + s + 'px;background:' + agent.color + '">' + UI.esc(agent.initials) + '</span>';
    },

    /* Modal */
    openModal(html) {
      if (modalCleanup) {
        modalCleanup();
        modalCleanup = null;
      }
      document.getElementById('modal-box').innerHTML = html;
      document.getElementById('modal-mask').classList.add('open');
    },
    setModalCleanup(cleanup) { modalCleanup = cleanup; },
    /* 通用弹窗:标题 + 内容(内容内的 [data-close] 按钮自动绑定关闭),onMount 回调拿到 modal-box */
    modal(title, bodyHtml, onMount) {
      UI.openModal(
        '<div class="modal-head"><div class="modal-title">' + UI.esc(title) + '</div>' +
        '<button class="btn-icon" data-close>' + ICON('x', 16) + '</button></div>' +
        '<div class="modal-body">' + bodyHtml + '</div>');
      const box = document.getElementById('modal-box');
      box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', UI.closeModal));
      if (onMount) onMount(box);
    },
    closeModal() {
      if (modalCleanup) {
        modalCleanup();
        modalCleanup = null;
      }
      document.getElementById('modal-mask').classList.remove('open');
    },

    /* Toast */
    toast(msg, type) {
      const t = document.createElement('div');
      t.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
      t.innerHTML = ICON(type === 'err' ? 'alert-triangle' : 'check-circle', 15) + '<span>' + UI.esc(msg) + '</span>';
      document.getElementById('toast-wrap').appendChild(t);
      setTimeout(() => t.remove(), 2600);
    },

    skeleton(rows) {
      let h = '<div style="display:flex;flex-direction:column;gap:14px">';
      for (let i = 0; i < (rows || 4); i++) h += '<div class="skel" style="height:' + (52 + (i % 2) * 22) + 'px"></div>';
      return h + '</div>';
    },

    /* 甜甜圈饼图(conic-gradient):segs=[{label,value,color}],返回带图例的 HTML */
    donut(segs, centerLabel) {
      const total = segs.reduce((a, s) => a + s.value, 0) || 1;
      let acc = 0;
      const parts = segs.map(s => {
        const from = acc / total * 360; acc += s.value;
        return s.color + ' ' + from.toFixed(1) + 'deg ' + (acc / total * 360).toFixed(1) + 'deg';
      });
      return '<div class="donut-wrap">' +
        '<div class="donut" style="background:conic-gradient(' + parts.join(',') + ')"><div class="donut-hole">' + (centerLabel || total) + '</div></div>' +
        '<div class="donut-legend">' + segs.map(s =>
          '<div class="dl-row"><i style="background:' + s.color + '"></i><span>' + UI.esc(s.label) + '</span><b class="mono">' + s.value + '</b></div>').join('') +
        '</div></div>';
    },

    /* 迷你曲线图(内联 SVG):values 数组,返回平滑折线 + 渐变面积 */
    sparkline(values, color) {
      const w = 260, h = 64, pad = 4;
      const max = Math.max.apply(null, values) || 1, min = Math.min.apply(null, values);
      const pts = values.map((v, i) => [
        pad + i * (w - pad * 2) / (values.length - 1),
        h - pad - (v - min) / ((max - min) || 1) * (h - pad * 2)
      ]);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (h - pad) + ' Z';
      const c = color || 'var(--accent)';
      return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<defs><linearGradient id="sg' + (++UI._sgid) + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + c + '" stop-opacity=".28"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#sg' + UI._sgid + ')"/>' +
        '<path d="' + line + '" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    },
    _sgid: 0,

    /* 更新热力图:cells=[{label,level 0-4,tip}] */
    heat(cells) {
      return '<div class="heat">' + cells.map(c =>
        '<i class="lv' + c.level + '" title="' + UI.esc(c.tip || '') + '"></i>').join('') + '</div>';
    }
  };

  document.getElementById('modal-mask').addEventListener('click', e => {
    if (e.target.id === 'modal-mask') UI.closeModal();
  });

  /* 初始渲染通知列表(UI 定义之后方可调用) */
  renderNotifs();

  /* ---------- 路由 ---------- */
  const ROUTES = {
    workbench: { title: '工作台', nav: 'workbench' },
    projects: { title: '项目', nav: 'projects' },
    project: { title: '项目详情', nav: 'projects' },
    agents: { title: '专家智能体', nav: 'agents' },
    workflows: { title: 'Workflow', nav: 'workflows' },
    workflow: { title: 'Workflow 配置', nav: 'workflows' },
    'workflow-task': { title: 'Workflow 运行', nav: 'workflows' },
    agent: { title: '专家详情', nav: 'agents' },
    plaza: { title: '广场', nav: 'plaza' },
    task: { title: '任务', nav: 'projects' },
    settings: { title: '设置', nav: '' },
    knowledge: { title: '知识库', nav: '' },
    'service-consent': { title: '工作台服务授权', nav: '' },
    login: { title: '登录', nav: '' }
  };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = h.split('?');
    const seg = pathPart.split('/').filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
    return { name: seg[0] || 'agents', param: seg[1] || null, query };
  }

  let renderToken = 0;
  async function route() {
    const token = ++renderToken;
    const { name, param, query } = parseHash();
    const auth = authSession.getSnapshot();
    const host = document.getElementById('app-content');
    host.firstElementChild?.viewCleanup?.();
    UI.closeModal();
    closeSearch();
    closeNotif();
    if (auth.status === 'checking' || auth.status === 'error') {
      document.body.classList.add('login-mode');
      if (window.__loginRAF) { cancelAnimationFrame(window.__loginRAF); window.__loginRAF = null; }
      if (window.__viewRAF) { cancelAnimationFrame(window.__viewRAF); window.__viewRAF = null; }
      host.innerHTML = '<div class="page"><div class="card empty"><div>' +
        (auth.status === 'checking' ? '正在确认登录状态…' : UI.esc(auth.error?.message || '账号服务暂不可用')) +
        '</div>' + (auth.status === 'error' ? '<button class="btn btn-ghost" id="retry-auth">重试</button>' : '') + '</div></div>';
      host.querySelector('#retry-auth')?.addEventListener('click', () => authSession.refresh());
      return;
    }
    if (name !== 'login' && auth.status !== 'authenticated') { rememberReturnTo(location.hash); location.hash = '#/login'; return; }
    if (name === 'login' && auth.status === 'authenticated') { location.hash = consumeReturnTo(); return; }
    /* 离开登录页时停止 canvas 动画 */
    if (name !== 'login' && window.__loginRAF) { cancelAnimationFrame(window.__loginRAF); window.__loginRAF = null; }
    /* 视图级 canvas 动画统一清理槽(指挥官节点图 / 情报地图等) */
    if (window.__viewRAF) { cancelAnimationFrame(window.__viewRAF); window.__viewRAF = null; }
    document.body.classList.toggle('login-mode', name === 'login');
    const conf = ROUTES[name] || ROUTES.agents;
    document.querySelectorAll('.nav-item').forEach(a => {
      a.classList.toggle('active', a.dataset.nav === conf.nav);
    });
    document.getElementById('topbar-title').textContent = conf.title;
    document.getElementById('topbar-crumb').innerHTML = '';
    document.getElementById('topbar-tabs').innerHTML = '';
    document.getElementById('topbar-actions').innerHTML = '';
    const view = Views[name] || Views.agents;
    // Detach the previous view so its pending async work cannot repaint another session.
    const content = document.createElement('div');
    content.className = 'route-view';
    content.style.display = 'contents';
    host.replaceChildren(content);
    host.scrollTop = 0;
    try {
      await view.render(content, param, query, token);
    } catch (error) {
      console.error('[route] 页面加载失败:', error);
      if (token !== renderToken) return;
      content.innerHTML = '<div class="page"><div class="card empty">' + ICON('alert-triangle', 34) +
        '<div style="font-weight:600">页面数据加载失败</div><div class="dim">' + UI.esc(error.message || '请求失败') +
        '</div><button class="btn btn-ghost btn-sm" id="retry-page">重新加载</button></div></div>';
      const retry = content.querySelector('#retry-page');
      if (retry) retry.addEventListener('click', () => route());
    }
  }

  window.addEventListener('hashchange', route);
  authSession.subscribe(({ user }) => {
    const avatar = document.querySelector('#user-card .avatar');
    avatar.replaceChildren(document.createTextNode(user?.name?.charAt(0) || '?'));
    if (user?.avatar) {
      const img = document.createElement('img');
      img.src = user.avatar; img.alt = '用户头像';
      img.addEventListener('error', () => img.remove(), { once: true });
      avatar.append(img);
    }
    renderNotifs();
    route();
  });
  sessionStorage.removeItem('ah-auth');
  authSession.ensure();
})();
