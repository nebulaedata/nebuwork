import React, { useEffect, useRef, useState } from 'react';
import { Checkbox, ConfigProvider, Dropdown, Input, Modal, Select } from 'antd';
import { FileText, FolderUp, KeyRound, Plug, Plus, Puzzle, Sparkles } from 'lucide-react';
import { selectTheme } from '../../shared/workbenchSelect.jsx';
import './runtimeExtensions.css';
import { MarketInstallDialog } from './MarketInstallDialog.jsx';
import { runtimeScopeHref } from '../../services/extensionMarketApi.js';

const skillFiles = (files, skill) => {
  const directory = skill.directory.replace(/\/+$/, '');
  return files.filter(file => !directory || file.path.startsWith(directory + '/'));
};
const fileSize = size => Number.isFinite(size) ? `${(size / 1024).toFixed(1)} KB` : '大小未知';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function useExtensionTheme() {
  const [theme, setTheme] = useState(selectTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(selectTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);
  return { ...theme, token: { ...theme.token, controlHeight: 40 }, components: {
    ...theme.components, Select: { ...theme.components?.Select, zIndexPopup: 2050 }
  } };
}

function CredentialDialog({ busy, error, onCreate, onClose }) {
  const [label, setLabel] = useState(''), [raw, setRaw] = useState(''), [validation, setValidation] = useState('');
  async function submit(event) {
    event.preventDefault();
    try {
      if (!label.trim()) throw Error('请填写凭据名称');
      const secret = JSON.parse(raw);
      if (!secret || Array.isArray(secret) || typeof secret !== 'object') throw Error('凭据必须是 JSON 对象');
      setValidation('');
      if (await onCreate(label.trim(), secret)) onClose();
    } catch (failure) { setValidation(failure.message); }
  }
  return <Modal open title="新增加密凭据" footer={null} onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy} className="runtime-extension-dialog" destroyOnHidden>
    <form className="runtime-extension-form" onSubmit={submit}>
      <label htmlFor="extension-credential-label">凭据名称<Input id="extension-credential-label" required value={label} disabled={busy} onChange={e => setLabel(e.target.value)}/></label>
      <label htmlFor="extension-credential-secret">凭据 JSON<Input.TextArea id="extension-credential-secret" required rows={6} value={raw} disabled={busy} onChange={e => setRaw(e.target.value)} autoComplete="off" spellCheck={false}/></label>
      <p className="runtime-extension-help">HTTP 使用 headers，容器命令使用 env。凭据加密保存，列表只显示名称。</p>
      {(validation || error) && <p className="runtime-extension-error" role="alert">{validation || error}</p>}
      <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy}>{busy ? '保存中…' : '保存凭据'}</button></footer>
    </form>
  </Modal>;
}

