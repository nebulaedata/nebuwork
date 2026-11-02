// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentTask } from './AgentTask.jsx';
let root,host,callbacks;
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;document.body.innerHTML='<div id="topbar-crumb"></div><div id="test"></div>';host=document.getElementById('test');root=createRoot(host);
  const run={id:'r',status:'running'},task={id:'t',projectId:'p',title:'资料分析',sessionId:'s'};
  vi.stubGlobal('API',{fetchTask:vi.fn(async()=>({data:{task,session:{id:'s'},runs:[run],events:[],cursor:0,hasEarlier:false}})),fetchProjectDetail:vi.fn(async()=>({data:{project:{id:'p',name:'项目'}}})),fetchProjectTasks:vi.fn(async()=>({data:[task]})),fetchProjectArtifacts:vi.fn(async()=>({data:{items:[{id:'f',name:'成果.html',version:1,size:12,mediaType:'text/html'}]}})),fetchAgentRun:vi.fn(async()=>({data:{...run,children:[]}})),subscribeTask:vi.fn(async(id,c,cb)=>{callbacks=cb;}),artifactContent:vi.fn(async()=>({data:{size:12,text:async()=>'<script>parent.evil=true</script>'}})),artifactUrl:()=>'/download'});
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('renders three desktop columns, updates one tool card, and isolates HTML previews',async()=>{
  await act(async()=>root.render(<AgentTask taskId="t"/>));expect(host.querySelector('.agent-task-list')).toBeTruthy();expect(host.querySelector('.agent-inspector')).toBeTruthy();
  await act(async()=>{callbacks.onEvent({sessionId:'s',sequence:1,eventId:'e1',runId:'r',type:'tool.started',payload:{toolCallId:'call',name:'read_file',arguments:{path:'AGENTS.md'}}});callbacks.onEvent({sessionId:'s',sequence:2,eventId:'e2',runId:'r',type:'tool.completed',payload:{toolCallId:'call',name:'read_file',result:{content:[]}}});await new Promise(r=>setTimeout(r,75));});expect(host.querySelectorAll('.agent-tool')).toHaveLength(1);expect(host.querySelector('.agent-tool').textContent).toContain('完成');
  await act(async()=>host.querySelector('.agent-file').click());const frame=host.querySelector('iframe');expect(frame.getAttribute('sandbox')).toBe('allow-scripts');expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');expect(frame.srcdoc).toContain('parent.evil');expect(window.evil).toBeUndefined();
});
it('shows snapshot experts in one avatar dropdown and opens collaboration without sending',async()=>{
  API.fetchAgentRun.mockResolvedValue({data:{id:'r',status:'running',manifest:{experts:[{id:'law',name:'法务审查专家'},{id:'review',name:'明察'}],instructions:[]},children:[]}});
  API.sendTask=vi.fn();
  await act(async()=>root.render(<AgentTask taskId="t"/>));
  const trigger=host.querySelector('.agent-task-expert-trigger');
  expect(trigger.textContent).toContain('法务审查专家 · 明察');expect(trigger.textContent).toContain('等2人');
  expect(trigger.querySelectorAll('.agent-task-expert-avatar')).toHaveLength(2);
  await act(async()=>trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect([...host.querySelectorAll('.agent-task-expert-option')].map(item=>item.textContent)).toEqual(['法法务审查专家可协作','明明察可协作']);
  await act(async()=>host.querySelector('.agent-task-expert-option').click());
  expect(host.querySelector('.agent-task-expert-popover')).toBeNull();
  expect(host.querySelector('.agent-inspector-tabs .selected').textContent).toBe('专家');
  expect(host.querySelector('.agent-inspector-content').textContent).toContain('本轮尚未委派专家');
  expect(API.sendTask).not.toHaveBeenCalled();
});
it('shows actual collaboration status and keeps latest experts when inspecting an older round',async()=>{
  const task={id:'t',projectId:'p',title:'资料分析',sessionId:'s'},runs=[{id:'old',status:'completed'},{id:'r',status:'completed'}];
  API.fetchTask.mockResolvedValue({data:{task,session:{id:'s'},runs,events:[{sessionId:'s',sequence:1,eventId:'delegation',runId:'r',type:'expert.delegated',payload:{runId:'law-child',expertId:'law',name:'法律法规专家'}}],cursor:1}});
  API.fetchAgentRun.mockImplementation(async(task,id)=>({data:{id,status:'completed',manifest:{experts:[{id:id==='r'?'law':'finance',name:id==='r'?'法律法规专家':'财务专家'}],instructions:[]},children:id==='r'?[{id:'law-child',status:'completed'}]:[]}}));
  API.fetchExpertRun=vi.fn(async()=>({data:{events:[]}}));
  await act(async()=>root.render(<AgentTask taskId="t"/>));
  await act(async()=>host.querySelector('.agent-task-expert-trigger').click());
  expect(host.querySelectorAll('.agent-task-expert-option')).toHaveLength(1);
  expect(host.querySelector('.agent-task-expert-option').textContent).toContain('已完成');
  await act(async()=>host.querySelector('.agent-task-expert-option').click());
  expect(API.fetchExpertRun).toHaveBeenCalledWith('t','law-child',expect.any(AbortSignal));
  await act(async()=>{const picker=host.querySelector('.agent-run-picker select');picker.value='old';picker.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host.querySelector('.agent-inspector-content').textContent).toContain('财务专家');
  expect(host.querySelector('.agent-task-expert-trigger').textContent).toContain('法律法规专家');
  expect(host.querySelector('.agent-task-expert-trigger').textContent).not.toContain('财务专家');
});
it('does not display project experts as participants when the frozen run has none',async()=>{
  API.fetchAgentRun.mockResolvedValue({data:{id:'r',status:'completed',manifest:{experts:[],instructions:[]},children:[]}});
  API.fetchProjectDetail.mockResolvedValue({data:{project:{id:'p',name:'项目',agents:[{id:'draft',name:'新增专家'}]}}});
  await act(async()=>root.render(<AgentTask taskId="t"/>));
  const trigger=host.querySelector('.agent-task-expert-trigger');expect(trigger.disabled).toBe(true);expect(trigger.textContent).toBe('暂无任务专家');
  expect(host.querySelector('.agent-composer').textContent).not.toContain('新增专家');
});
it('shares an embedded conversation, preserves the hub heading, and keeps SSE alive when an inspector read fails',async()=>{
  document.getElementById('topbar-crumb').textContent='工作台';
  API.fetchProjectArtifacts.mockRejectedValueOnce(Error('成果暂不可用'));
  const snapshot=vi.fn();
  await act(async()=>root.render(<AgentTask taskId="t" embedded onSnapshot={snapshot}/>));
  expect(host.querySelector('.agent-task-list')).toBeNull();expect(host.querySelector('.agent-inspector')).toBeNull();
  expect(host.querySelector('.agent-conversation')).toBeTruthy();expect(document.getElementById('topbar-crumb').textContent).toBe('工作台');
  expect(API.subscribeTask).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('成果暂不可用');
  expect(API.fetchProjectTasks).not.toHaveBeenCalled();expect(snapshot).toHaveBeenCalled();
});
it('opens a newly imported fixed-version artifact even before it appears in the project list',async()=>{
  API.fetchArtifact=vi.fn(async()=>({data:{id:'imported',version:1,name:'回传.json',mediaType:'application/json',size:2}}));
  await act(async()=>root.render(<AgentTask taskId="t" embedded/>));
  await act(async()=>{callbacks.onEvent({sessionId:'s',sequence:1,eventId:'m',runId:'r',type:'message.completed',payload:{messageId:'answer',role:'assistant',content:'[预览](artifact://imported/1)'}});await new Promise(r=>setTimeout(r,60));});
  const anchor=host.querySelector('[data-artifact-id="imported"]');
  await act(async()=>root.render(<AgentTask taskId="t" embedded draftRequest={{content:'继续跟踪'}}/>));
  expect(host.querySelector('[data-artifact-id="imported"]')).toBe(anchor);
  await act(async()=>host.querySelector('[data-artifact-id="imported"]').click());
  expect(API.fetchArtifact).toHaveBeenCalledWith('p','imported',1,expect.any(AbortSignal));
  expect(host.querySelector('[role="dialog"]').textContent).toContain('回传.json');
});
it('names a new commander question in its existing task and preserves its context before sending once',async()=>{
  const task={id:'t',projectId:'p',sessionId:'s',title:'指挥官问答',context:{entry:'commander',keep:'source'}};
  API.fetchTask.mockResolvedValue({data:{task,session:{id:'s'},runs:[],events:[],cursor:0}});
  API.editTask=vi.fn(async(id,body)=>({data:{task:{...task,...body}}})); API.sendTask=vi.fn(async()=>({data:{id:'r'}}));
  API.fetchTaskRuns=vi.fn(async()=>({data:{items:[{id:'r',status:'completed'}]}}));
  await act(async()=>root.render(<AgentTask taskId="t" embedded conversationLabel="指挥官问答" draftRequest={{content:'哪个工作台消耗最多？'}}/>));
  await act(async()=>host.querySelector('[aria-label="发送消息"]').click());
  expect(API.editTask).toHaveBeenCalledWith('t',{title:'哪个工作台消耗最多？',context:{entry:'commander',keep:'source'}});
  expect(API.sendTask).toHaveBeenCalledTimes(1);expect(API.sendTask.mock.calls[0][0]).toBe('t');
  expect(host.querySelector('.agent-conversation-head strong').textContent).toBe('哪个工作台消耗最多？');
});
