import { describe, expect, it } from 'vitest';
import { apiEndpoint } from './apiEndpoint.js';
import { createExpertApi } from './expertApi.js';

describe('gateway URLs', () => {
  it('routes login, expert configuration and streaming paths through the same module prefix', () => {
    for (const path of ['/api/agents', '/api/health', '/api/agents/a1', '/api/projects/p1/runs/r1/events']) {
      expect(apiEndpoint(path)).toBe('/nebulaedev/nwaa' + path);
    }
    expect(apiEndpoint('/api/agents', '')).toBe('/nebulaedev/nwaa/api/agents');
  });

  it('supports an environment override without duplicate separators', () => {
    expect(apiEndpoint('/api/agents', '/nebulaetest/nwaa/')).toBe('/nebulaetest/nwaa/api/agents');
    expect(apiEndpoint('/api/agents', 'https://gateway.example/nebulaedev/nwaa/'))
      .toBe('https://gateway.example/nebulaedev/nwaa/api/agents');
  });

  it('uses the gateway prefix for attachment links as well as JSON requests', async () => {
    const requests = [];
    const api = createExpertApi(async path => {
      requests.push(apiEndpoint(path));
      return { code: 0, data: [] };
    }, {}, apiEndpoint);
    await api.fetchAgents();
    expect(requests).toEqual(['/nebulaedev/nwaa/api/agents']);
    expect(api.sopMaterialUrl('a1', 'sop1', 'material/1'))
      .toBe('/nebulaedev/nwaa/api/agents/a1/sop-sets/sop1/materials/material%2F1/content');
  });
});