function EntryDialog({ entry, doc, credentials, busy, error, onApply, onCreateCredential, onClose }) {
  const [value, setValue] = useState(() => structuredClone(entry.value)), [removed, setRemoved] = useState([]);
  const [validation, setValidation] = useState(''), [credentialOpen, setCredentialOpen] = useState(false);
  const isSkill = entry.type === 'skills', isNew = entry.index === null;
  const update = patch => setValue(previous => ({ ...previous, ...patch }));
  const files = isSkill ? skillFiles(doc.files, value) : [];
  function submit(event) {
    event.preventDefault();
    let next = { ...value };
    if (isSkill) {
      next.name = (next.name || '').trim(); next.description = (next.description || '').trim();
      if (!next.name || !next.description) { setValidation('请填写技能名称和描述'); return; }
      next.revision = String(Date.now());
    } else {
      next.id = (next.id || '').trim();
      if (!next.id || doc.mcp.some((item, index) => index !== entry.index && item.id === next.id)) { setValidation('服务 ID 不能为空或与已有 MCP 重复'); return; }
      if (next.id.toLowerCase() === 'nebuwork') { setValidation('nebuwork 是系统 MCP 的保留标识，请使用其他服务 ID'); return; }
      if (next.transport === 'http') {
        next.url = (next.url || '').trim();
        try { if (!['http:', 'https:'].includes(new URL(next.url).protocol)) throw Error(); }
        catch { setValidation('请输入有效的 HTTP 或 HTTPS 服务地址'); return; }
      } else {
        next.command = (next.command || '').trim();
        if (!next.command) { setValidation('请填写容器内执行的命令'); return; }
      }
    }
    const items = [...doc[entry.type]];
    if (isNew) items.push(next); else items[entry.index] = next;
    onApply(entry.type, items, removed);
    onClose();
  }
  function changeTransport(transport) {
    const { url, command, args, ...rest } = value;
    setValue({ ...rest, transport, args: [], ...(transport === 'http' ? { url: '' } : { command: '' }) });
  }
  return <>
    <Modal open title={isSkill ? '配置 Skill' : isNew ? '添加 MCP' : '配置 MCP'} footer={null} onCancel={onClose} width={720} closable={!busy} maskClosable={!busy} keyboard={!busy} className="runtime-extension-dialog" destroyOnHidden>
      <form className="runtime-extension-form" onSubmit={submit}>
        {isSkill ? <>
          <label htmlFor="extension-skill-name">技能名称<Input id="extension-skill-name" required value={value.name} disabled={busy} onChange={e => update({ name: e.target.value })}/></label>
          <label htmlFor="extension-skill-description">技能描述<Input.TextArea id="extension-skill-description" required rows={3} value={value.description} disabled={busy} onChange={e => update({ description: e.target.value })}/></label>
          <label htmlFor="extension-skill-directory">技能目录<Input id="extension-skill-directory" readOnly value={value.directory}/></label>
          <Checkbox checked={Boolean(value.required)} disabled={busy} onChange={e => update({ required: e.target.checked })}>每轮执行前必须加载</Checkbox>
          <div className="runtime-extension-files"><h4>技能文件 <span>{files.length - removed.length}</span></h4>
            {files.filter(file => !removed.includes(file.path)).map(file => {
              const required = doc.skills.some(skill => file.path.toLowerCase() === `${skill.directory}/SKILL.md`.toLowerCase() || (skill.requiredFiles || []).some(path => file.path.toLowerCase() === `${skill.directory}/${path}`.toLowerCase()));
              return <div className="runtime-extension-file" key={file.path}><FileText size={15}/><code>{file.path}</code><small>{fileSize(file.size)}</small>{required ? <small>必需文件</small> : <button type="button" className="runtime-extension-action is-danger" disabled={busy} onClick={() => setRemoved(paths => [...paths, file.path])}>移除</button>}</div>;
            })}
            {!files.length && <p className="runtime-extension-help">技能目录中没有资源文件，请重新上传完整技能包。</p>}
          </div>
        </> : <>
          <div className="runtime-extension-grid">
            <label htmlFor="extension-mcp-id">服务 ID<Input id="extension-mcp-id" required value={value.id} disabled={busy} onChange={e => update({ id: e.target.value })}/></label>
            <label htmlFor="extension-mcp-transport">连接方式<Select id="extension-mcp-transport" value={value.transport} disabled={busy} onChange={changeTransport} options={[{ value: 'http', label: 'Streamable HTTP' }, { value: 'stdio', label: '任务容器内命令' }]}/></label>
          </div>
          <label htmlFor="extension-mcp-address">{value.transport === 'http' ? '服务地址' : '容器内命令'}<Input id="extension-mcp-address" required value={value.url || value.command || ''} disabled={busy} placeholder={value.transport === 'http' ? 'https://example.com/mcp' : '输入容器内可用的命令'} onChange={e => update({ [value.transport === 'http' ? 'url' : 'command']: e.target.value })}/></label>
          {value.transport === 'stdio' && <label htmlFor="extension-mcp-args">参数（每行一个）<Input.TextArea id="extension-mcp-args" rows={3} value={(value.args || []).join('\n')} disabled={busy} onChange={e => update({ args: e.target.value.split('\n').filter(Boolean) })}/></label>}
          <label htmlFor="extension-mcp-credential">凭据<Select id="extension-mcp-credential" value={value.credentialRef || ''} disabled={busy} onChange={credentialRef => { const next = { ...value }; if (credentialRef) next.credentialRef = credentialRef; else delete next.credentialRef; setValue(next); }} options={[{ value: '', label: '无需凭据' }, ...credentials.map(item => ({ value: item.id, label: item.label }))]}/></label>
          <div><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCredentialOpen(true)}><KeyRound size={14}/>新增加密凭据</button></div>
          <Checkbox checked={Boolean(value.required)} disabled={busy} onChange={e => update({ required: e.target.checked })}>此能力不可用时阻止执行</Checkbox>
        </>}
        <p className="runtime-extension-help">应用后加入当前草稿，保存并发布后对新一轮执行生效。</p>
        {(validation || error) && <p className="runtime-extension-error" role="alert">{validation || error}</p>}
        <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy}>应用更改</button></footer>
      </form>
    </Modal>
    {credentialOpen && <CredentialDialog busy={busy} error={error} onCreate={onCreateCredential} onClose={() => setCredentialOpen(false)}/>}
  </>;
}

