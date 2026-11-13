// ── [PCODE-309 | S15 | v0.1.0] T31.8b Architecture graph, change coupling and bus factor on the code map ──
// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-201 | S15 | v0.1.0] T16.5 Docs and handover from the terminal and VS Code: orq docs scan/build/drift, orq handover ──
//    Why:  the code scan reads Git the same way every time (last change, changes and authors in 90 days,
//          what agents wrote), skips binaries, and sends one full scan, the OpenAPI document and the rebuild;
//          the handover prints its checks and numbered checklist, ticks by number and sends the pack.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDeps } from '../src/loop/commands.js';
import { complexityOf, languageOf, parseGitLog, runDocs, scanFile } from '../src/loop/docs.js';

const WS = '11111111-1111-4111-8111-111111111111';
const W = '/api/workspaces/' + WS;
const P = W + '/projects/p1';
const NOW = Date.parse('2026-10-09T12:00:00Z');
const LOG = [
  '@@2026-10-08T10:00:00+02:00\tAda\tClaude Opus 5.5 <noreply@anthropic.com>',
  '',
  '30\t2\tsrc/a.ts',
  '-\t-\tlogo.png',
  '@@2026-10-01T10:00:00+02:00\tMo\t',
  '',
  '10\t0\tsrc/a.ts',
  '5\t0\tsrc/b.py',
  '@@2026-01-01T10:00:00+01:00\tMo\t',
  '',
  '100\t0\tsrc/b.py',
].join('\n');

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
let server: Server;
let base = '';
let seen: Seen[] = [];
let dir = '';

function reply(path: string, method: string): unknown {
  if (path === P + '/code-scan') return { files: 2, removed: 1 };
  // [PCODE-281 | S15 | v0.1.0]
  if (path === P + '/code-texts/wanted') return { paths: ['src/a.ts', 'gone.ts'], readmes: true };
  if (path === P + '/code-texts') return { stored: 2, removed: 0 };
  if (path === P + '/api-endpoints/import') return { endpoints: 3, removed: 0, unauthenticated: 0 };
  if (path === P + '/docs/from-code') return { created: 2, updated: 1, unchanged: 0, removed: 0 };
  if (path === P + '/docs/drift')
    return [
      {
        title: 'ADR-7',
        ownerName: 'Mo',
        refs: [{ path: 'src/a.ts', line: 88, state: 'changed' }],
      },
    ];
  if (path === P + '/handover' && method === 'GET')
    return {
      checks: [
        { key: 'readme', label: 'Handover readme', state: 'missing', detail: 'No page yet' },
        { key: 'tests', label: 'Tests', state: 'ok', detail: 'Regression: 9 passed' },
        { key: 'item:x', label: 'Access', state: 'ok', detail: 'Done' },
      ],
      ready: false,
      items: [
        { id: 'x', label: 'Access handed over', done: true },
        { id: 'y', label: 'Support named', done: false },
      ],
      client: 'Helio',
      packs: [
        { number: 1, status: 'changes_requested', signedName: '', decisionNote: 'Add a runbook' },
      ],
    };
  if (path === P + '/handover/packs') return { pack: { number: 2 } };
  return {};
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      seen.push({ method: req.method ?? '', path: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply(req.url ?? '', req.method ?? '')));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  seen = [];
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'orq-docs-'));
  mkdirSync(join(dir, '.orqiva', 'state'), { recursive: true });
  mkdirSync(join(dir, 'src'));
  writeFileSync(
    join(dir, '.orqiva', 'project.json'),
    JSON.stringify({
      server: base,
      workspaceId: WS,
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
    }),
  );
  writeFileSync(join(dir, 'src', 'a.ts'), 'if (a && b) {\n  x();\n}\n');
  writeFileSync(join(dir, 'src', 'b.py'), 'print(1)\n');
  writeFileSync(join(dir, 'README.md'), '# The app\n');
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0, 1]));
  writeFileSync(join(dir, 'openapi.json'), JSON.stringify({ paths: { '/x': { get: {} } } }));
});

const deps = (): LoopDeps => ({
  cwd: dir,
  home: dir,
  hostname: 'test',
  exec: (_cmd, args) =>
    Promise.resolve(
      args[0] === 'ls-files'
        ? {
            code: 0,
            out: ['src/a.ts', 'src/b.py', 'logo.png', 'openapi.json', 'README.md'].join('\u0000'),
          }
        : args[0] === 'log'
          ? { code: 0, out: LOG }
          : { code: 1, out: '' },
    ),
  env: { ORQIVA_TOKEN: 'orq_test' },
  now: () => NOW,
});

