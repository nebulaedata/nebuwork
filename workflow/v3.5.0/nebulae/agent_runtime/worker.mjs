// Private JSONL pipe worker. The host owns authorization, mutation and lifecycle.
import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import {
  createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';

const pending = new Map();
let session, initialized = false, stopped = false, toolCount = 0;
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
// No orphaned model request if the Python parent disappears (also on Linux).
input.on('close', () => { stopped = true; session?.dispose(); process.exit(0); });
input.on('line', line => {
  if (line === 'G') return; // Parent's process-tree isolation handshake.
  try {
    const message = JSON.parse(line);
    if (message.type === 'init' && !initialized) {
      initialized = true;
      void run(message).catch(error => emit({ type: 'error', error: String(error.message || error) }))
        .finally(() => { session?.dispose(); process.exit(0); });
    } else if (message.type === 'tool_result') {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message);
    } else if (message.type === 'abort') {
      stopped = true;
      for (const resolve of pending.values()) resolve({ error: '助手已停止' });
      pending.clear();
      void session?.abort();
    }
  } catch (error) { emit({ type: 'error', error: String(error.message || error) }); }
});

async function run(options) {
  const { config, directory } = options;
  mkdirSync(directory, { recursive: true });
  const runtime = await ModelRuntime.create({ authPath: directory + '/unused-auth.json',
    modelsPath: null, modelsStorePath: directory + '/models-cache.json', allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider('nebulae-local', { baseUrl: config.base_url, api: config.api,
    authHeader: !!options.api_key,
    models: [{ id: config.model, name: config.model, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.context_window, maxTokens: config.max_tokens }] });
  await runtime.setRuntimeApiKey('nebulae-local', options.api_key || 'local-no-auth');
  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => options.system, getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
  const customTools = options.tools.map(tool => ({ ...tool, label: tool.name, executionMode: 'sequential',
    async execute(id, args, signal) {
      if (stopped || signal?.aborted) throw new Error('助手已停止');
      if (++toolCount > 50) { stopped = true; emit({ type: 'limit', error: '达到本轮 50 次工具调用限制，请手动继续' }); throw new Error('工具调用限制'); }
      const result = await new Promise(resolve => {
        pending.set(id, resolve); emit({ type: 'tool', id, name: tool.name, arguments: args });
      });
      if (result.error) throw new Error(result.error);
      return { content: [{ type: 'text', text: JSON.stringify(result.result) }], details: {} };
    },
  }));
  const manager = SessionManager.open(directory + '/context.jsonl', directory, directory);
  ({ session } = await createAgentSession({ cwd: directory, agentDir: directory,
    modelRuntime: runtime, model: runtime.getModel('nebulae-local', config.model), thinkingLevel: 'off',
    resourceLoader, sessionManager: manager, customTools, tools: customTools.map(t => t.name),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false },
      compaction: { enabled: true, reserveTokens: Math.min(config.max_tokens, Math.floor(config.context_window / 4)),
        keepRecentTokens: Math.min(12000, Math.floor(config.context_window / 4)) } }),
  }));
  let error;
  session.subscribe(event => {
    if (event.type === 'message_start' && event.message.role === 'assistant') emit({ type: 'message_start' });
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
      emit({ type: 'delta', text: event.assistantMessageEvent.delta });
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      error = event.message.errorMessage || (event.message.stopReason === 'error' ? '模型响应失败' : undefined);
      emit({ type: 'message', text: event.message.content.filter(c => c.type === 'text').map(c => c.text).join(''),
        usage: event.message.usage, stop_reason: event.message.stopReason, error });
    }
    if (event.type === 'compaction_start' || event.type === 'compaction_end')
      emit({ type: event.type, error: event.errorMessage });
  });
  emit({ type: 'ready' });
  await session.prompt(options.prompt);
  emit({ type: 'done', error, stopped });
}
