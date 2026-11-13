// ── [PCODE-222 | S15 | v0.1.0] T20.4 Marketplace listings prepared: single-file orq, release assembly, VS Code, container image and Helm listings ──
//    Why:  one command puts together what a release hands out, after `npm run build`: the command line as
//          one file, the VS Code extension, the Helm chart, the docs site, a manifest and SHA256SUMS, in
//          out/release/<version>/. It publishes nothing; where each file goes is in docs/listings.md and is
//          the owner's step. Source maps stay out of the release (they hold the source).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version;
const out = join(root, 'out/release', version);
const problems = [];

/** Runs a Node script (no shell: paths with spaces stay whole). */
const node = (script, args, cwd) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0)
    problems.push(
      basename(script) + ' ' + args.join(' ') + ' failed:\n' + (r.stderr || r.stdout).trim(),
    );
  return r.status === 0;
};

/** A folder as a gzipped ustar archive, the folder itself at the top (what `helm package` writes). */
function tgz(dir, file) {
  const blocks = [];
  const header = (name, size, type) => {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write(type === '5' ? '0000755\0' : '0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write(
      Math.floor(Date.now() / 1000)
        .toString(8)
        .padStart(11, '0') + '\0',
      136,
    );
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0' + '00', 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(d, e.name);
      const name = relative(join(dir, '..'), full).replace(/\\/g, '/');
      if (name.length > 99) throw new Error('path too long for the archive: ' + name);
      if (e.isDirectory()) {
        blocks.push(header(name + '/', 0, '5'));
        walk(full);
      } else if (e.isFile()) {
        const data = readFileSync(full);
        blocks.push(
          header(name, data.length, '0'),
          data,
          Buffer.alloc((512 - (data.length % 512)) % 512),
        );
      }
    }
  };
  blocks.push(header(basename(dir) + '/', 0, '5'));
  walk(dir);
  blocks.push(Buffer.alloc(1024));
  writeFileSync(file, gzipSync(Buffer.concat(blocks)));
}
const need = (path, how) => {
  if (existsSync(path)) return true;
  problems.push(basename(path) + ' is missing: ' + how);
  return false;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// the command line, one file
const cli = join(root, 'packages/cli/dist-single/orq.mjs');
if (need(cli, 'run npm run build -w @orqiva/cli')) copyFileSync(cli, join(out, 'orq.mjs'));

// the VS Code extension, packaged by vsce (a development tool, never shipped)
const ext = join(root, 'packages/extension');
const vsix = 'orqiva-' + version + '.vsix';
const vsce = createRequire(join(ext, 'package.json')).resolve('@vscode/vsce/vsce');
if (need(join(ext, 'dist/extension.js'), 'run npm run build -w orqiva'))
  node(vsce, ['package', '--no-dependencies', '-o', join(out, vsix)], ext);

// the Helm chart, as `helm package` lays it out: the chart folder inside a gzipped tar
const chart = 'orqiva-chart-' + version + '.tgz';
tgz(join(root, 'deploy/helm/orqiva'), join(out, chart));

// the docs site, as a folder to copy onto any static host
const site = join(root, 'out/site');
if (need(join(site, 'index.html'), 'run npm run build -w @orqiva/site'))
  cpSync(site, join(out, 'docs-site'), { recursive: true });

const files = ['orq.mjs', vsix, chart].filter((f) => existsSync(join(out, f)));
const sums = files.map((f) => ({
  file: f,
  sha256: createHash('sha256')
    .update(readFileSync(join(out, f)))
    .digest('hex'),
  bytes: readFileSync(join(out, f)).length,
}));
writeFileSync(join(out, 'SHA256SUMS'), sums.map((s) => s.sha256 + '  ' + s.file).join('\n') + '\n');
writeFileSync(
  join(out, 'release.json'),
  JSON.stringify(
    {
      orqiva: version,
      created: new Date().toISOString(),
      image: 'prodengine/server:' + version,
      files: sums,
      docsSite: existsSync(join(out, 'docs-site')) ? 'docs-site/' : null,
    },
    null,
    2,
  ) + '\n',
);

for (const s of sums)
  console.log(
    s.sha256.slice(0, 12) + '  ' + s.file + '  ' + String(Math.round(s.bytes / 1024)) + ' KB',
  );
if (problems.length) {
  for (const p of problems) console.error('release: ' + p);
  process.exitCode = 1;
} else console.log('Release ' + version + ' in ' + out + ' (nothing was published)');
