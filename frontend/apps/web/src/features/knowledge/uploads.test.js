import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openKnowledgeUpload, openUploadTasks, loadUploadTargets, knowledgeUploads } from './uploads.js';
import { renderKnowledgeScope, renderKnowledgeCatalog } from './views.js';
import { renderLibraryDetail } from './management.js';
import { openKnowledgeBrowser } from './browser.js';

const auth = vi.hoisted(() => ({ version: 1, listeners: new Set() }));
vi.mock('../../services/authSession.js', () => ({ authSession: {
  getSnapshot: () => ({ version: auth.version, status: 'authenticated' }),
  subscribe: fn => { auth.listeners.add(fn); return () => auth.listeners.delete(fn); },
} }));
vi.mock('../../shared/configSelect.jsx', () => ({ mountConfigSelect: (node, props) => {
  let value = props.value, options = props.options || [];
  const select = document.createElement('select'); select.setAttribute('aria-label', props.label); node.append(select);
  const paint = () => { select.replaceChildren(new Option('请选择', '')); options.forEach(o => select.add(new Option(o.label, o.value))); select.value = value ?? ''; };
  select.onchange = () => { value = select.value || undefined; props.onChange?.(value); }; paint();
  return { getValue: () => value, setValue: v => { value = v; paint(); }, setOptions: v => { options = v; paint(); }, setDisabled: v => { select.disabled = v; }, destroy: () => select.remove() };
} }));
let dom, host, api, cleanup;
const connection = { id: 'c', name: '统一连接', enabled: true, capabilities: ['manage', 'upload'] };
const collection = { id: 'doc', name: '文档知识库', type: 'document', canManage: true };
const ref = { connectionId: 'c', collectionId: 'doc', enabled: true, id: 'ref', name: '文档知识库' };
const scope = kind => ({ kind, id: 'owner', revision: 1, knowledgeBases: [ref], connections: [connection] });
const ok = data => ({ data, code: 0 });
beforeEach(() => {
  auth.version++; auth.listeners.forEach(fn => fn()); cleanup = null;
  dom = new JSDOM('<main></main><div id="modal-mask"><div id="modal-box"></div></div>', { url: 'http://localhost/#/agents' });
  for (const key of ['window', 'document', 'location', 'MutationObserver', 'Option']) vi.stubGlobal(key, key === 'window' ? dom.window : dom.window[key]);
  host = document.querySelector('main'); vi.stubGlobal('ICON', () => '');
  vi.stubGlobal('UI', {
    modal: (_title, html, mount) => { cleanup?.(); cleanup = null; const box = document.querySelector('#modal-box'); box.innerHTML = '<div class="modal-body">' + html + '</div>'; mount(box); },
    setModalCleanup: fn => { cleanup = fn; }, closeModal: () => { cleanup?.(); cleanup = null; document.querySelector('#modal-box').innerHTML = ''; }, toast: vi.fn(),
  });
  api = {
    fetchKnowledgeCollections: vi.fn(async () => ok({ collections: [collection] })),
    fetchKnowledgeScope: vi.fn(async () => ok(scope('expert'))), fetchKnowledgeConnections: vi.fn(async () => ok([connection])),
    uploadKnowledgeFile: vi.fn(async () => ok({ outcome: 'accepted', operationId: 'receipt', result: { data: { parse_status: 'pending' } } })),
    manageKnowledge: vi.fn(async (_id, input) => ok({ result: input.operation === 'kb.get' ? { id: 'doc', name: '文档知识库', type: 'document' } : { data: [], total: 0 } })),
  };
  vi.stubGlobal('API', api);
});
afterEach(() => {
  cleanup?.(); host.knowledgeCleanup?.(); host.querySelectorAll('*').forEach(e => e.knowledgeCleanup?.());
  auth.version++; auth.listeners.forEach(fn => fn()); dom.window.close(); vi.unstubAllGlobals();
});

