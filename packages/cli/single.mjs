// ── [PCODE-222 | S15 | v0.1.0] T20.4 Marketplace listings prepared: single-file orq, release assembly, VS Code, container image and Helm listings ──
//    Why:  people get the command line as one file, orq.mjs: Node.js 22 runs it, nothing to install. One
//          esbuild call (a development tool, never shipped) bundles the CLI with the shared code inlined; the
//          only imports left are Node's own modules. The source map lets the licence gate prove what is in it.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = process.argv[2] ?? here('./dist-single/orq.mjs');
const version = JSON.parse(readFileSync(here('./package.json'), 'utf8')).version;

const r = await build({
  entryPoints: [here('./src/main.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'inline',
  alias: { '@orqiva/shared': here('../shared/src/index.ts') },
  banner: { js: '// Orqiva command line ' + version + ', one file: node orq.mjs --help' },
  metafile: true,
  logLevel: 'warning',
});
const external = Object.values(r.metafile.outputs)
  .flatMap((o) => o.imports)
  .filter((i) => i.external && !i.path.startsWith('node:'));
if (external.length) {
  console.error('orq.mjs would need: ' + external.map((i) => i.path).join(', '));
  process.exit(1);
}
console.log('orq.mjs ' + version + ' -> ' + out);
