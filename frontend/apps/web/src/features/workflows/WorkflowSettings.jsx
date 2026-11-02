import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Loading, key, useApi, useJob, useWatch } from './ui.jsx';

export function WorkflowSettings() {
  const { call } = useApi(), load = useWatch('/workflow/settings'), job = useJob();
  const [draft, setDraft] = useState(null), [secret, setSecret] = useState(''), attempt = useRef(null), password = useRef(null);
  useEffect(() => { if (load.data) { setDraft({ ...load.data, clearApiKey: false }); setSecret(''); attempt.current = null; } }, [load.data]);
  useEffect(() => () => { if (password.current) password.current.value = ''; }, []);
  if (!draft) return <Loading {...load} />;
  if (!draft.canEdit) return <section className="card wf-settings"><h2>Workflow 设置</h2><p>全系统 Workflow：{draft.enabled ? '已启用' : '未启用'}</p><p>仅指定管理员可以维护接入配置，各账号的工作流独立管理。</p><p className="dim">当前账号 ID：<code>{draft.actorId}</code></p><a className="btn btn-ghost" href="#/workflows">我的 Workflow</a></section>;
  const edit = change => { setDraft({ ...draft, ...change }); attempt.current = null; job.setError(''); job.setNote(''); };
  const body = () => ({ revision: draft.revision, enabled: draft.enabled, baseUrl: draft.baseUrl.trim(), apiKey: secret, clearApiKey: draft.clearApiKey, requestTimeoutMs: Number(draft.requestTimeoutMs) });
  const save = () => job.run(async () => {
    attempt.current ||= key();
    const saved = await call('/workflow/settings', 'POST', body(), { key: attempt.current });
    setDraft({ ...saved, clearApiKey: false }); setSecret(''); attempt.current = null; job.setNote('配置已保存，后续请求使用新配置。');
  });
  return <section className="card wf-settings"><h2>Workflow 设置</h2><p className="dim">管理员统一配置 3.5 服务，各账号的工作流及运行记录独立隔离。服务密钥只保存在后端。</p>
    <p className="dim">{draft.configured ? '正在使用页面保存的配置' : '尚未保存页面配置，当前使用部署默认值'}</p>
    <form autoComplete="off" onSubmit={event => { event.preventDefault(); save(); }}><fieldset disabled={job.busy}>
      <label className="wf-toggle"><input type="checkbox" checked={draft.enabled} onChange={e => edit({ enabled: e.target.checked })} />启用 Workflow 接入</label>
      <div className="wf-settings-grid">
        <label>服务地址<input type="url" required maxLength={2048} readOnly={draft.originLocked} value={draft.baseUrl} placeholder="http://127.0.0.1:8765" onChange={e => edit({ baseUrl: e.target.value })} /><small>{draft.originLocked ? '已有工作流记录，地址已固定；更换服务需要先迁移数据。' : '填写 3.5 服务根地址，跨机器部署需开启其远程接入模式。'}</small></label>
        <label>访问密钥<input ref={password} type="password" maxLength={8192} autoComplete="new-password" disabled={draft.clearApiKey} value={secret} placeholder={draft.hasApiKey ? '已保存，留空保留' : '远程服务需要访问密钥'} onChange={e => { setSecret(e.target.value); attempt.current = null; job.setNote(''); }} /><small>填写 NEBULAE_SERVICE_API_KEY 对应的服务密钥。</small></label>
        <label>请求超时（毫秒）<input type="number" required min="1000" max="60000" step="1" value={draft.requestTimeoutMs} onChange={e => edit({ requestTimeoutMs: e.target.value })} /><small>默认 15000，范围 1000–60000。</small></label>
      </div>
      <label className="wf-toggle"><input type="checkbox" disabled={!draft.hasApiKey} checked={draft.clearApiKey} onChange={e => { edit({ clearApiKey: e.target.checked }); if (e.target.checked) setSecret(''); }} />清除已保存的访问密钥</label>
      <div className="wf-actions wf-footer"><Button type="button" onClick={() => job.run(async () => { const result = await call('/workflow/settings/test', 'POST', body()); job.setNote(`${result.message}（${result.latencyMs} 毫秒）`); })}>测试连接</Button><Button primary type="submit">保存配置</Button><Button type="button" onClick={load.reload}>重新加载（放弃修改）</Button></div>
    </fieldset></form><Notice error={job.error || load.error} /><p role="status">{job.note}</p>
  </section>;
}
