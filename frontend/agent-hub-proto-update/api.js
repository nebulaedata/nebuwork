/* api.js — API 桩层:签名为未来真实接口形状,内部返回 mock。
   接入真实后端时逐个替换函数体即可,UI 不需要改动。 */
(function () {
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  window.API = {

    /* GET /api/workbenches */
    async fetchWorkbenches() {
      await delay(260);
      // TODO: replace with fetch('/api/workbenches')
      return { code: 0, data: DB.workbenches };
    },

    /* GET /api/projects?workbenchId= */
    async fetchProjects(workbenchId) {
      await delay(300);
      // TODO: replace with fetch(`/api/projects?workbenchId=${workbenchId||''}`)
      const list = workbenchId ? DB.projects.filter(p => p.workbenchId === workbenchId) : DB.projects;
      return { code: 0, data: list };
    },

    /* GET /api/projects/:id  (聚合:项目 + 记忆/文件/知识库/数据库/定时任务/用量) */
    async fetchProjectDetail(id) {
      await delay(320);
      // TODO: replace with fetch(`/api/projects/${id}`)
      return {
        code: 0,
        data: {
          project: DB.projects.find(p => p.id === id),
          sessions: DB.sessions.filter(s => s.projectId === id),
          memories: DB.memories[id] || [],
          files: DB.files[id] || [],
          fileTree: DB.fileTree[id] || null,
          knowledgeBases: DB.knowledgeBases.filter(k => k.projectId === id),
          databases: DB.databases[id] || [],
          cronJobs: DB.cronJobs[id] || [],
          usage: DB.usage[id] || null,
          extensions: (DB.projectExts[id] || []).map(x => DB.extensions.find(e => e.id === x)).filter(Boolean),
          intel: DB.projectIntel[id] || []
        }
      };
    },

    /* GET /api/agents */
    async fetchAgents() {
      await delay(280);
      // TODO: replace with fetch('/api/agents')
      return { code: 0, data: DB.agents };
    },

    /* GET /api/agents/:id (聚合:配置 + 跨项目任务 + 成长回流) */
    async fetchAgentDetail(id) {
      await delay(300);
      // TODO: replace with fetch(`/api/agents/${id}`)
      return {
        code: 0,
        data: {
          agent: DB.agents.find(a => a.id === id),
          tasks: DB.agentTasks[id] || [],
          growth: DB.agentGrowth[id] || []
        }
      };
    },

    /* GET /api/sessions/:id (聚合:会话 + 消息 + 待办 + 文件 + 审计) */
    async fetchSession(id) {
      await delay(320);
      // TODO: replace with fetch(`/api/sessions/${id}`)
      const s = DB.sessions.find(x => x.id === id);
      return {
        code: 0,
        data: {
          session: s,
          projectSessions: DB.sessions.filter(x => x.projectId === s.projectId),
          messages: DB.messages[id] || [],
          todos: DB.todos[id] || [],
          files: DB.files[id] || [],
          audit: DB.audit[id] || [],
          context: DB.sessionContext[id] || []
        }
      };
    },

    /* POST /api/sessions/:id/messages  {content}
       返回一条罐装演示回复(不真实调用模型) */
    async sendMessage(sessionId, content) {
      await delay(900);
      // TODO: replace with fetch(`/api/sessions/${sessionId}/messages`, {method:'POST', body:{content}})
      // TODO: 真实场景为 SSE 流式返回 agent 步骤与增量文本
      const canned = {
        id: 'm' + Date.now(), role: 'agent', type: 'text', time: '现在',
        content: '已收到你的补充要求。我会基于当前任务的上下文继续执行:先核对相关条款与数据,再把结论和产物文件同步到右侧文件面板。执行过程中的关键步骤会记录在「审计」面板,可随时回看轨迹。'
      };
      (DB.messages[sessionId] = DB.messages[sessionId] || []).push(canned);
      return { code: 0, data: canned };
    },

    /* PATCH /api/sessions/:id/todos/:todoId */
    async toggleTodo(sessionId, todoId) {
      await delay(180);
      // TODO: replace with fetch(`/api/sessions/${sessionId}/todos/${todoId}`, {method:'PATCH'})
      const list = DB.todos[sessionId] || [];
      const t = list.find(x => x.id === todoId);
      if (t) t.status = t.status === 'done' ? 'todo' : 'done';
      return { code: 0, data: t };
    },

    /* PATCH /api/projects/:id  {name, workbenchId, status, desc} */
    async updateProject(id, patch) {
      await delay(280);
      // TODO: replace with fetch(`/api/projects/${id}`, {method:'PATCH', body:patch})
      const p = DB.projects.find(x => x.id === id);
      if (p) Object.assign(p, patch);
      return { code: 0, data: p };
    },

    /* POST /api/projects  {name, workbenchId, desc} */
    async createProject(payload) {
      await delay(420);
      // TODO: replace with fetch('/api/projects', {method:'POST', body:payload})
      const id = 'p' + (DB.projects.length + 1);
      const p = {
        id, name: payload.name, workbenchId: payload.workbenchId,
        desc: payload.desc || '', status: 'active', createdAt: '2026-08-20',
        agentIds: [], stats: { tasks: 0, tokens: '0', cost: '¥ 0.00' }
      };
      DB.projects.push(p);
      const wb = DB.workbenches.find(w => w.id === p.workbenchId);
      if (wb) wb.projectIds.push(id);
      return { code: 0, data: p };
    },

    /* POST /api/agents  {name, role, model} */
    async createAgent(payload) {
      await delay(420);
      // TODO: replace with fetch('/api/agents', {method:'POST', body:payload})
      const id = 'a' + (DB.agents.length + 1);
      const a = {
        id, name: payload.name, initials: payload.name.slice(0, 1), color: '#6C63F0',
        role: payload.role || '通用专家', model: payload.model || 'DeepSeek-V3.2',
        level: 1, xp: 0, tagline: payload.tagline || '新建专家,等待配置 SOP 与知识库。',
        sop: ['等待配置 SOP 工作流'], kbIds: [], plugins: [],
        stats: { tasks: 0, successRate: 0, tokens: '0', cost: '¥ 0.00' }
      };
      DB.agents.push(a);
      return { code: 0, data: a };
    },

    /* 管理员审批:批准/拒绝 上架、上线或使用授权申请 */
    async reviewExtAuth(id, approved, note) {
      await delay(260);
      // TODO: replace with fetch('/api/ext-auth/' + id + '/review', {method:'POST', body:{approved, note}})
      const r = DB.extAuth.find(x => x.id === id);
      if (!r || r.status !== 'pending') return { code: 404, msg: '申请不存在或已处理' };
      r.status = approved ? 'approved' : 'rejected';
      r.approver = DB.user.name;
      if (note) r.note = note;
      return { code: 0, data: r };
    },

    /* 发起使用授权申请(专家智能体使用扩展能力) */
    async applyExtAuth(payload) {
      await delay(280);
      // TODO: replace with fetch('/api/ext-auth', {method:'POST', body:payload})
      const r = {
        id: 'ea' + Date.now(), cat: payload.cat || 'usage', kind: payload.kind || 'plugin',
        target: payload.target, agent: payload.agent, applicant: DB.user.name,
        reason: payload.reason || '', time: '刚刚', status: 'pending'
      };
      DB.extAuth.unshift(r);
      return { code: 0, data: r };
    }
  };
})();
