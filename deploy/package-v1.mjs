// ── [PCODE-442 | S15 | v0.1.0] T38 V1 test package for the dev team: server bundle, IDE setup exe, setup guide ──
//    Why:  the dev team starts the human test from one folder: the server as an offline bundle, the
//          developer setup as one .exe (and the same files for a manual install), the bug capture, the
//          docs and the setup guide. Run after `npm run build`, `npm run release` and
//          `orq bundle --build . --image orqiva/server:<version> --out out/v1-stage/orqiva-server-<version>.tar`
//          ([PCODE-456 | S15 | v0.1.0] --build: without it the bundle takes the image already on this machine).
//          The folder is handed to people, so it is scanned for secrets before it counts, and the dev
//          account's values must not appear in it. It writes V1/, which is never committed.
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
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version;
const release = join(root, 'out/release', version);
const stage = join(root, 'out/v1-stage');
const src = join(root, 'deploy/v1');
const out = join(root, 'V1');
const bundle = 'orqiva-server-' + version + '.tar';
const vsix = 'orqiva-' + version + '.vsix';
const exe = 'Orqiva-IDE-Setup-' + version + '.exe';

const need = [
  [join(release, 'orq.mjs'), 'npm run build && npm run release'],
  [join(release, vsix), 'npm run build && npm run release'],
  [join(release, 'docs-site/index.html'), 'npm run build && npm run release'],
  [
    join(stage, bundle),
    'node out/release/' +
      version +
      '/orq.mjs bundle --build . --image orqiva/server:' + // [PCODE-456 | S15 | v0.1.0] a fresh image
      version +
      ' --out out/v1-stage/' +
      bundle,
  ],
  [join(root, 'packages/capture/dist/chrome/manifest.json'), 'npm run build -w packages/capture'],
];
const missing = need.filter(([f]) => !existsSync(f));
if (missing.length) {
  for (const [f, how] of missing)
    console.error('missing ' + relative(root, f) + '  (make it with: ' + how + ')');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
const put = (from, to) => {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  if (statSync(from).isDirectory()) cpSync(from, join(out, to), { recursive: true });
  else copyFileSync(from, join(out, to));
};

// the server
put(join(stage, bundle), 'server/' + bundle);
put(join(stage, bundle + '.json'), 'server/' + bundle + '.json');
put(join(release, 'orq.mjs'), 'server/orq.mjs');

// the developer machines: the files, then the same files as one .exe
const ideFiles = ['Install-OrqivaIDE.ps1', 'Uninstall-OrqivaIDE.ps1', 'setup.cmd'];
for (const f of ideFiles) put(join(src, f), 'ide/manual/' + f);
put(join(release, 'orq.mjs'), 'ide/manual/orq.mjs');
put(join(release, vsix), 'ide/manual/' + vsix);
put(join(root, 'packages/capture/dist/chrome'), 'browser-bug-capture/chrome');
put(join(root, 'packages/capture/dist/firefox'), 'browser-bug-capture/firefox');
put(join(release, 'docs-site'), 'docs');
put(join(src, 'SETUP-GUIDE.md'), 'SETUP-GUIDE.md');

// IExpress (part of Windows) makes the self-extracting .exe; its SED file cannot take paths with
// spaces, so it works in a temporary folder
if (process.platform === 'win32') {
  const sfx = join(tmpdir(), 'orqiva-v1-sfx-' + version);
  rmSync(sfx, { recursive: true, force: true });
  mkdirSync(sfx, { recursive: true });
  const files = [...ideFiles, 'orq.mjs', vsix];
  for (const f of files) copyFileSync(join(out, 'ide/manual', f), join(sfx, f));
  const target = join(sfx, exe);
  const sed = [
    '[Version]',
    'Class=IEXPRESS',
    'SEDVersion=3',
    '[Options]',
    'PackagePurpose=InstallApp',
    'ShowInstallProgramWindow=0',
    'HideExtractAnimation=1',
    'UseLongFileName=1',
    'InsideCompressed=0',
    'CAB_FixedSize=0',
    'CAB_ResvCodeSigning=0',
    'RebootMode=N',
    'InstallPrompt=%InstallPrompt%',
    'DisplayLicense=%DisplayLicense%',
    'FinishMessage=%FinishMessage%',
    'TargetName=%TargetName%',
    'FriendlyName=%FriendlyName%',
    'AppLaunched=%AppLaunched%',
    'PostInstallCmd=%PostInstallCmd%',
    'AdminQuietInstCmd=%AdminQuietInstCmd%',
    'UserQuietInstCmd=%UserQuietInstCmd%',
    'SourceFiles=SourceFiles',
    '[Strings]',
    'InstallPrompt=',
    'DisplayLicense=',
    'FinishMessage=',
    'TargetName=' + target,
    'FriendlyName=Orqiva ' + version + ' developer setup',
    'AppLaunched=cmd /c setup.cmd',
    'PostInstallCmd=<None>',
    'AdminQuietInstCmd=',
    'UserQuietInstCmd=',
    ...files.map((f, i) => 'FILE' + i + '="' + f + '"'),
    '[SourceFiles]',
    'SourceFiles0=' + sfx + '\\',
    '[SourceFiles0]',
    ...files.map((_, i) => '%FILE' + i + '%='),
    '',
  ].join('\r\n');
  writeFileSync(join(sfx, 'setup.sed'), sed);
  const r = spawnSync('iexpress.exe', ['/N', '/Q', join(sfx, 'setup.sed')], { encoding: 'utf8' });
  if (!existsSync(target)) {
    console.error(
      'IExpress made no ' + exe + ': ' + (r.stderr || r.stdout || r.error || '').toString(),
    );
    process.exit(1);
  }
  put(target, 'ide/' + exe);
  rmSync(sfx, { recursive: true, force: true });
} else console.warn('not on Windows: ' + exe + ' is left out; ide/manual has the same files');

// the guide as a page, in the docs site's look, readable without the docs folder next to it
const { renderMarkdown } = await import(
  pathToFileURL(join(root, 'packages/site/dist/markdown.js')).href
);
const { page, STYLE } = await import(
  pathToFileURL(join(root, 'packages/site/dist/layout.js')).href
);
const md = readFileSync(join(src, 'SETUP-GUIDE.md'), 'utf8');
const r = renderMarkdown(md);
const html = page({
  slug: 'setup-guide',
  title: 'Setup guide for the test',
  description: 'Orqiva version 1: installing the test server and the developer machines.',
  body: r.html ?? r.body,
  headings: r.headings,
  nav: [],
  version,
})
  .replace('<link rel="stylesheet" href="site.css">', '<style>' + STYLE + '</style>')
  .replace(
    /href="(index|getting-started|pricing|cli|api|favicon)\.(html|svg)"/g,
    'href="docs/$1.$2"',
  );
writeFileSync(join(out, 'SETUP-GUIDE.html'), html);

// nothing secret goes out: no key, token or password, and none of the dev account's values
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
const all = walk(out);
const forbiddenNames =
  /(^|[\\/])(\.env|secrets\.bin|id_rsa|id_ed25519|dev-account[^\\/]*|.*\.map)$/;
const forbidden = [
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{40}/,
  /\borq_[A-Za-z0-9_-]{24,}/,
  /plane_api_[0-9a-f]{32}/,
  /AKIA[0-9A-Z]{16}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  // a real password, not a placeholder such as … or <password>
  /postgres(ql)?:\/\/[^\s:'"`$@/]+:[^\s'"`$@{}…<>*]{4,}@/,
];
const devValues = [];
try {
  const dev = JSON.parse(readFileSync(join(root, 'dev/dev-account.example.json'), 'utf8'));
  const collect = (v) =>
    typeof v === 'string'
      ? v.length >= 8 && devValues.push(v)
      : v && typeof v === 'object' && Object.values(v).forEach(collect);
  collect(dev);
} catch {
  // no dev account on this machine: nothing to look for
}
const text = new Set([
  '.md',
  '.html',
  '.json',
  '.mjs',
  '.js',
  '.css',
  '.ps1',
  '.cmd',
  '.txt',
  '.svg',
]);
const found = [];
for (const f of all) {
  const rel = relative(out, f).replace(/\\/g, '/');
  if (forbiddenNames.test(rel)) found.push(rel + ': a file that must not be handed out');
  if (!text.has(extname(f).toLowerCase())) continue;
  const s = readFileSync(f, 'utf8');
  for (const re of forbidden)
    if (re.test(s)) found.push(rel + ': matches ' + re.source.slice(0, 30));
  // the values themselves are never printed
  if (devValues.some((v) => s.includes(v))) found.push(rel + ': holds a value of the dev account');
}
if (found.length) {
  rmSync(out, { recursive: true, force: true });
  console.error('Refused, V1/ removed:\n  ' + found.join('\n  '));
  process.exit(1);
}

// the checksums, in the format sha256sum -c reads
const sums = all
  .map((f) => relative(out, f).replace(/\\/g, '/'))
  .sort()
  .map(
    (rel) =>
      createHash('sha256')
        .update(readFileSync(join(out, rel)))
        .digest('hex') +
      '  ' +
      rel,
  );
writeFileSync(join(out, 'SHA256SUMS'), sums.join('\n') + '\n');

const mb = (f) => (statSync(join(out, f)).size / 1048576).toFixed(1) + ' MB';
console.log('V1 test package ' + version + ' in ' + out);
for (const f of [
  'server/' + bundle,
  'server/orq.mjs',
  'ide/' + exe,
  'ide/manual/' + vsix,
  'SETUP-GUIDE.html',
])
  if (existsSync(join(out, f))) console.log('  ' + f.padEnd(40) + mb(f));
console.log('  ' + all.length + ' files checked for secrets: none found. Nothing was published.');
