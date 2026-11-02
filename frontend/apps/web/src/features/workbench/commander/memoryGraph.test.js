import { expect, it } from 'vitest';
import { memoryGraph } from './MemoryPanel.jsx';
it('draws only real ownership, configured experts and recorded task provenance', () => {
  const graph = memoryGraph([{ kind: 'workbench', id: 'w', name: '工作台', items: [] }, { kind: 'project', id: 'p', workbenchId: 'w', name: '项目', items: [{ id: 'm', title: '事实', source: { taskId: 't' } }, { id: 'deleted', title: '独立记忆', source: { taskId: 'gone' }, sourceTaskDeleted: true }] }, { kind: 'expert', id: 'e', projectId: 'p', name: '专家', items: [] }]);
  expect(graph.edges.map(e => [e.source, e.target])).toEqual([['workbench:w', 'project:p'], ['project:p', 'entry:m'], ['task:t', 'entry:m'], ['project:p', 'entry:deleted'], ['project:p', 'expert:e']]);
  expect(graph.nodes.some(n => n.id === 'task:gone')).toBe(false);
  expect(memoryGraph([])).toEqual({ nodes: [], edges: [] });
});
