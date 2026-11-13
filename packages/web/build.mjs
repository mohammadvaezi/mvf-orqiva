// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
// ── [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-113 | S15 | v0.1.0] Rebuild the web app shell: sidebar, top bar, page layout, design refresh ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
//    Why:  our own build script: one esbuild call (a development tool, never shipped) and index.html.
//          dist/ is what the server will serve. main.css comes out next to main.js.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { png, SVG } from './icons.mjs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.tsx'],
  jsx: 'automatic',
  // [PCODE-90 | S15 | v0.1.0] React's production build: no development checks in what ships
  define: { 'process.env.NODE_ENV': '"production"' },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  conditions: ['source'],
  outfile: 'dist/main.js',
});
// [PCODE-113 | S15 | v0.1.0] every build names its files by their content (?v=…), so a browser that
// cached the last version fetches the new one at once after an upgrade
const version = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
const html = readFileSync('src/index.html', 'utf8')
  .replace('href="/main.css"', 'href="/main.css?v=' + version('dist/main.css') + '"')
  .replace('src="/main.js"', 'src="/main.js?v=' + version('dist/main.js') + '"');
writeFileSync('dist/index.html', html);

// [PCODE-151 | S15 | v0.1.0] the installable app: icons, the manifest, and a service worker that keeps
// exactly this release's shell
writeFileSync('dist/icon.svg', SVG);
writeFileSync('dist/icon-192.png', png(192));
writeFileSync('dist/icon-512.png', png(512));
writeFileSync('dist/icon-maskable-512.png', png(512, true));
writeFileSync('dist/apple-touch-icon.png', png(180, true));
writeFileSync(
  'dist/manifest.webmanifest',
  JSON.stringify(
    {
      name: 'Orqiva',
      short_name: 'Orqiva',
      description: 'The engineering command center',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#4b3fce',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    null,
    2,
  ) + '\n',
);
// [PCODE-356 | S15 | v0.1.0] the German dictionary, loaded by who reads German, kept in the shell for offline use
mkdirSync('dist/i18n', { recursive: true });
writeFileSync('dist/i18n/de.json', readFileSync('src/i18n/de.json'));
const shell = [
  '/',
  '/i18n/de.json',
  '/main.js?v=' + version('dist/main.js'),
  '/main.css?v=' + version('dist/main.css'),
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
];
await build({
  entryPoints: ['src/sw.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: {
    SHELL: JSON.stringify(shell),
    RELEASE: JSON.stringify(version('dist/index.html')),
  },
  outfile: 'dist/sw.js',
  // [PCODE-215 | S15 | v0.1.0] the licence gate proves what a bundle holds from its source map
  sourcemap: true,
});
console.log('web: dist/ built');
