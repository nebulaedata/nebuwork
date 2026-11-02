/* views/settings.js — 设置:个人信息(名称/头像/大图预览)+ 用户设置(管理员开通权限) */
(function () {
  window.Views = window.Views || {};

  /* 同步侧栏头像(改名/换头像后调用) */
  function syncSidebarAvatar() {
    const span = document.querySelector('#user-card .avatar');
    if (!span) return;
    span.innerHTML = UI.esc(DB.user.name.charAt(0)) +
      (DB.user.avatar ? '<img src="' + DB.user.avatar + '" alt="用户头像" onerror="this.remove()">' : '');
  }

  /* 头像大图预览弹窗 */
  function openAvatarPreview() {
    const inner = DB.user.avatar
      ? '<img src="' + DB.user.avatar + '" alt="头像大图" style="width:260px;height:260px;border-radius:50%;object-fit:cover;display:block;margin:8px auto">'
      : '<div style="width:260px;height:260px;border-radius:50%;display:grid;place-items:center;font-size:96px;font-weight:600;color:#FFF;background:linear-gradient(135deg,var(--accent),var(--accent-2));margin:8px auto">' + UI.esc(DB.user.name.charAt(0)) + '</div>';
    UI.openModal(
      '<div class="modal-head"><span class="modal-title">' + ICON('image', 16) + '头像预览</span><button class="btn-icon" id="modal-close">' + ICON('x', 15) + '</button></div>' +
      '<div class="modal-body">' + inner + '</div>');
    document.getElementById('modal-close').addEventListener('click', UI.closeModal);
  }

  Views.settings = {
    async render(el, param, query) {
      const isAdmin = DB.user.role === 'admin';
      const validTabs = ['profile', 'model', 'channels', 'executor', 'extauth'];
      if (isAdmin) validTabs.push('users');
      const active = validTabs.includes(query.tab) ? query.tab : 'profile';

      /* 顶部功能页签(同项目二级菜单) */
      const tabs = [['profile', '个人信息', 'user'], ['model', '模型设置', 'cpu'],
        ['channels', '频道', 'message-circle'], ['executor', '执行体', 'monitor-down'],
        ['extauth', '扩展授权', 'shield']];
      if (isAdmin) tabs.push(['users', '用户设置', 'users']);
      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        tabs.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-stab="${k}">${ICON(ic, 14)}${label}</button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-stab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/settings?tab=' + b.dataset.stab;
      }));

      if (active === 'profile') {
        const avatarInner = DB.user.avatar
          ? '<img src="' + DB.user.avatar + '" alt="头像" onerror="this.remove()">'
          : '';
        el.innerHTML = `
        <div class="page" style="max-width:720px">
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
                <div class="dim" style="font-size:12px;margin-bottom:10px">${UI.esc(DB.user.account)} · ${isAdmin ? '管理员' : '成员'}</div>
                <button class="btn btn-ghost btn-sm" id="st-change-avatar">${ICON('camera', 13)}更换头像</button>
                <input type="file" id="st-avatar-input" accept="image/*" style="display:none">
              </div>
            </div>
            <div class="st-form">
              <div class="field"><label>个人名称</label><input id="st-name" value="${UI.esc(DB.user.name)}" placeholder="请输入名称"></div>
              <div class="field"><label>账号</label><input value="${UI.esc(DB.user.account)}" disabled></div>
            </div>
            <div class="st-actions">
              <button class="btn btn-ghost" id="st-logout" style="color:var(--danger)">${ICON('log-out', 14)}退出登录</button>
              <button class="btn btn-primary" id="st-save">${ICON('check', 14)}保存修改</button>
            </div>
          </div>
        </div>`;

        el.querySelector('#st-avatar').addEventListener('click', openAvatarPreview);
        const fileInput = el.querySelector('#st-avatar-input');
        el.querySelector('#st-change-avatar').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          const f = fileInput.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            DB.user.avatar = reader.result;
            syncSidebarAvatar();
            Views.settings.render(el, param, query);
            UI.toast('头像已更新');
          };
          reader.readAsDataURL(f);
        });
        el.querySelector('#st-save').addEventListener('click', () => {
          const name = el.querySelector('#st-name').value.trim();
          if (!name) { UI.toast('名称不能为空', 'err'); return; }
          DB.user.name = name;
          const u = DB.users.find(x => x.id === 'u1');
          if (u) u.name = name;
          syncSidebarAvatar();
          UI.toast('个人信息已保存');
        });
        el.querySelector('#st-logout').addEventListener('click', () => {
          /* TODO: replace with fetch('/api/logout', ...) */
          sessionStorage.removeItem('ah-auth');
          UI.toast('已退出登录');
          location.hash = '#/login';
        });
        return;
      }

      /* ---------- 模型设置(沿用旧版设置内容) ---------- */
      if (active === 'model') {
        el.innerHTML = `
        <div class="page" style="max-width:880px">
          <div class="grid grid-2">
            <div class="card card-pad">
              <div class="tc-title" style="margin-bottom:14px">${ICON('cpu', 15)}默认模型</div>
              <div class="field"><label>新任务默认模型</label>
                <select id="st-model"><option>DeepSeek-V3.2</option><option>Qwen3-235B</option><option>Kimi-K2</option><option>DeepSeek-V4-Pro</option></select>
              </div>
              <div class="field"><label>审计检索备用模型</label>
                <select><option>Kimi-K2</option><option>DeepSeek-V3.2</option><option>Qwen3-235B</option></select>
              </div>
              <div style="margin-top:14px"><button class="btn btn-primary btn-sm" id="btn-save-set">保存</button></div>
            </div>
            <div class="card card-pad">
              <div class="tc-title" style="margin-bottom:14px">${ICON('shield', 15)}审计与合规</div>
              <div class="file-row"><div style="flex:1;font-size:13px">保留任务审计轨迹</div><button class="cron-switch on" data-set></button></div>
              <div class="file-row"><div style="flex:1;font-size:13px">任务产物自动归档到项目</div><button class="cron-switch on" data-set></button></div>
              <div class="file-row"><div style="flex:1;font-size:13px">专家记忆自动回流</div><button class="cron-switch on" data-set></button></div>
            </div>
          </div>
        </div>`;
        el.querySelectorAll('[data-set]').forEach(sw => sw.addEventListener('click', () => sw.classList.toggle('on')));
        el.querySelector('#btn-save-set').addEventListener('click', () => UI.toast('模型设置已保存'));
        return;
      }

      /* ---------- 频道:接入其他 IM 软件 ---------- */
      if (active === 'channels') {
        el.innerHTML = `
        <div class="page" style="max-width:880px">
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
        <div class="page" style="max-width:880px">
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

      /* ---------- 扩展授权:上架 / 上线 / 使用 三类审批流 ---------- */
      if (active === 'extauth') {
        const AUTH_CATS = {
          ext: ['扩展上架', 'puzzle', '扩展市场上架技能、MCP、插件,需管理员审核和授权'],
          agent: ['专家上线', 'bot', '专家智能体市场上线专家智能体及能力,需管理员审核和授权'],
          usage: ['使用授权', 'key-round', '专家智能体使用扩展能力,需提交授权申请,管理员批准后生效']
        };
        const KIND_NAME = { skill: '技能', mcp: 'MCP', plugin: '插件', agent: '专家' };
        const STATUS = { pending: ['pill-warning', '待审核'], approved: ['pill-success', '已批准'], rejected: ['pill-danger', '已拒绝'] };
        const f = ['ext', 'agent', 'usage'].includes(query.f) ? query.f : '';
        const list = DB.extAuth.filter(r => !f || r.cat === f);
        const pendCnt = c => DB.extAuth.filter(r => r.status === 'pending' && (!c || r.cat === c)).length;

        el.innerHTML = `
        <div class="page" style="max-width:920px">
          <div class="section-title reveal">扩展授权</div>
          <div class="section-desc reveal" style="margin-bottom:18px">智能体能力扩展实行授权管理:市场上架、专家上线、能力使用均需管理员审核,全程留痕。</div>
          <div class="grid grid-3 reveal reveal-1" style="margin-bottom:18px">
            ${Object.keys(AUTH_CATS).map(k => `
              <div class="card card-pad clickable" data-auth-f="${k}" style="${f === k ? 'border-color:var(--accent)' : ''}">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                  <span style="color:var(--accent);display:inline-flex">${ICON(AUTH_CATS[k][1], 15)}</span>
                  <span style="font-size:13px;font-weight:600">${AUTH_CATS[k][0]}</span>
                  ${pendCnt(k) ? '<span class="pill pill-warning" style="margin-left:auto">' + pendCnt(k) + ' 待审</span>' : '<span class="pill pill-dim" style="margin-left:auto">无待审</span>'}
                </div>
                <div class="dim" style="font-size:11.5px;line-height:1.6">${AUTH_CATS[k][2]}</div>
              </div>`).join('')}
          </div>
          <div class="card reveal reveal-2">
            <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
              <div class="tc-title">${ICON('shield', 15)}审批记录<span class="pill pill-dim" style="margin-left:8px">${list.length}</span></div>
              <div style="display:flex;gap:8px;align-items:center">
                ${f ? '<button class="btn btn-ghost btn-sm" data-auth-f="">全部</button>' : ''}
                <button class="btn btn-primary btn-sm" id="btn-apply-auth">${ICON('plus', 13)}发起使用授权申请</button>
              </div>
            </div>
            <div class="tc-body">
              ${list.length ? list.map(r => `
                <div class="file-row" style="align-items:flex-start">
                  <span class="file-icon">${ICON(AUTH_CATS[r.cat][1], 15)}</span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px">
                      <span class="pill pill-dim" style="margin-right:6px">${AUTH_CATS[r.cat][0]} · ${KIND_NAME[r.kind] || r.kind}</span>
                      ${UI.esc(r.target)}
                      ${r.agent ? '<span class="dim" style="font-size:11.5px;margin-left:6px">使用方:' + UI.esc(r.agent) + '</span>' : ''}
                    </div>
                    <div class="dim" style="font-size:11.5px;margin-top:3px">${UI.esc(r.reason)} · ${UI.esc(r.applicant)} 提交于 ${r.time}</div>
                    ${r.note ? '<div style="font-size:11.5px;margin-top:3px;color:var(--danger)">驳回意见:' + UI.esc(r.note) + '</div>' : ''}
                    ${r.approver ? '<div class="dim" style="font-size:11px;margin-top:2px">审批人:' + UI.esc(r.approver) + '</div>' : ''}
                  </div>
                  <span class="pill ${STATUS[r.status][0]}" style="flex-shrink:0">${STATUS[r.status][1]}</span>
                  ${isAdmin && r.status === 'pending' ? `
                    <button class="btn btn-primary btn-sm" data-approve="${r.id}" style="flex-shrink:0">${ICON('check-circle', 12)}批准</button>
                    <button class="btn btn-ghost btn-sm" data-reject="${r.id}" style="flex-shrink:0;color:var(--danger)">拒绝</button>` : ''}
                </div>`).join('') : '<div class="empty" style="padding:26px">该分类暂无审批记录</div>'}
            </div>
          </div>
        </div>`;

        el.querySelectorAll('[data-auth-f]').forEach(b => b.addEventListener('click', () => {
          location.hash = '#/settings?tab=extauth' + (b.dataset.authF ? '&f=' + b.dataset.authF : '');
        }));
        el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
          await API.reviewExtAuth(b.dataset.approve, true);
          Views.settings.render(el, param, query);
          UI.toast('已批准');
        }));
        el.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => {
          const id = b.dataset.reject;
          const body = `
            <div class="field"><label>驳回意见</label><input id="ar-note" type="text" placeholder="告知申请人原因,便于修改后重新提交"></div>
            <div class="modal-foot">
              <button class="btn btn-ghost" data-close>取消</button>
              <button class="btn btn-primary" id="ar-submit" style="background:var(--danger)">确认拒绝</button>
            </div>`;
          UI.modal('拒绝申请', body, async m => {
            const btn = m.querySelector('#ar-submit');
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              await API.reviewExtAuth(id, false, m.querySelector('#ar-note').value.trim());
              UI.closeModal();
              Views.settings.render(el, param, query);
              UI.toast('已拒绝');
            });
          });
        }));
        el.querySelector('#btn-apply-auth').addEventListener('click', () => {
          const body = `
            <div class="field"><label>专家智能体</label><select id="aa-agent">${DB.agents.map(a => '<option>' + UI.esc(a.name) + '</option>').join('')}</select></div>
            <div class="field"><label>扩展能力</label><select id="aa-ext">${DB.extensions.map(x => '<option value="' + x.id + '">' + UI.esc(x.name) + '(' + KIND_NAME[x.kind] + ')</option>').join('')}</select></div>
            <div class="field"><label>申请理由</label><textarea id="aa-reason" placeholder="说明使用场景,便于管理员审批"></textarea></div>
            <div class="modal-foot">
              <button class="btn btn-ghost" data-close>取消</button>
              <button class="btn btn-primary" id="aa-submit">提交申请</button>
            </div>`;
          UI.modal('申请扩展使用授权', body, async m => {
            const btn = m.querySelector('#aa-submit');
            btn.addEventListener('click', async () => {
              const reason = m.querySelector('#aa-reason').value.trim();
              if (!reason) { UI.toast('请填写申请理由', 'err'); return; }
              btn.disabled = true; btn.textContent = '提交中…';
              const ext = DB.extensions.find(x => x.id === m.querySelector('#aa-ext').value);
              await API.applyExtAuth({ cat: 'usage', kind: ext.kind, target: ext.name, agent: m.querySelector('#aa-agent').value, reason });
              UI.closeModal();
              Views.settings.render(el, param, { tab: 'extauth', f: 'usage' });
              UI.toast('申请已提交,等待管理员审批');
            });
          });
        });
        return;
      }

      /* ---------- 用户设置(管理员):为其他用户开通权限 ---------- */
      el.innerHTML = `
      <div class="page" style="max-width:860px">
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
