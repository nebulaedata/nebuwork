/* views/task.js — 核心任务三栏:会话列表 | 对话交互 | 待办/文件/浏览器/审计 */
(function () {
  window.Views = window.Views || {};
  const STATUS_LABEL = { running: '运行中', done: '已完成', waiting: '排队中', failed: '已失败', paused: '已暂停' };

  const AUDIT_STYLE = {
    think: { label: '思考', color: '#9C9C97', icon: 'brain' },
    tool: { label: '工具', color: '#4C9AFF', icon: 'wrench' },
    file: { label: '文件', color: '#3FB6B2', icon: 'file-text' },
    browser: { label: '浏览', color: '#E09A5B', icon: 'globe' },
    decision: { label: '决策', color: '#6C63F0', icon: 'git-branch' },
    system: { label: '系统', color: '#9C9C97', icon: 'terminal' }
  };

  const FILE_ICON = { doc: 'file-text', md: 'file-text', pdf: 'file-text', sheet: 'table', csv: 'table', zip: 'folder', html: 'globe' };
  const FILE_COLOR = { doc: '#4C9AFF', md: '#6C63F0', pdf: '#E0645F', sheet: '#3FB6B2', csv: '#3FB6B2', zip: '#E09A5B', html: '#B074E8' };

  /* 迷你 Markdown 渲染(标题/列表/引用/代码块/行内样式,演示用) */
  function mdToHtml(md) {
    const inline = t => UI.esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    let html = '', inCode = false, inList = false, inOl = false;
    const closeLists = () => {
      if (inList) { html += '</ul>'; inList = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
    };
    md.split('\n').forEach(line => {
      if (/^```/.test(line)) { closeLists(); html += inCode ? '</pre>' : '<pre>'; inCode = !inCode; return; }
      if (inCode) { html += UI.esc(line) + '\n'; return; }
      const ul = line.match(/^- (.*)$/);
      if (ul) { if (!inList) { closeLists(); html += '<ul>'; inList = true; } html += '<li>' + inline(ul[1]) + '</li>'; return; }
      const ol = line.match(/^\d+\. (.*)$/);
      if (ol) { if (!inOl) { closeLists(); html += '<ol>'; inOl = true; } html += '<li>' + inline(ol[1]) + '</li>'; return; }
      closeLists();
      if (/^### /.test(line)) html += '<h5>' + inline(line.slice(4)) + '</h5>';
      else if (/^## /.test(line)) html += '<h4>' + inline(line.slice(3)) + '</h4>';
      else if (/^# /.test(line)) html += '<h3>' + inline(line.slice(2)) + '</h3>';
      else if (/^> ?/.test(line)) html += '<blockquote>' + inline(line.replace(/^> ?/, '')) + '</blockquote>';
      else if (/^---+$/.test(line.trim())) html += '<hr>';
      else if (line.trim()) html += '<p>' + inline(line) + '</p>';
    });
    closeLists();
    if (inCode) html += '</pre>';
    return html;
  }
  /* 文件源码(DB.fileContents 按文件名索引) */
  function fileSource(f) {
    return (DB.fileContents && DB.fileContents[f.name]) || null;
  }

  /* 文件预览的罐装内容(演示用) */
  function filePreviewContent(f) {
    const src = fileSource(f);
    if (f.name.endsWith('.md') && src) return mdToHtml(src);
    if (f.name.endsWith('.md')) return `
      <h4>审查底稿 · risk_review_draft</h4>
      <p class="dim">生成于 10:38 · 法务审查专家 · 明察</p>
      <div class="risk"><b>高风险 · 第 8.2 条 付款方式</b><br>账期 180 日,显著超出公司 60 日标准,且无逾期利息约定。建议:压缩至 60 日并补逾期利息条款。</div>
      <div class="risk"><b>高风险 · 第 12.1 条 违约责任</b><br>双方违约金上限不对等(20% vs 5%)。建议:统一为 10% 并增加逾期按日计收。</div>
      <div class="risk"><b>高风险 · 第 15.3 条 知识产权</b><br>定制开发成果归属对方,未保留我方二次使用权。建议:约定共有或保留使用权。</div>
      <pre>比对进度 47/47 · 高风险 3 / 中风险 5 / 提示 8
依据:《采购合同风险清单 v3》《民法典》第 585 条</pre>`;
    if (f.name.endsWith('.html')) return `
      <h4>毛利归因瀑布图</h4>
      <p class="dim">生成于 11:04 · 经营分析专家 · 观澜</p>
      <div class="mini-bars" style="height:120px;margin:14px 0">
        ${[100, 84, 79, 77, 62, 58, 55].map((h, i) => '<div class="bar" style="height:' + h + '%"><span class="tip">' + ['期初', '厨卫价格', '空调成本', '结构', '促销折扣', '其他', '期末'][i] + '</span></div>').join('')}
      </div>
      <pre>7 月毛利率 18.4% (-2.3pct MoM)
价格因素 -1.6pct · 成本因素 -0.5pct · 结构因素 -0.2pct</pre>`;
    return '<h4>' + UI.esc(f.name) + '</h4><p class="dim">' + f.type.toUpperCase() + ' 文件 · ' + f.size + ' · 更新于 ' + f.updatedAt + '</p><p style="margin-top:10px" class="sub">该类型文件的在线预览将在后续版本提供,可下载后查看。</p>';
  }

  Views.task = {
    async render(el, sessionId) {
      el.innerHTML = '<div class="page">' + UI.skeleton(5) + '</div>';
      const res = await API.fetchSession(sessionId);
      let d = res.data;
      if (!d.session) {
        el.innerHTML = '<div class="page"><div class="card empty">' + ICON('alert-triangle', 34) + '<div>任务不存在</div><a class="btn btn-ghost btn-sm" href="#/projects">返回项目</a></div></div>';
        return;
      }
      let s = d.session;
      const proj = UI.projectById(s.projectId);
      let agentIds = Array.isArray(s.agentIds) && s.agentIds.length ? s.agentIds.slice() : [s.agentId];
      let agent = UI.agentById(agentIds[0]);
      document.getElementById('topbar-title').innerHTML = '<a class="crumb-link" href="#/projects">项目</a>';
      document.getElementById('topbar-crumb').innerHTML = ' / <a class="crumb-link" href="#/project/' + proj.id + '">' + UI.esc(proj.name) + '</a> / <b>' + UI.esc(s.title) + '</b>';

      const state = { pane: 'todo', panelOpen: true, auditFilter: 'all', fileSel: null, fileCode: false, webCode: false, sessFilter: 'normal', sending: false, switching: false, showLeft: true, showRight: true };

      /* 左栏任务列表项(当前任务展开元信息;sessFilter 过滤 普通/定时) */
      function sessListHtml() {
        const list = d.projectSessions.filter(ps => state.sessFilter === 'cron' ? ps.kind === 'cron' : ps.kind !== 'cron');
        if (!list.length) return '<div class="empty" style="padding:34px 10px">' + ICON(state.sessFilter === 'cron' ? 'calendar-clock' : 'list-todo', 26) + '<div>' + (state.sessFilter === 'cron' ? '该项目暂无定时任务' : '该项目暂无普通任务') + '</div></div>';
        return list.map(ps => `
          <div class="sess-item ${ps.id === s.id ? 'active' : ''}" data-sess="${ps.id}">
            <div class="s-line">
              <span class="s-dot" data-status="${ps.status}" title="任务状态:${STATUS_LABEL[ps.status] || ps.status}"></span>
              <span class="s-title" title="${UI.esc(ps.title)}">${UI.esc(ps.title)}</span>
            </div>
            ${ps.id === s.id ? `<div class="s-detail">
              <span class="sd-item" title="最近更新">${ICON('clock', 11)}${ps.updatedAt}</span>
              <span class="sd-item" title="Token 消耗">${ICON('zap', 11)}${ps.tokens}</span>
              <span class="sd-item" title="消息数">${ICON('message-square', 11)}${ps.msgCount}</span>
              ${ps.kind === 'cron' ? `<span class="sd-item" title="定时任务" style="color:#4C9AFF">${ICON('calendar-clock', 11)}</span>` : ''}
            </div>` : ''}
          </div>`).join('');
      }

      /* 专家选择浮层内容(紧凑单行菜单,多选:已选标 ✓,底部固定管理入口) */
      function agentPopHtml() {
        return '<div class="ap-head">选择执行专家 · 可多选</div>' + DB.agents.map(a => {
          const on = agentIds.includes(a.id);
          return `
          <div class="ap-item ${on ? 'active' : ''}" data-agent="${a.id}" title="${UI.esc(a.role)} · Lv.${a.level} · ${UI.esc(a.model)}">
            ${UI.agentAvatar(a, 22)}
            <span class="ap-name">${UI.esc(a.name)}</span>
            ${on ? ICON('check', 13, 'ap-check') : ''}
          </div>`;
        }).join('') + `
          <div class="ap-divider"></div>
          <div class="ap-item ap-manage" data-manage-agents="1">${ICON('settings', 14)}<span class="ap-name">管理专家</span></div>`;
      }
      /* 专家徽章内容(多选:头像叠放 + 主专家名 / 等N人) */
      function agentBadgeHtml() {
        const list = agentIds.map(id => UI.agentById(id)).filter(Boolean);
        const first = list[0] || agent;
        const label = list.length > 1 ? UI.esc(first.name) + ' 等' + list.length + '人' : UI.esc(first.name);
        return '<span class="ia-avas">' + list.slice(0, 3).map(a => UI.agentAvatar(a, 18)).join('') + '</span>' +
          '<span id="input-agent-name">' + label + '</span>' + ICON('chevron-down', 12);
      }
      const PANE_META = {
        ctx: { title: '上下文资料', icon: 'layers' },
        todo: { title: '任务待办', icon: 'list-todo' },
        files: { title: '任务文件', icon: 'folder' },
        browser: { title: '浏览器预览', icon: 'globe' },
        audit: { title: '审计轨迹', icon: 'shield' }
      };

      el.innerHTML = `
      <div class="task-layout">
        <!-- 左栏:任务列表 -->
        <div class="task-col">
          <div class="tc-head">
            <span class="tc-title">${ICON('folder-kanban', 14)}${UI.esc(proj.name)}</span>
          </div>
          <div style="padding:10px 12px;display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" id="btn-new-task-col" style="flex:1;justify-content:center">${ICON('plus', 13)}新建任务</button>
            <button class="btn btn-ghost btn-sm btn-icon" id="btn-sess-filter" title="查看定时任务" style="flex-shrink:0">${ICON('calendar-clock', 13)}</button>
          </div>
          <div class="tc-body" id="sess-list">${sessListHtml()}</div>
        </div>

        <!-- 中栏:对话交互 -->
        <div class="task-col">
          <div class="chat-wrap">
            <div class="tc-head">
              <div style="min-width:0">
                <div class="tc-title" style="display:flex;align-items:center;gap:8px;max-width:460px">
                  <span class="input-status" id="input-status" data-status="${s.status}" style="margin:0"></span>
                  <span id="chat-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(s.title)}</span>
                </div>
                <div class="dim" id="chat-sub" style="font-size:11px;margin-top:3px">Tokens <span class="mono">${s.tokens}</span> · 更新 ${s.updatedAt}</div>
              </div>
              <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
                <button class="btn-icon col-tg on" id="tg-left" title="显示 / 隐藏任务栏">${ICON('panel-left', 15)}</button>
                <button class="btn-icon col-tg on" id="tg-right" title="显示 / 隐藏预览栏">${ICON('panel-right', 15)}</button>
              </div>
            </div>
            <div class="chat-scroll" id="chat-scroll"></div>
            <div class="chat-rail" id="chat-rail" title="会话快速跳转"></div>
            <div class="chat-input">
              <div class="input-box">
                <textarea id="chat-ta" rows="2" placeholder="给 ${UI.esc(agent.name.split(' · ')[1] || agent.name)} 下达补充指令…"></textarea>
                <div class="input-bar">
                  <span class="input-agent" id="input-agent" title="点击选择执行专家(可多选)">${agentBadgeHtml()}</span>
                  <button class="btn-icon" title="附件">${ICON('paperclip', 15)}</button>
                  <button class="btn-icon" title="语音输入">${ICON('mic', 15)}</button>
                  <span style="flex:1"></span>
                  <button class="btn btn-primary btn-sm send-btn" id="btn-send"></button>
                </div>
                <div class="agent-pop" id="agent-pop" hidden>${agentPopHtml()}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右栏:可收起面板(开关已迁移至顶栏操作区) -->
        <div class="rp-wrap">
          <div class="rp-panel" id="rp-panel">
            <div class="rp-panel-head">
              <span class="tc-title" id="rp-panel-title">${ICON(PANE_META.todo.icon, 14)}${PANE_META.todo.title}</span>
            </div>
            <div class="rp-pane" id="pane-ctx"></div>
            <div class="rp-pane active" id="pane-todo"></div>
            <div class="rp-pane" id="pane-files"></div>
            <div class="rp-pane" id="pane-browser"></div>
            <div class="rp-pane" id="pane-audit"></div>
          </div>
        </div>
      </div>`;

      /* ---------- 顶栏操作区:右栏面板开关(分割竖线在审计轨迹与全局搜索之间) ---------- */
      const topActions = document.getElementById('topbar-actions');
      topActions.innerHTML =
        Object.keys(PANE_META).map(k => `<button class="btn-icon tb-act" data-tpane="${k}" title="${PANE_META[k].title}">${ICON(PANE_META[k].icon, 15)}</button>`).join('') +
        '<span class="tb-sep"></span>';

      /* ---------- 中栏:消息渲染 ---------- */
      const chatEl = el.querySelector('#chat-scroll');
      function renderMessages() {
        chatEl.innerHTML = d.messages.map(m => {
          if (m.role === 'user') return `
            <div class="msg user" data-mid="${m.id}">
              <div class="msg-body">
                <div class="msg-text">${UI.esc(m.content)}</div>
                <div class="msg-acts">
                  <button class="btn-icon" data-act="copy" title="复制">${ICON('copy', 13)}</button>
                  <button class="btn-icon" data-act="del" title="删除">${ICON('trash', 13)}</button>
                  <button class="btn-icon" data-act="rollback" title="回退:回滚到该消息发送之前">${ICON('undo-2', 13)}</button>
                  <span class="msg-time">${m.time}</span>
                </div>
              </div>
            </div>`;
          const stepsHtml = m.type === 'steps' ? `
            <div class="steps-card" style="margin-bottom:10px">
              <div class="steps-head" data-steps-toggle>${ICON('activity', 13)}执行步骤 · ${m.steps.length} 步<span style="flex:1"></span>${ICON('chevron-down', 13)}</div>
              <div class="steps-body">
                ${m.steps.map(st => `
                  <div class="step">
                    <span class="step-icon ${st.status}">${st.status === 'doing' ? ICON('loader', 14, 'spin') : ICON(st.icon, 14)}</span>
                    <div class="step-main">
                      <div class="step-title">${UI.esc(st.title)}${st.status === 'done' ? ICON('check', 12, '') : ''}</div>
                      <div class="step-detail">${UI.esc(st.detail)}</div>
                    </div>
                    <span class="step-dur">${st.duration || '…'}</span>
                  </div>`).join('')}
              </div>
            </div>` : '';
          return `
            <div class="msg" data-mid="${m.id}">
              ${UI.agentAvatar(agent, 30)}
              <div class="msg-body" style="flex:1;min-width:0">
                <div class="msg-meta"><span style="color:${agent.color}">${UI.esc(agent.name)}</span><span>${m.time}</span></div>
                ${stepsHtml}
                <div class="msg-text">${UI.esc(m.content)}</div>
                <div class="msg-acts">
                  <button class="btn-icon" data-act="copy" title="复制">${ICON('copy', 13)}</button>
                  <button class="btn-icon" data-act="retry" title="重试">${ICON('refresh-cw', 13)}</button>
                  <button class="btn-icon" data-act="up" title="有帮助">${ICON('thumbs-up', 13)}</button>
                  <button class="btn-icon" data-act="down" title="没帮助">${ICON('thumbs-down', 13)}</button>
                  <span style="flex:1"></span>
                  <span class="msg-ai-tag">由 AI 生成</span>
                </div>
              </div>
            </div>`;
        }).join('');
        chatEl.scrollTop = chatEl.scrollHeight;
        renderRail();
        chatEl.querySelectorAll('[data-steps-toggle]').forEach(h => h.addEventListener('click', () => {
          const body = h.nextElementSibling;
          body.style.display = body.style.display === 'none' ? '' : 'none';
        }));
      }

      /* ---------- 会话快速跳转节点:每条用户消息一个锚点 ---------- */
      const railEl = el.querySelector('#chat-rail');
      function renderRail() {
        const turns = d.messages.filter(m => m.role === 'user');
        if (!turns.length) { railEl.style.display = 'none'; return; }
        railEl.style.display = '';
        railEl.innerHTML = turns.map(m =>
          '<i data-jump="' + m.id + '" title="' + UI.esc(m.content.slice(0, 20)) + '"></i>').join('');
        syncRail();
      }
      function syncRail() {
        const dots = railEl.querySelectorAll('[data-jump]');
        if (!dots.length) return;
        const top = chatEl.scrollTop + chatEl.clientHeight * 0.3;
        let current = dots[0];
        dots.forEach(dt => {
          const msg = chatEl.querySelector('[data-mid="' + dt.dataset.jump + '"]');
          if (msg && msg.offsetTop <= top) current = dt;
        });
        dots.forEach(dt => dt.classList.toggle('on', dt === current));
      }
      railEl.addEventListener('click', e => {
        const dt = e.target.closest('[data-jump]');
        if (!dt) return;
        const msg = chatEl.querySelector('[data-mid="' + dt.dataset.jump + '"]');
        if (msg) chatEl.scrollTo({ top: msg.offsetTop - 20, behavior: 'smooth' });
      });
      chatEl.addEventListener('scroll', syncRail, { passive: true });
      renderMessages();

      /* ---------- 右栏:待办 ---------- */
      function renderTodos() {
        const pane = el.querySelector('#pane-todo');
        const doneCnt = d.todos.filter(t => t.status === 'done').length;
        pane.innerHTML = `
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span class="dim" style="font-size:12px">任务待办 · ${doneCnt}/${d.todos.length}</span>
            <span class="pill ${doneCnt === d.todos.length ? 'pill-success' : 'pill-info'}">${doneCnt === d.todos.length ? '全部完成' : '进行中'}</span>
          </div>
          ${d.todos.length ? d.todos.map(t => `
            <div class="todo-item ${t.status}" data-todo="${t.id}">
              <span class="todo-check">${ICON('check', 11)}</span>
              <span class="todo-text">${UI.esc(t.text)}</span>
              ${t.status === 'doing' ? '<span class="todo-status pill pill-primary">执行中</span>' : ''}
            </div>`).join('') : '<div class="empty">' + ICON('list-todo', 30) + '<div>暂无待办事项</div></div>'}`;
        pane.querySelectorAll('[data-todo]').forEach(item => item.addEventListener('click', async () => {
          await API.toggleTodo(s.id, item.dataset.todo);
          renderTodos();
        }));
      }

      /* ---------- 右栏:文件 ---------- */
      function renderFiles() {
        const pane = el.querySelector('#pane-files');
        if (!state.fileSel) {
          pane.innerHTML = d.files.length ? d.files.map(f => `
            <div class="file-row" data-file="${f.id}" style="cursor:pointer">
              <span class="file-icon" style="color:${FILE_COLOR[f.type] || '#9C9C97'};background:${(FILE_COLOR[f.type] || '#9C9C97') + '1A'}">${ICON(FILE_ICON[f.type] || 'file-text', 15)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(f.name)}</div>
                <div class="dim" style="font-size:11px">${f.size} · ${f.updatedAt}</div>
              </div>
              ${ICON('chevron-right', 13, 'dim')}
            </div>`).join('') : '<div class="empty">' + ICON('folder', 30) + '<div>任务产物会出现在这里</div></div>';
          pane.querySelectorAll('[data-file]').forEach(r => r.addEventListener('click', () => {
            state.fileSel = d.files.find(f => f.id === r.dataset.file);
            state.fileCode = false;
            renderFiles();
          }));
        } else {
          const f = state.fileSel;
          const src = fileSource(f);
          pane.innerHTML = `
            <div class="file-preview">
              <div class="fp-head">
                <button class="btn-icon" id="fp-back">${ICON('chevron-left', 15)}</button>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(f.name)}</div>
                  <div class="dim" style="font-size:10.5px">${f.size}</div>
                </div>
                ${src ? `<button class="btn-icon ${state.fileCode ? 'on' : ''}" id="fp-code" title="${state.fileCode ? '查看预览' : '查看源码'}">${ICON('code', 14)}</button>` : ''}
                <button class="btn-icon" title="下载">${ICON('download', 14)}</button>
              </div>
              <div class="fp-body">${state.fileCode && src ? '<pre class="src-view">' + UI.esc(src) + '</pre>' : filePreviewContent(f)}</div>
            </div>`;
          pane.querySelector('#fp-back').addEventListener('click', () => { state.fileSel = null; state.fileCode = false; renderFiles(); });
          const codeBtn = pane.querySelector('#fp-code');
          if (codeBtn) codeBtn.addEventListener('click', () => { state.fileCode = !state.fileCode; renderFiles(); });
        }
      }

      /* ---------- 右栏:浏览器预览(代码按钮切换 网页/源码) ---------- */
      function renderBrowser() {
        const viewHtml = state.webCode
          ? '<pre class="src-view" style="margin:12px">' + UI.esc(DB.pageSource || '') + '</pre>'
          : `
              <span class="bv-tag">智能体正在浏览 · 法规检索</span>
              <h3>中华人民共和国民法典 · 合同编</h3>
              <p>第五百八十五条 当事人可以约定一方违约时应当根据违约情况向对方支付一定数额的违约金,也可以约定因违约产生的损失赔偿额的计算方法。</p>
              <p>约定的违约金低于造成的损失的,人民法院或者仲裁机构可以根据当事人的请求予以增加;约定的违约金过分高于造成的损失的,人民法院或者仲裁机构可以根据当事人的请求予以适当减少。</p>
              <blockquote>智能体摘录:违约金约定应遵循对等原则,本条款作为第 12.1 条修订建议的法律依据。</blockquote>
              <p>当事人就迟延履行约定违约金的,违约方支付违约金后,还应当履行债务。</p>`;
        el.querySelector('#pane-browser').innerHTML = `
          <div class="browser-frame">
            <div class="browser-bar">
              <button class="btn-icon">${ICON('rotate-ccw', 13)}</button>
              <div class="browser-url">${ICON('globe', 11)}npc.gov.cn/npc/c2/c30834/202006/t20200602_306457.html</div>
              <button class="btn-icon ${state.webCode ? 'on' : ''}" id="bw-code" title="${state.webCode ? '查看网页' : '查看源码'}">${ICON('code', 13)}</button>
              <button class="btn-icon">${ICON('external-link', 13)}</button>
            </div>
            <div class="browser-view${state.webCode ? ' src-mode' : ''}">${viewHtml}</div>
          </div>`;
        el.querySelector('#bw-code').addEventListener('click', () => { state.webCode = !state.webCode; renderBrowser(); });
      }

      /* ---------- 右栏:审计轨迹 ---------- */
      function renderAudit() {
        const pane = el.querySelector('#pane-audit');
        const types = [['all', '全部'], ...Object.keys(AUDIT_STYLE).map(k => [k, AUDIT_STYLE[k].label])];
        const list = d.audit.filter(a => state.auditFilter === 'all' || a.type === state.auditFilter);
        pane.innerHTML = `
          <div class="audit-filter">
            ${types.map(([k, label]) => `<span class="af-chip ${state.auditFilter === k ? 'on' : ''}" data-af="${k}">${label}</span>`).join('')}
          </div>
          ${list.length ? list.map(a => {
            const st = AUDIT_STYLE[a.type] || AUDIT_STYLE.system;
            return `<div class="audit-item" style="--ac:${st.color}">
              <div class="audit-rail"><span class="audit-dot"></span><span class="audit-line"></span></div>
              <div class="audit-main">
                <div class="audit-action">${ICON(st.icon, 12)}<b style="font-weight:500">${UI.esc(a.action)}</b><span class="pill pill-dim" style="font-size:10px">${UI.esc(a.actor)}</span></div>
                <div class="audit-detail">${UI.esc(a.detail)}</div>
                <div class="audit-meta"><span>${a.time}</span><span>耗时 ${a.duration}</span><span>Tokens ${a.tokens}</span></div>
              </div>
            </div>`;
          }).join('') : '<div class="empty">' + ICON('shield', 30) + '<div>该类型下暂无审计记录</div></div>'}`;
        pane.querySelectorAll('[data-af]').forEach(c => c.addEventListener('click', () => {
          state.auditFilter = c.dataset.af;
          renderAudit();
        }));
      }

      renderTodos(); renderFiles(); renderBrowser(); renderAudit();

      /* ---------- 右栏:面板切换 / 收起(开关在顶栏) ---------- */
      function syncRightPanel() {
        const meta = PANE_META[state.pane];
        el.querySelector('#rp-panel').classList.toggle('collapsed', !state.panelOpen);
        el.querySelector('#rp-panel-title').innerHTML = ICON(meta.icon, 14) + meta.title;
        topActions.querySelectorAll('[data-tpane]').forEach(b =>
          b.classList.toggle('on', state.panelOpen && b.dataset.tpane === state.pane));
        el.querySelectorAll('.rp-pane').forEach(p =>
          p.classList.toggle('active', p.id === 'pane-' + state.pane));
        /* 右栏展开时中栏恒定(容器 37%,与左栏显隐无关);动态伸缩的是右栏 */
        const lay = el.querySelector('.task-layout');
        if (lay) lay.classList.toggle('rp-open', state.showRight && state.panelOpen);
      }
      topActions.querySelectorAll('[data-tpane]').forEach(b => b.addEventListener('click', () => {
        /* 至少保留一个选中:点击当前激活面板不再取消 */
        if (state.panelOpen && b.dataset.tpane === state.pane) return;
        state.pane = b.dataset.tpane;
        state.panelOpen = true;
        syncRightPanel();
      }));
      syncRightPanel();

      /* ---------- 右栏:上下文资料面板(该任务挂载的文件 / 资料) ---------- */
      const CTX_STYLE = {
        kb: { icon: 'book-open', color: '#6C63F0' }, doc: { icon: 'file-text', color: '#4C9AFF' },
        file: { icon: 'folder', color: '#E09A5B' }, web: { icon: 'globe', color: '#3FB6B2' },
        db: { icon: 'database', color: '#B074E8' }
      };
      function renderContext() {
        const list = d.context || [];
        el.querySelector('#pane-ctx').innerHTML = `
          <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
            <span class="dim" style="font-size:12px">上下文资料 · ${list.length}</span>
          </div>
          <div style="padding:6px">
            ${list.length ? list.map(c => {
              const st = CTX_STYLE[c.type] || CTX_STYLE.doc;
              const clickable = c.type === 'file' || c.type === 'doc';
              return `<div class="ctx-item" ${clickable ? `data-ctx-file="${UI.esc(c.name)}" style="cursor:pointer" title="点击在任务文件中预览"` : ''}>
                <span class="file-icon" style="color:${st.color};background:${st.color}1A">${ICON(st.icon, 14)}</span>
                <div style="flex:1;min-width:0">
                  <div class="ctx-name">${UI.esc(c.name)}</div>
                  <div class="ctx-meta">${UI.esc(c.meta)}</div>
                </div>
                ${clickable ? ICON('chevron-right', 12, 'dim') : ''}
              </div>`;
            }).join('') : '<div class="empty">' + ICON('layers', 30) + '<div>该任务暂未挂载上下文资料</div></div>'}
          </div>`;
        el.querySelector('#pane-ctx').querySelectorAll('[data-ctx-file]').forEach(item => item.addEventListener('click', () => {
          const f = d.files.find(x => x.name === item.dataset.ctxFile);
          if (!f) { UI.toast('该资料不在本任务产物文件中', 'err'); return; }
          state.pane = 'files';
          state.panelOpen = true;
          state.fileSel = f;
          state.fileCode = false;
          renderFiles();
          syncRightPanel();
        }));
      }
      renderContext();

      /* ---------- 会话动态切换(不整页重载,只刷新中栏+右栏) ---------- */
      function renderSessList() {
        el.querySelector('#sess-list').innerHTML = sessListHtml();
      }
      function syncCrumb() {
        document.getElementById('topbar-crumb').innerHTML = ' / <a class="crumb-link" href="#/project/' + proj.id + '">' + UI.esc(proj.name) + '</a> / <b>' + UI.esc(s.title) + '</b>';
      }
      /* 徽章 + 输入占位 + 浮层:随选中专家集合同步 */
      function syncAgentBadge() {
        agentBadge.innerHTML = agentBadgeHtml();
        const shortName = agent.name.split(' · ')[1] || agent.name;
        ta.placeholder = '给 ' + shortName + (agentIds.length > 1 ? ' 等' + agentIds.length + '人' : '') + ' 下达补充指令…';
        agentPop.innerHTML = agentPopHtml();
      }
      function syncChatHead() {
        const t = el.querySelector('#chat-title');
        if (t) t.textContent = s.title;
        const sub = el.querySelector('#chat-sub');
        if (sub) sub.innerHTML = 'Tokens <span class="mono">' + s.tokens + '</span> · 更新 ' + s.updatedAt;
        syncAgentBadge();
      }
      async function switchSession(id) {
        if (state.switching) return;
        state.switching = true;
        chatEl.innerHTML = '<div style="padding:8px 4px">' + UI.skeleton(4) + '</div>';
        try {
          const r = await API.fetchSession(id);
          if (!el.isConnected) return; // 已离开任务页
          if (!r.data || !r.data.session) throw new Error('session not found: ' + id);
          d = r.data;
          s = d.session;
          agentIds = Array.isArray(s.agentIds) && s.agentIds.length ? s.agentIds.slice() : [s.agentId];
          agent = UI.agentById(agentIds[0]);
          state.fileSel = null;
          state.fileCode = false;
          state.webCode = false;
          state.sending = false;
          renderSessList();
          syncCrumb();
          syncChatHead();
          renderMessages();
          renderTodos(); renderFiles(); renderBrowser(); renderAudit();
          renderContext();
          syncStatus();
          updateSendBtn();
          history.replaceState(null, '', '#/task/' + id);
        } catch (err) {
          console.error('[task] 会话切换失败:', err);
          if (el.isConnected) {
            renderMessages();
            UI.toast('任务切换失败,请重试', 'err');
          }
        } finally {
          state.switching = false;
        }
      }
      el.querySelector('#sess-list').addEventListener('click', e => {
        const item = e.target.closest('[data-sess]');
        if (!item || item.dataset.sess === s.id) return;
        switchSession(item.dataset.sess);
      });
      el.querySelector('#btn-new-task-col').addEventListener('click', () => UI.toast('新任务入口将在后续版本接入编排器', 'err'));
      /* 左栏:普通任务 / 定时任务 切换 */
      el.querySelector('#btn-sess-filter').addEventListener('click', () => {
        state.sessFilter = state.sessFilter === 'cron' ? 'normal' : 'cron';
        const btn = el.querySelector('#btn-sess-filter');
        const cron = state.sessFilter === 'cron';
        btn.innerHTML = ICON(cron ? 'list-todo' : 'calendar-clock', 13);
        btn.title = cron ? '查看普通任务' : '查看定时任务';
        btn.style.color = cron ? '#4C9AFF' : '';
        renderSessList();
      });
      const layout = el.querySelector('.task-layout');
      function syncColumns() {
        layout.classList.toggle('hide-left', !state.showLeft);
        layout.classList.toggle('hide-right', !state.showRight);
        layout.classList.toggle('rp-open', state.showRight && state.panelOpen);
        el.querySelector('#tg-left').classList.toggle('on', state.showLeft);
        el.querySelector('#tg-right').classList.toggle('on', state.showRight);
      }
      el.querySelector('#tg-left').addEventListener('click', () => { state.showLeft = !state.showLeft; syncColumns(); });
      el.querySelector('#tg-right').addEventListener('click', () => { state.showRight = !state.showRight; syncColumns(); });

      /* ---------- 发送按钮三态 + 状态点 ---------- */
      const ta = el.querySelector('#chat-ta');
      const sendBtn = el.querySelector('#btn-send');
      function syncStatus() {
        const dot = el.querySelector('#input-status');
        dot.dataset.status = s.status;
        dot.title = '任务状态:' + (STATUS_LABEL[s.status] || s.status);
      }
      function updateSendBtn() {
        const hasText = ta.value.trim().length > 0;
        if (state.sending) { sendBtn.innerHTML = ICON('square', 12); sendBtn.title = '停止任务'; }
        else if (hasText) { sendBtn.innerHTML = ICON('arrow-up', 15); sendBtn.title = '发送'; }
        else { sendBtn.innerHTML = ICON('audio-lines', 15); sendBtn.title = '语音输入(原型占位)'; }
      }
      function stopTask() {
        state.sending = false;
        s.status = 'completed';
        const loading = document.getElementById('msg-loading');
        if (loading) loading.remove();
        d.messages.push({ id: 'mx' + Date.now(), role: 'assistant', type: 'text', time: '现在', content: '收到停止指令,已终止当前执行。' });
        renderMessages();
        syncStatus();
        updateSendBtn();
        UI.toast('任务已停止', 'err');
      }
      async function runAgentReply(text) {
        state.sending = true;
        s.status = 'running';
        syncStatus();
        updateSendBtn();
        chatEl.insertAdjacentHTML('beforeend', `
          <div class="msg" id="msg-loading">
            ${UI.agentAvatar(agent, 30)}
            <div class="msg-body"><div class="msg-text" style="display:inline-flex;align-items:center;gap:8px">${ICON('loader', 14, 'spin')}正在思考并调用工具…</div></div>
          </div>`);
        chatEl.scrollTop = chatEl.scrollHeight;
        await API.sendMessage(s.id, text);
        if (!state.sending) return; // 执行期间已被手动停止
        d.audit.push({ id: 'au' + Date.now(), time: '现在', actor: agent.name.split(' · ')[1] || agent.name, type: 'think', action: '规划执行路径', detail: '针对补充指令重新规划子步骤', duration: '2s', tokens: '0.6K' });
        const loading = document.getElementById('msg-loading');
        if (loading) loading.remove();
        state.sending = false;
        s.status = 'completed';
        renderMessages();
        renderAudit();
        syncStatus();
        updateSendBtn();
      }
      const send = () => {
        const text = ta.value.trim();
        if (!text || state.sending) return;
        d.messages.push({ id: 'mu' + Date.now(), role: 'user', type: 'text', time: '现在', content: text });
        ta.value = '';
        renderMessages();
        runAgentReply(text);
      };
      /* 消息 hover 操作:用户=复制/删除/回退;助手=复制/重试/评价 */
      chatEl.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const msgEl = btn.closest('[data-mid]');
        const idx = d.messages.findIndex(m => m.id === msgEl.dataset.mid);
        if (idx < 0) return;
        const m = d.messages[idx];
        const act = btn.dataset.act;
        if (act === 'copy') {
          const text = typeof m.content === 'string' ? m.content : (m.steps || []).map(st => st.title).join('\n');
          try { await navigator.clipboard.writeText(text); UI.toast('已复制到剪贴板'); }
          catch (err) { UI.toast('复制失败:浏览器未授权剪贴板', 'err'); }
        }
        if (act === 'del') { d.messages.splice(idx, 1); renderMessages(); UI.toast('消息已删除'); }
        if (act === 'rollback') {
          d.messages.splice(idx);
          renderMessages();
          UI.toast('已回滚到该消息发送之前');
        }
        if (act === 'retry') {
          const lastUser = d.messages.slice(0, idx).reverse().find(x => x.role === 'user');
          d.messages.splice(idx, 1);
          renderMessages();
          if (lastUser && !state.sending) runAgentReply(lastUser.content);
        }
        if (act === 'up' || act === 'down') {
          const row = btn.closest('.msg-acts');
          row.querySelectorAll('[data-act="up"],[data-act="down"]').forEach(b => b.classList.remove('voted'));
          btn.classList.add('voted');
          UI.toast(act === 'up' ? '已标记为有帮助,感谢反馈' : '已记录反馈,将持续优化');
        }
      });
      sendBtn.addEventListener('click', () => {
        if (state.sending) { stopTask(); return; }
        if (!ta.value.trim()) { UI.toast('语音输入为原型占位,暂未开放', 'err'); return; }
        send();
      });
      ta.addEventListener('input', updateSendBtn);
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });

      /* ---------- 执行专家切换浮层 ---------- */
      const agentBadge = el.querySelector('#input-agent');
      const agentPop = el.querySelector('#agent-pop');
      agentBadge.addEventListener('click', e => {
        e.stopPropagation();
        agentPop.hidden = !agentPop.hidden;
      });
      agentPop.addEventListener('click', e => {
        if (e.target.closest('[data-manage-agents]')) {
          agentPop.hidden = true;
          location.hash = '#/agents';
          return;
        }
        const item = e.target.closest('[data-agent]');
        if (!item) return;
        const a = UI.agentById(item.dataset.agent);
        if (!a) return;
        const i = agentIds.indexOf(a.id);
        if (i >= 0) {
          if (agentIds.length === 1) { UI.toast('至少保留一位执行专家', 'err'); return; }
          agentIds.splice(i, 1);
        } else {
          agentIds.push(a.id);
        }
        // TODO: replace with fetch(`/api/sessions/${s.id}`, {method:'PATCH', body:{agentIds}})
        s.agentIds = agentIds.slice();
        s.agentId = agentIds[0];
        agent = UI.agentById(agentIds[0]);
        syncAgentBadge();
        UI.toast(i >= 0 ? '已移除「' + a.name + '」' : '已添加「' + a.name + '」,共 ' + agentIds.length + ' 位执行专家');
      });
      const onDocClose = e => {
        if (!el.isConnected) { document.removeEventListener('click', onDocClose); return; }
        if (!agentPop.hidden && !e.target.closest('#agent-pop') && !e.target.closest('#input-agent')) agentPop.hidden = true;
      };
      document.addEventListener('click', onDocClose);

      syncStatus();
      updateSendBtn();
    }
  };
})();
