export const statuses = { unavailable: '状态暂不可用', idle: '等待目标', queued: '排队中', preparing: '准备上下文', running: '执行中', waiting_input: '等待你的补充', waiting_children: '专家协作中', recovering: '恢复执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '执行中断' };
export const isActive = status => status && !['idle', 'completed', 'failed', 'cancelled'].includes(status);
export const emptyState = sessionId => ({ sessionId, events: {}, cursor: 0, turns: [], artifacts: {}, plans: {}, experts: {} });
/** Rebuild from immutable ordered facts: duplicates, delayed packets and history pages converge. */
export function agentReducer(state, action) {
  if (action.type === 'reset') return emptyState(action.sessionId);
  if (action.type !== 'events') return state;
  const events = { ...state.events };
  for (const event of action.items) if (event.sessionId === state.sessionId && Number.isSafeInteger(event.sequence)) events[event.sequence] = event;
  const ordered = Object.values(events).sort((a, b) => a.sequence - b.sequence);
  const turns = new Map(), artifacts = {}, plans = {}, experts = {};
  for (const e of ordered) {
    if (!e.runId) { if (e.type === 'artifact.created') artifacts[e.payload.artifact.id] = e.payload.artifact; continue; }
    if (!turns.has(e.runId)) turns.set(e.runId, { id: e.runId, status: 'queued', messages: {}, tools: {}, activities: [], sequence: e.sequence });
    const t = turns.get(e.runId), p = e.payload || {};
    if (e.type.startsWith('run.')) { const status = e.type.slice(4); if (statuses[status]) t.status = status; if (status === 'started') t.status = 'running'; t.error = p.error || p.reason || p.message || t.error; }
    if (e.type.startsWith('message.')) {
      const m = t.messages[p.messageId] ||= { id: p.messageId, content: '', role: p.role || 'assistant', sequence: e.sequence, occurredAt: e.occurredAt };
      if (e.type === 'message.created') Object.assign(m, p);
      if (e.type === 'message.delta' && !m.complete) m.content += p.delta;
      if (e.type === 'message.completed') Object.assign(m, p, { complete: true });
    }
    if (e.type.startsWith('tool.')) {
      const tool = t.tools[p.toolCallId] ||= { id: p.toolCallId, sequence: e.sequence, status: 'running', output: '' };
      if (e.type === 'tool.started') Object.assign(tool, p);
      if (e.type === 'tool.output') tool.output = (tool.output + (p.output || p.text || '')).slice(-12000);
      if (e.type === 'tool.completed') Object.assign(tool, p, { status: p.result?.isError ? 'failed' : 'completed' });
    }
    if (e.type === 'artifact.created') artifacts[p.artifact.id] = p.artifact;
    if (e.type === 'plan.updated') plans[e.runId] = p.items || p.steps || [];
    if (e.type === 'expert.delegated') experts[p.runId] = { ...p, parentRunId: e.runId, sequence: e.sequence };
    if (['context.degraded', 'mcp.status', 'instructions.loaded', 'input.required'].includes(e.type)) t.activities.push(e);
    if (e.type === 'input.required') t.status = 'waiting_input';
  }
  return { sessionId: state.sessionId, events, cursor: ordered.at(-1)?.sequence || state.cursor, turns: [...turns.values()], artifacts, plans, experts };
}
export const toolLabels = { database_list: "查看数据库", database_schema: "读取数据结构", database_query: "提交数据库查询", database_execute: "提交数据库写入", database_insert_rows: "存入生成数据", database_create: "创建 SQLite", database_import: "导入数据库", database_export: "导出数据库成果", database_operation_get: "核对数据库操作结果", workspace_read: '读取资料', workspace_write: '写入文件', workspace_edit: '修改文件', shell: '运行命令', list_artifacts: '查看项目成果', read_artifact: '读取项目成果', publish_artifact: '发布成果', knowledge_search: '检索项目资料', knowledge_document: '读取知识文档', knowledge_capabilities:'查看知识库能力', knowledge_documents:'浏览知识目录', knowledge_wiki_search:'检索 Wiki', knowledge_wiki_page:'阅读 Wiki', knowledge_graph:'查询知识图谱', knowledge_gallery:'检索知识图片', memory_search: '查找相关记忆', memory_propose: '提交记忆建议', workflow_start: '启动工作流', workflow_status: '查询工作流进度', workflow_import_artifact: '导入工作流成果', workflow_list: '查看可用工作流', workflow_definition: '读取工作流定义', workflow_control: '控制工作流', workflow_artifacts: '查看工作流成果', update_plan: '更新任务计划', delegate_expert: '委派专家', expert_input: '补充专家输入', cancel_expert: '取消专家任务', expert_status: '查看专家进度', wait_experts: '等待专家成果', request_user_input: '请求补充信息', session_read: '读取授权会话' };
