/* views/project-detail.js — 项目详情:记忆/文件/知识库/数据库/定时任务/资源统计 */
(function () {
  window.Views = window.Views || {};

  const FILE_ICON = { doc: 'file-text', md: 'file-text', pdf: 'file-text', sheet: 'table', csv: 'table', zip: 'folder', html: 'globe' };
  const FILE_COLOR = { doc: '#4C9AFF', md: '#6C63F0', pdf: '#E0645F', sheet: '#3FB6B2', csv: '#3FB6B2', zip: '#E09A5B', html: '#B074E8' };

  function tabOverview(d) {
    const p = d.project;
    const maxBar = Math.max(...(d.usage ? d.usage.series : [1]));
    return `
      <div class="grid grid-4" style="margin-bottom:20px">
        <div class="card stat-card"><div class="s-label">${ICON('message-square', 13)}任务</div><div class="s-value">${p.stats.tasks}</div><div class="s-foot">运行中 ${d.sessions.filter(s => s.status === 'running').length} 个</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('zap', 13)}累计 Tokens</div><div class="s-value">${p.stats.tokens}</div><div class="s-foot">任务均值 ${d.usage ? d.usage.avgPerTask : '-'}</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('activity', 13)}累计消耗</div><div class="s-value">${p.stats.cost}</div><div class="s-foot">本月</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('brain', 13)}项目记忆</div><div class="s-value">${d.memories.length}</div><div class="s-foot">持续回流沉淀</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('bar-chart-3', 15)}近 14 日 Tokens 趋势</div>
          ${d.usage ? `<div class="mini-bars">${d.usage.series.map((v, i) => `<div class="bar" style="height:${Math.round(v / maxBar * 100)}%"><span class="tip">${d.usage.days[i]} · ${v}K</span></div>`).join('')}</div>` : '<div class="empty">暂无用量数据</div>'}
        </div>
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('bot', 15)}在岗专家</div>
          ${p.agentIds.length ? p.agentIds.map(aid => {
            const a = UI.agentById(aid);
            return `<a href="#/agent/${a.id}" class="file-row" style="text-decoration:none">
              <span class="agent-ava" style="width:34px;height:34px;font-size:13px;background:${a.color}">${UI.esc(a.initials)}</span>
              <div style="flex:1"><div style="font-size:13px">${UI.esc(a.name)}</div><div class="dim" style="font-size:11px">${UI.esc(a.role)} · Lv.${a.level}</div></div>
              ${ICON('chevron-right', 14, 'dim')}
            </a>`;
          }).join('') : '<div class="empty">尚未指派专家智能体</div>'}
        </div>
      </div>`;
  }

  function tabSessions(d) {
    if (!d.sessions.length) return '<div class="card empty">' + ICON('inbox', 34) + '<div>暂无任务</div></div>';
    return `<div class="card"><table class="table">
      <thead><tr><th>任务</th><th>类型</th><th>执行专家</th><th>状态</th><th>消息</th><th>Tokens</th><th>更新时间</th></tr></thead>
      <tbody>${d.sessions.map(s => {
        const a = UI.agentById(s.agentId);
        return `<tr data-sess="${s.id}" style="cursor:pointer">
          <td style="max-width:320px">${UI.esc(s.title)}</td>
          <td>${s.kind === 'cron' ? '<span class="pill pill-info">' + ICON('calendar-clock', 11) + '定时任务</span>' : '<span class="pill pill-dim">普通任务</span>'}</td>
          <td><span style="color:${a.color}">${UI.esc(a.name)}</span></td>
          <td>${UI.statusPill(s.status)}</td>
          <td class="mono dim">${s.msgCount}</td>
          <td class="mono dim">${s.tokens}</td>
          <td class="dim">${s.updatedAt}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function tabMemories(d) {
    if (!d.memories.length) return '<div class="card empty">' + ICON('brain', 34) + '<div>暂无项目记忆,任务执行后会自动回流沉淀</div></div>';
    const typePill = { '经验': 'pill-primary', '规则': 'pill-info', '偏好': 'pill-warning', '背景': 'pill-dim' };
    return `<div class="card card-pad">
      <div class="tc-title" style="margin-bottom:6px">${ICON('brain', 15)}项目记忆</div>
      <div class="section-desc">任务中沉淀的经验、规则与偏好,仅在「${UI.esc(d.project.name)}」内生效,随任务持续优化专家表现。</div>
      ${d.memories.map(m => `
        <div class="mem-item">
          <span class="pill ${typePill[m.type] || 'pill-dim'} mem-tag">${m.type}</span>
          <div class="mem-body">
            <div class="m-content">${UI.esc(m.content)}</div>
            <div class="m-meta">${m.time} · 来源:${UI.esc(m.source)}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  /* 目录树行渲染(资源管理器模式) */
  function fileTreeRows(nodes, depth) {
    return nodes.map(n => {
      const pad = 10 + depth * 16;
      if (n.children) return `
        <div class="ft-row ft-dir open" style="padding-left:${pad}px">
          ${ICON('chevron-right', 12, 'ft-caret')}${ICON('folder', 14, 'ft-fold-icon')}<span class="ft-name">${UI.esc(n.name)}</span>
        </div>
        <div class="ft-children">${fileTreeRows(n.children, depth + 1)}</div>`;
      const c = FILE_COLOR[n.type] || '#9C9C97';
      return `
        <div class="ft-row ft-file" style="padding-left:${pad + 16}px" title="${n.size} · 更新于 ${n.updatedAt}"
          data-fname="${UI.esc(n.name)}" data-ftype="${n.type || ''}" data-fsize="${n.size || ''}" data-fupd="${n.updatedAt || ''}">
          <span style="color:${c};display:inline-flex;flex-shrink:0">${ICON(FILE_ICON[n.type] || 'file-text', 14)}</span>
          <span class="ft-name">${UI.esc(n.name)}</span>
          <span class="ft-meta">${n.size} · ${n.updatedAt}</span>
          <span class="ft-acts">
            <button class="btn-icon" data-acts="preview" title="预览">${ICON('eye', 13)}</button>
            <button class="btn-icon" data-acts="download" title="下载">${ICON('download', 13)}</button>
          </span>
        </div>`;
    }).join('');
  }

  /* 文件 Tab(与知识库平级):目录树展示该项目全部资源文件 */
  function tabFiles(d) {
    const tree = d.fileTree || [];
    const headHtml = `<div style="display:flex;align-items:center;margin-bottom:12px">
      <span class="tc-title">${ICON('folder', 15)}项目文件</span>
      <span class="dim" style="font-size:11.5px;margin-left:8px">该项目全部资源文件</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" id="btn-upload-files">${ICON('upload', 13)}上传文件</button>
    </div>`;
    if (!tree.length) return headHtml + '<div class="card empty">' + ICON('folder', 34) + '<div>暂无项目文件,点击右上角上传</div></div>';
    return headHtml + `<div class="card" style="padding:8px 6px">
      <div class="ft-root">${ICON('chevron-down', 12, 'ft-caret')}${ICON('folder', 14, 'ft-fold-icon')}<span class="ft-name" style="font-weight:600">${UI.esc(d.project.name)}</span></div>
      ${fileTreeRows(tree, 1)}
    </div>`;
  }

  /* 知识库详情:库内文档清单 */
  function kbDetailHtml(kb) {
    const docs = (DB.kbDocs && DB.kbDocs[kb.id]) || [];
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <button class="btn-icon" id="kb-back" title="返回知识库列表">${ICON('chevron-left', 15)}</button>
        <span class="file-icon">${ICON('book-open', 16)}</span>
        <div style="min-width:0">
          <div class="tc-title">${UI.esc(kb.name)}</div>
          <div class="dim" style="font-size:11px;margin-top:2px">文档 ${kb.docs} · 切片 ${kb.chunks} · 更新 ${kb.updatedAt}</div>
        </div>
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" id="btn-upload-kb">${ICON('upload', 13)}上传文档</button>
        <button class="btn btn-ghost btn-sm" id="btn-conn-kb">${ICON('external-link', 13)}连接外部知识库</button>
      </div>
      <div class="sub" style="font-size:12.5px;margin-bottom:12px">${UI.esc(kb.desc)}</div>
      <div class="card">
        ${docs.length ? docs.map((f, i) => {
          const c = FILE_COLOR[f.type] || '#9C9C97';
          return `<div class="file-row">
            <span class="file-icon" style="color:${c};background:${c}1A">${ICON(FILE_ICON[f.type] || 'file-text', 15)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.esc(f.name)}</div>
              <div class="dim" style="font-size:11px">${f.size} · 更新于 ${f.updatedAt}</div>
            </div>
            <span class="fr-acts">
              <button class="btn-icon" data-doc-act="preview" data-doc-idx="${i}" title="预览">${ICON('eye', 13)}</button>
              <button class="btn-icon" data-doc-act="download" data-doc-idx="${i}" title="下载">${ICON('download', 13)}</button>
            </span>
          </div>`;
        }).join('') : '<div class="empty">' + ICON('file-text', 30) + '<div>该知识库暂无文档,点击右上角上传</div></div>'}
      </div>`;
  }

  function tabKB(d, kbSelId) {
    if (kbSelId) {
      const kb = d.knowledgeBases.find(k => k.id === kbSelId);
      if (kb) return kbDetailHtml(kb);
    }
    const headHtml = `<div style="display:flex;align-items:center;margin-bottom:12px">
      <span class="tc-title">${ICON('book-open', 15)}知识库</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" id="btn-conn-kb">${ICON('external-link', 13)}连接外部知识库</button>
    </div>`;
    if (!d.knowledgeBases.length) return headHtml + '<div class="card empty">' + ICON('book-open', 34) + '<div>暂无知识库,点击右上角接入外部知识库</div></div>';
    return headHtml + `<div class="grid grid-2">
      ${d.knowledgeBases.map(kb => `
        <div class="card card-pad" data-kb="${kb.id}" style="cursor:pointer" title="点击查看库内文档">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span class="file-icon">${ICON('book-open', 16)}</span>
            <div style="font-size:14px;font-weight:600">${UI.esc(kb.name)}</div>
            <span style="flex:1"></span>
            <button class="btn-icon" data-kb-upload="${kb.id}" title="上传文档到该库">${ICON('upload', 14)}</button>
          </div>
          <div class="sub" style="font-size:12.5px;line-height:1.6;min-height:38px">${UI.esc(kb.desc)}</div>
          <div class="proj-meta" style="margin-top:12px;display:flex;align-items:center"><span>文档 <b>${kb.docs}</b></span><span>切片 <b>${kb.chunks}</b></span><span>更新 <b>${kb.updatedAt}</b></span><span style="flex:1"></span>${ICON('chevron-right', 13, 'dim')}</div>
        </div>`).join('')}
    </div>`;
  }

  function tabDB(d) {
    const headHtml = `<div style="display:flex;align-items:center;margin-bottom:12px">
      <span class="tc-title">${ICON('database', 15)}数据库连接</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" id="btn-conn-db">${ICON('external-link', 13)}连接外部数据库</button>
    </div>`;
    const connHtml = d.databases.length ? `<div class="card"><table class="table">
      <thead><tr><th>连接名</th><th>类型</th><th>表数量</th><th>说明</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${d.databases.map(db => `<tr>
        <td class="mono">${db.name}</td><td>${db.type}</td><td class="mono dim">${db.tables}</td>
        <td class="sub">${UI.esc(db.desc)}</td><td>${UI.statusPill(db.status)}</td>
        <td><button class="btn btn-ghost btn-sm" data-manage="${db.id}">${ICON('table', 13)}数据管理</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="card empty">' + ICON('database', 34) + '<div>未连接数据库,点击右上角接入外部数据源</div></div>';
    return headHtml + connHtml + '<div id="db-manager"></div>';
  }

  /* 数据管理页:表列表 + 可编辑数据网格 */
  function dbManagerHtml(conn, tables, selIdx) {
    const t = tables[selIdx];
    return `
      <div class="card" style="margin-top:16px;overflow:hidden">
        <div class="dbm-head">
          <span class="tc-title">${ICON('database', 14)}${conn.name} · 数据管理</span>
          <span style="flex:1"></span>
          <button class="btn btn-ghost btn-sm" id="dbm-new-table">${ICON('plus', 13)}新建数据表</button>
          ${t ? `<button class="btn btn-ghost btn-sm" id="dbm-add-row">${ICON('plus', 13)}添加行</button>` : ''}
        </div>
        <div class="dbm-body">
          <div class="dbm-side">
            ${tables.length ? tables.map((tb, i) => `
              <div class="dbm-tb ${i === selIdx ? 'active' : ''}" data-tb="${i}">
                ${ICON('table', 13)}<span class="ft-name">${UI.esc(tb.name)}</span>
                <span class="dim" style="margin-left:auto;font-size:11px">${tb.rows.length} 行</span>
              </div>`).join('') : '<div class="dim" style="font-size:12px;padding:12px 10px;line-height:1.7">暂无数据表<br>点击右上角「新建数据表」</div>'}
          </div>
          <div class="dbm-grid">
            ${t ? `<table class="table dbm-table">
              <thead><tr>${t.columns.map(c => `<th class="mono">${UI.esc(c)}</th>`).join('')}</tr></thead>
              <tbody>${t.rows.map((r, ri) => `<tr>${t.columns.map((c, ci) => `<td data-r="${ri}" data-c="${ci}" title="点击编辑">${UI.esc(String(r[ci] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>` : '<div class="empty" style="padding:40px 0">' + ICON('table', 30) + '<div>选择或新建一个数据表</div></div>'}
          </div>
        </div>
      </div>`;
  }

  function tabCron(d, projectId) {
    if (!d.cronJobs.length) return '<div class="card empty">' + ICON('calendar-clock', 34) + '<div>暂无定时任务</div></div>';
    return `<div class="card card-pad">
      ${d.cronJobs.map(cj => {
        const a = UI.agentById(cj.agentId);
        return `<div class="file-row">
          <span class="file-icon">${ICON('calendar-clock', 16)}</span>
          <div style="flex:1">
            <div style="font-size:13px">${UI.esc(cj.name)} <span class="dim mono" style="font-size:11px;margin-left:6px">${cj.schedule}</span></div>
            <div class="dim" style="font-size:11px;margin-top:2px">${UI.esc(cj.desc)} · 执行专家:${UI.esc(a.name)} · 上次 ${cj.lastRun} · 下次 ${cj.nextRun}</div>
          </div>
          <button class="cron-switch ${cj.enabled ? 'on' : ''}" data-cron="${cj.id}" title="${cj.enabled ? '点击停用' : '点击启用'}"></button>
        </div>`;
      }).join('')}
    </div>`;
  }

  function tabUsage(d) {
    if (!d.usage) return '<div class="card empty">' + ICON('bar-chart-3', 34) + '<div>暂无用量数据</div></div>';
    const u = d.usage, maxBar = Math.max(...u.series);
    return `
      <div class="grid grid-3" style="margin-bottom:20px">
        <div class="card stat-card"><div class="s-label">${ICON('zap', 13)}总 Tokens</div><div class="s-value">${u.totalTokens}</div><div class="s-foot">近 14 日</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('activity', 13)}总消耗</div><div class="s-value">${u.totalCost}</div><div class="s-foot">本月账单口径</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('message-square', 13)}任务均值</div><div class="s-value">${u.avgPerTask}</div><div class="s-foot">每任务 Tokens</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('bar-chart-3', 15)}按日消耗(K)</div>
          <div class="mini-bars" style="height:110px">${u.series.map((v, i) => `<div class="bar" style="height:${Math.round(v / maxBar * 100)}%"><span class="tip">${u.days[i]} · ${v}K</span></div>`).join('')}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card card-pad">
            <div class="tc-title" style="margin-bottom:12px">${ICON('bot', 15)}按专家</div>
            ${u.byAgent.map(row => {
              const a = UI.agentById(row.agentId);
              return `<div style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
                  <span style="color:${a.color}">${UI.esc(a.name)}</span><span class="mono dim">${row.tokens} · ${row.cost}</span>
                </div>
                <div class="quota-bar"><i style="width:${row.pct}%;background:${a.color}"></i></div>
              </div>`;
            }).join('')}
          </div>
          <div class="card card-pad">
            <div class="tc-title" style="margin-bottom:12px">${ICON('cpu', 15)}按模型</div>
            ${u.byModel.map((m, i) => `<div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span class="mono">${m.model}</span><span class="mono dim">${m.pct}%</span></div>
              <div class="quota-bar"><i style="width:${m.pct}%;background:${['#6C63F0', '#4C9AFF', '#B074E8'][i % 3]}"></i></div>
            </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  /* ---------- 页签指标卡片(除 概览/任务/资源统计 外,替换「项目详情 + 新建任务」头部模块) ---------- */
  function metricStrip(cards) {
    return `<div class="grid grid-4" style="margin-bottom:20px">${cards.map(c => `
      <div class="card stat-card">
        <div class="s-label"><span style="color:${c.color};display:inline-flex">${ICON(c.icon, 13)}</span>${c.label}</div>
        ${c.chart ? '<div style="margin-top:10px">' + c.chart + '</div>' : `<div class="s-value">${c.value}</div><div class="s-foot">${c.foot || ''}</div>`}
      </div>`).join('')}</div>`;
  }

  /* 确定性伪随机热力格(28 天) */
  function heatCells(seed) {
    return Array.from({ length: 28 }, (_, i) => ({
      level: (seed + i * 7 + Math.floor(i / 5)) % 5,
      tip: '08-' + String(25 - (27 - i)).padStart(2, '0') + ' · ' + ((seed + i * 7) % 5) + ' 次更新'
    }));
  }

  /* 知识库指标卡:kb=null 为全部库聚合;选中具体库时切换为该库数据 */
  function kbMetricCards(d, kb) {
    if (!kb) {
      return [
        { label: '知识库数量', value: d.knowledgeBases.length, icon: 'book-open', color: '#6C63F0', foot: '挂载于本项目' },
        { label: '知识内容数量', value: d.knowledgeBases.reduce((a, k) => a + k.docs, 0) + ' 篇', icon: 'file-text', color: '#4C9AFF', foot: d.knowledgeBases.reduce((a, k) => a + k.chunks, 0) + ' 个切片' },
        { label: '知识类型分类', icon: 'layers', color: '#B074E8', chart: UI.donut(d.knowledgeBases.map((k, i) => ({ label: k.name, value: k.docs, color: ['#6C63F0', '#4C9AFF', '#3FB6B2'][i % 3] }))) },
        { label: '知识更新热力图', icon: 'activity', color: '#E0645F', chart: UI.heat(heatCells(1)) }
      ];
    }
    /* 单库视图:文档类型分布按库内文档后缀统计(无明细时按比例拆分) */
    const docs = (DB.kbDocs && DB.kbDocs[kb.id]) || [];
    let typeSegs;
    if (docs.length) {
      const byType = {};
      docs.forEach(f => { const t = (f.type || 'doc'); byType[t] = (byType[t] || 0) + 1; });
      const NAME = { doc: '文档', md: 'Markdown', pdf: 'PDF', csv: '数据表', sheet: '表格', zip: '压缩包', html: '网页' };
      const COLORS = ['#6C63F0', '#4C9AFF', '#3FB6B2', '#E09A5B', '#B074E8'];
      typeSegs = Object.keys(byType).map((t, i) => ({ label: NAME[t] || t, value: byType[t], color: COLORS[i % COLORS.length] }));
    } else {
      const total = kb.docs || 1;
      typeSegs = [
        { label: '文档', value: Math.ceil(total * 0.6), color: '#6C63F0' },
        { label: 'PDF', value: Math.floor(total * 0.3), color: '#4C9AFF' },
        { label: '数据表', value: Math.max(1, total - Math.ceil(total * 0.6) - Math.floor(total * 0.3)), color: '#3FB6B2' }
      ];
    }
    const seed = kb.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
    return [
      { label: '当前知识库', value: kb.name, icon: 'book-open', color: '#6C63F0', foot: '更新于 ' + kb.updatedAt },
      { label: '知识内容数量', value: kb.docs + ' 篇', icon: 'file-text', color: '#4C9AFF', foot: kb.chunks + ' 个切片' },
      { label: '知识类型分类', icon: 'layers', color: '#B074E8', chart: UI.donut(typeSegs) },
      { label: '知识更新热力图', icon: 'activity', color: '#E0645F', chart: UI.heat(heatCells(seed)) }
    ];
  }

  function pageMetrics(tab, d, kb) {
    const leafCount = nodes => nodes.reduce((n, x) => n + (x.children ? leafCount(x.children) : 1), 0);
    const spark = seed => Array.from({ length: 14 }, (_, i) => 8 + ((seed + i * 5) % 18) + i);
    const M = {
      memory: [
        { label: '记忆总数', value: d.memories.length, icon: 'brain', color: '#B074E8', foot: '项目沉淀的可复用经验' },
        { label: '本周新增', value: Math.min(3, d.memories.length), icon: 'sparkles', color: '#6C63F0', foot: '任务经验自动回流' },
        { label: '类型分布', icon: 'book-open', color: '#4C9AFF', chart: UI.donut([{ label: '记忆', value: d.memories.length, color: '#B074E8' }, { label: '知识', value: d.knowledgeBases.length, color: '#4C9AFF' }, { label: '规则', value: 2, color: '#3FB6B2' }]) },
        { label: '近 14 日回流', icon: 'trending-up', color: '#3FB6B2', chart: UI.sparkline(spark(3), '#B074E8') }
      ],
      files: [
        { label: '文件总数', value: leafCount(d.fileTree), icon: 'folder', color: '#4C9AFF', foot: '工作区全量文件' },
        { label: '顶层目录', value: d.fileTree.length, icon: 'folder-kanban', color: '#6C63F0', foot: '交付物 / 底稿 / 模板' },
        { label: '类型分布', icon: 'file-text', color: '#E09A5B', chart: UI.donut([{ label: '文档', value: 5, color: '#4C9AFF' }, { label: '数据表', value: 2, color: '#3FB6B2' }, { label: '底稿', value: 3, color: '#B074E8' }]) },
        { label: '更新热力', icon: 'activity', color: '#E0645F', chart: UI.heat(heatCells(2)) }
      ],
      kb: kbMetricCards(d, kb || null),
      db: [
        { label: '数据库连接', value: d.databases.length, icon: 'database', color: '#3FB6B2', foot: '正常 ' + d.databases.filter(x => x.status === 'ok').length + ' / 异常 ' + d.databases.filter(x => x.status !== 'ok').length },
        { label: '表数量', value: d.databases.reduce((a, x) => a + x.tables, 0), icon: 'layers', color: '#4C9AFF', foot: '跨连接合计' },
        { label: '类型分布', icon: 'globe', color: '#E09A5B', chart: UI.donut([{ label: 'PostgreSQL', value: d.databases.filter(x => x.type === 'PostgreSQL').length, color: '#4C9AFF' }, { label: 'MySQL', value: d.databases.filter(x => x.type === 'MySQL').length, color: '#E09A5B' }]) },
        { label: '查询趋势', icon: 'trending-up', color: '#6C63F0', chart: UI.sparkline(spark(7), '#3FB6B2') }
      ],
      cron: [
        { label: '定时任务', value: d.cronJobs.length, icon: 'calendar-clock', color: '#E09A5B', foot: '启用中 ' + d.cronJobs.filter(j => j.enabled).length + ' 个' },
        { label: '今日已执行', value: 3, icon: 'check-circle', color: '#3FB6B2', foot: '全部成功' },
        { label: '调度类型', icon: 'workflow', color: '#6C63F0', chart: UI.donut([{ label: '每日', value: d.cronJobs.filter(j => /每天/.test(j.cron)).length, color: '#4C9AFF' }, { label: '每周', value: d.cronJobs.filter(j => /每周/.test(j.cron)).length, color: '#B074E8' }]) },
        { label: '执行趋势', icon: 'trending-up', color: '#E09A5B', chart: UI.sparkline(spark(5), '#E09A5B') }
      ],
      ext: [
        { label: '技能', value: d.extensions.filter(x => x.kind === 'skill').length, icon: 'sparkles', color: '#6C63F0', foot: '已启用技能扩展' },
        { label: 'MCP', value: d.extensions.filter(x => x.kind === 'mcp').length, icon: 'workflow', color: '#4C9AFF', foot: '外部能力接入' },
        { label: '插件', value: d.extensions.filter(x => x.kind === 'plugin').length, icon: 'puzzle', color: '#3FB6B2', foot: '工具型插件' },
        { label: '调用趋势', icon: 'trending-up', color: '#B074E8', chart: UI.sparkline(spark(9), '#B074E8') }
      ],
      intel: [
        { label: '订阅源', value: DB.intelSubs.filter(s => s.enabled).length, icon: 'rss', color: '#6C63F0', foot: '情报中心统一配置' },
        { label: '收集条目', value: d.intel.length, icon: 'radar', color: '#4C9AFF', foot: '按项目聚合归档' },
        { label: '来源分布', icon: 'map', color: '#3FB6B2', chart: UI.donut([{ label: '法规库', value: d.intel.filter(i => /法规/.test(i.source)).length, color: '#4C9AFF' }, { label: '市场监测', value: d.intel.filter(i => /监测|行情/.test(i.source)).length, color: '#E09A5B' }, { label: '行业媒体', value: d.intel.filter(i => !/法规|监测|行情/.test(i.source)).length, color: '#B074E8' }]) },
        { label: '热度趋势', icon: 'trending-up', color: '#E0645F', chart: UI.sparkline(spark(4), '#E0645F') }
      ]
    };
    return metricStrip(M[tab] || []);
  }

  /* ---------- 页签:扩展(技能 / MCP / 插件) ---------- */
  const EXT_KIND = { skill: ['技能', 'sparkles'], mcp: ['MCP', 'workflow'], plugin: ['插件', 'puzzle'] };
  function tabExt(d) {
    const groups = ['skill', 'mcp', 'plugin'].map(k => ({
      kind: k, label: EXT_KIND[k][0], icon: EXT_KIND[k][1], list: d.extensions.filter(x => x.kind === k)
    }));
    return `
    <div class="grid grid-3">
      ${groups.map(g => `
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:12px">${ICON(g.icon, 15)}${g.label}<span class="pill pill-dim" style="margin-left:8px">${g.list.length}</span></div>
          ${g.list.length ? g.list.map(x => `
            <div class="file-row" style="align-items:flex-start">
              <span class="file-icon" style="color:${x.color};background:${x.color}1A">${ICON(g.icon, 14)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px">${UI.esc(x.name)} <span class="dim mono" style="font-size:10.5px;margin-left:4px">${x.version}</span></div>
                <div class="dim" style="font-size:11px;margin-top:3px;line-height:1.5">${UI.esc(x.desc)}</div>
                ${x.endpoint ? '<div class="mono dim" style="font-size:10.5px;margin-top:3px">' + UI.esc(x.endpoint) + '</div>' : ''}
              </div>
            </div>`).join('') : '<div class="empty" style="padding:20px">未启用' + g.label + '</div>'}
          <button class="btn btn-ghost btn-sm" data-ext-add style="margin-top:10px">${ICON('plus', 13)}添加${g.label}</button>
        </div>`).join('')}
    </div>`;
  }

  /* ---------- 页签:情报(订阅汇总收集) ---------- */
  function tabIntel(d) {
    return `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="tc-title" style="margin-bottom:12px">${ICON('rss', 15)}订阅源</div>
        ${DB.intelSubs.map(s => `
          <div class="file-row">
            <span class="file-icon">${ICON('rss', 15)}</span>
            <div style="flex:1">
              <div style="font-size:13px">${UI.esc(s.name)} <span class="dim mono" style="font-size:11px;margin-left:6px">${s.cadence}</span></div>
              <div class="dim" style="font-size:11px;margin-top:2px">来源:${UI.esc(s.source)}</div>
            </div>
            <span class="pill ${s.enabled ? 'pill-success' : 'pill-dim'}">${s.enabled ? '订阅中' : '已停用'}</span>
          </div>`).join('')}
        <button class="btn btn-ghost btn-sm" id="btn-intel-center" style="margin-top:10px">${ICON('radar', 13)}前往情报中心</button>
      </div>
      <div class="card card-pad">
        <div class="tc-title" style="margin-bottom:12px">${ICON('radar', 15)}收集汇总<span class="pill pill-dim" style="margin-left:8px">${d.intel.length}</span></div>
        ${d.intel.length ? d.intel.map(it => `
          <div class="file-row" style="align-items:flex-start">
            <span class="file-icon">${ICON('rss', 14)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;line-height:1.5">${UI.esc(it.title)}</div>
              <div class="dim" style="font-size:11px;margin-top:3px">${UI.esc(it.source)} · ${it.tag} · ${it.time}</div>
            </div>
          </div>`).join('') : '<div class="empty" style="padding:24px">暂无收集条目,启用订阅后自动归档</div>'}
      </div>
    </div>`;
  }

  /* ---------- 主视图 ---------- */
  Views['project'] = {
    async render(el, projectId, query) {
      el.innerHTML = '<div class="page">' + UI.skeleton(5) + '</div>';
      const { data: d } = await API.fetchProjectDetail(projectId);
      if (!d.project) {
        el.innerHTML = '<div class="page"><div class="card empty">' + ICON('alert-triangle', 34) + '<div>项目不存在</div><a class="btn btn-ghost btn-sm" href="#/projects">返回项目列表</a></div></div>';
        return;
      }
      document.getElementById('topbar-title').innerHTML = '<a class="crumb-link" href="#/projects">项目</a>';
      document.getElementById('topbar-crumb').innerHTML = ' / <b>' + UI.esc(d.project.name) + '</b>';

      const tabs = [
        ['overview', '概览', 'layout-dashboard'], ['sessions', '任务', 'message-square'],
        ['memory', '记忆', 'brain'], ['files', '文件', 'folder'],
        ['kb', '知识库', 'book-open'], ['db', '数据库', 'database'],
        ['cron', '定时任务', 'calendar-clock'], ['ext', '扩展', 'puzzle'],
        ['intel', '情报', 'radar'], ['usage', '资源统计', 'bar-chart-3']
      ];
      const active = query.tab || 'overview';
      const countLeaves = nodes => nodes.reduce((n, x) => n + (x.children ? countLeaves(x.children) : 1), 0);
      const counts = { sessions: d.sessions.length, memory: d.memories.length, files: d.fileTree ? countLeaves(d.fileTree) : 0, kb: d.knowledgeBases.length, db: d.databases.length, cron: d.cronJobs.length, ext: d.extensions.length, intel: d.intel.length };

      /* 概览/任务/资源统计 保留「项目详情 + 新建任务」头部;其他页签替换为当前页面的指标卡片 + 图表 */
      const KEEP_HEAD = ['overview', 'sessions', 'usage'];
      const headHtml = KEEP_HEAD.includes(active) ? `
        <div class="pd-head reveal">
          <div>
            <div style="display:flex;align-items:center;gap:12px">
              <div class="pd-title">${UI.esc(d.project.name)}</div>
              ${UI.statusPill(d.project.status)}
            </div>
            <div class="pd-sub">${UI.esc(d.project.desc)}</div>
            <div class="dim" style="font-size:12px;margin-top:8px">${UI.esc(UI.wbById(d.project.workbenchId).name)} · 创建于 ${d.project.createdAt}</div>
          </div>
          <div style="display:flex;gap:10px;flex-shrink:0">
            <button class="btn btn-ghost" id="btn-edit-proj">${ICON('settings', 14)}编辑项目</button>
            <button class="btn btn-primary" id="btn-new-sess">${ICON('plus', 14)}新建任务</button>
          </div>
        </div>` : pageMetrics(active, d);

      el.innerHTML = `
      <div class="page">
        <div id="pd-head-wrap">${headHtml}</div>
        <div id="pd-tab-body" class="reveal reveal-1"></div>
      </div>`;

      /* 知识库钻取时,指标卡随选中的库自动更新;返回列表恢复聚合 */
      function updateKbMetrics() {
        if (active !== 'kb') return;
        const wrap = el.querySelector('#pd-head-wrap');
        const kb = kbSel ? d.knowledgeBases.find(k => k.id === kbSel) : null;
        if (wrap) wrap.innerHTML = metricStrip(kbMetricCards(d, kb));
      }

      /* Tab 栏渲染到全局顶栏(路由切换时由 app.js 清空) */
      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        tabs.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-tab="${k}">${ICON(ic, 14)}${label}${counts[k] !== undefined ? '<span class="cnt">' + counts[k] + '</span>' : ''}</button>`).join('') +
        '</div>';

      const body = el.querySelector('#pd-tab-body');
      let kbSel = null; // 知识库钻取:当前查看的知识库 id
      const painters = {
        overview: () => tabOverview(d), sessions: () => tabSessions(d),
        memory: () => tabMemories(d), files: () => tabFiles(d),
        kb: () => tabKB(d, kbSel),
        db: () => tabDB(d),
        cron: () => tabCron(d, projectId), ext: () => tabExt(d),
        intel: () => tabIntel(d), usage: () => tabUsage(d)
      };
      body.innerHTML = (painters[active] || painters.overview)();

      /* ---------- 知识库/数据库:外部连接 + 数据管理 ---------- */
      let manageConnId = null, manageTableIdx = 0;
      function renderManager() {
        const box = body.querySelector('#db-manager');
        const conn = d.databases.find(x => x.id === manageConnId);
        if (!box || !conn) return;
        const tables = (DB.dbTables[conn.id] = DB.dbTables[conn.id] || []);
        if (manageTableIdx >= tables.length) manageTableIdx = 0;
        box.innerHTML = dbManagerHtml(conn, tables, manageTableIdx);
      }
      function openConnKb() {
        UI.openModal(`
          <div class="modal-head">
            <div class="modal-title">连接外部知识库</div>
            <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>连接方式</label>
              <select id="ck-type">
                <option value="obsidian">Obsidian 本地库</option>
                <option value="mcp">MCP 知识库服务</option>
              </select>
            </div>
            <div class="field" id="f-ck-name">
              <label>名称</label>
              <input id="ck-name" placeholder="如:团队知识 Vault">
              <div class="err">请输入名称</div>
            </div>
            <div class="field">
              <label id="ck-conf-label">库路径</label>
              <input id="ck-conf" placeholder="如:D:\\notes\\team-vault">
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" id="ck-submit">连接</button>
          </div>`);
        const typeSel = document.getElementById('ck-type');
        typeSel.addEventListener('change', () => {
          const isObs = typeSel.value === 'obsidian';
          document.getElementById('ck-conf-label').textContent = isObs ? '库路径' : 'MCP Server 地址';
          document.getElementById('ck-conf').placeholder = isObs ? '如:D:\\notes\\team-vault' : '如:npx -y mcp-kb-server 或 http://127.0.0.1:8765/sse';
        });
        document.getElementById('ck-submit').addEventListener('click', () => {
          const name = document.getElementById('ck-name').value.trim();
          if (!name) { document.getElementById('f-ck-name').classList.add('invalid'); return; }
          const isObs = typeSel.value === 'obsidian';
          const conf = document.getElementById('ck-conf').value.trim();
          // TODO: replace with fetch('/api/knowledge-bases/connect', {method:'POST', body:{type,name,conf}})
          DB.knowledgeBases.push({ id: 'kb' + Date.now(), projectId, name, docs: 0, chunks: 0, updatedAt: '刚刚', desc: (isObs ? '外部连接 · Obsidian' : '外部连接 · MCP') + (conf ? ' · ' + conf : '') + ' · 索引同步中' });
          d.knowledgeBases = DB.knowledgeBases.filter(k => k.projectId === projectId);
          UI.closeModal();
          UI.toast('外部知识库已连接,索引同步中');
          if (active === 'kb') { body.innerHTML = tabKB(d); updateKbMetrics(); }
        });
      }
      function openConnDb() {
        UI.openModal(`
          <div class="modal-head">
            <div class="modal-title">连接外部数据库</div>
            <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
          </div>
          <div class="modal-body">
            <div class="field" id="f-cd-name">
              <label>连接名</label>
              <input id="cd-name" placeholder="如:dw_sales_mart">
              <div class="err">请输入连接名</div>
            </div>
            <div class="field">
              <label>数据库类型</label>
              <select id="cd-type">
                <option>MySQL</option><option>PostgreSQL</option><option>SQLite</option>
                <option>ClickHouse</option><option>MongoDB</option>
              </select>
            </div>
            <div class="field">
              <label>连接地址</label>
              <input id="cd-host" placeholder="host:port,如 10.0.8.21:3306">
            </div>
            <div class="field">
              <label>说明</label>
              <input id="cd-desc" placeholder="用途说明(可选)">
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" id="cd-submit">测试并连接</button>
          </div>`);
        document.getElementById('cd-submit').addEventListener('click', () => {
          const name = document.getElementById('cd-name').value.trim();
          if (!name) { document.getElementById('f-cd-name').classList.add('invalid'); return; }
          const host = document.getElementById('cd-host').value.trim();
          const desc = document.getElementById('cd-desc').value.trim();
          // TODO: replace with fetch('/api/databases/connect', {method:'POST', body:{...}})
          (DB.databases[projectId] = DB.databases[projectId] || []).push({
            id: 'db' + Date.now(), name, type: document.getElementById('cd-type').value,
            tables: 0, status: 'connected', desc: desc || host || '外部数据库连接'
          });
          d.databases = DB.databases[projectId];
          UI.closeModal();
          UI.toast('数据库「' + name + '」已连接');
          if (active === 'db') body.innerHTML = tabDB(d);
        });
      }
      function openNewTable() {
        UI.openModal(`
          <div class="modal-head">
            <div class="modal-title">新建数据表</div>
            <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
          </div>
          <div class="modal-body">
            <div class="field" id="f-nt-name">
              <label>表名</label>
              <input id="nt-name" placeholder="如:fact_sales_daily">
              <div class="err">请输入表名</div>
            </div>
            <div class="field" id="f-nt-cols">
              <label>列定义(逗号分隔)</label>
              <input id="nt-cols" placeholder="如:date, category, amount">
              <div class="err">请至少定义一列</div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" id="nt-submit">创建</button>
          </div>`);
        document.getElementById('nt-submit').addEventListener('click', () => {
          const name = document.getElementById('nt-name').value.trim();
          const cols = document.getElementById('nt-cols').value.split(/[,\uFF0C\s]+/).map(x => x.trim()).filter(Boolean);
          let ok = true;
          if (!name) { document.getElementById('f-nt-name').classList.add('invalid'); ok = false; }
          if (!cols.length) { document.getElementById('f-nt-cols').classList.add('invalid'); ok = false; }
          if (!ok) return;
          // TODO: replace with fetch(`/api/databases/${manageConnId}/tables`, {method:'POST', body:{name, columns:cols}})
          const tables = DB.dbTables[manageConnId];
          tables.push({ name, columns: cols, rows: [] });
          manageTableIdx = tables.length - 1;
          UI.closeModal();
          UI.toast('数据表「' + name + '」已创建');
          renderManager();
        });
      }
      function editCell(cell) {
        if (cell.querySelector('input')) return;
        const old = cell.textContent;
        cell.innerHTML = '<input class="dbm-cell-input" value="' + UI.esc(old) + '">';
        const inp = cell.querySelector('input');
        inp.focus();
        inp.select();
        const commit = () => {
          const t = (DB.dbTables[manageConnId] || [])[manageTableIdx];
          // TODO: replace with fetch(`/api/databases/${manageConnId}/tables/${t.name}/rows`, {method:'PATCH', ...})
          if (t) t.rows[+cell.dataset.r][+cell.dataset.c] = inp.value;
          renderManager();
        };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') inp.blur();
          if (ev.key === 'Escape') { inp.value = old; inp.blur(); }
        });
      }

      /* 文件预览 / 下载 / 上传队列(mock 假进度) */
      const EXT_TYPE = { doc: 'doc', docx: 'doc', md: 'md', pdf: 'pdf', csv: 'csv', xlsx: 'sheet', xls: 'sheet', zip: 'zip', html: 'html' };
      function fmtSize(bytes) {
        if (bytes == null) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
      }
      function downloadFile(f) {
        // TODO: replace with real file url
        const blob = new Blob(['(Mock) ' + f.name], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = f.name;
        a.click();
        URL.revokeObjectURL(a.href);
        UI.toast('已开始下载「' + f.name + '」');
      }
      function openFilePreview(f) {
        UI.openModal(`
          <div class="modal-head">
            <div class="modal-title">${UI.esc(f.name)}</div>
            <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
          </div>
          <div class="modal-body">
            <div class="dim" style="font-size:12px;margin-bottom:10px">${(f.type || 'doc').toUpperCase()} · ${f.size || '-'} · 更新于 ${f.updatedAt || '-'}</div>
            <div style="font-size:13px;line-height:1.7">(Mock) 文件内容预览区域,接入后端后在此渲染文档内容或对接在线预览服务。</div>
          </div>
          <div class="modal-foot"><button class="btn btn-primary" id="fp-dl">${ICON('download', 13)}下载</button></div>`);
        document.getElementById('fp-dl').addEventListener('click', () => downloadFile(f));
      }
      let uploadTarget = { kind: 'tree' };
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      el.appendChild(fileInput);
      let uqItems = [];
      let uqPanel = null;
      function renderUq() {
        if (!uqPanel) {
          uqPanel = document.createElement('div');
          uqPanel.className = 'uq-panel';
          el.appendChild(uqPanel);
          uqPanel.addEventListener('click', ev => {
            if (ev.target.closest('#uq-clear')) { uqItems = uqItems.filter(it => !it.done); renderUq(); }
          });
        }
        if (!uqItems.length) { uqPanel.remove(); uqPanel = null; return; }
        uqPanel.innerHTML = `
          <div class="uq-head"><span>上传队列</span><span class="dim" style="font-size:11px">${uqItems.filter(i => i.done).length}/${uqItems.length} 完成</span><span style="flex:1"></span><button class="btn-icon" id="uq-clear" title="清除已完成">${ICON('trash-2', 13)}</button></div>
          ${uqItems.map(it => `
            <div class="uq-item">
              <div class="uq-line"><span class="uq-name">${UI.esc(it.name)}</span><span class="uq-pct">${it.done ? '完成' : it.pct + '%'}</span></div>
              <div class="uq-bar${it.done ? ' done' : ''}"><i style="width:${it.pct}%"></i></div>
            </div>`).join('')}`;
      }
      function commitUpload(it) {
        // TODO: replace with fetch('/api/files', {method:'POST', body:FormData})
        const ext = (it.name.split('.').pop() || '').toLowerCase();
        const node = { name: it.name, type: EXT_TYPE[ext] || 'doc', size: fmtSize(it.size), updatedAt: '刚刚' };
        if (it.target.kind === 'kb') {
          const kbId = it.target.kbId;
          DB.kbDocs = DB.kbDocs || {};
          (DB.kbDocs[kbId] = DB.kbDocs[kbId] || []).unshift(node);
          const kb = d.knowledgeBases.find(k => k.id === kbId);
          if (kb) kb.docs++;
          if (active === 'kb' && kbSel === kbId) { body.innerHTML = tabKB(d, kbSel); updateKbMetrics(); }
        } else {
          d.fileTree.push(node);
          if (active === 'files') body.innerHTML = tabFiles(d);
        }
      }
      function startUpload(files) {
        Array.from(files).forEach(f => {
          const it = { name: f.name, size: f.size, pct: 0, done: false, target: uploadTarget };
          uqItems.push(it);
          const timer = setInterval(() => {
            it.pct = Math.min(100, it.pct + 10 + Math.round(Math.random() * 15));
            if (it.pct >= 100) { it.pct = 100; it.done = true; clearInterval(timer); commitUpload(it); }
            renderUq();
          }, 200);
        });
        renderUq();
        UI.toast('已加入上传队列,共 ' + files.length + ' 个文件');
      }
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) startUpload(fileInput.files);
        fileInput.value = '';
      });

      /* 目录树 / 外部连接 / 数据管理:统一事件委托 */
      body.addEventListener('click', e => {
        const act = e.target.closest('[data-acts]');
        if (act) {
          const row = act.closest('.ft-file');
          const f = { name: row.dataset.fname, type: row.dataset.ftype, size: row.dataset.fsize, updatedAt: row.dataset.fupd };
          if (act.dataset.acts === 'preview') openFilePreview(f); else downloadFile(f);
          return;
        }
        const docAct = e.target.closest('[data-doc-act]');
        if (docAct) {
          const docs = (DB.kbDocs && DB.kbDocs[kbSel]) || [];
          const f = docs[+docAct.dataset.docIdx];
          if (f) { if (docAct.dataset.docAct === 'preview') openFilePreview(f); else downloadFile(f); }
          return;
        }
        if (e.target.closest('#btn-upload-files')) { uploadTarget = { kind: 'tree' }; fileInput.click(); return; }
        if (e.target.closest('#btn-upload-kb')) { uploadTarget = { kind: 'kb', kbId: kbSel }; fileInput.click(); return; }
        const kbUp = e.target.closest('[data-kb-upload]');
        if (kbUp) { uploadTarget = { kind: 'kb', kbId: kbUp.dataset.kbUpload }; fileInput.click(); return; }
        const dir = e.target.closest('.ft-dir');
        if (dir) { dir.classList.toggle('open'); return; }
        const file = e.target.closest('.ft-file');
        if (file) { openFilePreview({ name: file.dataset.fname, type: file.dataset.ftype, size: file.dataset.fsize, updatedAt: file.dataset.fupd }); return; }
        if (e.target.closest('#kb-back')) { kbSel = null; body.innerHTML = tabKB(d, null); updateKbMetrics(); return; }
        const kbCard = e.target.closest('[data-kb]');
        if (kbCard) { kbSel = kbCard.dataset.kb; body.innerHTML = tabKB(d, kbSel); updateKbMetrics(); return; }
        if (e.target.closest('#btn-conn-kb')) { openConnKb(); return; }
        if (e.target.closest('#btn-conn-db')) { openConnDb(); return; }
        if (e.target.closest('#dbm-new-table')) { openNewTable(); return; }
        if (e.target.closest('#dbm-add-row')) {
          const t = DB.dbTables[manageConnId][manageTableIdx];
          t.rows.push(t.columns.map(() => '')); // TODO: POST row
          renderManager();
          UI.toast('已添加一行,点击单元格编写数据');
          return;
        }
        const mg = e.target.closest('[data-manage]');
        if (mg) { manageConnId = mg.dataset.manage; manageTableIdx = 0; renderManager(); return; }
        const tb = e.target.closest('[data-tb]');
        if (tb) { manageTableIdx = +tb.dataset.tb; renderManager(); return; }
        const cell = e.target.closest('.dbm-table td');
        if (cell) editCell(cell);
      });

      document.querySelectorAll('#topbar-tabs [data-tab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/project/' + projectId + '?tab=' + b.dataset.tab;
      }));
      el.querySelectorAll('[data-sess]').forEach(r => r.addEventListener('click', () => {
        location.hash = '#/task/' + r.dataset.sess;
      }));
      el.querySelectorAll('[data-cron]').forEach(sw => sw.addEventListener('click', () => {
        sw.classList.toggle('on');
        UI.toast(sw.classList.contains('on') ? '定时任务已启用' : '定时任务已停用');
      }));
      el.querySelectorAll('[data-ext-add]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/plaza?tab=ext';
      }));
      const btnIntelCenter = el.querySelector('#btn-intel-center');
      if (btnIntelCenter) btnIntelCenter.addEventListener('click', () => {
        location.hash = '#/workbench?tab=intel';
      });
      /* 头部模块仅在 概览/任务/资源统计 渲染,按钮绑定需判空 */
      const btnNewSess = el.querySelector('#btn-new-sess');
      if (btnNewSess) btnNewSess.addEventListener('click', () => {
        const first = d.sessions[0];
        if (first) { location.hash = '#/task/' + first.id; }
        else UI.toast('该项目暂无任务,请先指派专家后创建', 'err');
      });

      /* 编辑项目:基本信息 + 状态 */
      const btnEditProj = el.querySelector('#btn-edit-proj');
      if (btnEditProj) btnEditProj.addEventListener('click', () => {
        const p = d.project;
        UI.openModal(`
          <div class="modal-head">
            <div class="modal-title">编辑项目</div>
            <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
          </div>
          <div class="modal-body">
            <div class="field" id="f-ep-name">
              <label>项目名称</label>
              <input id="ep-name" value="${UI.esc(p.name)}">
              <div class="err">请输入项目名称</div>
            </div>
            <div class="field">
              <label>所属工作台</label>
              <select id="ep-wb">
                ${DB.workbenches.map(w => '<option value="' + w.id + '"' + (w.id === p.workbenchId ? ' selected' : '') + '>' + UI.esc(w.name) + '</option>').join('')}
              </select>
            </div>
            <div class="field">
              <label>项目状态</label>
              <select id="ep-status">
                <option value="active"${p.status === 'active' ? ' selected' : ''}>进行中</option>
                <option value="paused"${p.status === 'paused' ? ' selected' : ''}>已暂停</option>
                <option value="archived"${p.status === 'archived' ? ' selected' : ''}>已归档</option>
              </select>
            </div>
            <div class="field">
              <label>项目说明</label>
              <textarea id="ep-desc" rows="3">${UI.esc(p.desc)}</textarea>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
            <button class="btn btn-primary" id="ep-submit">保存修改</button>
          </div>`);

        document.getElementById('ep-submit').addEventListener('click', async () => {
          const name = document.getElementById('ep-name').value.trim();
          if (!name) { document.getElementById('f-ep-name').classList.add('invalid'); return; }
          const btn = document.getElementById('ep-submit');
          btn.disabled = true;
          btn.innerHTML = ICON('loader', 14, 'spin') + '保存中…';
          await API.updateProject(p.id, {
            name,
            workbenchId: document.getElementById('ep-wb').value,
            status: document.getElementById('ep-status').value,
            desc: document.getElementById('ep-desc').value.trim()
          });
          UI.closeModal();
          UI.toast('项目信息已更新');
          location.hash = '#/project/' + p.id + '?tab=' + active + '&_=' + Date.now();
        });
      });
    }
  };
})();
