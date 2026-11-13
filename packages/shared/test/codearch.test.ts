// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
//    Why:  imports are found and followed into the repository, folders and their edges are counted, cycles
//          named; files that change together are paired, worst across folders; the bus factor counts
//          people, not agents.
import { describe, expect, it } from 'vitest';
import {
  changeCoupling,
  folderGraph,
  importCycles,
  importsOf,
  knowledgeOf,
  resolveImport,
} from '../src/index.js';

describe('imports', () => {
  it('finds the specifiers of TypeScript and JavaScript files', () => {
    const text = [
      "import { a } from './a.js';",
      "import type { B } from '../b/index.js';",
      "export * from './c';",
      "import './side-effect.css';",
      "const d = await import('./lazy.js');",
      "const e = require('./old');",
      "import React from 'react';",
      'import {',
      '  x,',
      "} from './multi.js';",
    ].join('\n');
    expect(importsOf('src/x.ts', text).sort()).toEqual(
      [
        '../b/index.js',
        './a.js',
        './c',
        './lazy.js',
        './multi.js',
        './old',
        './side-effect.css',
        'react',
      ].sort(),
    );
    expect(importsOf('README.md', "import x from './y'")).toEqual([]);
    expect(
      importsOf('app/views.py', 'from .models import Cart\nfrom ..core.db import q\nimport os'),
    ).toEqual(['.models', '..core.db']);
  });

  it('follows relative imports to files of the repository', () => {
    const known = new Set([
      'src/a.ts',
      'src/b/index.ts',
      'src/c.tsx',
      'lib/old.js',
      'app/models.py',
      'core/db.py',
    ]);
    expect(resolveImport('src/x.ts', './a.js', known)).toBe('src/a.ts');
    expect(resolveImport('src/x.ts', './b', known)).toBe('src/b/index.ts');
    expect(resolveImport('src/x.ts', './c', known)).toBe('src/c.tsx');
    expect(resolveImport('src/x.ts', '../lib/old', known)).toBe('lib/old.js');
    expect(resolveImport('src/x.ts', 'react', known)).toBeNull();
    expect(resolveImport('src/x.ts', '../../outside', known)).toBeNull();
    expect(resolveImport('app/views.py', '.models', known)).toBe('app/models.py');
    expect(resolveImport('app/views.py', '..core.db', known)).toBe('core/db.py');
  });

  it('follows a monorepo’s own packages by name', () => {
    const known = new Set(['packages/shared/src/index.ts', 'packages/shared/src/money.ts']);
    const packages = new Map([['@acme/shared', 'packages/shared']]);
    expect(resolveImport('packages/web/src/a.ts', '@acme/shared', known, packages)).toBe(
      'packages/shared/src/index.ts',
    );
    expect(resolveImport('packages/web/src/a.ts', '@acme/shared/money.js', known, packages)).toBe(
      'packages/shared/src/money.ts',
    );
    expect(resolveImport('packages/web/src/a.ts', '@acme/sharedx', known, packages)).toBeNull();
    expect(resolveImport('packages/web/src/a.ts', 'react', known, packages)).toBeNull();
  });
});

describe('architecture graph', () => {
  const files = [
    { path: 'web/ui/a.ts', lines: 10, imports: ['web/api/b.ts', 'web/ui/c.ts'] },
    { path: 'web/ui/c.ts', lines: 5, imports: ['web/api/b.ts'] },
    { path: 'web/api/b.ts', lines: 20, imports: ['web/ui/c.ts'] },
    { path: 'server/x.ts', lines: 40, imports: [] },
  ];
  it('counts folders and the imports between them', () => {
    const g = folderGraph(files, 2);
    expect(g.nodes).toEqual([
      { id: 'server', files: 1, lines: 40 },
      { id: 'web/api', files: 1, lines: 20 },
      { id: 'web/ui', files: 2, lines: 15 },
    ]);
    expect(g.edges).toEqual([
      { from: 'web/ui', to: 'web/api', imports: 2 },
      { from: 'web/api', to: 'web/ui', imports: 1 },
    ]);
    expect(importCycles(g.edges)).toEqual([['web/api', 'web/ui']]);
  });

  it('finds no cycle in a tree', () => {
    expect(
      importCycles([
        { from: 'a', to: 'b', imports: 1 },
        { from: 'b', to: 'c', imports: 1 },
        { from: 'a', to: 'c', imports: 1 },
      ]),
    ).toEqual([]);
  });
});

describe('change coupling', () => {
  it('pairs files that change together, across folders first', () => {
    const commits = [
      ['api/cart.ts', 'web/cart.tsx'],
      ['api/cart.ts', 'web/cart.tsx', 'api/cart.test.ts'],
      ['api/cart.ts', 'api/cart.test.ts'],
      ['api/cart.ts'],
      ['README.md', 'a', 'b', 'c', 'd', 'e'],
    ];
    expect(changeCoupling(commits, { minTogether: 2, maxFiles: 5, depth: 1, limit: 10 })).toEqual([
      { a: 'api/cart.ts', b: 'web/cart.tsx', together: 2, degree: 1, crossFolder: true },
      { a: 'api/cart.test.ts', b: 'api/cart.ts', together: 2, degree: 1, crossFolder: false },
    ]);
  });
});

describe('bus factor', () => {
  it('counts the fewest people who wrote most of it, not agents', () => {
    expect(knowledgeOf({ ada: 70, bob: 20, 'Coder agent': 500 })).toEqual({
      busFactor: 1,
      owner: 'ada',
      ownerShare: 0.78,
      authors: 2,
    });
    expect(knowledgeOf({ ada: 30, bob: 30, cy: 30 }).busFactor).toBe(2);
    expect(knowledgeOf({})).toEqual({ busFactor: 0, owner: null, ownerShare: 0, authors: 0 });
  });
});
