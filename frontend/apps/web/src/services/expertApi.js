// Java expert-management adapter. The DB object is a cache, never a persistence fallback.
export function createExpertApi(request, db, urlFor = path => path, sessionVersion = () => 0) {
  for (const key of ['agents', 'extensions', 'plazaTemplates', 'plazaAgents']) db[key] = [];
  for (const key of ['sopSets', 'ruleSets', 'agentRules', 'agentExts', 'agentTpls']) db[key] = {};
  const queues = new Map();
  let membershipEpoch = 0, membershipQueue = Promise.resolve();
  const responseScopes = new WeakMap();
  const scope = () => ({ session: sessionVersion(), epoch: membershipEpoch });
  const checkScope = captured => {
    if (captured.session !== sessionVersion()) throw new Error('登录状态已变化，请重新加载');
    if (captured.epoch !== membershipEpoch) throw new Error('专家添加状态已变化，请重新加载');
  };
  const read = async (url, options) => {
    const captured = scope();
    const result = await request(url, options);
    checkScope(captured);
    responseScopes.set(result, captured);
    return result;
  };
  const checked = result => { checkScope(responseScopes.get(result)); return result; };
  // Membership changes invalidate in-flight reads/writes and serialize add/remove responses.
  const changeMembership = action => {
    const version = sessionVersion();
    const next = membershipQueue.then(async () => {
      if (version !== sessionVersion()) throw new Error('登录状态已变化，请重新加载');
      membershipEpoch++;
      try { return await action(); }
      finally { membershipEpoch++; }
    });
    membershipQueue = next.catch(() => {});
    return next;
  };
  const enc = encodeURIComponent;
  const base = id => '/api/agents/' + enc(id);
  const sopBase = (agent, sop) => base(agent) + '/sop-sets/' + enc(sop);
  const write = (url, method, body) => read(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const merge = (array, item) => {
    const i = array.findIndex(x => x.id === item.id);
    if (i < 0) array.push(item); else array[i] = item;
  };
  const cacheDetail = d => {
    merge(db.agents, d.agent);
    db.sopSets[d.agent.id] = d.sopSets;
    db.ruleSets[d.agent.id] = d.ruleSets;
    db.agentRules[d.agent.id] = d.rules;
    db.agentExts[d.agent.id] = d.extensions.map(x => x.id);
    db.agentTpls[d.agent.id] = d.templates.map(x => x.id);
    d.extensions.forEach(x => merge(db.extensions, x));
    d.templates.forEach(x => merge(db.plazaTemplates, x));
    return d;
  };
  const cacheSop = (agent, set) => {
    merge(db.sopSets[agent] ||= [], set);
    const a = db.agents.find(x => x.id === agent);
    if (a) a.sop = db.sopSets[agent].flatMap(s => (s.kind === 'workflow' ? s.wf.nodes : s.proc.steps).map(n => n.t));
  };
  const enqueue = (agent, sop, action) => {
    const captured = scope();
    const key = agent + '/' + sop;
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.then(async () => {
      checkScope(captured);
      const current = db.sopSets[agent]?.find(s => s.id === sop);
      if (!current) throw new Error('SOP 已不存在，请重新加载');
      return action(current);
    });
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  };
  const cacheRule = (agent, rule) => {
    merge(db.agentRules[agent] ||= [], rule);
    const sets = db.ruleSets[agent] ||= [];
    if (!sets.some(s => s.id === rule.ruleSetId)) sets.push({ id: rule.ruleSetId, name: rule.scene, desc: '', revision: 1 });
  };
  return {
    async fetchAgents() {
      const result = checked(await read('/api/agents'));
      db.agents.splice(0, db.agents.length, ...result.data);
      return result;
    },
    async fetchAgentDetail(id, taskOffset = 0) {
      const result = checked(await read(base(id) + (taskOffset ? '?taskOffset=' + Math.max(0, taskOffset) : ''))); cacheDetail(result.data); return result;
    },
    async createAgent(payload) {
      const result = checked(await write('/api/agents', 'POST', payload));
      merge(db.agents, result.data); return result;
    },
    async updateAgent(id, payload, { signal } = {}) {
      const result = checked(await read(base(id), { method: 'POST', body: JSON.stringify(payload), signal }));
      merge(db.agents, result.data); return result;
    },
    async completeExpertAbility(payload, { signal } = {}) {
      return checked(await read('/api/agents/ability-completion', { method: 'POST', body: JSON.stringify(payload), signal }));
    },
    async fetchExpertCatalogs() {
      const captured = scope();
      const [extensions, templates, agents] = await Promise.all([
        read('/api/plaza/extensions'), read('/api/plaza/templates'), read('/api/plaza/agents')
      ]);
      checkScope(captured);
      db.extensions = extensions.data; db.plazaTemplates = templates.data; db.plazaAgents = agents.data;
      return { code: 0, data: { extensions: extensions.data, templates: templates.data, agents: agents.data } };
    },
    async createSop(agent, payload, requestKey) {
      const result = checked(await read(base(agent) + '/sop-sets', { method: 'POST', body: JSON.stringify(payload), ...(requestKey ? { headers: { 'Idempotency-Key': requestKey } } : {}) }));
      cacheSop(agent, result.data); return result;
    },
    createSopWorkflow(agent, sop, requestKey) {
      return enqueue(agent, sop, async current => {
        const result = checked(await read(sopBase(agent, sop) + '/workflow', { method: 'POST', body: JSON.stringify({ revision: current.revision }), headers: { 'Idempotency-Key': requestKey } }));
        cacheSop(agent, result.data); return result;
      });
    },
    updateSop(agent, sop, mutate) {
      return enqueue(agent, sop, async current => {
        const draft = structuredClone(current);
        mutate(draft);
        // Browser saves use POST because the deployed gateway does not permit PATCH.
        const result = checked(await write(sopBase(agent, sop), 'POST', draft));
        cacheSop(agent, result.data); return result;
      });
    },
    deleteSop(agent, sop) {
      return enqueue(agent, sop, async current => {
        const result = checked(await write(sopBase(agent, sop) + '?revision=' + current.revision, 'DELETE'));
        db.sopSets[agent] = db.sopSets[agent].filter(s => s.id !== sop);
        const a = db.agents.find(x => x.id === agent);
        if (a) a.sop = db.sopSets[agent].flatMap(s => (s.kind === 'workflow' ? s.wf.nodes : s.proc.steps).map(n => n.t));
        return result;
      });
    },
    uploadSopMaterial(agent, sop, file) {
      return enqueue(agent, sop, async current => {
        const body = new FormData(); body.append('file', file); body.append('revision', String(current.revision));
        const result = checked(await read(sopBase(agent, sop) + '/materials', { method: 'POST', body }));
        cacheSop(agent, result.data); return result;
      });
    },
    removeSopMaterial(agent, sop, material) {
      return enqueue(agent, sop, async current => {
        const result = checked(await write(sopBase(agent, sop) + '/materials/' + enc(material) + '?revision=' + current.revision, 'DELETE'));
        cacheSop(agent, result.data); return result;
      });
    },
    sopMaterialUrl(agent, sop, material) { return urlFor(sopBase(agent, sop) + '/materials/' + enc(material) + '/content'); },
    async createRuleSet(agent, payload) {
      const result = checked(await write(base(agent) + '/rule-sets', 'POST', payload));
      merge(db.ruleSets[agent] ||= [], result.data); return result;
    },
    async saveAgentRule(agent, rule, payload) {
      const result = checked(await write(base(agent) + '/rules' + (rule ? '/' + enc(rule.id) : ''), 'POST',
        { ...payload, ...(rule ? { revision: rule.revision } : {}) }));
      cacheRule(agent, result.data); return result;
    },
    async deleteAgentRule(agent, rule) {
      const result = checked(await write(base(agent) + '/rules/' + enc(rule.id) + '?revision=' + rule.revision, 'DELETE'));
      db.agentRules[agent] = db.agentRules[agent].filter(r => r.id !== rule.id); return result;
    },
    async setExpertBinding(agent, kind, target, enabled) {
      if (!['extensions', 'tpls'].includes(kind)) throw new Error('无效的绑定类型');
      const result = checked(await write(base(agent) + '/' + kind + '/' + enc(target), enabled ? 'PUT' : 'DELETE'));
      cacheDetail(result.data); return result;
    },
    hireExpert(market) {
      return changeMembership(async () => {
        const result = checked(await write('/api/plaza/agents/' + enc(market) + '/hire', 'POST'));
        merge(db.agents, result.data);
        const m = db.plazaAgents.find(x => x.id === market);
        if (m) Object.assign(m, { hiredAgentId: result.data.id, hiredAgentRevision: result.data.revision,
          hiredMembershipRevision: result.data.membershipRevision });
        return result;
      });
    },
    removeExpert(agent, revision, membershipRevision) {
      return changeMembership(async () => {
        const result = checked(await write(base(agent) + '?revision=' + enc(revision) + '&membershipRevision=' + enc(membershipRevision), 'DELETE'));
        const index = db.agents.findIndex(x => x.id === agent);
        if (index >= 0) db.agents.splice(index, 1);
        for (const key of ['sopSets', 'ruleSets', 'agentRules', 'agentExts', 'agentTpls']) delete db[key][agent];
        const m = db.plazaAgents.find(x => x.id === result.data.sourceMarketId || x.hiredAgentId === agent);
        if (m) Object.assign(m, { hiredAgentId: null, hiredAgentRevision: null, hiredMembershipRevision: result.data.membershipRevision });
        return result;
      });
    }
  };
}
