// Missing edges are legacy sequential flows; [] is an intentionally disconnected graph.
export function workflowEdges(wf) {
  return wf.edges ?? wf.nodes.slice(1).map((node, index) => ({
    id: `legacy-edge-${index + 1}`, source: wf.nodes[index].id, target: node.id,
  }));
}

export function materializeWorkflowEdges(wf) {
  return wf.edges ??= workflowEdges(wf);
}

export function connectWorkflowNodes(wf, source, target, id) {
  const edges = materializeWorkflowEdges(wf);
  if (!wf.nodes.some(node => node.id === source) || !wf.nodes.some(node => node.id === target)) {
    throw new Error('节点已不存在，请重新加载');
  }
  if (source === target) throw new Error('不能连接节点自身');
  if (edges.some(edge => edge.source === source && edge.target === target)) throw new Error('这条连线已存在');
  if (edges.length >= 1000) throw new Error('连线不能超过 1000 条');
  edges.push({ id, source, target });
}

export function removeWorkflowNode(wf, id) {
  wf.edges = materializeWorkflowEdges(wf).filter(edge => edge.source !== id && edge.target !== id);
  wf.nodes = wf.nodes.filter(node => node.id !== id);
}
