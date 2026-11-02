import assert from 'node:assert/strict';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import ts from 'typescript';
const compiled = new URL('../.network-layout-test.mjs', import.meta.url);
try {
  await writeFile(compiled, ts.transpileModule(await readFile(new URL('../src/networkLayout.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
  const {networkLayout,nodeRadius} = await import(compiled.href);
  const node = id => ({id,label:'节点 '+id,category:'页面',color:'#2ba471'});
  const nodes = Array.from({length:512},(_,i)=>node(String(i)));
  const edges = Array.from({length:100},(_,i)=>({id:'e'+i,source:String(Math.floor(i/20)*20),target:String(i+1)}));
  edges.push({id:'duplicate',source:'0',target:'1'},{id:'self',source:'0',target:'0'},{id:'missing',source:'0',target:'not-loaded'});
  const original=JSON.stringify({nodes,edges});
  const start=performance.now(), result=networkLayout(nodes,edges);
  assert.equal(JSON.stringify({nodes,edges}),original,'layout must not mutate API records');
  assert.equal(result.positions.size,512,'isolated pages must not be lost');
  assert.ok([...result.positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  assert.equal(result.degree.get('0'),20,'self and duplicate edges must not inflate node degree');
  assert.equal(result.degree.get('511'),0);
  assert.ok(result.positions.get('511').y>=result.isolatedY,'unlinked pages must be separated from connected network');
  assert.deepEqual([...result.positions], [...networkLayout([...nodes].reverse(),edges).positions],'stable ID order makes layout deterministic');
  assert.ok(nodeRadius(10000)<=19 && nodeRadius(0)>=6);
  assert.equal(networkLayout([],[]).positions.size,0);
  assert.equal(networkLayout([node('single')],[]).positions.size,1);
  console.log(`PASS: 512 nodes, isolated pages, duplicate/self/dangling edges, immutable input, stable layout (${Math.round(performance.now()-start)}ms)`);
} finally {await unlink(compiled).catch(()=>{});}
