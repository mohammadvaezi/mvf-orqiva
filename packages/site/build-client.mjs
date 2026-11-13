// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
//    Why:  the landing page's script in one minified file (esbuild is a development tool, never shipped).
//          src/main.ts picks it up from dist/client/ and the site build names it by its content.
import { build } from 'esbuild';

await build({
  entryPoints: ['client/landing.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  outfile: 'dist/client/landing.js',
});
