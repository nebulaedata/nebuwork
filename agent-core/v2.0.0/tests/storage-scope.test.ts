import { afterEach, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { Objects } from '../src/objects.js';
import { hash } from '../src/contracts.js';
import { testConfig } from './fixture.js';

afterEach(() => vi.unstubAllEnvs());

it('isolates deployments and accounts inside a shared bucket', () => {
  const primary = new Objects({...testConfig, S3_PREFIX: 'nebu-agent-engine'});
  const otherDeployment = new Objects({...testConfig, S3_PREFIX: 'another-engine'});
  try {
    const key = primary.key('tenant', 'owner', hash('same content'));
    expect(key).toMatch(/^nebu-agent-engine\//);
    expect(() => primary.authorize('tenant', 'owner', key)).not.toThrow();
    expect(() => primary.authorize('another-tenant', 'owner', key)).toThrow('资源不属于当前账号');
    expect(() => primary.authorize('tenant', 'another-owner', key)).toThrow('资源不属于当前账号');
    expect(() => otherDeployment.authorize('tenant', 'owner', key)).toThrow('资源不属于当前账号');
    expect(() => primary.authorize('tenant', 'owner', key.replace('nebu-agent-engine/', ''))).toThrow();
  } finally {primary.client.destroy(); otherDeployment.client.destroy();}
});

it('normalizes directory prefixes and rejects ambiguous shared-service namespaces', () => {
  for (const [key, value] of Object.entries(testConfig)) vi.stubEnv(key, String(value));
  vi.stubEnv('S3_PREFIX', 'engine/dev/');
  expect(config().S3_PREFIX).toBe('engine/dev');
  for (const prefix of ['../business', '/business', 'a//b', 'a\\b', 'a/../b']) {
    vi.stubEnv('S3_PREFIX', prefix);
    expect(() => config()).toThrow();
  }
  vi.stubEnv('S3_PREFIX', '');
  vi.stubEnv('REDIS_CHANNEL_PREFIX', '*');
  expect(() => config()).toThrow();
});
