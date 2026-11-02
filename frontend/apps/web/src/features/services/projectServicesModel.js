/** Project visibility follows the formal release's page/capability authorization. */
export function projectPublishedServices(service, releases, projectId) {
  if (!service.activeReleaseId) return { status: 'empty' };
  if (!service.enabled) return { status: 'disabled' };
  const release = releases.find(r => r.id === service.activeReleaseId && !r.preview);
  if (!release?.definition) throw new Error('当前发布版本暂不可用，请刷新重试。');
  const definition = release.definition, capabilities = definition.capabilities || [];
  const authorized = c => c.projectIds?.includes(projectId);
  const pages = (definition.pages || []).filter(page =>
    (!page.projectIds || page.projectIds.includes(projectId)) &&
    (page.capabilities || []).every(key => capabilities.some(c => c.key === key && authorized(c) && c.channels?.page === true)));
  return {
    status: 'published', available: service.available === true, release,
    pages, api: capabilities.filter(c => authorized(c) && c.channels?.api === true),
    mcp: capabilities.filter(c => authorized(c) && c.channels?.mcp === true),
  };
}

export function projectServiceLinks(api, workbenchId, projectId, releaseId) {
  const absolute = suffix => new URL(api.serviceUrl(workbenchId, suffix), window.location.href).href;
  return {
    page: key => absolute('pages/' + encodeURIComponent(key)) + '?projectId=' + encodeURIComponent(projectId),
    invoke: key => absolute('capabilities/' + encodeURIComponent(key) + '/invoke'),
    docs: absolute('openapi.json') + '?releaseId=' + encodeURIComponent(releaseId),
    mcp: absolute('mcp'),
  };
}
