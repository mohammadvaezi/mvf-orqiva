// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-85 | S08 | v0.1.0] Build our own licence checker and SBOM generator that fail CI on a denied licence ──
//    Why:  every way a restrictive licence could slip in, built as a small repository in a temp folder:
//          declared GPL, a manifest that hides a GPL text, a Commons Clause rider, no licence at all, a
//          development package inlined into a bundle. The real repository is checked by CI itself.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectLicences } from '../src/licences/detect.js';
import { runLicences } from '../src/licences/command.js';
import { chooseAccepted, parseSpdx } from '../src/licences/spdx.js';
import { purl } from '../src/licences/sbom.js';
import { packageOfSource, importedPackages } from '../src/licences/bundles.js';

const MIT_TEXT =
  'MIT License\n\nCopyright (c) 2024 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software...';
const GPL_TEXT =
  'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n...\nuse the GNU Lesser General Public License instead of this License.';
const COMMONS_CLAUSE =
  '\n\n"Commons Clause" License Condition v1.0\nThe Software is provided to you by the Licensor under the License...';

const ACCEPTED = ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'CC-BY-4.0'];

describe('SPDX expressions', () => {
  const accepted = new Set(ACCEPTED);
  it('picks the accepted branch of an OR', () => {
    const t = parseSpdx('(MIT OR GPL-3.0-only)');
    expect(t && chooseAccepted(t, accepted)).toEqual(['MIT']);
  });
  it('needs every part of an AND', () => {
    const t = parseSpdx('MIT AND GPL-2.0-only');
    expect(t && chooseAccepted(t, accepted)).toBeNull();
  });
  it('keeps the base licence verdict through WITH', () => {
    const t = parseSpdx('Apache-2.0 WITH LLVM-exception');
    expect(t && chooseAccepted(t, accepted)).toEqual(['Apache-2.0']);
  });
  it('returns null for a text that is not an expression', () => {
    expect(parseSpdx('SEE LICENSE IN LICENSE.txt')).toBeNull();
    expect(parseSpdx('(MIT OR')).toBeNull();
  });
});

describe('licence texts', () => {
  it('recognises MIT', () => {
    expect(detectLicences(MIT_TEXT)).toEqual(['MIT']);
  });
  it('reads the GPL as GPL although it mentions the LGPL', () => {
    expect(detectLicences(GPL_TEXT)).toEqual(['GPL']);
  });
  it('tells the LGPL and AGPL apart', () => {
    expect(
      detectLicences('GNU LESSER GENERAL PUBLIC LICENSE Version 3 ... GNU General Public License'),
    ).toEqual(['LGPL']);
    expect(
      detectLicences('GNU AFFERO GENERAL PUBLIC LICENSE Version 3 ... GNU General Public License'),
    ).toEqual(['AGPL-3.0']);
  });
  it('finds a Commons Clause appended to MIT', () => {
    expect(detectLicences(MIT_TEXT + COMMONS_CLAUSE)).toEqual(
      expect.arrayContaining(['MIT', 'Commons-Clause']),
    );
  });
});

describe('bundle helpers', () => {
  it('names the package a source map entry came from', () => {
    expect(packageOfSource('../../node_modules/@scope/pkg/lib/a.js')).toBe('@scope/pkg');
    expect(packageOfSource('../node_modules/a/node_modules/b/index.js')).toBe('b');
    expect(packageOfSource('../src/main.ts')).toBeNull();
  });
  it('lists the bare modules a file loads, without built-ins', () => {
    const code =
      "import x from 'left-pad';\nconst fs = require('node:fs');\nrequire(\"path\");\nimport('./local.js');\nexport { y } from '@scope/lib/sub';";
    expect(importedPackages(code).sort()).toEqual(['@scope/lib', 'left-pad']);
  });
  // [PCODE-107 | S15 | v0.1.0] the word in a string is not an import
  it('does not take the word import inside strings for an import', () => {
    const code =
      "import 'side-effect';\nconst tags = ['import'],\n  role = 'admin';\nif (command === 'import') { write(l + '\\n'); }";
    expect(importedPackages(code)).toEqual(['side-effect']);
  });
  it('builds npm package URLs', () => {
    expect(purl('@vscode/codicons', '0.0.46-24')).toBe('pkg:npm/%40vscode/codicons@0.0.46-24');
  });
});

