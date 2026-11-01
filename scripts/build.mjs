import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/assets', { recursive: true });
mkdirSync('dist', { recursive: true });
copyFileSync('src/web/styles.css', 'public/assets/app.css');

await build({
  entryPoints: ['src/web/main.ts'], bundle: true, minify: true, sourcemap: false, format: 'esm', target: 'es2022',
  outfile: 'public/assets/app.js', legalComments: 'none', logLevel: 'info',
});
await build({
  entryPoints: ['src/server/main.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: 'dist/server.mjs', external: ['node:*'], sourcemap: false, logLevel: 'info',
});
console.log('Build concluído: public/assets/ e dist/server.mjs');
