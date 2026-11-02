// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { projectPublishedServices, projectServiceLinks } from './projectServicesModel.js';

const cap = (key, projects, channels) => ({ key, projectIds: projects, channels });
const release = { id: 'active', version: 2, definition: {
  capabilities: [cap('common', ['project', 'other'], { api: true, mcp: true, page: true }), cap('private', ['other'], { api: true, mcp: true, page: true }), cap('pageOnly', ['project'], { page: true }), cap('closed', ['project'], { api: false, mcp: false, page: false })],
  pages: [
    { key: 'scoped', projectIds: ['project'], capabilities: [] },
    { key: 'otherPage', projectIds: ['other'], capabilities: [] },
    { key: 'legacy', capabilities: ['common'] },
    { key: 'mixed', capabilities: ['common', 'private'] },
    { key: 'legacyStatic', capabilities: [] },
    { key: 'closedPage', capabilities: ['closed'] },
    { key: 'missing', capabilities: ['removed'] },
  ],
} };
const service = { activeReleaseId: 'active', enabled: true, available: true, draft: { pages: [{ key: 'draft' }] } };
it('shows only the active formal release and the current project’s permitted channels', () => {
  const result = projectPublishedServices(service, [{ id: 'newer' }, release], 'project');
  expect(result.pages.map(p => p.key)).toEqual(['scoped', 'legacy', 'legacyStatic']);
  expect(result.api.map(c => c.key)).toEqual(['common']);
  expect(result.mcp.map(c => c.key)).toEqual(['common']);
  expect(result.release.version).toBe(2);
});
it('does not treat drafts, previews, history or disabled services as active publications', () => {
  expect(projectPublishedServices({ ...service, activeReleaseId: null }, [release], 'project').status).toBe('empty');
  expect(projectPublishedServices({ ...service, enabled: false }, [release], 'project').status).toBe('disabled');
  expect(() => projectPublishedServices(service, [{ ...release, preview: true }], 'project')).toThrow('当前发布版本');
  expect(() => projectPublishedServices(service, [{ ...release, id: 'history' }], 'project')).toThrow('当前发布版本');
});
it('keeps runtime availability distinct from publication', () => {
  const result = projectPublishedServices({ ...service, available: false }, [release], 'project');
  expect(result.status).toBe('published'); expect(result.available).toBe(false); expect(result.pages).not.toHaveLength(0);
});
it('preserves the gateway prefix and encodes project/page/release parameters', () => {
  const links = projectServiceLinks({ serviceUrl: (wb, suffix) => '/nebulaedev/nwaa/api/workbench-services/' + encodeURIComponent(wb) + '/' + suffix }, 'wb /', 'p /&', 'release /');
  expect(new URL(links.page('page /')).pathname).toBe('/nebulaedev/nwaa/api/workbench-services/wb%20%2F/pages/page%20%2F');
  expect(new URL(links.page('page /')).searchParams.get('projectId')).toBe('p /&');
  expect(new URL(links.docs).searchParams.get('releaseId')).toBe('release /');
  expect(links.invoke('read /')).toMatch(/\/capabilities\/read%20%2F\/invoke$/);
  expect(links.mcp).toMatch(/\/mcp$/);
});
