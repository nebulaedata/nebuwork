import { mountWorkflowCanvas } from './workflowCanvas.js';

export function processGraph(proc) {
  return {
    nodes: structuredClone(proc.steps),
    edges: proc.steps.slice(1).map((step, index) => ({ id: `process-edge-${index + 1}`, source: proc.steps[index].id, target: step.id })),
  };
}
export function mountProcessCanvas(canvas, set, { save, editNode, refresh, ui, session }) {
  return mountWorkflowCanvas(canvas, { wf: processGraph(set.proc) }, {
    allowConnections: false, ariaLabel: '标准化流程步骤画布', ui, session, editNode, refresh,
    save: mutate => save(draft => {
      const graph = { wf: processGraph(draft.proc) };
      mutate(graph);
      const nodes = new Map(graph.wf.nodes.map(node => [node.id, node]));
      // The list remains the source of step order; a drag changes coordinates only.
      draft.proc.steps = draft.proc.steps.filter(step => nodes.has(step.id)).map(step => ({ ...step, ...nodes.get(step.id) }));
    }),
  });
}
