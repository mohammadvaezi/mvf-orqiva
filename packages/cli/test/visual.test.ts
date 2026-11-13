// ── [PCODE-295 | S15 | v0.1.0] T30.8b Visual regression: baselines, pixel diff, orq visual check, the Visual tab ──
//    Why:  `orq visual check` sends each screenshot unread under its file's name with the commit, prints a
//          line per screen and fails the CI step only when a screen changed beyond what it may.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDeps } from '../src/loop/commands.js';
import { runVisual, screenOfFile } from '../src/loop/visual.js';

const WS = '11111111-1111-4111-8111-111111111111';
const W = '/api/workspaces/' + WS;
let server: Server;
let base = '';
let dir = '';
const uploads: string[] = [];
const checks: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('latin1')));
    req.on('end', () => {
      const send = (o: unknown): void => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (req.url?.startsWith(W + '/files?')) {
        uploads.push(req.url);
        send({ id: 'f' + String(uploads.length) });
      } else if (req.url === W + '/projects/p1/visual/checks') {
        const b = JSON.parse(raw) as { name: string };
        checks.push(b);
        send({
          id: 'r',
          name: b.name,
          status: b.name === 'home' ? 'pass' : b.name === 'cart' ? 'fail' : 'new',
          reason: b.name === 'cart' ? '400 pixels changed' : 'fine',
        });
      } else send({});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port);
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  uploads.length = 0;
  checks.length = 0;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), 'orq-visual-'));
  mkdirSync(join(dir, '.orqiva', 'state'), { recursive: true });
  mkdirSync(join(dir, 'shots'));
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
  for (const n of ['home', 'cart', 'checkout'])
    writeFileSync(join(dir, 'shots', n + '.png'), 'png ' + n);
});

const deps = (): LoopDeps => ({
  cwd: dir,
  home: dir,
  hostname: 'test',
  env: { ORQIVA_TOKEN: 'orq_test' },
  exec: (_cmd, args) =>
    Promise.resolve(args[0] === 'rev-parse' ? { code: 0, out: 'abc1234\n' } : { code: 1, out: '' }),
});

describe('orq visual check', () => {
  it('names screens after their files and fails on a changed one', async () => {
    expect(screenOfFile('shots/Sign in.PNG')).toBe('Sign in');
    const r = await runVisual(
      ['visual', 'check', 'shots/home.png', 'shots/cart.png', 'shots/checkout.png'],
      deps(),
    );
    expect(r?.code).toBe(1);
    expect(r?.out).toContain('ok   home: fine');
    expect(r?.out).toContain('FAIL cart: 400 pixels changed');
    expect(r?.out).toContain('new  checkout: fine');
    expect(r?.out).toContain(
      '3 screen(s): 1 as approved, 1 changed, 1 new. Look and approve: ' +
        base +
        '/projects/p1/uikit?view=visual',
    );
    expect(uploads.every((u) => u.endsWith('&read=0'))).toBe(true);
    expect(checks.map((c) => [c['name'], c['commit']])).toEqual([
      ['home', 'abc1234'],
      ['cart', 'abc1234'],
      ['checkout', 'abc1234'],
    ]);
  });

  it('passes without changes, takes a name and a commit, refuses two files for one name', async () => {
    const r = await runVisual(
      ['visual', 'check', 'shots/home.png', '--name', 'home', '--commit', 'feed42'],
      deps(),
    );
    expect(r).toMatchObject({ code: 0 });
    expect(checks[0]).toMatchObject({ name: 'home', commit: 'feed42' });
    await expect(
      runVisual(['visual', 'check', 'a.png', 'b.png', '--name', 'x'], deps()),
    ).rejects.toThrow('--name names one');
    await expect(runVisual(['visual', 'check', 'missing.png'], deps())).rejects.toThrow(
      'Cannot read missing.png',
    );
  });
});
