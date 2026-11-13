// ── [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site ──
// ── [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) ──
//    Why:  `npm run build -w @orqiva/site` after the other packages: the CLI's help and the server's route
//          list come from their built code (the server's routes are listed without a database), so the
//          references show exactly what ships. Exits 1 when a page or link is broken.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLATFORM_VERSION, PRODUCT_NAME } from '@orqiva/shared';
import { buildSite } from './build.js';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const out = resolve(process.argv[2] ?? resolve(root, 'out/site'));
const load = (path: string): Promise<Record<string, unknown>> =>
  import(pathToFileURL(resolve(root, path)).href) as Promise<Record<string, unknown>>;

const cli = await load('packages/cli/dist/run.js');
const help = (await (cli['run'] as (argv: string[]) => Promise<{ out: string }>)(['--help'])).out;
const app = await load('packages/server/dist/app.js');
const openapi = await load('packages/server/dist/http/openapi.js');
const routes = (app['buildRoutes'] as (auth: unknown) => unknown[])({
  pool: undefined,
  secureCookies: false,
});
const doc = (
  openapi['openApiDocument'] as (
    r: unknown[],
    info: { title: string; version: string },
  ) => Record<string, unknown>
)(routes, { title: PRODUCT_NAME + ' API', version: PLATFORM_VERSION });

// [PCODE-219 | S15 | v0.1.0] the vendor's buy page, set for a release build
const buyUrl = process.env['ORQIVA_BUY_URL'];
// [PCODE-443 | S15 | v0.1.0] the landing script from build-client.mjs, and the footage in media/
const site = resolve(root, 'packages/site');
const scriptPath = resolve(site, 'dist/client/landing.js');
const mediaDir = resolve(site, 'media');
const media = new Map<string, Buffer>();
if (existsSync(mediaDir))
  for (const name of readdirSync(mediaDir))
    if (/\.(mp4|webm|jpg|webp|png)$/.test(name))
      media.set(name, readFileSync(resolve(mediaDir, name)));
const r = buildSite({
  root,
  out,
  version: PLATFORM_VERSION,
  cliHelp: help,
  openapi: doc,
  ...(buyUrl ? { buyUrl } : {}),
  landing: { script: existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '', media },
});
if (!buyUrl)
  process.stdout.write('site: ORQIVA_BUY_URL is not set; the pricing page has no buy buttons\n');
for (const e of r.errors) process.stderr.write('site: ' + e + '\n');
process.stdout.write(
  'Site: ' +
    String(r.pages.length) +
    ' pages, ' +
    String(Math.round(r.bytes / 1024)) +
    ' KB in ' +
    out +
    (r.errors.length ? ' (' + String(r.errors.length) + ' broken)' : '') +
    '\n',
);
process.exitCode = r.errors.length ? 1 : 0;
