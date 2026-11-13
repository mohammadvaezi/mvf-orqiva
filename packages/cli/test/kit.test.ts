// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
//    Why:  the scan counts uses outside a component's own file and sends findings with their token; the
//          check reads the changed files only and fails only when asked to; the rule is printed as the
//          server gives it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDeps } from '../src/loop/commands.js';
import { runKit } from '../src/loop/kit.js';

const WS = '11111111-1111-4111-8111-111111111111';
const P = '/api/workspaces/' + WS + '/projects/p1';

let server: Server;
let base = '';
let sent: Record<string, unknown> | null = null;
let dir = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const send = (o: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (req.url === P + '/tokens')
        send({
          tokens: [
            {
              name: 'color.primary',
              type: 'color',
              valueLight: '#4f46e5',
              valueDark: '',
              description: '',
              themeValues: {},
            },
            {
              name: 'space.4',
              type: 'dimension',
              valueLight: '16px',
              valueDark: '',
              description: '',
              themeValues: {},
            },
          ],
          themes: [],
        });
      else if (req.url === P + '/components')
        send([
          { name: 'Button', codePath: 'src/ui/Button.tsx' },
          { name: 'Card', codePath: 'src/ui/Card.tsx' },
        ]);
      else if (req.url === P + '/kit-scan') {
        sent = JSON.parse(raw) as Record<string, unknown>;
        send({ components: 2, findings: 2 });
      } else if (req.url === P + '/kit-rule') send({ rule: 'UI kit rule: use the kit.' });
      else send({});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  sent = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'orq-kit-'));
  mkdirSync(join(dir, '.orqiva', 'state'), { recursive: true });
  mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
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
  writeFileSync(join(dir, 'src', 'ui', 'Button.tsx'), 'export const Button = () => <Button />;');
  writeFileSync(
    join(dir, 'src', 'Page.tsx'),
    '<Button>Go</Button>\n<Button kind="x" />\n<div style={{ padding: "16px" }} />',
  );
  writeFileSync(join(dir, 'src', 'page.css'), '.a { color: #4F46E5; margin: 13px; }');
  writeFileSync(join(dir, 'src', 'util.ts'), 'const c = "#ff0000";');
});

const deps = (changed: string[] = []): LoopDeps => ({
  cwd: dir,
  home: dir,
  hostname: 'test',
  exec: (_cmd, args) =>
    Promise.resolve(
      args[0] === 'ls-files' && args[1] === '-z'
        ? {
            code: 0,
            out: ['src/ui/Button.tsx', 'src/Page.tsx', 'src/page.css', 'src/util.ts'].join(
              '\u0000',
            ),
          }
        : args[0] === 'diff'
          ? { code: 0, out: changed.join('\n') }
          : { code: 0, out: '' },
    ),
  env: { ORQIVA_TOKEN: 'orq_test' },
});

describe('orq kit', () => {
  it('scans: uses outside a component’s own file, and raw values with their token', async () => {
    const r = await runKit(['kit', 'scan'], deps());
    expect(r?.code).toBe(0);
    expect(r?.out).toContain('Kit scan: 3 UI files.');
    expect(r?.out).toContain('Components: Button 2; not used: Card.');
    expect(r?.out).toContain('Raw values: 3 (2 have a token with the same value).');
    expect(sent).toMatchObject({
      files: 3,
      usage: [{ name: 'Button', count: 2, files: [{ path: 'src/Page.tsx', count: 2 }] }],
    });
    expect(sent?.['findings']).toEqual([
      { path: 'src/Page.tsx', line: 3, kind: 'size', value: '16px', token: 'space.4' },
      { path: 'src/page.css', line: 1, kind: 'colour', value: '#4F46E5', token: 'color.primary' },
      { path: 'src/page.css', line: 1, kind: 'size', value: '13px', token: null },
    ]);
  });

  it('checks the changed files, failing only with --strict', async () => {
    const r = await runKit(['kit', 'check'], deps(['src/page.css', 'src/util.ts']));
    expect(r).toEqual({
      code: 0,
      out: [
        '2 raw value(s) in 1 UI file(s):',
        '  src/page.css:1  colour #4F46E5 → use color.primary',
        '  src/page.css:1  size 13px (no token has this value)',
      ].join('\n'),
    });
    expect((await runKit(['kit', 'check', '--strict'], deps(['src/page.css'])))?.code).toBe(1);
    expect((await runKit(['kit', 'check'], deps(['src/util.ts'])))?.out).toBe(
      'No raw colours or sizes in 0 UI files.',
    );
    expect((await runKit(['kit', 'rule'], deps()))?.out).toBe('UI kit rule: use the kit.');
  });
});