describe('shared upload entrypoints', () => {
  it.each(['expert', 'workbench'])('opens the shared picker from %s knowledge', async kind => {
    api.fetchKnowledgeScope.mockResolvedValue(ok(scope(kind)));
    await renderKnowledgeScope(host, { kind, id: 'owner' });
    expect(host.querySelector('[data-upload-folder]')).not.toBeNull(); host.querySelector('[data-upload-files]').click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="上传目标知识库"]').value).toBe('0'));
    expect(document.querySelector('#modal-box [data-upload-files]').multiple).toBe(true);
    expect(document.querySelector('#modal-box [data-upload-folder]').hasAttribute('webkitdirectory')).toBe(true);
  });
  it('shows settings list shortcuts only for writable non-FAQ collections', async () => {
    api.fetchKnowledgeCollections.mockResolvedValue(ok({ collections: [collection, { ...collection, id: 'faq', type: 'faq' }, { ...collection, id: 'reader', canManage: false }] }));
    await renderKnowledgeCatalog(host);
    expect(host.querySelectorAll('[data-upload-files]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-upload-folder]')).toHaveLength(1);
    host.querySelector('[data-upload-folder]').click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="上传目标知识库"]').value).toBe('0'));
  });
  it('provides both upload actions in library details and displays stored source paths', async () => {
    api.manageKnowledge.mockImplementation(async (_id, input) => ok({ result: input.operation === 'kb.get' ? { name: '文档知识库', type: 'document' } : { data: [{ id: 'a', title: 'a.md', file_name: 'a.md', folder_path: '公司/制度', parse_status: 'completed' }], total: 1 } }));
    await renderLibraryDetail(host, 'c', 'doc');
    expect(host.querySelector('[data-upload]')).not.toBeNull(); expect(host.querySelector('[data-upload-folder]')).not.toBeNull();
    expect(host.textContent).toContain('公司/制度/a.md');
  });
  it('restricts upload targets to owned, supported, bound libraries', async () => {
    api.fetchKnowledgeCollections.mockResolvedValue(ok({ collections: [collection, { ...collection, id: 'unbound' }, { ...collection, id: 'faq', type: 'faq' }, { ...collection, id: 'reader', canManage: false }] }));
    const value = scope('workbench'); value.knowledgeBases.push({ ...ref, collectionId: 'faq' }, { ...ref, collectionId: 'reader' });
    expect((await loadUploadTargets({ scope: value }, api)).targets.map(t => t.collectionId)).toEqual(['doc']);
    expect((await loadUploadTargets({ scope: { ...value, knowledgeBases: [] } }, api)).targets).toEqual([]);
  });
  it('retains valid targets when an independent connection fails', async () => {
    api.fetchKnowledgeCollections.mockImplementation(async id => { if (id === 'bad') throw new Error('连接不可用'); return ok({ collections: [collection] }); });
    const value = scope('expert'); value.knowledgeBases.push({ ...ref, connectionId: 'bad' });
    const result = await loadUploadTargets({ scope: value }, api);
    expect(result.targets).toHaveLength(1); expect(result.errors).toEqual(['连接不可用']);
  });
  it('previews validation and removes invalid files before enabling submission', async () => {
    openKnowledgeUpload({ target: ref });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="上传目标知识库"]').value).toBe('0'));
    const input = document.querySelector('[data-upload-files]');
    Object.defineProperty(input, 'files', { value: [new File(['正文'], 'a.md'), new File([], 'empty.md')] });
    input.dispatchEvent(new dom.window.Event('change'));
    expect(document.querySelector('[data-upload-summary]').textContent).toContain('2 个文件');
    expect(document.querySelector('[data-upload-start]').disabled).toBe(true);
    document.querySelector('[data-remove-file="1"]').click();
    expect(document.querySelector('[data-upload-start]').disabled).toBe(false); expect(api.uploadKnowledgeFile).not.toHaveBeenCalled();
  });
  it('enables folder upload for the large ZIP shown in the reported case', async () => {
    openKnowledgeUpload({ target: ref, folder: true });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="上传目标知识库"]').value).toBe('0'));
    const zip=new File(['fixture'],'法律法规原文.zip');Object.defineProperty(zip,'size',{value:768*1024*1024});
    const input=document.querySelector('[data-upload-folder]');Object.defineProperty(input,'files',{value:[zip]});input.dispatchEvent(new dom.window.Event('change'));
    expect(document.querySelector('[data-upload-start]').disabled).toBe(false);expect(document.querySelector('[data-upload-summary]').textContent).toContain('768.0 MiB');
    expect(document.querySelector('#modal-box').textContent).toContain('单文件最多 2 GiB');expect(document.querySelector('#modal-box').textContent).not.toContain('超过 100 MiB');
  });
  it('continues after closing and navigating, and reopens the same queue', async () => {
    let finish; api.uploadKnowledgeFile.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    openKnowledgeUpload({ target: ref });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="上传目标知识库"]').value).toBe('0'));
    const input = document.querySelector('[data-upload-files]'), nested = new File(['正文'], 'a.md');
    Object.defineProperty(nested, 'webkitRelativePath', { value: '根/部门/a.md' });
    Object.defineProperty(input, 'files', { value: [nested] }); input.dispatchEvent(new dom.window.Event('change'));
    document.querySelector('[data-upload-start]').click();
    expect(api.uploadKnowledgeFile).toHaveBeenCalledTimes(1);
    UI.closeModal(); location.hash = '#/settings'; await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.uploadKnowledgeFile.mock.calls[0][2].aborted).toBe(false);
    finish(ok({ outcome: 'accepted', operationId: 'receipt', result: { data: { parse_status: 'pending' } } }));
    await vi.waitFor(() => expect(knowledgeUploads.getSnapshot()[0].items[0].status).toBe('accepted'));
    openUploadTasks(); expect(document.querySelector('[data-upload-batches]').textContent).toContain('根/部门/a.md');
    expect(document.querySelector('[data-upload-batches]').textContent).toContain('等待解析');
  });
  it('opens read-only browsing through a page without copying source paths into navigation', () => {
    openKnowledgeBrowser({...ref,scopeKind:'workbench',scopeId:'w',folderPath:'<img>/部门'},vi.fn());
    const query=new URLSearchParams(location.hash.split('?')[1]);
    expect(query.get('reference')).toBe(ref.id);expect(query.get('scope')).toBe('w');expect(location.hash).not.toContain('folderPath');expect(document.querySelector('[data-documents-list]')).toBeNull();
  });
});
