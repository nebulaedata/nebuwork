/** Keep the database explorer out of ordinary expert/project navigation. */
export function mountDatabaseScope(host, props) {
  let disposed = false, cleanup;
  host.textContent = '正在读取数据库…';
  import('./DatabaseScope.jsx').then(module => { if (!disposed && host.isConnected) cleanup = module.mountDatabaseScope(host, props); }).catch(error => { if (!disposed && host.isConnected) host.textContent = '数据库界面加载失败：' + error.message; });
  return () => { disposed = true; cleanup?.(); };
}
