/** Account-scoped response cache. Production starts without business or demonstration data. */
window.DB = {
  workbenches: [], projects: [], agents: [], extAuth: [], sessions: [], knowledgeBases: [],
  users: [], PERM_KEYS: [], notifications: [], extensions: [], plazaTemplates: [], sharedKbs: [],
  plazaAgents: [], channels: [], executors: [], intelSubs: [], intelItems: [], modelProviders: [],
  wbConfigs: {}, workbenchVersions: {}, projectDetails: {}, messages: {}, todos: {}, files: {},
  fileTree: {}, audit: {}, dbTables: {}, fileContents: {}, sessionContext: {}, memories: {},
  kbDocs: {}, databases: {}, cronJobs: {}, usage: {}, agentTasks: {}, agentGrowth: {},
  agentExts: {}, projectExts: {}, agentTpls: {}, sopSets: {}, ruleSets: {}, agentRules: {}, projectIntel: {},
  commander: { messages: [], dispatch: [], memNodes: [] }, pageSource: '', quota: null,
  modelSettings: null, user: { id: '', name: '', account: '', avatar: '', email: '', phone: '' },
};
