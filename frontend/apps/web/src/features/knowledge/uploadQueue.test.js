import { describe, expect, it, vi } from 'vitest';
import { createUploadQueue, MAX_UPLOAD_SIZE, validateUpload } from './uploadQueue.js';

const file = (name = '资料.md', path = '', content = '正文') => {
  const value = new File([content], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
};
const target = { connectionId: 'connection', collectionId: 'library', name: '制度' };
const accepted = { data: { outcome: 'accepted', operationId: 'receipt', result: { data: { parse_status: 'pending' } } } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(upload = vi.fn(async () => accepted)) {
  let version = 1, id = 0; const listeners = new Set();
  const session = { getSnapshot: () => ({ version, status: 'authenticated' }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const queue = createUploadQueue({ session, upload, makeId: () => 'id-' + ++id });
  return { queue, upload, switchAccount: () => { version++; listeners.forEach(fn => fn()); } };
}

describe('upload validation', () => {
  it('accepts nested Chinese paths, files above 100 MiB and exactly 2 GiB', () => {
    expect(validateUpload(file('制度.md', '公司/部门/制度.md'))).toBe('');
    expect(validateUpload({ name: 'large.pdf', size: MAX_UPLOAD_SIZE })).toBe('');
    expect(validateUpload({ name: '法律法规原文.zip', size: 768 * 1024 * 1024 })).toBe('');
    expect(validateUpload({ name: 'large.pdf', size: 100 * 1024 * 1024 + 1 })).toBe('');
    expect(validateUpload(file('a.md', Array(16).fill('目录').join('/') + '/a.md'))).toBe('');
  });
  it.each(['/etc/a.md', 'C:/资料/a.md', '../a.md', '资料/../a.md', '资料//a.md', '资料./a.md', '资料 /a.md', 'a\n/a.md', 'a/other.md', Array(17).fill('a').join('/') + '/a.md', '中'.repeat(43) + '/a.md', Array(9).fill('a'.repeat(128)).join('/') + '/a.md'])('rejects unsafe or truncated paths: %s', path => {
    expect(validateUpload(file('a.md', path))).not.toBe('');
  });
  it('rejects empty, oversized and header-injection filenames', () => {
    expect(validateUpload(file('empty.md', '', ''))).not.toBe('');
    expect(validateUpload({ name: 'large.pdf', size: MAX_UPLOAD_SIZE + 1 })).not.toBe('');
    expect(validateUpload(file('a".md'))).not.toBe('');
    expect(validateUpload(file('a\r\n.md'))).not.toBe('');
  });
});

describe('session upload queue', () => {
  it('serializes files, preserves source paths and uses distinct stable keys', async () => {
    const first = deferred(), { queue, upload } = fixture(vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(accepted));
    queue.enqueue(target, [file('a.md', '根/一/a.md'), file('a.md', '根/二/a.md', '第二份')]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot()[0].items.map(i => i.status)).toEqual(['uploading', 'queued']);
    const form = upload.mock.calls[0][1];
    expect(form.get('relativePath')).toBe('根/一/a.md'); expect(form.get('fileName')).toBe('a.md');
    expect(queue.getSnapshot()[0].items[0]).not.toHaveProperty('file');
    first.resolve(accepted);
    await vi.waitFor(() => expect(queue.getSnapshot()[0].items.map(i => i.status)).toEqual(['accepted', 'accepted']));
    expect(upload.mock.calls[1][1].get('relativePath')).toBe('根/二/a.md');
    expect(upload.mock.calls[0][1].get('requestKey')).not.toBe(upload.mock.calls[1][1].get('requestKey'));
    expect(queue.getSnapshot()[0].items[0].parseStatus).toBe('pending'); queue.dispose();
  });
  it('continues after rejection and timeout, without retrying uncertain writes', async () => {
    const upload = vi.fn().mockRejectedValueOnce(Object.assign(new Error('格式不支持'), { status: 422 })).mockRejectedValueOnce(Object.assign(new Error('超时'), { status: 504 })).mockResolvedValueOnce({ data: { outcome: 'duplicate', operationId: 'existing' } });
    const { queue } = fixture(upload);
    queue.enqueue(target, [file('a.md'), file('b.md'), file('c.md')]);
    await vi.waitFor(() => expect(queue.getSnapshot()[0].items.map(i => i.status)).toEqual(['failed', 'unknown', 'duplicate']));
    expect(upload).toHaveBeenCalledTimes(3); queue.dispose();
  });
  it('stops every queued file for an unavailable target while allowing another library', async () => {
    const first = deferred(), { queue, upload } = fixture(vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(accepted));
    queue.enqueue(target, [file(), file('b.md')]); queue.enqueue(target, [file('c.md')]);
    queue.enqueue({ ...target, collectionId: 'other' }, [file('d.md')]);
    first.reject(Object.assign(new Error('权限已撤销'), { status: 404 }));
    await vi.waitFor(() => expect(queue.getSnapshot()[2].items[0].status).toBe('accepted'));
    expect(queue.getSnapshot().flatMap(b => b.items.map(i => i.status))).toEqual(['failed', 'cancelled', 'cancelled', 'accepted']);
    expect(upload).toHaveBeenCalledTimes(2); queue.dispose();
  });
  it('stops only the remainder and leaves the in-flight receipt intact', async () => {
    const first = deferred(), { queue, upload } = fixture(vi.fn(() => first.promise));
    const batch = queue.enqueue(target, [file(), file('b.md')]); queue.stop(batch);
    expect(upload.mock.calls[0][2].aborted).toBe(false);
    first.resolve(accepted);
    await vi.waitFor(() => expect(queue.getSnapshot()[0].items.map(i => i.status)).toEqual(['accepted', 'cancelled']));
    expect(upload).toHaveBeenCalledTimes(1); queue.clearFinished(); expect(queue.getSnapshot()).toEqual([]); queue.dispose();
  });
  it('clears and aborts on account change, accepts new work and ignores late old responses', async () => {
    const old = deferred(), current = deferred(), { queue, upload, switchAccount } = fixture(vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise));
    queue.enqueue(target, [file(), file('old.md')]); switchAccount();
    expect(upload.mock.calls[0][2].aborted).toBe(true); expect(queue.getSnapshot()).toEqual([]);
    queue.enqueue({ ...target, name: '新账号' }, [file('new.md')]); expect(upload).toHaveBeenCalledTimes(2);
    old.resolve(accepted); await Promise.resolve();
    expect(queue.getSnapshot()[0].items[0].status).toBe('uploading');
    current.resolve(accepted); await vi.waitFor(() => expect(queue.getSnapshot()[0].items[0].status).toBe('accepted'));
    expect(queue.getSnapshot()[0].target.name).toBe('新账号'); expect(upload).toHaveBeenCalledTimes(2); queue.dispose();
  });
  it('validates before enqueuing or sending anything', () => {
    const { queue, upload } = fixture(); expect(() => queue.enqueue(target, [file('empty.md', '', '')])).toThrow('不能为空');
    expect(upload).not.toHaveBeenCalled(); expect(queue.getSnapshot()).toEqual([]); queue.dispose();
  });
});