// ── a throw-away repository: licence-policy.json, one shipped workspace, node_modules ──────────────────
let repo = '';
afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = '';
});

function put(rel: string, text: string): void {
  const file = join(repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

interface Lib {
  name: string;
  license?: string;
  text?: string;
  dependencies?: Record<string, string>;
}

function makeRepo(opts: {
  deps: string[];
  devDeps?: string[];
  libs: Lib[];
  sources?: string[];
  noMap?: boolean;
}): void {
  repo = mkdtempSync(join(tmpdir(), 'pe-licences-'));
  put(
    'licence-policy.json',
    JSON.stringify({
      accepted: ACCEPTED,
      shipped: [{ workspace: 'packages/app', bundles: ['dist'] }],
      exceptions: {},
    }),
  );
  const dependencies = Object.fromEntries(opts.deps.map((d) => [d, '1.0.0']));
  const devDependencies = Object.fromEntries((opts.devDeps ?? []).map((d) => [d, '1.0.0']));
  put(
    'packages/app/package.json',
    JSON.stringify({ name: '@orqiva/app', version: '0.1.0', dependencies, devDependencies }),
  );
  put('packages/app/dist/index.js', opts.deps.map((d) => "import '" + d + "';").join('\n') + '\n');
  if (!opts.noMap) {
    put(
      'packages/app/dist/index.js.map',
      JSON.stringify({ version: 3, sources: ['../src/index.ts', ...(opts.sources ?? [])] }),
    );
  }
  for (const lib of opts.libs) {
    const manifest: Record<string, unknown> = { name: lib.name, version: '1.0.0' };
    if (lib.license !== undefined) manifest['license'] = lib.license;
    if (lib.dependencies) manifest['dependencies'] = lib.dependencies;
    put('node_modules/' + lib.name + '/package.json', JSON.stringify(manifest));
    if (lib.text !== undefined) put('node_modules/' + lib.name + '/LICENSE', lib.text);
  }
}

const check = (): ReturnType<typeof runLicences> =>
  runLicences({
    root: repo,
    timestamp: '2026-10-02T00:00:00.000Z',
    serial: '00000000-0000-4000-8000-000000000000',
  });

describe('orq licences on a repository', () => {
  it('passes permissive dependencies and writes the SBOM and notices', () => {
    makeRepo({
      deps: ['good'],
      libs: [
        { name: 'good', license: 'MIT', text: MIT_TEXT, dependencies: { deeper: '1.0.0' } },
        { name: 'deeper', license: 'ISC' },
      ],
    });
    const r = check();
    expect(r.code, r.out).toBe(0);
    const sbom = JSON.parse(readFileSync(join(repo, 'out/licences/sbom.cdx.json'), 'utf8')) as {
      bomFormat: string;
      specVersion: string;
      components: { name: string; licenses: unknown[] }[];
    };
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.components.map((c) => c.name)).toEqual(['deeper', 'good']);
    const notices = readFileSync(join(repo, 'out/licences/THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices).toContain('Permission is hereby granted');
    expect(r.out).toContain('deeper@1.0.0: no licence file');
  });

  it('fails on a GPL-3.0 package and names it and its licence', () => {
    makeRepo({
      deps: ['badlib'],
      libs: [{ name: 'badlib', license: 'GPL-3.0-only', text: GPL_TEXT }],
    });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DENIED {2}badlib@1\.0\.0 {2}GPL-3\.0-only/);
  });

  it('fails when the manifest says MIT but the licence file is the GPL', () => {
    makeRepo({ deps: ['liar'], libs: [{ name: 'liar', license: 'MIT', text: GPL_TEXT }] });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('licence file is GPL, the manifest says MIT');
  });

  it('fails on a Commons Clause rider', () => {
    makeRepo({
      deps: ['rider'],
      libs: [{ name: 'rider', license: 'MIT', text: MIT_TEXT + COMMONS_CLAUSE }],
    });
    expect(check().out).toContain('licence file adds Commons-Clause');
  });

  it('fails on a package with no licence at all, and on UNLICENSED', () => {
    makeRepo({
      deps: ['bare', 'closed'],
      libs: [{ name: 'bare' }, { name: 'closed', license: 'UNLICENSED' }],
    });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('bare@1.0.0');
    expect(r.out).toContain('no licence found');
    expect(r.out).toContain('closed@1.0.0  UNLICENSED');
  });

  it('accepts a dual-licensed package through its permissive branch', () => {
    makeRepo({
      deps: ['dual'],
      libs: [
        { name: 'dual', license: '(MIT OR GPL-3.0-or-later)', text: MIT_TEXT + '\n\n' + GPL_TEXT },
      ],
    });
    expect(check().code).toBe(0);
  });

  it('ignores development-only packages, but fails when one is inlined into a bundle', () => {
    const libs = [
      { name: 'good', license: 'MIT', text: MIT_TEXT },
      { name: 'devtool', license: 'GPL-3.0-only', text: GPL_TEXT },
    ];
    makeRepo({ deps: ['good'], devDeps: ['devtool'], libs });
    expect(check().code).toBe(0);
    rmSync(repo, { recursive: true, force: true });
    makeRepo({
      deps: ['good'],
      devDeps: ['devtool'],
      libs,
      sources: ['../../../node_modules/devtool/index.js'],
    });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('contains code from devtool, which is not a runtime dependency');
  });

  it('fails on a bundle without a source map and on a dependency that is not installed', () => {
    makeRepo({ deps: ['ghost'], libs: [], noMap: true });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('no source map');
    expect(r.out).toContain('MISSING @orqiva/app needs ghost');
  });
});

// [PCODE-226 | S15 | v0.1.0] a phone app ships its bundles and its native modules, not its build tools
describe('orq licences on a phone app', () => {
  function makeApp(opts: { sources: string[]; libs: (Lib & { native?: string })[] }): void {
    repo = mkdtempSync(join(tmpdir(), 'pe-licences-app-'));
    put(
      'licence-policy.json',
      JSON.stringify({
        accepted: ACCEPTED,
        shipped: [{ workspace: 'packages/mobile', bundles: ['dist'], app: true }],
        exceptions: {},
      }),
    );
    const deps = Object.fromEntries(opts.libs.map((l) => [l.name, '1.0.0']));
    put(
      'packages/mobile/package.json',
      JSON.stringify({ name: '@orqiva/mobile', version: '0.1.0', dependencies: deps }),
    );
    put('packages/mobile/dist/app.js', '__d(function () {});\n');
    put(
      'packages/mobile/dist/app.js.map',
      JSON.stringify({ version: 3, sources: ['/index.ts', ...opts.sources] }),
    );
    for (const lib of opts.libs) {
      put(
        'packages/mobile/node_modules/' + lib.name + '/package.json',
        JSON.stringify({ name: lib.name, version: '1.0.0', license: lib.license }),
      );
      if (lib.text !== undefined)
        put('packages/mobile/node_modules/' + lib.name + '/LICENSE', lib.text);
      if (lib.native) put('packages/mobile/node_modules/' + lib.name + '/' + lib.native, '{}');
    }
  }

  it('judges what is in the bundle and what brings native code, and leaves build tools out', () => {
    makeApp({
      sources: ['/node_modules/ui/index.js'],
      libs: [
        { name: 'ui', license: 'MIT', text: MIT_TEXT },
        { name: 'camera', license: 'MIT', text: MIT_TEXT, native: 'expo-module.config.json' },
        { name: 'bundler', license: 'GPL-3.0-only', text: GPL_TEXT },
      ],
    });
    const r = check();
    expect(r.code).toBe(0);
    expect(r.verdicts.map((v) => v.name).sort()).toEqual(['camera', 'ui']);
    expect(r.out).toContain('1 build-only package(s) of the apps left out');
  });

  it('fails on a denied licence inside the bundle or in native code', () => {
    makeApp({
      sources: ['/node_modules/bundler/runtime.js'],
      libs: [
        { name: 'bundler', license: 'GPL-3.0-only', text: GPL_TEXT },
        { name: 'nativelib', license: 'GPL-3.0-only', text: GPL_TEXT, native: 'nativelib.podspec' },
      ],
    });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('DENIED  bundler@1.0.0');
    expect(r.out).toContain('DENIED  nativelib@1.0.0');
  });
});
