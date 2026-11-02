/** Supplied by NebuWork's authenticated HTML bridge; absent in standalone mode. */
export type Integration = { apiBase: string; uiBase: string; admin: boolean; canCreate: boolean; connectionId: string };
declare global { interface Window { __NEBUWORK_V101__?: Integration } }
export const integration = window.__NEBUWORK_V101__;
export function resourceURL(path: string) {
  if (!integration) return path;
  if (path.startsWith("/api/v1/")) return integration.apiBase + path.slice(7);
  if (path.startsWith("/pdfjs/")) return integration.uiBase + path;
  if (/^\/(documents|knowledge-bases|qa|extractions)(\/|\?|$)/.test(path)) return integration.uiBase + path;
  return path;
}
export const apiURL = (path: string) => integration
  ? integration.apiBase + (path.startsWith("/health") ? "/system/status" : path)
  : path.startsWith("/health") ? path : "/api/v1" + path;
export const appPath = () => (integration ? location.pathname.slice(integration.uiBase.length) : location.pathname) + location.search;
export const appURL = (path: string) => integration && !path.startsWith(integration.uiBase) ? integration.uiBase + path : path;
const sessions = new Map<string, string>();
// Integrated uploads keep filenames and content out of browser persistent storage.
export const uploadSessions = integration ? {
  getItem: (key: string) => sessions.get(key) || null,
  setItem: (key: string, value: string) => { sessions.set(key, value); },
  removeItem: (key: string) => { sessions.delete(key); },
} : localStorage;
