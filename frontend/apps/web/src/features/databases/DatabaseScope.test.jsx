// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ version:1, listeners:new Set() }));
vi.mock('../../services/authSession.js',()=>({authSession:{getSnapshot:()=>({version:session.version}),subscribe:fn=>{session.listeners.add(fn);return()=>session.listeners.delete(fn);}}}));
vi.mock('./DatabaseSqlEditor.jsx',()=>({default:({value,onChange})=><textarea aria-label="SQL 编辑器" value={value} onChange={e=>onChange(e.target.value)}/>}));
import { DatabaseScope } from './DatabaseScope.jsx';
import { databaseToolRecord, databaseToolStatus } from './DatabaseToolRecord.jsx';
let root,host,resource,api;
const button=(text,container=document)=>[...container.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const input=(name,container=document)=>container.querySelector(`[aria-label="${name}"]`);
async function setValue(el,value){await act(async()=>{const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});}
beforeEach(()=>{
  session.version=1;session.listeners.clear();globalThis.IS_REACT_ACT_ENVIRONMENT=true;document.body.innerHTML='<div id="test"></div>';host=document.getElementById('test');root=createRoot(host);
  window.matchMedia=vi.fn(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  const original=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(element=>original(element));
  resource={id:'db-'+ 'a'.repeat(40),name:'分析数据库',description:'保存分析结果',type:'sqlite',scopeKind:'project',scopeId:'p',revision:1,configVersion:1,dataVersion:1,enabled:true,permissions:{read:true,write:true,schema:true},draft:{name:'分析数据库',type:'sqlite',permissions:{read:true,write:true,schema:true}}};
  api={fetchDatabaseScope:vi.fn(async()=>({data:{enabled:true,databases:[resource]}})),fetchDatabase:vi.fn(async()=>({data:resource})),fetchDatabaseOperations:vi.fn(async()=>({data:{items:[]}})),fetchProjects:vi.fn(async()=>({data:[]})),changeDatabase:vi.fn(),saveDatabase:vi.fn(),createDatabase:vi.fn(),fetchDatabaseOperation:vi.fn()};
  api.submitDatabaseOperation=vi.fn(async(id,body)=>({data:{id:'dbo-'+ 'b'.repeat(40),databaseId:id,operation:body.operation,state:'completed',result:body.operation==='schema'?{tables:[{name:'records',type:'table'}]}:body.operation==='browse'?{columns:[{name:'id',type:'INTEGER'},{name:'code',type:'TEXT'}],rows:[[1,'0012']],rowCount:1,rowHashes:['original-row'],structure:{name:'records',type:'table',editable:true,keyColumns:['id'],columns:[{name:'id',type:'INTEGER',primaryKey:true},{name:'code',type:'TEXT',nullable:true}],indexes:[]}}:{affectedRows:1}}}));
  vi.stubGlobal('API',api);
});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
it('opens scoped tables and sends the original unique key and row hash when editing',async()=>{
  await act(async()=>root.render(<DatabaseScope kind="project" id="p"/>));expect(host.textContent).toContain('分析数据库');await act(async()=>button('打开数据库').click());expect(document.body.textContent).toContain('0012');
  await act(async()=>button('编辑').click());await setValue(input('行字段 code'),'0020');await act(async()=>button('保存数据').click());
  const call=api.submitDatabaseOperation.mock.calls.find(([,body])=>body.operation==='mutate_row');expect(call[1].arguments).toEqual({table:'records',action:'update',key:{id:1},rowHash:'original-row',values:{code:'0020'}});
});
it('retains the editor on revision conflict and shows actual failure',async()=>{
  await act(async()=>root.render(<DatabaseScope kind="project" id="p"/>));await act(async()=>button('打开数据库').click());await act(async()=>button('编辑').click());await setValue(input('行字段 code'),'new');
  api.submitDatabaseOperation.mockResolvedValueOnce({data:{id:'op',state:'failed',errorStatus:409,error:'这行数据已变化，请刷新后重新编辑'}});await act(async()=>button('保存数据').click());expect(input('行字段 code').value).toBe('new');expect(document.body.textContent).toContain('这行数据已变化');
});
it('keeps uncertain SQL writes on the same operation key and never reports success',async()=>{
  await act(async()=>root.render(<DatabaseScope kind="project" id="p"/>));await act(async()=>button('打开数据库').click());await act(async()=>button('SQL').click());await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});await setValue(input('SQL 编辑器'),"INSERT INTO records(code) VALUES ('x')");
  api.submitDatabaseOperation.mockResolvedValue({data:{id:'dbo-'+ 'b'.repeat(40),operationId:'dbo-'+ 'b'.repeat(40),databaseId:resource.id,operation:'execute',state:'unknown',error:'结果待核对'}});
  await act(async()=>button('执行写入 / 结构变更').click());await act(async()=>button('执行写入 / 结构变更').click());const calls=api.submitDatabaseOperation.mock.calls.filter(([,body])=>body.operation==='execute');expect(calls).toHaveLength(2);expect(calls[0][3]).toBe(calls[1][3]);expect(document.body.textContent).toContain('结果待核对');expect(document.body.textContent).not.toContain('SQL 已提交成功');
});
it('does not apply an old account response after identity changes',async()=>{
  let finish;api.fetchDatabaseScope.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(<DatabaseScope kind="expert" id="e"/>));const oldSignal=api.fetchDatabaseScope.mock.calls[0][2];api.fetchDatabaseScope.mockResolvedValue({data:{enabled:true,databases:[]}});
  await act(async()=>{session.version=2;session.listeners.forEach(fn=>fn());});await act(async()=>finish({data:{enabled:true,databases:[resource]}}));expect(oldSignal.aborted).toBe(true);expect(host.textContent).not.toContain('分析数据库');expect(host.textContent).toContain('尚未配置专家数据库');
});
it('distinguishes submission facts from completed database writes',()=>{
  const payload={operationId:'dbo-'+ 'b'.repeat(40),databaseId:resource.id,state:'queued'};const tool={name:'database_execute',result:{content:[{type:'text',text:JSON.stringify(payload)}]}};expect(databaseToolRecord(tool)).toEqual(payload);expect(databaseToolStatus(tool)).toBe('已提交');expect(databaseToolRecord({...tool,name:'shell'})).toBeNull();
});
