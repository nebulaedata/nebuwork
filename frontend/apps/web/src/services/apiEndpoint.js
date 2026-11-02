// Business paths stay /api/...; the environment and Java module prefixes live here.
export const DEFAULT_API_BASE_PATH = '/nebulaedev/nwaa';

export function apiEndpoint(path, base = DEFAULT_API_BASE_PATH) {
  return (base || DEFAULT_API_BASE_PATH).replace(/\/+$/, '') + path;
}
