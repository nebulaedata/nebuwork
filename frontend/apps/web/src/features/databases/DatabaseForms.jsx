import { createUuid } from '../../lib/uuid.js';
import React, { useEffect, useRef, useState } from 'react';
import { Checkbox, Input, Modal, Select } from 'antd';
import { Plus, Trash2, Upload } from 'lucide-react';
import { blankDatabase, databaseTypes, importTableDefinition } from './databaseModel.js';
import { useDatabaseLife } from './useDatabaseLife.js';

const options = values => values.map(value => ({ value, label: value }));
const fieldTypes = ['TEXT', 'VARCHAR', 'INTEGER', 'BIGINT', 'DECIMAL', 'REAL', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'JSON', 'BLOB'];
export function DatabaseConfigForm({ initial, creating = false, busy, error, onSave }) {
  const [value, setValue] = useState(() => ({ ...blankDatabase(initial?.type), ...initial, password: '', permissions: { ...blankDatabase(initial?.type).permissions, ...initial?.permissions } }));
  const change = patch => setValue(v => ({ ...v, ...patch }));
  function submit(publish) { const config = { ...value, permissions: { ...value.permissions, read: true } }; if (initial?.hasPassword && !config.password) delete config.password; onSave(config, publish); }
  return <form className="database-config-form" onSubmit={e => { e.preventDefault(); submit(true); }}>
    {error && <p role="alert" className="database-error">{error}</p>}
    <div className="database-form-grid">
      <label>数据库名称<input className="database-input" aria-label="数据库名称" required maxLength={240} value={value.name} onChange={e => change({ name: e.target.value })}/></label>
      <label>数据库类型<Select aria-label="数据库类型" disabled={!creating} value={value.type} options={Object.entries(databaseTypes).map(([v, label]) => ({ value: v, label }))} onChange={type => setValue(v => ({ ...blankDatabase(type), name: v.name, description: v.description }))}/></label>
      <label className="database-full">说明<textarea className="database-input" rows={2} maxLength={2400} value={value.description || ''} aria-label="数据库说明" onChange={e => change({ description: e.target.value })}/></label>
      {value.type !== 'sqlite' && <><label>主机<input className="database-input" aria-label="数据库主机" required value={value.host || ''} onChange={e => change({ host: e.target.value })} placeholder="数据库服务器地址"/></label>
        <label>端口<input className="database-input" aria-label="数据库端口" required type="number" min={1} max={65535} value={value.port} onChange={e => change({ port: Number(e.target.value) })}/></label>
        <label>库名<input className="database-input" aria-label="库名" required value={value.database || ''} onChange={e => change({ database: e.target.value })}/></label>
        {value.type === 'postgresql' && <label>Schema<input className="database-input" aria-label="数据库 Schema" required value={value.schema || 'public'} onChange={e => change({ schema: e.target.value })}/></label>}
        <label>账号<input className="database-input" aria-label="数据库账号" required autoComplete="off" value={value.username || ''} onChange={e => change({ username: e.target.value })}/></label>
        <label>密码<Input.Password aria-label="数据库密码" required={!initial?.hasPassword} autoComplete="new-password" value={value.password || ''} placeholder={initial?.hasPassword ? '已保存，留空保持' : '数据库密码'} onChange={e => change({ password: e.target.value })}/></label>
        <label>TLS<Select aria-label="数据库 TLS" value={value.tls} options={[{ value: 'verify-full', label: '验证证书和主机名' }, { value: 'disabled', label: '关闭 TLS' }]} onChange={tls => change({ tls })}/></label></>}
    </div>
    <fieldset className="database-permissions"><legend>智能体与页面权限</legend><Checkbox checked disabled>允许读取</Checkbox><Checkbox checked={value.permissions.write} onChange={e => change({ permissions: { ...value.permissions, write: e.target.checked } })}>允许数据写入</Checkbox><Checkbox checked={value.permissions.schema} onChange={e => change({ permissions: { ...value.permissions, schema: e.target.checked } })}>允许修改表结构</Checkbox></fieldset>
    <p className="database-muted">{value.type === 'sqlite' ? '创建独立 SQLite，数据会持续保存，可供所属范围内的任务使用。' : '密码加密保存在服务端。连接是否可用以实际测试结果为准。'}</p>
    <footer className="database-actions">{!creating && <button type="button" className="btn btn-ghost" disabled={busy || !value.name.trim()} onClick={() => submit(false)}>保存草稿</button>}<button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '处理中…' : creating ? value.type === 'sqlite' ? '创建数据库' : '保存连接并启用' : '保存并启用'}</button></footer>
  </form>;
}