describe('the code scan', () => {
  it('reads Git: last change, 90 days of changes and authors, what agents wrote', () => {
    const g = parseGitLog(LOG, NOW - 90 * 86_400_000);
    expect(g.get('src/a.ts')).toEqual({
      lastCommitAt: '2026-10-08T10:00:00+02:00',
      churn: 2,
      authors: { Agent: 30, Mo: 10 },
      agentLines: 30,
    });
    expect(g.get('src/b.py')).toMatchObject({ churn: 1, authors: { Mo: 5 } });
    expect(scanFile('src/a.ts', 'if (a && b) {\n  x();\n}\n', g.get('src/a.ts'))).toMatchObject({
      language: 'TypeScript',
      lines: 3,
      complexity: 2,
      agentShare: 0.75,
    });
    expect(languageOf('x/Y.PY')).toBe('Python');
    expect(complexityOf('for (;;) { switch (x) { case 1: } } a ? b : c')).toBe(3);
  });

  // [PCODE-309 | S15 | v0.1.0] the repository's own files a file imports, for the architecture graph
  it('sends what a file imports from the repository, not packages', () => {
    const known = new Set(['src/a.ts', 'src/b/index.ts', 'lib/c.js']);
    const text =
      "import x from './b';\nimport { y } from '../lib/c.js';\nimport z from 'zod';\nimport './a.js';\n";
    expect(scanFile('src/a.ts', text, undefined, known).imports).toEqual([
      'lib/c.js',
      'src/b/index.ts',
    ]);
  });

  it('sends one full scan, the OpenAPI document and the rebuild', async () => {
    const r = await runDocs(['docs', 'scan', '--openapi', 'openapi.json'], deps());
    expect(r?.out).toBe(
      'Code scan: 2 files sent, 1 gone from the map.\nTexts for pages: 2 files (README and code embeds); not in the repository: gone.ts.\nOpenAPI: 3 endpoints.\nDocs from code: 2 new, 1 changed (Documents, folder "Built from the code").',
    );
    const texts = seen.find((s) => s.path === P + '/code-texts')?.body;
    expect(texts?.['full']).toBe(true);
    expect(
      (texts?.['texts'] as { path: string; text: string }[]).map((t) => [t.path, t.text]),
    ).toEqual([
      ['README.md', '# The app\n'],
      ['src/a.ts', 'if (a && b) {\n  x();\n}\n'],
    ]);
    const scan = seen.find((s) => s.path === P + '/code-scan');
    const files = scan?.body?.['files'] as { path: string }[];
    expect(scan?.body?.['full']).toBe(true);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.py', 'openapi.json', 'README.md']);
    expect(seen.map((s) => s.path)).toEqual([
      P + '/code-scan',
      P + '/code-texts/wanted',
      P + '/code-texts',
      P + '/api-endpoints/import',
      P + '/docs/from-code',
    ]);
  });

  it('lists drift', async () => {
    expect((await runDocs(['docs', 'drift'], deps()))?.out).toBe(
      'ADR-7 (Mo)\n  src/a.ts:88 changed after the page',
    );
  });
});

describe('orq handover', () => {
  it('prints the checks and the numbered checklist, ticks by number and sends', async () => {
    const out = (await runDocs(['handover'], deps()))?.out ?? '';
    expect(out).toContain('✗ Handover readme: No page yet');
    expect(out).toContain('✓ Tests: Regression: 9 passed');
    expect(out).not.toContain('✓ Access:');
    expect(out).toContain('  2. [ ] Support named');
    expect(out).toContain('Latest: pack 1, changes asked for: Add a runbook');
    expect(out).toContain('Not ready: Handover readme');
    expect((await runDocs(['handover', 'check', '2'], deps()))?.out).toBe('Ticked: Support named');
    expect(seen.at(-1)).toEqual({
      method: 'PATCH',
      path: W + '/handover-items/y',
      body: { done: true },
    });
    await expect(runDocs(['handover', 'check', '9'], deps())).rejects.toThrow(
      'No checklist item 9',
    );
    expect((await runDocs(['handover', 'send', '--note', 'Final'], deps()))?.out).toContain(
      'Sent handover pack 2',
    );
    expect(seen.at(-1)?.body).toEqual({ note: 'Final' });
    expect(await runDocs(['inbox'], deps())).toBeNull();
  });
});
