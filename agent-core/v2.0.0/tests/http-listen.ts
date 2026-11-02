import type { Server } from 'node:http';
// Windows may allocate one of Fetch's forbidden ports to listen(0).
const forbidden = new Set([1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
export async function listenHttp(server: Server): Promise<string> {
  for (;;) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    if (!forbidden.has(port)) return 'http://127.0.0.1:' + port;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
