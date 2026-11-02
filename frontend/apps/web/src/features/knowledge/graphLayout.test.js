import { expect, it } from 'vitest';
import { graphPositions, graphLabels } from './graphLayout.js';

it('keeps same-name document instances separate and produces deterministic bounded positions', () => {
  const nodes=Array.from({length:80},(_,i)=>({id:'doc-instance-'+i,name:'同名实体'}));
  const edges=nodes.slice(1).map(n=>({source:nodes[0].id,target:n.id}));
  const positions=graphPositions(nodes,edges);expect(positions).toEqual(graphPositions(nodes,edges));expect(positions.size).toBe(80);
  for(const p of positions.values()){expect(p.x).toBeGreaterThanOrEqual(65);expect(p.x).toBeLessThanOrEqual(615);expect(p.y).toBeGreaterThanOrEqual(45);expect(p.y).toBeLessThanOrEqual(415);}
  expect(positions.get(nodes[0].id)).not.toEqual(positions.get(nodes[1].id));expect(edges[0]).toEqual({source:nodes[0].id,target:nodes[1].id});
});
it('prioritizes a selected label over overlapping labels while retaining the full source name', () => {
  const nodes=[{id:'a',name:'被遮挡实体'},{id:'b',name:'选择的完整实体名称'}],positions=new Map(nodes.map(n=>[n.id,{x:340,y:230}]));
  const labels=graphLabels(nodes,[],positions,'b',null,1);expect(labels.get('b')).toBe(nodes[1].name);expect(labels.has('a')).toBe(false);expect(nodes[0].name).toBe('被遮挡实体');
});
