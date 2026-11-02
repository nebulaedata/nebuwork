import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require=createRequire(import.meta.url);
const root=dirname(require.resolve('pdfjs-dist/package.json'));
mkdirSync('public/pdfjs',{recursive:true});
for(const folder of ['cmaps','standard_fonts','wasm']) {
  const source=join(root,folder);
  if(existsSync(source)) cpSync(source,'public/pdfjs/'+folder,{recursive:true});
}