export function CreateTableDialog({ open, busy, error, onClose, onSubmit }) {
  const [table, setTable] = useState(''), [columns, setColumns] = useState([{ name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true, nullable: false }]);
  const change = (index, patch) => setColumns(c => c.map((value, i) => i === index ? { ...value, ...patch } : value));
  return <Modal open={open} title="新建表" footer={null} onCancel={onClose} width={1000} className="database-dialog" destroyOnHidden><form className="database" onSubmit={e => { e.preventDefault(); onSubmit({ table, columns: columns.map(({ hasDefault, ...c }) => { if (!hasDefault) delete c.defaultValue; return c; }) }); }}>
    {error && <p className="database-error" role="alert">{error}</p>}<label className="database-field">表名<input className="database-input" required aria-label="新表名称" value={table} onChange={e => setTable(e.target.value)} placeholder="例如：analysis_results"/></label>
    <div className="database-fields-scroll"><table className="database-fields"><thead><tr><th>字段名</th><th>类型</th><th>主键</th><th>自增</th><th>允许空值</th><th>默认值</th><th/></tr></thead><tbody>{columns.map((c, i) => <tr key={i}>
      <td><input className="database-input" required aria-label={`字段 ${i + 1} 名称`} value={c.name} onChange={e => change(i, { name: e.target.value })}/></td>
      <td><Select aria-label={`字段 ${i + 1} 类型`} value={c.type} options={options(fieldTypes)} onChange={type => change(i, { type })}/></td>
      <td><Checkbox aria-label={`字段 ${i + 1} 主键`} checked={c.primaryKey} onChange={e => change(i, { primaryKey: e.target.checked, ...(e.target.checked ? { nullable: false } : { autoIncrement: false }) })}/></td>
      <td><Checkbox aria-label={`字段 ${i + 1} 自增`} checked={c.autoIncrement} onChange={e => change(i, { autoIncrement: e.target.checked, ...(e.target.checked ? { primaryKey: true, nullable: false, type: 'INTEGER' } : {}) })}/></td>
      <td><Checkbox aria-label={`字段 ${i + 1} 允许空值`} disabled={c.primaryKey} checked={c.nullable} onChange={e => change(i, { nullable: e.target.checked })}/></td>
      <td><div className="database-inline"><Checkbox aria-label={`字段 ${i + 1} 使用默认值`} checked={c.hasDefault} onChange={e => change(i, { hasDefault: e.target.checked, defaultValue: c.defaultValue || '' })}/><input className="database-input" aria-label={`字段 ${i + 1} 默认值`} disabled={!c.hasDefault} value={c.defaultValue || ''} onChange={e => change(i, { defaultValue: e.target.value })}/></div></td>
      <td><button type="button" className="btn-icon" aria-label={`移除字段 ${i + 1}`} disabled={columns.length === 1} onClick={() => setColumns(v => v.filter((_, n) => n !== i))}><Trash2 size={15}/></button></td>
    </tr>)}</tbody></table></div>
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setColumns(c => [...c, { name: 'column_' + (c.length + 1), type: 'TEXT', primaryKey: false, nullable: true, autoIncrement: false }])}><Plus size={14}/>添加字段</button>
    <footer className="database-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>取消</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '创建中…' : '创建表'}</button></footer>
  </form></Modal>;
}

