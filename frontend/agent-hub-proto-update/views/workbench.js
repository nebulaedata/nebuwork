/* views/workbench.js — 工作台:首页 / 数据统计 / 指挥官 / 情报中心 / 专业工作台(顶部二级菜单) */
(function () {
  window.Views = window.Views || {};

  const WB_TABS = [
    ['home', '首页', 'layout-dashboard'], ['stats', '数据统计', 'bar-chart-3'],
    ['commander', '指挥官', 'command'], ['intel', '情报中心', 'radar'],
    ['pro', '专业工作台', 'package']
  ];

  /* 解析 '4.6M' / '900K' / '48.2K' 为 K 数值 */
  function parseK(v) {
    const n = parseFloat(v) || 0;
    return v.endsWith('M') ? n * 1000 : n;
  }

  /* ================= 首页(原工作台内容) ================= */
  function tabHome(el, wbs, projects) {
    const running = DB.sessions.filter(s => s.status === 'running').length;
    const doneToday = DB.sessions.filter(s => s.status === 'done').length;
    const totalTokens = (DB.projects.reduce((a, p) => a + parseK(p.stats.tokens), 0) / 1000).toFixed(1);
    const stats = [
      { label: '垂直工作台', value: wbs.length, icon: 'layout-dashboard', color: '#6C63F0', foot: '按业务领域划分' },
      { label: '进行中项目', value: projects.filter(p => p.status === 'active').length, icon: 'folder-kanban', color: '#4C9AFF', foot: '共 ' + projects.length + ' 个项目' },
      { label: '运行中任务', value: running, icon: 'activity', color: '#3FB6B2', foot: '今日已完成 ' + doneToday + ' 个' },
      { label: '累计消耗 Tokens', value: totalTokens + 'M', icon: 'zap', color: '#B074E8', foot: DB.quota.costMonth + ' / 本月' }
    ];
    el.innerHTML = `
    <div class="page">
      <div class="wb-hero reveal">
        <h1>让 <em>专家智能体</em> 驱动你的业务工作台</h1>
        <p>以项目管理资源,以专家沉淀能力 —— 选择一个垂直领域工作台开始。</p>
      </div>

      <div class="grid grid-4 reveal reveal-1" style="margin-bottom:28px">
        ${stats.map(s => `
          <div class="card stat-card">
            <div class="s-label"><span style="color:${s.color};display:inline-flex">${ICON(s.icon, 13)}</span>${s.label}</div>
            <div class="s-value">${s.value}</div>
            <div class="s-foot">${s.foot}</div>
          </div>`).join('')}
      </div>

      <div class="section-title reveal reveal-2">垂直领域工作台</div>
      <div class="section-desc reveal reveal-2">每个工作台面向一类业务场景,聚合该领域的项目、专家与运行状态。</div>
      <div class="grid grid-2 reveal reveal-3">
        ${wbs.map(wb => `
          <div class="card clickable wb-card" style="--wc:${wb.color}" data-wb="${wb.id}">
            <div class="wb-head">
              <span class="wb-icon">${ICON(wb.icon, 19)}</span>
              <div>
                <div class="wb-name">${UI.esc(wb.name)}</div>
                <div class="dim" style="font-size:11px;margin-top:2px">${wb.projectIds.length} 个项目</div>
              </div>
            </div>
            <div class="wb-desc">${UI.esc(wb.desc)}</div>
            <div class="wb-stats">
              <span>运行中任务 <b>${wb.stats.running}</b></span>
              <span>今日 Tokens <b>${wb.stats.tokenToday}</b></span>
            </div>
            <div class="wb-foot">
              <span class="wb-link">进入工作台 ${ICON('arrow-right', 13)}</span>
              <div class="agent-avatars">
                ${wb.projectIds.flatMap(pid => (UI.projectById(pid).agentIds || [])).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 4)
                  .map(aid => '<span class="avatar" style="background:' + UI.agentById(aid).color + '">' + UI.esc(UI.agentById(aid).initials) + '</span>').join('')}
              </div>
            </div>
          </div>`).join('')}
      </div>

      <div class="section-title reveal reveal-4" style="margin-top:32px">最近任务</div>
      <div class="section-desc reveal reveal-4">跨项目的最新任务动态,点击可直接回到任务现场。</div>
      <div class="card reveal reveal-5">
        <table class="table">
          <thead><tr><th>任务</th><th>类型</th><th>所属项目</th><th>执行专家</th><th>状态</th><th>Tokens</th><th>更新时间</th></tr></thead>
          <tbody>
            ${DB.sessions.slice(0, 6).map(s => {
              const a = UI.agentById(s.agentId), p = UI.projectById(s.projectId);
              return `<tr data-sess="${s.id}" style="cursor:pointer">
                <td style="max-width:280px">${UI.esc(s.title)}</td>
                <td>${s.kind === 'cron' ? '<span class="pill pill-info">' + ICON('calendar-clock', 11) + '定时任务</span>' : '<span class="pill pill-dim">普通任务</span>'}</td>
                <td class="sub">${UI.esc(p.name)}</td>
                <td><span style="color:${a.color}">${UI.esc(a.name.split(' · ')[1] || a.name)}</span></td>
                <td>${UI.statusPill(s.status)}</td>
                <td class="mono dim">${s.tokens}</td>
                <td class="dim">${s.updatedAt}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

    el.querySelectorAll('[data-wb]').forEach(c =>
      c.addEventListener('click', () => location.hash = '#/projects?wb=' + c.dataset.wb));
    el.querySelectorAll('[data-sess]').forEach(r =>
      r.addEventListener('click', () => location.hash = '#/task/' + r.dataset.sess));
  }

  /* ================= 数据统计 ================= */
  function tabStats(el, wbs, projects) {
    const statusCount = st => DB.sessions.filter(s => s.status === st).length;
    const totalTasks = projects.reduce((a, p) => a + p.stats.tasks, 0);
    const totalK = projects.reduce((a, p) => a + parseK(p.stats.tokens), 0);
    const merged = (DB.usage.p1 ? DB.usage.p1.series : []).map((v, i) => v + ((DB.usage.p3 || {}).series || [])[i] || 0);
    const projBars = projects.slice().sort((a, b) => parseK(b.stats.tokens) - parseK(a.stats.tokens));
    const maxK = parseK(projBars[0].stats.tokens) || 1;

    const cards = [
      { label: '项目总数', value: projects.length, icon: 'folder-kanban', color: '#4C9AFF', foot: '进行中 ' + projects.filter(p => p.status === 'active').length },
      { label: '任务总量', value: totalTasks, icon: 'message-square', color: '#6C63F0', foot: '运行中 ' + statusCount('running') + ' · 排队 ' + statusCount('waiting') },
      { label: '累计 Tokens', value: (totalK / 1000).toFixed(1) + 'M', icon: 'zap', color: '#B074E8', foot: '任务均值 ' + Math.round(totalK / totalTasks) + 'K' },
      { label: '本月消耗', value: DB.quota.costMonth, icon: 'activity', color: '#E09A5B', foot: '额度 ' + DB.quota.used + ' / ' + DB.quota.total + ' ' + DB.quota.unit }
    ];

    el.innerHTML = `
    <div class="page">
      <div class="grid grid-4 reveal" style="margin-bottom:20px">
        ${cards.map(s => `
          <div class="card stat-card">
            <div class="s-label"><span style="color:${s.color};display:inline-flex">${ICON(s.icon, 13)}</span>${s.label}</div>
            <div class="s-value">${s.value}</div>
            <div class="s-foot">${s.foot}</div>
          </div>`).join('')}
      </div>
      <div class="grid grid-2 reveal reveal-1" style="margin-bottom:20px">
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('trending-up', 15)}近 14 日全站消耗(K)</div>
          ${UI.sparkline(merged.length ? merged : [0], '#6C63F0')}
          <div class="dim" style="font-size:11px;margin-top:8px">${DB.usage.p1 ? DB.usage.p1.days[0] : ''} ~ ${DB.usage.p1 ? DB.usage.p1.days[DB.usage.p1.days.length - 1] : ''} · 峰值 ${Math.max.apply(null, merged.length ? merged : [0])}K</div>
        </div>
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('message-square', 15)}任务状态分布</div>
          ${UI.donut([
            { label: '运行中', value: statusCount('running'), color: '#4C9AFF' },
            { label: '已完成', value: statusCount('done'), color: '#3FB6B2' },
            { label: '排队中', value: statusCount('waiting'), color: '#E09A5B' },
            { label: '已失败', value: statusCount('failed'), color: '#E0645F' }
          ], DB.sessions.length + ' 个')}
        </div>
      </div>
      <div class="grid grid-2 reveal reveal-2">
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('folder-kanban', 15)}按项目 Tokens 消耗</div>
          ${projBars.map(p => `
            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
                <span>${UI.esc(p.name)}</span><span class="mono dim">${p.stats.tokens} · ${p.stats.cost}</span>
              </div>
              <div class="quota-bar"><i style="width:${Math.round(parseK(p.stats.tokens) / maxK * 100)}%"></i></div>
            </div>`).join('')}
        </div>
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('layout-dashboard', 15)}按工作台今日 Tokens</div>
          ${UI.donut(wbs.map(wb => ({ label: wb.name, value: parseK(wb.stats.tokenToday), color: wb.color })), '今日')}
          <div class="dim" style="font-size:11px;margin-top:10px">单位:K tokens · 数据口径为今日 0 点起累计</div>
        </div>
      </div>
    </div>`;
  }

  /* ================= 指挥官 ================= */
  /* 球状节点图:节点分布在球面(fibonacci),绕 Y 轴旋转投影,中心为主智能体记忆 */
  function startMemGraph(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const nodes = DB.commander.memNodes;
    const N = nodes.length - 1;
    const R = 1;
    nodes.forEach((n, i) => {
      if (n.kind === 'center') { n.p3 = [0, 0, 0]; return; }
      const k = i - 1, ga = Math.PI * (3 - Math.sqrt(5));
      const y = 1 - (k / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = ga * k;
      n.p3 = [Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R];
    });
    const edges = [];
    nodes.forEach((n, i) => {
      if (n.kind === 'center') return;
      edges.push([0, i]);
      if (n.kind === 'memory') edges.push([i, 1 + (i - 7) % 6]);
    });
    let W = 0, H = 0, rot = 0, hover = null;
    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
    }
    resize();
    const onResize = () => { if (!document.body.contains(canvas)) { window.removeEventListener('resize', onResize); return; } resize(); };
    window.addEventListener('resize', onResize);
    const onMove = e => {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (canvas.width / r.width), my = (e.clientY - r.top) * (canvas.height / r.height);
      hover = null;
      nodes.forEach(n => {
        if (!n.s) return;
        if (Math.hypot(n.s[0] - mx, n.s[1] - my) < n.s[2] + 8) hover = n;
      });
      const tip = document.getElementById('mem-tip');
      if (tip) tip.textContent = hover ? ('节点:' + hover.label + (hover.kind === 'memory' ? ' · 记忆沉淀' : hover.kind === 'agent' ? ' · 专家智能体' : ' · 主智能体')) : '拖动查看 · 点击节点查看关联';
    };
    canvas.addEventListener('mousemove', onMove);
    function frame() {
      if (!document.body.contains(canvas)) { window.__viewRAF = null; return; }
      rot += 0.004;
      const cx = W / 2, cy = H / 2, scale = Math.min(W, H) * 0.34;
      ctx.clearRect(0, 0, W, H);
      /* 投影 + 按深度排序 */
      nodes.forEach(n => {
        const [x, y, z] = n.p3;
        const xr = x * Math.cos(rot) - z * Math.sin(rot);
        const zr = x * Math.sin(rot) + z * Math.cos(rot);
        n.sx = cx + xr * scale; n.sy = cy + y * scale * 0.92; n.sz = zr;
        const depth = (zr + 1) / 2;
        const base = n.kind === 'center' ? 15 : n.kind === 'agent' ? 8 : 5.5;
        n.s = [n.sx, n.sy, base * (0.7 + depth * 0.55) * (W / 800 + 0.6)];
        n.alpha = 0.35 + depth * 0.65;
      });
      /* 轨道环 */
      ctx.strokeStyle = 'rgba(108,99,240,0.16)';
      ctx.lineWidth = 1;
      [0.62, 1.0].forEach(rr => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, scale * rr, scale * rr * 0.30, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      /* 连边 */
      edges.forEach(([a, b]) => {
        const A = nodes[a], B = nodes[b];
        const alpha = Math.min(A.alpha, B.alpha) * 0.5;
        ctx.strokeStyle = 'rgba(108,99,240,' + alpha.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.stroke();
      });
      /* 节点 */
      nodes.forEach(n => {
        const col = n.kind === 'center' ? '#6C63F0' : n.kind === 'agent' ? '#4C9AFF' : '#B074E8';
        ctx.globalAlpha = n.alpha;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(n.sx, n.sy, n.s[2], 0, Math.PI * 2); ctx.fill();
        if (n.kind !== 'memory' || n === hover) {
          ctx.font = (n.kind === 'center' ? '600 ' + Math.round(12 * W / 800 + 4) : Math.round(10 * W / 800 + 4)) + 'px sans-serif';
          ctx.fillStyle = col;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.sx, n.sy - n.s[2] - 7);
        }
        if (n === hover) {
          ctx.strokeStyle = col; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(n.sx, n.sy, n.s[2] + 5, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
      /* 中心脉动光环 */
      const c = nodes[0], pulse = (Date.now() % 2400) / 2400;
      ctx.strokeStyle = 'rgba(108,99,240,' + (0.35 * (1 - pulse)).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(c.sx, c.sy, c.s[2] + pulse * 26, 0, Math.PI * 2); ctx.stroke();
      window.__viewRAF = requestAnimationFrame(frame);
    }
    window.__viewRAF = requestAnimationFrame(frame);
  }

  function commanderMsgHtml(m) {
    if (m.role === 'user') {
      return `<div class="cmd-msg user"><div class="cmd-bubble">${UI.esc(m.content)}</div><div class="cmd-time">${m.time}</div></div>`;
    }
    return `<div class="cmd-msg"><div class="cmd-bubble agent">${UI.esc(m.content)}</div><div class="cmd-time">${m.time} · 指挥官</div></div>`;
  }

  function dispatchHtml() {
    return DB.commander.dispatch.map(t => {
      const a = UI.agentById(t.agentId), p = UI.projectById(t.projectId);
      return `<div class="cmd-task" data-dispatch="${t.id}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="agent-ava" style="width:22px;height:22px;font-size:10px;border-radius:7px;background:${a.color}">${UI.esc(a.initials)}</span>
          <span style="flex:1;font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(t.title)}</span>
          ${UI.statusPill(t.status)}
        </div>
        <div class="dim" style="font-size:11px;margin-bottom:6px">${UI.esc(p.name)} · ${t.time}</div>
        <div class="quota-bar" style="height:4px"><i style="width:${t.progress}%;background:${t.status === 'failed' ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--accent)'}"></i></div>
      </div>`;
    }).join('');
  }

  function tabCommander(el) {
    el.innerHTML = `
    <div class="page page-fill">
      <div class="cmd-grid reveal">
        <div class="card cmd-chat">
          <div class="tc-head"><span class="tc-title">${ICON('command', 15)}指挥官对话</span><span class="pill pill-dim">主智能体</span></div>
          <div class="cmd-msgs" id="cmd-msgs">${DB.commander.messages.map(commanderMsgHtml).join('')}</div>
          <div class="cmd-input">
            <input id="cmd-text" placeholder="向指挥官下达指令,如:创建项目「供应链复盘」并发起分析任务…">
            <button class="btn btn-primary btn-sm" id="cmd-send">${ICON('send', 13)}发送</button>
          </div>
        </div>
        <div class="card cmd-canvas-wrap">
          <div class="tc-head"><span class="tc-title">${ICON('orbit', 15)}主智能体记忆</span><span class="dim" style="font-size:11px" id="mem-tip">拖动查看 · 点击节点查看关联</span></div>
          <canvas id="mem-canvas" class="cmd-canvas"></canvas>
        </div>
        <div class="card cmd-side">
          <div class="tc-head"><span class="tc-title">${ICON('workflow', 15)}任务调度执行</span><span class="pill pill-dim" id="dispatch-cnt">${DB.commander.dispatch.length}</span></div>
          <div class="cmd-tasks" id="cmd-tasks">${dispatchHtml()}</div>
        </div>
      </div>
    </div>`;

    startMemGraph(el.querySelector('#mem-canvas'));

    const msgs = el.querySelector('#cmd-msgs');
    msgs.scrollTop = msgs.scrollHeight;

    async function send() {
      const inp = el.querySelector('#cmd-text');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      DB.commander.messages.push({ id: 'cm' + Date.now(), role: 'user', time: '现在', content: text });
      msgs.innerHTML = DB.commander.messages.map(commanderMsgHtml).join('');
      msgs.scrollTop = msgs.scrollHeight;

      let reply;
      if (/创建项目|新建项目/.test(text)) {
        const m = text.match(/[「『"]([^」』"]+)[」』"]/);
        const name = m ? m[1] : '未命名项目';
        /* TODO: replace with fetch('/api/projects', {method:'POST', ...}) */
        await API.createProject({ name, workbenchId: 'wb-doc', desc: '由指挥官对话创建' });
        DB.commander.dispatch.unshift({ id: 'cd' + Date.now(), title: '初始化项目「' + name + '」资源配置', agentId: 'a1', projectId: DB.projects[DB.projects.length - 1].id, status: 'running', progress: 12, time: '现在' });
        reply = '已创建项目「' + name + '」,正在初始化资源配置。你可以在右侧调度列表跟踪进度,或到项目页查看详情。';
        UI.toast('项目「' + name + '」已由指挥官创建');
      } else if (/任务|调度|执行/.test(text)) {
        DB.commander.dispatch.unshift({ id: 'cd' + Date.now(), title: text.slice(0, 28), agentId: 'a2', projectId: 'p3', status: 'running', progress: 5, time: '现在' });
        reply = '已为你调度任务:「' + text.slice(0, 28) + '」,指派给经营分析专家 · 观澜执行。进展会实时同步到右侧调度列表。';
        UI.toast('任务已调度');
      } else if (/智能体|专家/.test(text)) {
        reply = '当前在岗 6 位专家智能体,均可在「专家智能体」页管理。需要我为新任务指派专家时,直接说明业务目标即可,我会自动匹配最合适的人选。';
      } else {
        reply = '收到。我可以直接创建项目、发起任务、调度专家智能体——试试说「创建项目『XX』」或「发起一个 XX 任务」。';
      }
      DB.commander.messages.push({ id: 'cm' + (Date.now() + 1), role: 'agent', time: '现在', content: reply });
      msgs.innerHTML = DB.commander.messages.map(commanderMsgHtml).join('');
      msgs.scrollTop = msgs.scrollHeight;
      el.querySelector('#cmd-tasks').innerHTML = dispatchHtml();
      el.querySelector('#dispatch-cnt').textContent = DB.commander.dispatch.length;
    }
    el.querySelector('#cmd-send').addEventListener('click', send);
    el.querySelector('#cmd-text').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  /* ================= 情报中心 ================= */
  /* 粗略世界轮廓(归一化坐标,演示用) */
  const WORLD = [
    [[0.05, 0.28], [0.10, 0.22], [0.17, 0.18], [0.24, 0.22], [0.28, 0.30], [0.27, 0.38], [0.24, 0.44], [0.20, 0.44], [0.16, 0.38], [0.10, 0.36], [0.06, 0.33]],
    [[0.30, 0.12], [0.35, 0.10], [0.38, 0.14], [0.33, 0.18], [0.29, 0.16]],
    [[0.26, 0.50], [0.31, 0.48], [0.35, 0.55], [0.33, 0.66], [0.29, 0.78], [0.26, 0.70], [0.24, 0.58]],
    [[0.46, 0.22], [0.52, 0.18], [0.57, 0.22], [0.55, 0.28], [0.50, 0.32], [0.46, 0.30], [0.44, 0.26]],
    [[0.46, 0.36], [0.52, 0.33], [0.58, 0.36], [0.60, 0.44], [0.56, 0.56], [0.52, 0.64], [0.49, 0.56], [0.45, 0.46]],
    [[0.58, 0.20], [0.68, 0.14], [0.78, 0.16], [0.86, 0.24], [0.88, 0.32], [0.82, 0.40], [0.76, 0.42], [0.72, 0.50], [0.68, 0.44], [0.64, 0.36], [0.58, 0.28]],
    [[0.74, 0.56], [0.78, 0.55], [0.80, 0.58], [0.76, 0.59]],
    [[0.85, 0.33], [0.87, 0.31], [0.88, 0.35], [0.86, 0.37]],
    [[0.78, 0.66], [0.85, 0.63], [0.89, 0.68], [0.87, 0.74], [0.80, 0.74]]
  ];

  function startIntelMap(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let W = 0, H = 0;
    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
    }
    resize();
    const onResize = () => { if (!document.body.contains(canvas)) { window.removeEventListener('resize', onResize); return; } resize(); };
    window.addEventListener('resize', onResize);
    function frame() {
      if (!document.body.contains(canvas)) { window.__viewRAF = null; return; }
      ctx.clearRect(0, 0, W, H);
      /* 经纬网格 */
      ctx.strokeStyle = 'rgba(108,99,240,0.08)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(W * i / 8, 0); ctx.lineTo(W * i / 8, H); ctx.stroke(); }
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke(); }
      /* 大陆 */
      WORLD.forEach(poly => {
        ctx.beginPath();
        poly.forEach(([x, y], i) => i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H));
        ctx.closePath();
        ctx.fillStyle = 'rgba(108,99,240,0.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(108,99,240,0.35)';
        ctx.stroke();
      });
      /* 信号点(脉动) */
      const t = Date.now();
      DB.intelItems.forEach(it => {
        const x = it.x * W, y = it.y * H;
        const ph = (t / 1600 + it.heat) % 1;
        const hot = it.heat >= 70;
        const col = hot ? '224,120,88' : '76,154,255';
        ctx.strokeStyle = 'rgba(' + col + ',' + (0.5 * (1 - ph)).toFixed(3) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, 4 + ph * 16, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(' + col + ',0.95)';
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(120,120,140,0.9)';
        ctx.textAlign = 'left';
        ctx.fillText(it.region, x + 8, y + 3);
      });
      window.__viewRAF = requestAnimationFrame(frame);
    }
    window.__viewRAF = requestAnimationFrame(frame);
  }

  function tabIntel(el) {
    const hot = DB.intelItems.filter(i => i.heat >= 70).length;
    const regions = new Set(DB.intelItems.map(i => i.region)).size;
    const cards = [
      { label: '订阅源', value: DB.intelSubs.length, icon: 'rss', color: '#6C63F0', foot: '启用 ' + DB.intelSubs.filter(s => s.enabled).length + ' 个' },
      { label: '情报条目', value: DB.intelSubs.reduce((a, s) => a + s.items, 0), icon: 'radar', color: '#4C9AFF', foot: '今日新增 ' + DB.intelItems.length },
      { label: '高热信号', value: hot, icon: 'activity', color: '#E0645F', foot: '热度 ≥ 70' },
      { label: '覆盖区域', value: regions, icon: 'map', color: '#3FB6B2', foot: '全球信息地图实时定位' }
    ];
    const sorted = DB.intelItems.slice().sort((a, b) => b.heat - a.heat);
    el.innerHTML = `
    <div class="page">
      <div class="grid grid-4 reveal" style="margin-bottom:20px">
        ${cards.map(s => `
          <div class="card stat-card">
            <div class="s-label"><span style="color:${s.color};display:inline-flex">${ICON(s.icon, 13)}</span>${s.label}</div>
            <div class="s-value">${s.value}</div>
            <div class="s-foot">${s.foot}</div>
          </div>`).join('')}
      </div>
      <div class="grid grid-2 reveal reveal-1" style="margin-bottom:20px">
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:12px">${ICON('rss', 15)}行业情报订阅</div>
          ${DB.intelSubs.map(s => `
            <div class="file-row">
              <span class="file-icon">${ICON('rss', 15)}</span>
              <div style="flex:1">
                <div style="font-size:13px">${UI.esc(s.name)} <span class="dim mono" style="font-size:11px;margin-left:6px">${s.cadence}</span></div>
                <div class="dim" style="font-size:11px;margin-top:2px">来源:${UI.esc(s.source)} · 累计 ${s.items} 条</div>
              </div>
              <button class="cron-switch ${s.enabled ? 'on' : ''}" data-sub="${s.id}" title="${s.enabled ? '点击退订' : '点击订阅'}"></button>
            </div>`).join('')}
          <button class="btn btn-ghost btn-sm" id="btn-add-sub" style="margin-top:10px">${ICON('plus', 13)}添加订阅</button>
        </div>
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:12px">${ICON('radar', 15)}情报汇总看板</div>
          ${sorted.map(it => `
            <div class="file-row" style="align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;line-height:1.5">${UI.esc(it.title)}</div>
                <div class="dim" style="font-size:11px;margin-top:3px">${UI.esc(it.source)} · ${it.region} · ${it.time}</div>
              </div>
              <span class="pill ${it.heat >= 70 ? 'pill-danger' : 'pill-dim'} mono" style="flex-shrink:0">${it.heat}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card reveal reveal-2" style="overflow:hidden">
        <div class="tc-head"><span class="tc-title">${ICON('map', 15)}全球信息地图</span><span class="dim" style="font-size:11px">信号点按区域实时脉动,红色为高热情报</span></div>
        <canvas id="intel-map" class="intel-map"></canvas>
      </div>
    </div>`;

    startIntelMap(el.querySelector('#intel-map'));
    el.querySelectorAll('[data-sub]').forEach(sw => sw.addEventListener('click', () => {
      const s = DB.intelSubs.find(x => x.id === sw.dataset.sub);
      s.enabled = !s.enabled;
      sw.classList.toggle('on', s.enabled);
      UI.toast(s.enabled ? '已订阅「' + s.name + '」' : '已退订「' + s.name + '」');
    }));
    el.querySelector('#btn-add-sub').addEventListener('click', () => UI.toast('订阅市场将在后续版本接入', 'err'));
  }

  /* ================= 专业工作台 ================= */
  /* ---------- 专业工作台:入口列表 + 顶层定义配置(业务本体定义/共享知识库/专家/案例模板) ---------- */
  function wbCfgOf(wb) {
    /* TODO: replace with fetch('/api/workbenches/' + wb.id + '/config') */
    if (!DB.wbConfigs[wb.id]) DB.wbConfigs[wb.id] = { bizName: '', domain: '', bizDef: '', kbRefs: [], agentIds: [], tplIds: [] };
    return DB.wbConfigs[wb.id];
  }

  function tabPro(el, wbs) {
    el.innerHTML = '<div class="page" id="pro-wrap"></div>';
    const wrap = el.querySelector('#pro-wrap');

    const paintList = () => {
      wrap.innerHTML = `
      <div class="section-title reveal">专业工作台</div>
      <div class="section-desc reveal">你定制的专业工作台入口,点击卡片进入,点击「配置」维护业务本体定义与资源引用。</div>
      <div class="grid grid-2 reveal reveal-1" style="margin-top:16px">
        ${wbs.map(wb => `
          <div class="card clickable wb-card" style="--wc:${wb.color}" data-wb="${wb.id}">
            <div class="wb-head">
              <span class="wb-icon">${ICON(wb.icon, 19)}</span>
              <div>
                <div class="wb-name">${UI.esc(wb.name)}</div>
                <div class="dim" style="font-size:11px;margin-top:2px">${wb.projectIds.length} 个项目 · 运行中 ${wb.stats.running}</div>
              </div>
            </div>
            <div class="wb-desc">${UI.esc(wb.desc)}</div>
            <div class="wb-foot">
              <span class="wb-link">进入工作台 ${ICON('arrow-right', 13)}</span>
              <span style="display:flex;align-items:center;gap:8px">
                <span class="pill pill-dim mono">${wb.stats.tokenToday}/今日</span>
                <button class="btn btn-ghost btn-sm" data-wb-cfg="${wb.id}">${ICON('settings', 12)}配置</button>
              </span>
            </div>
          </div>`).join('')}
        <div class="card clickable wb-new" id="btn-new-pro">
          ${ICON('plus', 22)}
          <div style="font-size:13.5px;font-weight:500;margin-top:8px">定制新工作台</div>
          <div class="dim" style="font-size:11.5px;margin-top:4px">选择领域模板,配置专属项目与专家组合</div>
        </div>
      </div>`;
      wrap.querySelectorAll('[data-wb]').forEach(c =>
        c.addEventListener('click', () => location.hash = '#/projects?wb=' + c.dataset.wb));
      wrap.querySelectorAll('[data-wb-cfg]').forEach(b =>
        b.addEventListener('click', e => {
          e.stopPropagation();
          paintCfg(wbs.find(w => w.id === b.dataset.wbCfg));
        }));
      wrap.querySelector('#btn-new-pro').addEventListener('click', () => UI.toast('工作台定制向导将在后续版本上线', 'err'));
    };

    /* 通用引用选择弹窗 */
    const openRefPicker = (title, options, onPick) => {
      if (!options.length) { UI.toast('暂无可引用的资源', 'err'); return; }
      UI.modal(title, `
        <div class="field"><label>${title}</label>
          <select id="rp-sel">${options.map(o => '<option value="' + o.id + '">' + UI.esc(o.label) + '</option>').join('')}</select>
        </div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="rp-submit">确认引用</button></div>`, m => {
        m.querySelector('#rp-submit').addEventListener('click', () => {
          UI.closeModal();
          onPick(m.querySelector('#rp-sel').value);
        });
      });
    };

    const paintCfg = wb => {
      const cfg = wbCfgOf(wb);
      const kbRows = cfg.kbRefs.map(id => DB.sharedKbs.find(k => k.id === id)).filter(Boolean);
      const agentRows = cfg.agentIds.map(id => DB.agents.find(a => a.id === id)).filter(Boolean);
      const tplRows = cfg.tplIds.map(id => DB.plazaTemplates.find(t => t.id === id)).filter(Boolean);
      wrap.innerHTML = `
      <div class="section-title reveal" style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost btn-sm" id="pro-back">${ICON('chevron-left', 13, 'dim')} 返回列表</button>
        <span class="wb-icon" style="--wc:${wb.color};width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center">${ICON(wb.icon, 15)}</span>
        ${UI.esc(wb.name)} · 配置
      </div>

      <div class="card reveal reveal-1" style="margin-top:14px">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('file-text', 15)}业务本体定义</span>
          <button class="btn btn-ghost btn-sm" id="wbc-edit-def">${ICON('pencil', 12)}编辑定义</button>
        </div>
        <div class="tc-body">
          <div class="grid grid-2" style="gap:10px;margin-bottom:10px">
            <div class="card card-pad" style="box-shadow:none"><div class="dim" style="font-size:11px;margin-bottom:4px">业务名称</div><div style="font-size:13px">${UI.esc(cfg.bizName || '未定义')}</div></div>
            <div class="card card-pad" style="box-shadow:none"><div class="dim" style="font-size:11px;margin-bottom:4px">业务领域</div><div style="font-size:13px">${UI.esc(cfg.domain || '未定义')}</div></div>
          </div>
          <div class="card card-pad" style="box-shadow:none"><div class="dim" style="font-size:11px;margin-bottom:4px">业务本体定义</div><div style="font-size:12.5px;line-height:1.7">${UI.esc(cfg.bizDef || '未定义')}</div></div>
        </div>
      </div>

      <div class="card reveal reveal-2" style="margin-top:14px">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('book-open', 15)}引用的共享知识库<span class="pill pill-dim" style="margin-left:8px">${kbRows.length}</span></span>
          <button class="btn btn-ghost btn-sm" id="wbc-add-kb">${ICON('plus', 12)}引用知识库</button>
        </div>
        <div class="tc-body">
          ${kbRows.length ? kbRows.map(k => `
            <div class="file-row"><span class="file-icon" style="color:#4C9AFF;background:#4C9AFF1A">${ICON('book-open', 14)}</span>
              <div style="flex:1;min-width:0"><div style="font-size:13px">${UI.esc(k.name)}</div><div class="dim" style="font-size:11px;margin-top:2px">${UI.esc(k.owner)} · ${UI.esc(k.field)} · ${k.docs} 文档</div></div>
              <button class="btn-icon" data-wbc-rm-kb="${k.id}" title="移除引用" style="color:var(--danger)">${ICON('trash-2', 12)}</button>
            </div>`).join('') : '<div class="empty" style="padding:14px">尚未引用共享知识库</div>'}
        </div>
      </div>

      <div class="card reveal reveal-3" style="margin-top:14px">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('bot', 15)}专家智能体<span class="pill pill-dim" style="margin-left:8px">${agentRows.length}</span></span>
          <button class="btn btn-ghost btn-sm" id="wbc-add-agent">${ICON('plus', 12)}添加专家</button>
        </div>
        <div class="tc-body">
          ${agentRows.length ? agentRows.map(a => `
            <div class="file-row"><span class="file-icon" style="color:${a.color};background:${a.color}1A">${ICON('bot', 14)}</span>
              <div style="flex:1;min-width:0"><div style="font-size:13px">${UI.esc(a.name)}</div><div class="dim" style="font-size:11px;margin-top:2px">${UI.esc(a.role)} · Lv.${a.level}</div></div>
              <button class="btn-icon" data-wbc-rm-agent="${a.id}" title="移除" style="color:var(--danger)">${ICON('trash-2', 12)}</button>
            </div>`).join('') : '<div class="empty" style="padding:14px">尚未配置专家智能体</div>'}
        </div>
      </div>

      <div class="card reveal reveal-4" style="margin-top:14px">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('layout-template', 15)}案例模板<span class="pill pill-dim" style="margin-left:8px">${tplRows.length}</span></span>
          <button class="btn btn-ghost btn-sm" id="wbc-add-tpl">${ICON('plus', 12)}引用模板</button>
        </div>
        <div class="tc-body">
          ${tplRows.length ? tplRows.map(t => `
            <div class="file-row"><span class="file-icon" style="color:${t.color};background:${t.color}1A">${ICON('layout-template', 14)}</span>
              <div style="flex:1;min-width:0"><div style="font-size:13px">${UI.esc(t.name)}<span class="pill pill-dim" style="margin-left:8px">${UI.esc(t.scene)}</span></div><div class="dim" style="font-size:11px;margin-top:2px">${UI.esc(t.desc)}</div></div>
              <button class="btn-icon" data-wbc-rm-tpl="${t.id}" title="移除引用" style="color:var(--danger)">${ICON('trash-2', 12)}</button>
            </div>`).join('') : '<div class="empty" style="padding:14px">尚未引用案例模板</div>'}
        </div>
      </div>`;

      wrap.querySelector('#pro-back').addEventListener('click', paintList);
      wrap.querySelector('#wbc-edit-def').addEventListener('click', () => {
        UI.modal('编辑业务本体定义 · ' + wb.name, `
          <div class="field"><label>业务名称</label><input id="bd-name" value="${UI.esc(cfg.bizName)}"></div>
          <div class="field"><label>业务领域</label><input id="bd-domain" value="${UI.esc(cfg.domain)}" placeholder="如:法务合规"></div>
          <div class="field"><label>业务本体定义</label><textarea id="bd-def" placeholder="面向谁、解决什么业务问题、如何运转">${UI.esc(cfg.bizDef)}</textarea></div>
          <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="bd-submit">保存</button></div>`, m => {
          m.querySelector('#bd-submit').addEventListener('click', () => {
            /* TODO: replace with fetch('/api/workbenches/' + wb.id + '/config', {method:'PATCH'}) */
            cfg.bizName = m.querySelector('#bd-name').value.trim();
            cfg.domain = m.querySelector('#bd-domain').value.trim();
            cfg.bizDef = m.querySelector('#bd-def').value.trim();
            UI.closeModal(); paintCfg(wb); UI.toast('业务本体定义已保存');
          });
        });
      });
      wrap.querySelector('#wbc-add-kb').addEventListener('click', () =>
        openRefPicker('引用共享知识库', DB.sharedKbs.filter(k => !cfg.kbRefs.includes(k.id)).map(k => ({ id: k.id, label: k.name + '(' + k.field + ')' })), id => {
          /* TODO: replace with fetch('.../config/kb-refs', {method:'POST'}) */
          cfg.kbRefs.push(id); paintCfg(wb); UI.toast('已引用共享知识库');
        }));
      wrap.querySelector('#wbc-add-agent').addEventListener('click', () =>
        openRefPicker('添加专家智能体', DB.agents.filter(a => !cfg.agentIds.includes(a.id)).map(a => ({ id: a.id, label: a.name + ' · ' + a.role })), id => {
          cfg.agentIds.push(id); paintCfg(wb); UI.toast('专家已加入工作台');
        }));
      wrap.querySelector('#wbc-add-tpl').addEventListener('click', () =>
        openRefPicker('引用案例模板', DB.plazaTemplates.filter(t => !cfg.tplIds.includes(t.id)).map(t => ({ id: t.id, label: t.name + '(' + t.scene + ')' })), id => {
          cfg.tplIds.push(id); paintCfg(wb); UI.toast('已引用案例模板');
        }));
      wrap.querySelectorAll('[data-wbc-rm-kb]').forEach(b => b.addEventListener('click', () => {
        cfg.kbRefs = cfg.kbRefs.filter(id => id !== b.dataset.wbcRmKb); paintCfg(wb); UI.toast('已移除引用');
      }));
      wrap.querySelectorAll('[data-wbc-rm-agent]').forEach(b => b.addEventListener('click', () => {
        cfg.agentIds = cfg.agentIds.filter(id => id !== b.dataset.wbcRmAgent); paintCfg(wb); UI.toast('已移除专家');
      }));
      wrap.querySelectorAll('[data-wbc-rm-tpl]').forEach(b => b.addEventListener('click', () => {
        cfg.tplIds = cfg.tplIds.filter(id => id !== b.dataset.wbcRmTpl); paintCfg(wb); UI.toast('已移除引用');
      }));
    };

    paintList();
  }

  /* ================= 视图入口 ================= */
  Views.workbench = {
    async render(el, param, query, token) {
      el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';

      const [{ data: wbs }, { data: projects }] = await Promise.all([
        API.fetchWorkbenches(), API.fetchProjects()
      ]);
      if (token !== undefined && !el.isConnected) return;

      const active = WB_TABS.some(t => t[0] === query.tab) ? query.tab : 'home';
      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        WB_TABS.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-wtab="${k}">${ICON(ic, 14)}${label}</button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-wtab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/workbench?tab=' + b.dataset.wtab;
      }));

      ({ home: tabHome, stats: tabStats, commander: tabCommander, intel: tabIntel, pro: tabPro })[active](el, wbs, projects);
    }
  };
})();
