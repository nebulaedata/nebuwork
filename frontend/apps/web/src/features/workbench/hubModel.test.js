// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { analysisRequest, dispatchTargets, readPreference, savePreference, settledMap, sourceIdentity, taskArtifacts } from './hubModel.js';
it('matches artifacts to actual task sessions and runs when taskId is absent', () => {
  const files = [{ id: 'own', sessionId: 's', runId: 'r' }, { id: 'import', sessionId: 's' }, { id: 'other', sessionId: 'other-s', runId: 'other-r' }, { id: 'unknown' }];
  expect(taskArtifacts(files, { task: { id: 't' }, session: { id: 's' }, runs: [{ id: 'r' }] }).map(f => f.id)).toEqual(['own', 'import']);
  expect(taskArtifacts(files, {}).length).toBe(0);
});
it('persists only account-scoped ID preferences', () => {
  localStorage.clear(); savePreference('a', 'intel', { projectId: 'p', taskId: 't', content: 'secret', token: 'key' });
  expect(readPreference('a', 'intel')).toEqual({ projectId: 'p', taskId: 't' });
  expect(readPreference('b', 'intel')).toEqual({});
  expect(localStorage.getItem('nw-hub:a:intel')).not.toContain('secret');
});
it('associates only successful dispatch results, never prose, failed calls or list results', () => {
  const t = (name, result, status = 'completed') => ({ name: `mcp__nebuwork__${name}`, status, result });
  const targets = dispatchTargets([{ tools: {
    a: t('nw_task_create', { content: [{ text: JSON.stringify({ task: { id: 'child' } }) }] }),
    b: t('nw_task_run_start', { data: { taskId: 'child' } }),
    c: t('nw_task_list', { data: { taskId: 'unrelated' } }),
    d: t('nw_task_create', { isError: true, taskId: 'error' }),
    e: t('nw_task_create', { data: { taskId: 'pending' } }, 'running'),
    f: t('nw_task_create', { content: [{ text: '创建成功 task-guess' }] }),
  } }]);
  expect([...targets]).toEqual(['child']);
});
it('keeps provenance and exact versions without cross-project file attachments', () => {
  const sources = [{ kind: 'artifact', id: 'f', version: 3, projectId: 'other', name: 'facts.md' }, { kind: 'knowledge', scopeKind: 'project', scopeId: 'p', referenceId: 'r', documentId: 'd' }];
  const payload = analysisRequest('分析', sources);
  expect(payload.fileRefs).toBeUndefined(); expect(payload.context.sourceRefs[0]).toMatchObject({ projectId: 'other', version: 3 });
  expect(payload.context.sourceRefs[1]).toMatchObject({ referenceId: 'r', documentId: 'd' });
  expect(sourceIdentity(sources[0])).not.toBe(sourceIdentity({ ...sources[0], version: 4 }));
});
it('limits fanout and preserves successful sources when another source fails', async () => {
  let running = 0, peak = 0;
  const rows = await settledMap([0, 1, 2, 3, 4], async n => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 2)); running--; if (n === 2) throw Error('denied'); return n; }, 2);
  expect(peak).toBe(2); expect(rows[2].status).toBe('rejected'); expect(rows[4]).toEqual({ status: 'fulfilled', value: 4 });
});
