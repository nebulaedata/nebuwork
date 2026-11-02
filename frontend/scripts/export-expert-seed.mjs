import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// One-time, explicitly selected configuration import; never loaded by the Java runtime.
const source = fileURLToPath(new URL('../apps/web/src/data/mock.js', import.meta.url));
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(source, 'utf8'), context);
const db = context.window.DB;
const seed = {
  agents: db.agents.map(a => {
    const sopSets = structuredClone(db.sopSets[a.id] || [{
      id: 'sop-' + a.id + '-base', name: a.name + '标准作业流程', kind: 'process', desc: '专家标准作业流程',
      proc: { materials: [], specRefs: [], steps: a.sop.map(t => ({ t, d: '' })) }
    }]);
    for (const s of sopSets) {
      delete s.updatedAt;
      const nodes = s.kind === 'workflow' ? s.wf.nodes : s.proc.steps;
      nodes.forEach((n, i) => { n.id = s.id + '-node-' + i; });
    }
    const ruleSets = (db.ruleSets[a.id] || []).map((s, i) => ({ id: 'rs-' + a.id + '-' + i, name: s.name, desc: s.desc || '' }));
    const rules = (db.agentRules[a.id] || []).map((r, i) => {
      let set = ruleSets.find(s => s.name === r.scene);
      if (!set) { set = { id: 'rs-' + a.id + '-' + ruleSets.length, name: r.scene, desc: '' }; ruleSets.push(set); }
      return { id: 'rule-' + a.id + '-' + i, ruleSetId: set.id, name: r.name, content: r.content, enabled: r.enabled };
    });
    return { id: a.id, name: a.name, role: a.role, tagline: a.tagline, model: a.model, initials: a.initials, color: a.color,
      extensionIds: db.agentExts[a.id] || [], templateIds: db.agentTpls[a.id] || [], sopSets, ruleSets, rules };
  }),
  extensions: db.extensions.map(({ id, name, kind, desc, version, color }) => ({ id, name, kind, desc, version, color })),
  templates: db.plazaTemplates.map(({ id, name, scene, desc, color, agents }) => ({ id, name, scene, desc, color, agents })),
  marketExperts: db.plazaAgents.map(({ id, name, role, tagline, color }) => ({ id, name, role, tagline, color, model: 'DeepSeek-V3.2' }))
};
if (!process.argv[2]) throw new Error('Specify the Java seed JSON output path');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(seed, null, 2) + '\n');
console.log('Exported configuration for ' + seed.agents.length + ' experts; no knowledge or usage data.');
