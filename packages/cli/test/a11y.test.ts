// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  the check reads changed or named files and fails only when asked; the scan sends every UI
//          file's problems with the commit; the script needs no project; a saved page audit is sent
//          under its screen's name and refused when it is not one.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDeps } from '../src/loop/commands.js';
import { runA11y } from '../src/loop/a11y.js';

const WS = '11111111-1111-4111-8111-111111111111';
const P = '/api/workspaces/' + WS + '/projects/p1';
let server: Server;
let base = '';
let dir = '';
const sent: { url: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      sent.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') as Record<string, unknown> });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ findings: 0 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  sent.length = 0;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'orq-a11y-'));
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
  writeFileSync(
    join(dir, 'src', 'Card.tsx'),
    '<div>\n  <img src={a} />\n  <button><Icon /></button>\n</div>',
  );
  writeFileSync(join(dir, 'src', 'ok.tsx'), '<img src={a} alt="A cat" />');
  writeFileSync(join(dir, 'src', 'util.ts'), 'const x = "<img>";');
});

const deps = (changed: string[] = []): LoopDeps => ({
  cwd: dir,
  home: dir,
  hostname: 'test',
  env: { ORQIVA_TOKEN: 'orq_test' },
  exec: (_cmd, args) =>
    Promise.resolve(
      args[0] === 'ls-files' && args[1] === '-z'
        ? { code: 0, out: ['src/Card.tsx', 'src/ok.tsx', 'src/util.ts'].join('\u0000') }
        : args[0] === 'diff'
          ? { code: 0, out: changed.join('\n') }
          : args[0] === 'rev-parse'
            ? { code: 0, out: 'abc1234\n' }
            : { code: 0, out: '' },
    ),
});

describe('orq a11y', () => {
  it('checks changed files, and fails only with --strict', async () => {
    const r = await runA11y(['a11y', 'check'], deps(['src/Card.tsx', 'src/util.ts']));
    expect(r?.code).toBe(0);
    expect(r?.out).toContain('2 accessibility problem(s) in 1 UI file(s):');
    expect(r?.out).toContain('src/Card.tsx:2  Image without alt text: <img src={a} />');
    expect(r?.out).toContain('src/Card.tsx:3  Button or link without a name');
    expect((await runA11y(['a11y', 'check', 'src/Card.tsx', '--strict'], deps()))?.code).toBe(1);
    expect((await runA11y(['a11y', 'check', 'src/ok.tsx'], deps()))?.out).toBe(
      'No accessibility problems in 1 UI file.',
    );
  });

  it('scans every UI file and sends it with the commit', async () => {
    const r = await runA11y(['a11y', 'scan'], deps());
    expect(r?.out).toBe(
      'Accessibility scan: 2 UI files, 2 problem(s): Image without alt text 1, Button or link without a name 1.',
    );
    expect(sent[0]?.url).toBe(P + '/a11y/code');
    expect(sent[0]?.body).toMatchObject({ files: 2, commit: 'abc1234' });
  });

  it('prints the script without a project and sends saved audits', async () => {
    const script = await runA11y(['a11y', 'script'], { ...deps(), cwd: tmpdir() });
    expect(script?.out.startsWith('(function auditPage(doc)')).toBe(true);
    writeFileSync(
      join(dir, 'checkout.json'),
      JSON.stringify({
        url: 'http://localhost/checkout',
        title: 'Checkout',
        checked: { targets: 9, focusable: 9, images: 2 },
        findings: [{ rule: 'target-size', selector: 'button.x', message: '16 × 16 px' }],
      }),
    );
    const r = await runA11y(['a11y', 'report', 'checkout.json', '--strict'], deps());
    expect(r?.code).toBe(1);
    expect(r?.out).toContain('FAIL checkout: 1 problem(s) in 9 targets, 2 images');
    expect(r?.out).toContain('Target smaller than 24 × 24 px: button.x (16 × 16 px)');
    expect(sent[0]).toMatchObject({
      url: P + '/a11y/pages',
      body: { name: 'checkout', commit: 'abc1234' },
    });
    writeFileSync(join(dir, 'bad.json'), '{"no": "findings"}');
    await expect(runA11y(['a11y', 'report', 'bad.json'], deps())).rejects.toThrow(
      'no findings list',
    );
  });
});
