// ── [PCODE-458 | S15 | v0.1.0] VS Code extension updates itself from GitHub: CI publishes the build, Update button installs it ──
// ── [PCODE-1 | S01 | v0.1.0] Scaffold the extension repo: manifest, esbuild bundle, tsconfig, lint and format ──
// ── [PCODE-19 | S04 | v0.1.0] Add the webview host helper with CSP nonce, theme CSS and a typed message bridge ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/cb55079f-fd25-471d-9fe6-4c5790d15f89/
//    Why:  one script builds the extension host bundle and every webview entry; no framework, no second tool.
import { build, context } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// ── [PCODE-1 | S01 | v0.1.0] webview entries: src/webviews/<name>/main.ts -> dist/webviews/<name>.js ──
function webviewEntries() {
  const root = 'src/webviews';
  if (!existsSync(root)) return {};
  const entries = {};
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const main = join(root, name.name, 'main.ts');
    if (name.isDirectory() && existsSync(main)) entries[`webviews/${name.name}`] = main;
  }
  return entries;
}

// ── [PCODE-1 | S01 | v0.1.0] media/ is copied next to the bundles so webviews find css and icons ──
function copyMedia() {
  mkdirSync('dist/media', { recursive: true });
  // [PCODE-64 | S12 | v0.1.0] media/walkthrough is read from the installed extension, not by a webview
  if (existsSync('media'))
    cpSync('media', 'dist/media', {
      recursive: true,
      filter: (src) => !src.replace(/\\/g, '/').includes('media/walkthrough'),
    });
  // [PCODE-19 | S04 | v0.1.0] codicons (the one production dependency) travel next to our css
  // [PCODE-84 | S08 | v0.1.0] found wherever npm installed it: in a workspace it sits in the root
  //    node_modules, and a silent skip shipped every panel without icons. A missing package fails the build.
  const codicons = dirname(
    createRequire(import.meta.url).resolve('@vscode/codicons/dist/codicon.css'),
  );
  cpSync(join(codicons, 'codicon.css'), 'dist/media/codicon.css');
  cpSync(join(codicons, 'codicon.ttf'), 'dist/media/codicon.ttf');
}

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
  entryPoints: {
    extension: 'src/extension.ts',
    'test/runTests': 'test/e2e/runTests.ts',
    'test/suite/index': 'test/e2e/suite/index.ts',
    ...Object.fromEntries(
      readdirSync('test/e2e/suite')
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => [`test/suite/${f.replace(/\.ts$/, '')}`, `test/e2e/suite/${f}`]),
    ),
  },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  external: ['vscode', 'mocha', '@vscode/test-electron', 'glob'],
  // [PCODE-105 | S15 | v0.1.0] workspace packages (shared, the pe loop) are bundled from their source
  conditions: ['source'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: webviewEntries(),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outdir: 'dist',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// ── [PCODE-458 | S15 | v0.1.0] dist/build.json: which commit this build is and when it was made ──
//    The Update button compares it with the build GitHub published; a build from a newer time wins.
function stampBuild() {
  let commit = process.env.GITHUB_SHA ?? '';
  if (!commit)
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      commit = 'unknown';
    }
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  mkdirSync('dist', { recursive: true });
  writeFileSync(
    'dist/build.json',
    JSON.stringify({ commit, builtAt: new Date().toISOString(), version }, null, 2) + '\n',
  );
}

// ── [PCODE-1 | S01 | v0.1.0] build once, or keep both bundles rebuilding on change ──
async function run() {
  copyMedia();
  stampBuild(); // [PCODE-458 | S15 | v0.1.0]
  const configs = [hostOptions];
  if (Object.keys(webviewOptions.entryPoints).length > 0) configs.push(webviewOptions);
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => context(c)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('[esbuild] watching…');
    return;
  }
  await Promise.all(configs.map((c) => build(c)));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
