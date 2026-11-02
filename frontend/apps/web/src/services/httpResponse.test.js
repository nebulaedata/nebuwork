import { describe, it, expect } from 'vitest';
import { decodeHttpError } from './httpResponse.js';

describe('HTTP failure messages', () => {
  it('handles an empty proxy 500 without consuming its body twice', async () => {
    const error = await decodeHttpError(new Response('', { status: 500 }));
    expect(error.message).toBe('服务暂时不可用，请稍后重试');
    expect(error.status).toBe(500);
  });
  it('does not expose HTML proxy errors as UI markup', async () => {
    const error = await decodeHttpError(new Response('<html>gateway error</html>', { status: 502 }));
    expect(error.message).toBe('服务暂时不可用，请稍后重试');
  });
  it('preserves revision conflict detail', async () => {
    const error = await decodeHttpError(new Response(JSON.stringify({ msg: '请重新加载', detail: { revision: 2 } }), { status: 409 }));
    expect(error.message).toBe('请重新加载');
    expect(error.detail.revision).toBe(2);
  });
  it('returns a usable message for a non-JSON 404', async () => {
    expect((await decodeHttpError(new Response('Not found', { status: 404 }))).message).toContain('404');
  });
});
