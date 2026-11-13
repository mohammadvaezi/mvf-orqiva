// ── [PCODE-207 | S15 | v0.1.0] T17.5 Releases from the terminal and VS Code: orq release, orq env, orq train ──
//    Why:  the release commands as a developer types them, against a stand-in server that records what
//          orq sends: releases with their notes state, the changelog written to a file, environments
//          promoted, decided and rolled back by key, trains listed, checked, shipped and rolled back.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDeps } from '../src/loop/commands.js';
import { runRelease } from '../src/loop/release.js';

const WS = '11111111-1111-4111-8111-111111111111';
const W = '/api/workspaces/' + WS;
const P = W + '/projects/p1';
let server: Server;
let base = '';
let seen: { method: string; path: string; body: unknown }[] = [];
let dir = '';

const train = (state: string) => ({
  id: 't1',
  name: 'October',
  state,
  targetDate: '2026-10-16',
  releases: [
    {
      projectKey: 'API',
      version: '2.0.0',
      state: 'frozen',
      environmentName: 'Production',
      done: 3,
      items: 3,
      deploy: state === 'shipping' ? { status: 'queued', ref: '2.0.0' } : null,
    },
    {
      projectKey: 'APP',
      version: '2.0.0',
      state: 'frozen',
      environmentName: null,
      done: 1,
      items: 2,
      deploy: null,
    },
  ],
});

function reply(path: string, method: string): unknown {
  if (path === P + '/releases')
    return {
      releases: [
        {
          id: 'r2',
          version: '1.4.0',
          state: 'planned',
          frozen: true,
          train: 'October',
          items: 4,
          done: 3,
          notesTeam: '# 1.4.0 team',
          notesClient: '# 1.4.0',
          notesApprovedBy: null,
        },
        {
          id: 'r1',
          version: '1.3.8',
          state: 'released',
          frozen: false,
          train: '',
          items: 2,
          done: 2,
          notesTeam: 'x',
          notesClient: 'y',
          notesApprovedBy: 'Mara',
        },
      ],
    };
  if (path === W + '/releases/r2/notes/approve')
    return { approvedBy: 'Ada', approvedAt: '2026-10-09T10:00:00Z' };
  if (path === P + '/changelog')
    return { markdown: '# Demo changelog\n\n## [1.3.8] - 2026-10-01\n' };
  if (path === P + '/pipeline')
    return [
      {
        id: 'e1',
        key: 'staging',
        name: 'Staging',
        approver: null,
        running: { ref: '1.4.0-rc.1', at: null, by: 'Ada' },
        latest: { status: 'succeeded', ref: '1.4.0-rc.1' },
        waiting: null,
      },
      {
        id: 'e2',
        key: 'production',
        name: 'Production',
        approver: { name: 'Bob' },
        running: { ref: '1.3.8', at: null, by: 'Bob' },
        latest: { status: 'succeeded', ref: '1.3.8' },
        waiting: { id: 'pm1', ref: '1.4.0-rc.1', approver: 'Bob', requestedBy: 'Ada' },
      },
    ];
  if (path === W + '/environments/e2/promote')
    return { status: 'requested', ref: '1.4.0-rc.1', approver: 'Bob' };
  if (path === W + '/environments/e2/rollback') return { ref: '1.3.7', from: '1.3.8' };
  if (path === W + '/trains') return [train('frozen')];
  if (path === W + '/trains/t1/check')
    return {
      releases: [
        { project: 'API', ready: true, missing: [] },
        { project: 'APP', ready: false, missing: ['1 task is not done'] },
      ],
    };
  if (path === W + '/trains/t1/ship') return train('shipping');
  if (path === W + '/trains/t1/rollback') return { ...train('rolling_back') };
  return method === 'GET' ? {} : { ok: true };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        path: req.url ?? '',
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      });
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
  dir = mkdtempSync(join(tmpdir(), 'orq-release-'));
  mkdirSync(join(dir, '.orqiva', 'state'), { recursive: true });
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
});
const deps = (): LoopDeps => ({
  cwd: dir,
  home: dir,
  hostname: 'test',
  exec: () => Promise.resolve({ code: 1, out: '' }),
  env: { ORQIVA_TOKEN: 'orq_test' },
});
const orq = async (...argv: string[]): Promise<string> =>
  (await runRelease(argv, deps()))?.out ?? '';

describe('orq release', () => {
  it('lists releases with their notes, approves and writes the changelog', async () => {
    const out = await orq('release');
    expect(out).toContain(
      '1.4.0           frozen      3/4 done    notes waiting for approval · train October',
    );
    expect(out).toContain('1.3.8           released    2/2 done    notes approved by Mara');
    expect(await orq('release', 'notes', '1.4.0', '--client')).toBe('# 1.4.0');
    expect(await orq('release', 'notes', '1.4.0', '--approve')).toBe(
      'Notes of 1.4.0 approved by Ada.',
    );
    expect(await orq('release', 'changelog', '--write', 'CHANGELOG.md')).toBe(
      'Changelog written to CHANGELOG.md.',
    );
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toBe(
      '# Demo changelog\n\n## [1.3.8] - 2026-10-01\n',
    );
    await expect(orq('release', 'notes', '9.9.9')).rejects.toThrow('No release 9.9.9');
  });
});

describe('orq env', () => {
  it('shows what runs where and acts on an environment by its key', async () => {
    const out = await orq('env');
    expect(out).toContain('production    1.3.8           running · Bob approves');
    expect(out).toContain('  waiting: 1.4.0-rc.1 (asked by Ada, Bob decides)');
    expect(await orq('env', 'promote', 'production')).toBe(
      'Promotion of 1.4.0-rc.1 to Production requested: Bob approves.',
    );
    expect(await orq('env', 'approve', 'production')).toBe(
      '1.4.0-rc.1 to Production approved: the runner deploys it.',
    );
    expect(seen.at(-1)).toEqual({
      method: 'POST',
      path: W + '/promotions/pm1/decision',
      body: { approve: true },
    });
    await expect(orq('env', 'decline', 'production')).rejects.toThrow('Say why');
    await expect(orq('env', 'approve', 'staging')).rejects.toThrow(
      'No promotion waits for Staging',
    );
    await expect(orq('env', 'rollback', 'production')).rejects.toThrow('Say why');
    expect(await orq('env', 'rollback', 'production', '--reason', 'login broken')).toBe(
      'Production rolls back from 1.3.8 to 1.3.7.',
    );
  });
});

describe('orq train', () => {
  it('lists, checks, ships and rolls back a train', async () => {
    expect(await orq('train')).toBe(
      'October       frozen: fixes only                API 2.0.0, APP 2.0.0',
    );
    const one = await orq('train', 'october');
    expect(one).toContain('Train October: frozen: fixes only · ships 2026-10-16');
    expect(one).toContain('  APP     2.0.0         no environment no-go: 1 task is not done');
    expect(await orq('train', 'ship', 'October')).toContain(
      'Train October ships: 2 deploys queued.',
    );
    await expect(orq('train', 'rollback', 'October')).rejects.toThrow('Say why');
    expect(await orq('train', 'rollback', 'October', '--reason', 'API failed')).toContain(
      'Train October: rolling back.',
    );
    expect(await runRelease(['inbox'], deps())).toBeNull();
  });
});
