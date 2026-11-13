// ── [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names ──
//    Why:  a developer who installed the V1 test build gets the fixed extension without the whole setup
//          again: one folder with the .vsix, a script that swaps it in, and the guide. Builds the
//          extension itself; needs packages/site built for the guide's page (npm run build). The folder
//          is handed to people, so it is scanned for secrets like V1/. It writes V1-IDE-FIX/ and
//          V1-IDE-FIX.zip, which are never committed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ext = join(root, 'packages/extension');
const version = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8')).version;
const src = join(root, 'deploy/v1');
const out = join(root, 'V1-IDE-FIX');
const zip = out + '.zip';
const vsix = 'orqiva-' + version + '.vsix';

const run = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('failed: ' + cmd);
    process.exit(1);
  }
};

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });

// the fixed extension, built from this tree
run('npm run build', ext);
run('npx vsce package --no-dependencies --out "' + join(out, vsix) + '"', ext);

// the script and its launcher, with Windows line ends
for (const f of ['Fix-OrqivaIDE.ps1', 'Fix-OrqivaIDE.cmd'])
  writeFileSync(join(out, f), readFileSync(join(src, f), 'utf8').replace(/\r?\n/g, '\r\n'));
copyFileSync(join(src, 'FIX-GUIDE.md'), join(out, 'FIX-GUIDE.md'));
// [PCODE-456 | S15 | v0.1.0] the orq command too: the Claude Code hooks run it (npm run release makes it)
const orqBuilt = join(root, 'out/release', version, 'orq.mjs');
if (!existsSync(orqBuilt)) {
  console.error('missing ' + orqBuilt + '  (make it with: npm run release)');
  process.exit(1);
}
copyFileSync(orqBuilt, join(out, 'orq.mjs'));

// the guide as a page, in the docs site's look
const { renderMarkdown } = await import(
  pathToFileURL(join(root, 'packages/site/dist/markdown.js')).href
);
const { page, STYLE } = await import(
  pathToFileURL(join(root, 'packages/site/dist/layout.js')).href
);
const r = renderMarkdown(readFileSync(join(src, 'FIX-GUIDE.md'), 'utf8'));
writeFileSync(
  join(out, 'FIX-GUIDE.html'),
  page({
    slug: 'fix-guide',
    title: 'Fix for the VS Code extension',
    description:
      'Orqiva V1 test: replacing the VS Code extension with the fixed one, step by step.',
    body: r.html ?? r.body,
    headings: r.headings,
    nav: [],
    version,
  }).replace('<link rel="stylesheet" href="site.css">', '<style>' + STYLE + '</style>'),
);

// nothing secret goes out
const all = readdirSync(out).map((f) => join(out, f));
const forbidden = [
  /\borq_[A-Za-z0-9_-]{24,}/,
  /plane_api_[0-9a-f]{32}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const found = all
  .filter((f) => /\.(md|html|ps1|cmd|mjs)$/.test(f))
  .filter((f) => forbidden.some((re) => re.test(readFileSync(f, 'utf8'))))
  .map((f) => relative(out, f));
if (found.length) {
  rmSync(out, { recursive: true, force: true });
  console.error('Refused, V1-IDE-FIX/ removed: ' + found.join(', '));
  process.exit(1);
}

// the checksums, in the format sha256sum -c reads
writeFileSync(
  join(out, 'SHA256SUMS'),
  all
    .map((f) => relative(out, f))
    .sort()
    .map(
      (rel) =>
        createHash('sha256')
          .update(readFileSync(join(out, rel)))
          .digest('hex') +
        '  ' +
        rel,
    )
    .join('\n') + '\n',
);

// one file to hand over
if (process.platform === 'win32')
  run(
    'powershell -NoProfile -Command "Compress-Archive -Path \'' +
      out +
      "\\*' -DestinationPath '" +
      zip +
      '\'"',
    root,
  );
console.log('IDE fix ' + version + ' in ' + out + (existsSync(zip) ? ' and ' + zip : ''));