export function DatabaseRowDialog({ mode, structure, row, busy, error, onClose, onSubmit }) {
  const columns = structure.columns.filter(c => !c.generated && !(mode === 'insert' && c.autoIncrement));
  const [values, setValues] = useState(() => mode === 'insert' ? {} : { ...row });
  const change = (name, value) => setValues(v => ({ ...v, [name]: value }));
  function submit() { const result = {}; for (const c of columns) { if (mode !== 'insert' && structure.keyColumns.includes(c.name)) continue; if (Object.hasOwn(values, c.name) && (mode === 'insert' || values[c.name] !== row[c.name])) result[c.name] = values[c.name]; } onSubmit(result); }
  return <Modal open title={mode === 'insert' ? '新增一行' : mode === 'delete' ? '删除这一行' : '编辑这一行'} footer={null} onCancel={onClose} className="database-dialog" destroyOnHidden><form className="database" onSubmit={e => { e.preventDefault(); submit(); }}>
    {error && <p role="alert" className="database-error">{error}</p>}
    {mode === 'delete' ? <p>删除表「{structure.name}」中唯一键为 {JSON.stringify(Object.fromEntries(structure.keyColumns.map(k => [k, row[k]])))} 的这一行。</p> : <><p className="database-muted">{mode === 'insert' ? '未填写的字段使用数据库默认值。空字符串和 NULL 分别保存。' : '唯一键用于定位，保存时会检查原数据是否已变化。'}</p><div className="database-row-fields">{columns.map(c => { const disabled = mode !== 'insert' && structure.keyColumns.includes(c.name), binary = row?.[c.name]?.type === 'binary'; return <div className="database-row-field" key={c.name}>
      <label>{c.name}<small>{c.type}{c.primaryKey ? ' · 主键' : ''}</small><input className="database-input" aria-label={`行字段 ${c.name}`} disabled={disabled || values[c.name] === null || binary} value={values[c.name] == null ? '' : String(values[c.name])} placeholder={mode === 'insert' ? c.defaultValue == null ? '未填写' : String(c.defaultValue) : ''} onChange={e => change(c.name, e.target.value)}/></label>
      <Checkbox checked={Object.hasOwn(values, c.name) && values[c.name] === null} disabled={disabled || !c.nullable || binary} onChange={e => change(c.name, e.target.checked ? null : '')}>NULL</Checkbox>{mode === 'insert' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues(v => { const next = { ...v }; delete next[c.name]; return next; })}>默认值</button>}
    </div>; })}</div></>}
    <footer className="database-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>取消</button><button type="submit" className={'btn ' + (mode === 'delete' ? 'database-danger' : 'btn-primary')} disabled={busy}>{busy ? '处理中…' : mode === 'delete' ? '删除这一行' : '保存数据'}</button></footer>
  </form></Modal>;
}

