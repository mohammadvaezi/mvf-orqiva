// ── [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use ──
//    Why:  Serves packages/web/dist (build it first) with an SPA fallback on 127.0.0.1:8732, so /preview routes load.
//    Run:  npm run build -w @orqiva/web; node deploy/site/tools/serve-preview.mjs (keep it running), then
//          node deploy/site/tools/serve-preview.mjs [names…]. Needs playwright-core (npm i --no-save playwright-core)
//          and its cached Chromium and ffmpeg (npx playwright install chromium ffmpeg). Not part of the build.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = 'C:\\Broszio Apps\\planecode\\packages\\web\\dist';
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(
    /^([/\\])+/,
    '',
  );
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory())
    file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(8732, '127.0.0.1', () => console.log('web on http://127.0.0.1:8732'));
