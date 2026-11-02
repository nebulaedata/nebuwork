import { fileURLToPath } from 'node:url';

// Keep third-party browser and worker bundles on the same portable UUID API.
/** @param {URL} helperUrl @returns {import('vite').Plugin} */
export function secureUuidPlugin(helperUrl) {
  const method = ['random', 'UUID'].join('');
  const property = (node, name) => node?.type === 'MemberExpression'
    && (node.computed ? node.property.value === name : node.property.name === name);
  const isCrypto = node => node?.type === 'Identifier' && node.name === 'crypto'
    || property(node, 'crypto') && node.object.type === 'Identifier'
      && ['globalThis', 'window', 'self'].includes(node.object.name);
  return {
    name: 'secure-byte-uuid',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes('/node_modules/') || !code.includes(method)) return null;
      const ranges = [];
      function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (property(node, method) && isCrypto(node.object)) {
          ranges.push([node.start, node.end]);
          return;
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') visit(value);
        }
      }
      visit(this.parse(code));
      if (!ranges.length) return null;
      let binding = '__nebuSecureUuid';
      while (code.includes(binding)) binding += '_';
      for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
        code = code.slice(0, start) + binding + code.slice(end);
      }
      const helper = JSON.stringify(fileURLToPath(helperUrl).replaceAll('\\', '/'));
      return { code: `import { createUuid as ${binding} } from ${helper};\n${code}`, map: null };
    },
  };
}