export function DatabaseImportDialog({ database, table, tables, busy: parentBusy, parentError, onClose, onSubmit }) {
  const life = useDatabaseLife('import:' + database.id), upload = useRef(null), keys = useRef(new Map()), sequence = useRef(0);
  const [mode, setMode] = useState('upload'), [projects, setProjects] = useState([]), [project, setProject] = useState(''), [artifacts, setArtifacts] = useState([]), [source, setSource] = useState(null);
  const [preview, setPreview] = useState(null), [sheet, setSheet] = useState(''), [sheetNames, setSheetNames] = useState([]), [encoding, setEncoding] = useState('UTF-8'), [mapping, setMapping] = useState([]), [target, setTarget] = useState(table || ''), [newTable, setNewTable] = useState(!table), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { API.fetchProjects().then(r => { if (life.live()) setProjects(r.data); }).catch(e => { if (life.live()) setError(e.message); }); }, [database.id, life.epoch]);
  async function act(fn) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { if (life.live()) setError(e.message); } finally { if (life.live()) setBusy(false); } }
  async function load(source, nextSheet = sheet, nextEncoding = encoding) {
    setSource(source); setPreview(null);
    const generation = ++sequence.current, result = await API.previewDatabaseImport(database.id, { source, sheet: nextSheet, encoding: nextEncoding }, life.signal()); if (!life.live() || generation !== sequence.current) return;
    setSource(result.data.source); setPreview(result.data); setMapping(result.data.columns.map((name, i) => ({ source: name, target: /^[\p{L}_][\p{L}\p{N}_]{0,62}$/u.test(name) ? name : 'column_' + (i + 1), type: 'text', emptyAsNull: false })));
    setSheetNames(result.data.sheets || []);if (result.data.sheets?.length && !nextSheet) setSheet(result.data.sheet || result.data.sheets[0]);
  }
  const updateMapping = (i, patch) => setMapping(m => m.map((f, n) => n === i ? { ...f, ...patch } : f));
  return <Modal open title="导入数据" footer={null} width={1000} onCancel={onClose} className="database-dialog" destroyOnHidden><div className="database">
    {(error || parentError) && <p className="database-error" role="alert">{error || parentError}</p>}<p className="database-muted">支持 CSV / XLSX，每批最多 20 MiB、10000 行。先固定源文件版本，再预览和导入。</p>
    <div className="database-toolbar"><Select aria-label="导入文件来源" value={mode} options={[{ value: 'upload', label: '上传文件' }, { value: 'artifact', label: '选择项目成果' }]} onChange={setMode}/>
      {mode === 'upload' ? <><button className="btn btn-ghost" disabled={busy || parentBusy} onClick={() => upload.current.click()}><Upload size={15}/>选择 CSV / XLSX</button><input hidden ref={upload} type="file" accept=".csv,.xlsx" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; act(async () => { setSheetNames([]); const signature = file.name + ':' + file.size + ':' + file.lastModified; if (!keys.current.has(signature)) keys.current.set(signature, createUuid()); const staged = await API.uploadDatabaseImport(database.id, file, life.signal(), keys.current.get(signature)); if (life.live()) { setSheet(''); await load(staged.data, ''); } }); }}/></> : <><Select aria-label="成果所属项目" placeholder="选择项目" value={project || undefined} showSearch optionFilterProp="label" options={projects.map(p => ({ value: p.id, label: p.name }))} disabled={busy} onChange={value => { setProject(value); setArtifacts([]); setSheetNames([]); setSource(null); setPreview(null); act(async () => { const result = await API.fetchProjectArtifacts(value, life.signal()); if (life.live()) setArtifacts(result.data.items.filter(f => /\.(csv|xlsx)$/i.test(f.name))); }); }}/><Select aria-label="导入成果文件" placeholder="选择文件及版本" disabled={busy} value={source?.artifactId} options={artifacts.map(a => ({ value: a.id, label: `${a.name} · v${a.version}` }))} onChange={value => { const file = artifacts.find(a => a.id === value); setSheetNames([]); setSheet(''); act(() => load({ projectId: project, artifactId: file.id, version: file.version, name: file.name }, '')); }}/></>}
    </div>
    {source && <p className="database-source">{source.name} · 固定版本 v{source.version}</p>}
    <div className="database-toolbar">{sheetNames.length > 0 && <label>工作表<Select aria-label="导入工作表" disabled={busy} value={sheet} options={options(sheetNames)} onChange={value => { setSheet(value); act(() => load(source, value)); }}/></label>}
      {source?.name?.toLowerCase().endsWith('.csv') && <label>CSV 编码<Select aria-label="CSV 编码" disabled={busy} value={encoding} options={options(['UTF-8', 'GB18030'])} onChange={value => { setEncoding(value); act(() => load(source, sheet, value)); }}/></label>}
    </div>
    {preview && <><div className="database-toolbar"><Checkbox disabled={!database.permissions.schema} checked={newTable} onChange={e => setNewTable(e.target.checked)}>新建表后导入</Checkbox>{newTable ? <input className="database-input" aria-label="导入目标新表" value={target} placeholder="新表名称" onChange={e => setTarget(e.target.value)}/> : <Select aria-label="导入目标表" value={target || undefined} options={tables.filter(t => t.type === 'table').map(t => ({ value: t.name, label: t.name }))} onChange={setTarget}/>}</div>
      <h4>字段映射与类型</h4><p className="database-muted">默认按文本导入，保留前导零。可明确选择数字或布尔类型。</p><div className="database-fields-scroll"><table className="database-fields"><thead><tr><th>源字段</th><th>目标字段</th><th>转换类型</th><th>空值规则</th></tr></thead><tbody>{mapping.map((m, i) => <tr key={m.source}><td>{m.source}</td><td><input className="database-input" aria-label={`映射 ${m.source} 目标字段`} value={m.target} onChange={e => updateMapping(i, { target: e.target.value })}/></td><td><Select aria-label={`映射 ${m.source} 类型`} value={m.type} options={[{ value: 'text', label: '文本' }, { value: 'number', label: '数字' }, { value: 'boolean', label: '布尔' }]} onChange={type => updateMapping(i, { type })}/></td><td><Checkbox checked={m.emptyAsNull} onChange={e => updateMapping(i, { emptyAsNull: e.target.checked })}>空单元格转 NULL</Checkbox></td></tr>)}</tbody></table></div>
      <h4>数据预览 · 共 {preview.rowCount} 行</h4><div className="database-preview-grid"><table className="database-fields"><thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{preview.rows.slice(0,10).map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
      {newTable && database.type === 'mysql' && <p className="database-muted">新建表会独立提交；数据导入失败时整批数据回滚，空表保留。</p>}
      <footer className="database-actions"><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || parentBusy || !target || !preview.rowCount || !mapping.length} onClick={() => act(async () => { const args = { source, sheet, encoding, table: target, mapping, ...(newTable ? { createTable: importTableDefinition(target, mapping) } : {}) }; await onSubmit(args); })}>{busy || parentBusy ? '处理中…' : `导入 ${preview.rowCount} 行数据`}</button></footer>
    </>}
  </div></Modal>;
}