function SkillUploadDialog({ busy, error, onUpload, onClose }) {
  const [files, setFiles] = useState([]), [prefix, setPrefix] = useState(''), [validation, setValidation] = useState('');
  const folder = useRef(null);
  async function submit(event) {
    event.preventDefault();
    if (!files.some(file => /(^|\/)SKILL\.md$/i.test(file.webkitRelativePath || file.name))) { setValidation('请选择包含 SKILL.md 的完整技能目录'); return; }
    setValidation('');
    if (await onUpload(files, prefix.trim())) onClose();
  }
  return <Modal open title="上传 Skill" footer={null} onCancel={onClose} width={680} closable={!busy} maskClosable={!busy} keyboard={!busy} className="runtime-extension-dialog" destroyOnHidden>
    <form className="runtime-extension-form" onSubmit={submit}>
      <p className="runtime-extension-help">选择包含 SKILL.md 的技能目录，脚本、参考文件和素材会一起保留。</p>
      <div className="runtime-extension-upload"><FolderUp size={28}/><strong>{files.length ? `已选择 ${files.length} 个文件` : '选择完整技能目录'}</strong><p>目录结构将原样保留</p><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => folder.current.click()}>{files.length ? '重新选择目录' : '选择目录'}</button><input hidden type="file" multiple webkitdirectory="" ref={folder} onChange={e => { setFiles([...e.target.files]); setValidation(''); e.target.value = ''; }}/></div>
      <label htmlFor="extension-upload-prefix">上传目录前缀<Input id="extension-upload-prefix" placeholder="可留空，例如 skills" value={prefix} disabled={busy} onChange={e => setPrefix(e.target.value)}/></label>
      {files.length > 0 && <div className="runtime-extension-upload-files">{files.map(file => <div key={file.webkitRelativePath || file.name}><FileText size={14}/><code>{file.webkitRelativePath || file.name}</code><small>{fileSize(file.size)}</small></div>)}</div>}
      {(validation || error) && <p className="runtime-extension-error" role="alert">{validation || error}</p>}
      <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || !files.length}>{busy ? '上传中…' : '上传并加入草稿'}</button></footer>
    </form>
  </Modal>;
}

