// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
//    Why:  an upgrade keeps the range's ^ or ~ and the file's indentation, adds an override for a package
//          that only comes in through another one, raises a Python pin in place; an AI answer counts only
//          as a whole, changed file.
import { describe, expect, it } from 'vitest';
import {
  bumpPackageJson,
  bumpRequirements,
  fixNoteOf,
  fixedFileOf,
  manifestOf,
} from '../src/fixes.js';

const PKG =
  '{\n    "name": "shop",\n    "dependencies": {\n        "lodash": "^4.17.20",\n        "pg": "8.11.0"\n    }\n}\n';

describe('fix pull requests', () => {
  it('finds the manifest beside a lockfile', () => {
    expect(manifestOf('packages/web/package-lock.json')).toEqual({
      path: 'packages/web/package.json',
      kind: 'npm',
    });
    expect(manifestOf('requirements-dev.txt')).toEqual({
      path: 'requirements-dev.txt',
      kind: 'pip',
    });
    expect(manifestOf('src/app.ts')).toBeNull();
  });

  it('raises a declared dependency, keeping its range and the indentation', () => {
    const b = bumpPackageJson(PKG, 'lodash', '4.17.21');
    expect(b?.summary).toBe('lodash ^4.17.20 → ^4.17.21 in dependencies');
    expect(b?.text).toBe(PKG.replace('^4.17.20', '^4.17.21'));
    expect(bumpPackageJson(PKG.replace('^4.17.20', '^4.17.21'), 'lodash', '4.17.21')).toBeNull();
  });

  it('pins a package that only comes in through another by an override', () => {
    const b = bumpPackageJson(PKG, 'minimist', '1.2.8');
    expect(b?.summary).toContain('npm override');
    expect(JSON.parse(b?.text ?? '{}')).toMatchObject({ overrides: { minimist: '1.2.8' } });
    expect(bumpPackageJson('not json', 'x', '1')).toBeNull();
  });

  it('raises a Python pin in place', () => {
    const b = bumpRequirements(
      'Django==4.2.1  # web\nrequests[socks]==2.31.0\nflask>=2\n',
      'requests',
      '2.32.3',
    );
    expect(b?.text).toBe('Django==4.2.1  # web\nrequests[socks]==2.32.3\nflask>=2\n');
    expect(b?.summary).toBe('requests 2.31.0 → 2.32.3');
    expect(bumpRequirements('django==4.2.1\n', 'Django', '4.2.1')).toBeNull();
  });

  it('takes the agent’s corrected file only whole and changed', () => {
    const before = 'const a = 1;\nconst b = eval(input);\nexport { a, b };\n';
    const fixed = 'const a = 1;\nconst b = JSON.parse(input);\nexport { a, b };';
    const answer = 'Replaced eval with JSON.parse.\n\n```ts\n' + fixed + '\n```';
    expect(fixedFileOf(answer, before)).toBe(fixed + '\n');
    expect(fixNoteOf(answer)).toBe('Replaced eval with JSON.parse.');
    expect(fixedFileOf('```ts\nconst b = 1;\n```', before)).toBeNull();
    expect(fixedFileOf('No code here.', before)).toBeNull();
    expect(fixedFileOf('```\n' + before + '```', before)).toBeNull();
  });
});
