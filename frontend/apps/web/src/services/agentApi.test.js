import { describe, it, expect, vi } from 'vitest';
import { createAgentApi } from './agentApi.js';
function setup(){let version=1;const request=vi.fn(),auth={getSnapshot:()=>({version}),assertCurrent:v=>{if(v!==version)throw new DOMException('account changed','AbortError');}};return{request,api:createAgentApi(request,p=>'/gateway'+p,auth),switchAccount:()=>version++};}
describe('new agent HTTP boundary',()=>{
  it('routes engine configuration only through Java and rejects stale account responses', async () => {
    const { api, request, switchAccount } = setup(); request.mockResolvedValue({ data: { canEdit: true } });
    await api.engineSettingsRequest('/test', 'POST', { revision: 1 }, { key: 'configuration-check' });
    expect(request).toHaveBeenCalledWith('/api/agent-engine/settings/test', expect.objectContaining({ method: 'POST', headers: { 'Idempotency-Key': 'configuration-check' } }));
    await expect(api.engineSettingsRequest('http://engine')).rejects.toThrow('无效');
    let finish; request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = api.engineSettingsRequest(); switchAccount(); finish({ data: {} });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('retains the idempotency key across lost responses and clears it after success',async()=>{const{request,api}=setup();request.mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({data:{id:'r'}});await expect(api.sendTask('task',{content:'目标'})).rejects.toThrow('lost');await api.sendTask('task',{content:'目标'});expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(request.mock.calls[1][1].headers['Idempotency-Key']);await api.sendTask('task',{content:'目标'});expect(request.mock.calls[2][1].headers['Idempotency-Key']).not.toBe(request.mock.calls[1][1].headers['Idempotency-Key']);expect(request.mock.calls.every(([p,o])=>p==='/api/tasks/task/runs'&&o.method==='POST')).toBe(true);});
  it('rejects old account completions and starts a new request scope',async()=>{const{request,api,switchAccount}=setup();let resolve;request.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({data:{}});const pending=api.createTask('p',{title:'t'});switchAccount();resolve({data:{}});await expect(pending).rejects.toMatchObject({name:'AbortError'});await api.createTask('p',{title:'t'});expect(request.mock.calls[0][1].headers['Idempotency-Key']).not.toBe(request.mock.calls[1][1].headers['Idempotency-Key']);});
  it('keeps artifact references versioned and all commands on the Java gateway',async()=>{const{api,request}=setup();request.mockResolvedValue({data:{}});await api.commandRun('task','run',{type:'steer',content:'补充'});expect(request).toHaveBeenCalledWith('/api/tasks/task/runs/run/commands',expect.objectContaining({method:'POST',body:'{"type":"steer","content":"补充"}'}));expect(api.artifactUrl('project',{id:'file',version:2})).toBe('/gateway/api/projects/project/artifacts/file/content?version=2');});
});