export function RuntimeExtensions({ kind, id, doc, saved, credentials, busy, error, notice, onReplace, onSave, onReload, onUpload, onCreateCredential, embedded = false }) {
  const theme = useExtensionTheme();
  const [editor, setEditor] = useState(null), [uploadOpen, setUploadOpen] = useState(false), [removing, setRemoving] = useState(null);
  const [marketEditing, setMarketEditing] = useState(null), [marketOpen, setMarketOpen] = useState(false), [marketInitialId, setMarketInitialId] = useState(''), [marketSession, setMarketSession] = useState(null);
  useEffect(() => { setMarketOpen(false); setMarketSession(null); }, [kind, id]);
  const refs = doc.extensionRefs || [];
  const installed = (saved.extensions?.items || []).filter(item => item.inherited || refs.some(ref => ref.installationId === item.installationId));
  const ownIds = new Set(installed.filter(item => !item.inherited).map(item => item.extensionId));
  const marketRows = installed.filter(item => !item.inherited || !ownIds.has(item.extensionId)).map(item => ({ type: 'market', value: { ...item, required: item.inherited ? item.required : refs.find(ref => ref.installationId === item.installationId)?.required } }));
  const inheritedRows = (saved.extensions?.inheritedLocal || []).filter(item => !doc[item.type].some(value => value.id === item.value.id)).map(item => ({ ...item, inherited: true }));
  const rows = [...doc.skills.map((value, index) => ({ type: 'skills', value, index })), ...doc.mcp.map((value, index) => ({ type: 'mcp', value, index })), ...marketRows, ...inheritedRows];
  const dirty = !same(doc, saved.document), published = saved.published?.revision === saved.revision;
  function status(row) {
    if (row.inherited) return ['已继承', 'pill-info'];
    if (row.type === 'market') {
      if (row.value.inherited) return ['已继承', 'pill-info'];
      const ref = refs.find(item => item.installationId === row.value.installationId), prior = (saved.document.extensionRefs || []).find(item => item.installationId === row.value.installationId);
      const active = (saved.publishedExtensionRefs || []).find(item => item.installationId === row.value.installationId);
      return !same(ref, prior) ? ['未保存', 'pill-warning'] : same(ref, active) ? ['已发布', 'pill-success'] : ['待发布', 'pill-dim'];
    }
    const prior = saved.document[row.type].find(item => item.id === row.value.id);
    const changed = !same(prior, row.value) || row.type === 'skills' && !same(skillFiles(doc.files, row.value), skillFiles(saved.document.files, row.value));
    return changed ? ['未保存', 'pill-warning'] : published ? ['已发布', 'pill-success'] : ['待发布', 'pill-dim'];
  }
  function addMcp() {
    let number = doc.mcp.length + 1;
    while (doc.mcp.some(item => item.id === `mcp-${number}`)) number++;
    setEditor({ type: 'mcp', index: null, value: { id: `mcp-${number}`, transport: 'http', url: '', args: [], required: false } });
  }
  function apply(type, items, removed) {
    onReplace(type, items);
    if (removed.length) onReplace('files', doc.files.filter(file => !removed.includes(file.path)));
  }
  function openMarket(extensionId = '') { setMarketInitialId(extensionId); setMarketOpen(true); }
  return <ConfigProvider theme={theme}><section className="runtime-extensions" aria-label="能力扩展">
    <header className="runtime-extension-heading"><div><h3>能力扩展 <span className="pill pill-dim">{rows.length}</span></h3><p>管理 Skills 与 MCP 服务，市场扩展固定版本使用</p></div>
      <Dropdown trigger={['click']} menu={{ items: [...(saved.extensions?.enabled ? [{ key: 'market', label: '从市场安装', icon: <Puzzle size={15}/> }] : []), { key: 'skill', label: '上传 Skill', icon: <Sparkles size={15}/> }, { key: 'mcp', label: '添加 MCP', icon: <Plug size={15}/> }], onClick: ({ key }) => { if (key === 'market') openMarket(); else if (key === 'skill') setUploadOpen(true); else addMcp(); } }} disabled={busy}><button className="btn btn-primary" disabled={busy}><Plus size={15}/>添加扩展</button></Dropdown>
    </header>
    {error && <p className="runtime-extension-error runtime-extension-banner" role="alert">{error}</p>}
    {marketSession && !marketOpen && <p className="runtime-extension-notice runtime-extension-banner">有待核对的扩展安装。<button className="runtime-extension-action" disabled={busy} onClick={() => setMarketOpen(true)}>查看安装进度</button></p>}
    {notice && <p className="runtime-extension-notice runtime-extension-banner" role="status">{notice}</p>}
    {kind === 'expert' && <p className="runtime-extension-help">执行时合并工作台、当前专家和项目的扩展，同一市场条目由项目优先覆盖。实际生效内容以该轮执行快照为准。</p>}
    <div className="card runtime-extension-list"><div className="runtime-extension-scroll" role="region" aria-label="Skills 与 MCP 列表" tabIndex={0}>
      <table className="table runtime-extension-table"><thead><tr><th scope="col">扩展名称</th><th scope="col">类型</th><th scope="col">来源</th><th scope="col">状态</th><th scope="col">调用方式</th><th scope="col">操作</th></tr></thead>
        <tbody>{rows.map(row => {
          const isMarket = row.type === 'market', isSkill = row.type === 'skills' || isMarket && row.value.kind === 'skill', item = row.value, [label, tone] = status(row);
          const name = (isMarket || isSkill ? item.name : item.id) || (isSkill ? '未命名 Skill' : '未命名 MCP');
          const description = isMarket ? item.description : isSkill ? item.description || item.directory : item.url || [item.command, ...(item.args || [])].join(' ');
          return <tr key={isMarket ? item.installationId + ':' + item.inherited : `${row.type}:${item.id}:${row.index}`}>
            <td data-label="扩展名称"><div className="runtime-extension-name"><span className={`runtime-extension-icon ${isSkill ? 'is-skill' : 'is-mcp'}`}>{isSkill ? <Sparkles size={17}/> : <Plug size={17}/>}</span><div><strong title={name}>{name}</strong><p title={description}>{description || '暂无说明'}</p></div></div></td>
            <td data-label="类型"><span className={`pill ${isSkill ? 'pill-primary' : 'pill-info'}`}>{isSkill ? 'Skill' : 'MCP'}</span></td>
            <td data-label="来源"><span className="runtime-extension-source">{isMarket ? `扩展市场 · v${item.version}${item.inherited ? ' · 工作台继承' : ''}` : row.inherited ? '工作台继承' : '本地配置'}</span></td>
            <td data-label="状态"><span className={`pill ${tone}`}>{label}</span></td>
            <td data-label="调用方式"><div className="runtime-extension-call">{isSkill ? item.required ? '每轮加载' : '按需加载' : item.transport === 'http' ? 'Streamable HTTP' : isMarket ? '独立 MCP 容器' : '任务容器内命令'}<small>{isMarket ? item.kind === 'mcp' ? '管理员统一认证' : `${item.fileCount || 0} 个技能文件` : isSkill ? `${skillFiles(row.files || doc.files, item).length} 个技能文件` : item.required ? '必需能力' : '可选能力'}</small></div></td>
            <td data-label="操作"><div className="runtime-extension-actions">{isMarket && item.inherited || row.inherited ? <a className="runtime-extension-action" href={runtimeScopeHref(isMarket ? item.sourceKind : row.sourceKind, isMarket ? item.sourceId : row.sourceId)}>管理来源</a> : <><button className="runtime-extension-action" disabled={busy} onClick={() => isMarket ? setMarketEditing({ ...item }) : setEditor(row)} aria-label={`配置 ${name}`}>配置</button><button className="runtime-extension-action is-danger" disabled={busy} onClick={() => setRemoving(row)} aria-label={`移除 ${name}`}>移除</button></>}</div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <div className="runtime-extension-empty"><Puzzle size={30}/><strong>暂无扩展</strong><p>添加 Skills 或 MCP，为专家补充业务能力。</p></div>}
    </div></div>
    {saved.extensions?.legacyReferences?.length > 0 && <div className="runtime-extension-banner"><strong>历史引用，未安装</strong><p className="runtime-extension-help">{saved.extensions.legacyReferences.map(item => item.name).join('、')}。历史绑定不包含可执行技能包或 MCP 连接，请从扩展市场重新安装。</p></div>}
    {!embedded && <footer className="runtime-extension-footer"><div><span className={dirty ? 'runtime-extension-unsaved' : ''}>{dirty ? '有未保存的更改' : published ? `已发布 v${saved.revision}` : `草稿 v${saved.revision} · 未发布`}</span><p>与设置中的运行配置一同发布，新一轮执行生效。</p></div><div className="runtime-extension-footer-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => onSave(false)}>保存草稿</button><button className="btn btn-primary" disabled={busy} onClick={() => onSave(true)}>{busy ? '处理中…' : '保存并发布资源'}</button></div></footer>}
    {editor && <EntryDialog key={`${editor.type}:${editor.index}`} entry={editor} doc={doc} credentials={credentials} busy={busy} error={error} onApply={apply} onCreateCredential={onCreateCredential} onClose={() => setEditor(null)}/>}
    {uploadOpen && <SkillUploadDialog busy={busy} error={error} onUpload={onUpload} onClose={() => setUploadOpen(false)}/>}
    {removing && <Modal open title="移除扩展" okText="移除" cancelText="取消" onCancel={() => setRemoving(null)} onOk={() => { if (removing.type === 'market') onReplace('extensionRefs', refs.filter(ref => ref.installationId !== removing.value.installationId)); else onReplace(removing.type, doc[removing.type].filter((_, index) => index !== removing.index)); setRemoving(null); }} okButtonProps={{ danger: true }} className="runtime-extension-dialog"><p className="runtime-extension-help">将「{removing.value.name || removing.value.id}」从运行资源草稿中移除，保存并发布后生效。当前执行继续使用原快照；上级存在同一扩展时恢复继承。</p></Modal>}
    {marketEditing && <Modal open title={`配置 ${marketEditing.name}`} footer={null} onCancel={() => setMarketEditing(null)} className="runtime-extension-dialog"><div className="runtime-extension-form"><p className="runtime-extension-help">扩展市场 · v{marketEditing.version}。连接、认证和完整技能包由管理员维护。</p><Checkbox checked={Boolean(marketEditing.required)} onChange={e => setMarketEditing(value => ({ ...value, required: e.target.checked }))}>{marketEditing.kind === 'skill' ? '每轮执行前必须加载' : '此能力不可用时阻止执行'}</Checkbox>{marketEditing.canUpgrade && <button className="btn btn-ghost" onClick={() => { const extensionId=marketEditing.extensionId; setMarketEditing(null); openMarket(extensionId); }}>选择升级版本</button>}<footer><button className="btn btn-ghost" onClick={() => setMarketEditing(null)}>取消</button><button className="btn btn-primary" onClick={() => { onReplace('extensionRefs', refs.map(ref => ref.installationId === marketEditing.installationId ? { ...ref, required: Boolean(marketEditing.required) } : ref)); setMarketEditing(null); }}>应用更改</button></footer></div></Modal>}
    {marketOpen && <MarketInstallDialog key={`${kind}:${id}`} kind={kind} id={id} saved={saved} references={refs} dirty={dirty} busy={busy} parentError={error} initialExtensionId={marketInitialId} session={marketSession} onSessionChange={setMarketSession} onSave={onSave} onReload={onReload} onClose={clear => { setMarketOpen(false); if(clear)setMarketSession(null); }}/>}
  </section></ConfigProvider>;
}
