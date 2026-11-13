// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  one source, two unpacked extensions: dist/chrome and dist/firefox, each with its manifest,
//          the bundled scripts (classic scripts: content scripts and pages cannot be modules everywhere),
//          the pages, the style sheet and the icon.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
const ENTRIES = ['background', 'content', 'page', 'popup', 'options', 'record'];
const STATIC = ['popup.html', 'options.html', 'record.html', 'capture.css'];

rmSync(join(here, 'dist'), { recursive: true, force: true });
const manifestModule = join(here, 'dist', '.manifest.mjs');
await build({
  entryPoints: [join(here, 'src/lib/manifest.ts')],
  outfile: manifestModule,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
});
const { manifestFor } = await import(pathToFileURL(manifestModule).href);

for (const browser of ['chrome', 'firefox']) {
  const out = join(here, 'dist', browser);
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(ENTRIES.map((e) => [e, join(here, 'src', e + '.ts')])),
    outdir: out,
    bundle: true,
    format: 'iife',
    target: ['chrome111', 'firefox128'],
    minify: false,
    logLevel: 'warning',
  });
  for (const f of STATIC) copyFileSync(join(here, 'static', f), join(out, f));
  copyFileSync(join(here, '../extension/media/icon.png'), join(out, 'icon.png'));
  writeFileSync(
    join(out, 'manifest.json'),
    JSON.stringify(manifestFor(browser, version), null, 2) + '\n',
  );
}
rmSync(manifestModule, { force: true });
console.log('capture ' + version + ': dist/chrome and dist/firefox');
