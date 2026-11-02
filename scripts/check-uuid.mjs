import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const helpers = [
  'frontend/apps/web/src/lib/uuid.js',
  'workflow/v3.5.0/frontend/src/uuid.js',
  'agent-core/v2.0.0/src/uuid.js',
  'deploy/dev/uuid.mjs',
];
const sources = await Promise.all(helpers.map(file => readFile(path.join(root, file), 'utf8')));
for (const source of sources) assert.equal(source, sources[0], 'Standalone UUID helpers must stay in sync');
assert.equal(
  await readFile(path.join(root, 'frontend/apps/web/tooling/secure-uuid.mjs'), 'utf8'),
  await readFile(path.join(root, 'workflow/v3.5.0/frontend/tooling/secure-uuid.mjs'), 'utf8'),
  'Browser dependency transforms must stay in sync',
);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const source = sources[0].replace('export ', '') + '\ncreateUuid;';
// No secure-context-only Crypto methods are exposed in this sandbox.
const createUuid = vm.runInNewContext(source, { crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) } });
const generated = new Set(Array.from({ length: 10000 }, () => createUuid()));
assert.equal(generated.size, 10000);
for (const value of generated) assert.match(value, uuidPattern);
for (const byte of [0, 255]) {
  const fixed = vm.runInNewContext(source, { crypto: { getRandomValues: bytes => bytes.fill(byte) } });
  assert.equal(fixed(), byte === 0 ? '00000000-0000-4000-8000-000000000000' : 'ffffffff-ffff-4fff-bfff-ffffffffffff');
}
const unavailable = vm.runInNewContext(source, { crypto: {} });
assert.throws(() => unavailable(), /getRandomValues/, 'Never fall back to a weak random source');
for (const name of ['host.js', 'page-sdk.js']) {
  const script = await readFile(path.join(root, 'backend/java/src/main/resources/workbench-service', name), 'utf8');
  assert.ok(script.includes(sources[0].replace('export ', '').trim().split('\n').map(line => '  ' + line).join('\n')), `${name}: embedded UUID helper differs`);
}

// Scan maintained JS/TS sources, including development scripts and tests.
const forbidden = new RegExp('\\b' + ['random', 'UUID'].join('') + '\\b');
async function scan(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (['node_modules', '.venv', 'dist', 'build', 'target', '.git', '.qa'].includes(entry.name)) continue;
    const relative = path.posix.join(directory, entry.name);
    if (relative === 'workflow/v3.5.0/nebulae/web') continue; // Generated third-party bundles.
    if (entry.isDirectory()) await scan(relative);
    else if (/\.(?:[cm]?js|jsx|tsx?|html)$/.test(entry.name)) {
      assert.ok(!forbidden.test(await readFile(path.join(root, relative), 'utf8')), `Unsupported UUID API in ${relative}`);
    }
  }
}
for (const directory of ['frontend', 'backend', 'agent-core', 'workflow', 'deploy', 'scripts']) await scan(directory);
if (process.argv.includes('--bundles')) {
  const method = ['random', 'UUID'].join('');
  const nativeAccess = new RegExp('\\bcrypto\\s*(?:(?:\\?\\.|\\.)\\s*' + method + '\\b|\\[\\s*[\'\"]' + method + '[\'\"]\\s*\\])');
  async function scanBundle(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scanBundle(file);
      else if (/\.[cm]?js$/.test(entry.name)) assert.ok(!nativeAccess.test(await readFile(file, 'utf8')), `Unsupported browser UUID API in ${file}`);
    }
  }
  for (const directory of ['frontend/apps/web/dist/client', 'workflow/v3.5.0/nebulae/web']) await scanBundle(path.join(root, directory));
  console.log('Browser bundles passed, including PDF/PPT previews and editor workers.');
}
console.log('UUID verification passed: HTTP-compatible randomness, v4 format, uniqueness, standalone copies and maintained source scan.');
