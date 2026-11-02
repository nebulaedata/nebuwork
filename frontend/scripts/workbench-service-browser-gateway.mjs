import { createServer, request as proxy } from 'node:http';
// Disposable local acceptance gateway, never loaded by the application.
const server = createServer((req, res) => {
  if (req.url.startsWith('/nebulaedev/web/punterapi/')) {
    res.setHeader('content-type', 'application/json'); res.setHeader('set-cookie', 'token=alice-token; Path=/; SameSite=Lax');
    res.end(JSON.stringify({ status: 0, data: { userInfo: { punterId: 'alice', punterName: '隔离服务验收', nickName: '隔离服务验收' } } })); return;
  }
  if (!req.url.startsWith('/nebulaedev/nwaa/')) { res.writeHead(404); res.end(); return; }
  const upstream = proxy({ host: '127.0.0.1', port: 42024, path: req.url.slice('/nebulaedev'.length), method: req.method, headers: { ...req.headers, host: '127.0.0.1:42024', token: 'alice-token' } }, response => {
    res.writeHead(response.statusCode, { ...response.headers, 'set-cookie': 'token=alice-token; Path=/; SameSite=Lax' }); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('Isolated acceptance host unavailable'); }); req.pipe(upstream);
});
server.listen(42224, '127.0.0.1', () => process.stdout.write('Isolated workbench service gateway: 42224\n'));
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close());
