// ── [PCODE-365 | S15 | v0.1.0] T36.1 Test suite stability ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-107 | S15 | v0.1.0] Build the Plane importer: projects, items, states, comments, cycles, history ──
// ── [PCODE-109 | S15 | v0.1.0] Move PCODE into Orqiva and retire Plane for this project ──
//    Why:  the import end to end: `orq import plane` reads a stand-in Plane over HTTP (its REST v1 shapes,
//          cursor pages) and writes into the real server. Numbers, states, cycles, comments with their authors
//          and times, and the activity log must arrive; a second run must change nothing.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnExec } from '../../../cli/src/install/exec.js';
import { run } from '../../../cli/src/run.js';
import { startTestApp, type Person, type TestApp } from '../db/apphelper.js';
import { hasDatabase } from '../db/testdb.js';
import { listenFetchable } from '../ports.js'; // [PCODE-365 | S15 | v0.1.0]

const P = 'pp-1';
const today = new Date().toISOString().slice(0, 10);
const shift = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const PLANE: Record<string, unknown> = {
  '/projects/': [{ id: P, identifier: 'PCODE', name: 'Orqiva', description: 'The old one' }],
  ['/projects/' + P + '/states/']: [
    { id: 's-todo', name: 'Todo', group: 'unstarted', color: '#3F76FF' },
    { id: 's-review', name: 'Review', group: 'started', color: '#A855F7' },
    { id: 's-done', name: 'Done', group: 'completed', color: '#16A34A' },
    { id: 's-qa', name: 'QA', group: 'started', color: 'teal' },
  ],
  ['/projects/' + P + '/labels/']: [{ id: 'l-feat', name: 'feature', color: '#00AA00' }],
  '/members/': [
    { id: 'u-fa', display_name: 'farivarz', email: 'owner@example.test' },
    { id: 'u-cc', display_name: 'Claude Code', email: 'agent@example.test' },
  ],
  ['/projects/' + P + '/cycles/']: [
    {
      id: 'c-old',
      name: 'Sprint 1 - old',
      description: 'first',
      start_date: '2026-09-01',
      end_date: '2026-09-02',
    },
    {
      id: 'c-now',
      name: 'Sprint 15 - today',
      description: '',
      start_date: today,
      end_date: shift(1),
    },
  ],
  ['/projects/' + P + '/cycles/c-old/cycle-issues/']: [{ id: 'i-12' }, { id: 'i-13' }],
  ['/projects/' + P + '/cycles/c-now/cycle-issues/']: [{ id: 'i-13' }],
};
const issues = [
  {
    id: 'i-12',
    sequence_id: 12,
    name: 'Order editing',
    description_html:
      '<p>Reprice from the <strong>POS</strong> payload.</p><ul><li data-checked="true">tested</li></ul>',
    state: 's-done',
    priority: 'high',
    labels: ['l-feat'],
    assignees: ['u-fa'],
    parent: null,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-02T09:00:00Z',
  },
  {
    id: 'i-13',
    sequence_id: 13,
    name: 'Reprice tests',
    description_html: '',
    state: 's-qa',
    priority: 'none',
    labels: [],
    assignees: [],
    parent: 'i-12',
    created_at: '2026-09-01T09:00:00Z',
    updated_at: '2026-09-03T09:00:00Z',
  },
];
PLANE['/projects/' + P + '/issues/'] = issues;
PLANE['/projects/' + P + '/issues/i-12/comments/'] = [
  {
    id: 'cm-1',
    comment_html: '<p><strong>Done</strong> by Claude Code — commit <code>abc1234</code></p>',
    created_at: '2026-09-02T08:59:00Z',
    actor: 'u-cc',
  },
];
PLANE['/projects/' + P + '/issues/i-13/comments/'] = [];
PLANE['/projects/' + P + '/issues/i-12/activities/'] = [
  {
    id: 'a-1',
    created_at: '2026-09-01T08:00:00Z',
    verb: 'created',
    field: null,
    old_value: null,
    new_value: null,
    comment: 'created the issue',
    actor: 'u-fa',
  },
  {
    id: 'a-2',
    created_at: '2026-09-02T09:00:00Z',
    verb: 'updated',
    field: 'state',
    old_value: 'Review',
    new_value: 'Done',
    comment: 'updated the state to Done',
    actor: 'u-cc',
  },
];
PLANE['/projects/' + P + '/issues/i-13/activities/'] = [];

describe.skipIf(!hasDatabase)('orq import plane (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let plane: Server;
  let planeUrl = '';
  let repo = '';
  let home = '';
  let projectId = '';
  let requests = 0;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const env = (): Record<string, string> => ({
    PLANE_API_KEY: 'plane-key',
    PLANE_BASE_URL: planeUrl,
    PLANE_WORKSPACE_SLUG: 'acme',
  });
  const pe = (...argv: string[]) =>
    run(argv, {
      exec: spawnExec,
      log: () => undefined,
      plane: { spacingMs: 0 },
      loop: { cwd: repo, home, hostname: hostname(), env: env() },
    });

  beforeAll(async () => {
    plane = createServer((req, res) => {
      requests++;
      const u = new URL(req.url ?? '', 'http://x');
      const path = u.pathname.replace('/api/v1/workspaces/acme', '');
      if (req.headers['x-api-key'] !== 'plane-key') return void res.writeHead(401).end();
      const data = PLANE[path];
      if (data === undefined) return void res.writeHead(404).end();
      const list = data as unknown[];
      // the issues come in two cursor pages, as Plane pages them
      if (path.endsWith('/issues/') && !u.searchParams.get('cursor'))
        return void res.end(
          JSON.stringify({
            results: list.slice(0, 1),
            next_cursor: 'next',
            next_page_results: true,
          }),
        );
      if (path.endsWith('/issues/'))
        return void res.end(
          JSON.stringify({ results: list.slice(1), next_cursor: null, next_page_results: false }),
        );
      res.end(
        JSON.stringify(path === '/members/' ? list : { results: list, next_page_results: false }),
      );
    });
    await listenFetchable(plane); // [PCODE-365 | S15 | v0.1.0]
    planeUrl = 'http://127.0.0.1:' + String((plane.address() as AddressInfo).port);

    t = await startTestApp();
    ada = await t.signup('Ada');
    const token = (await t.call<{ token: string }>(ada, 'POST', '/auth/tokens', { name: 'import' }))
      .body.token;
    await t.call(ada, 'POST', W('/projects'), { key: 'HOME', name: 'Home' });
    repo = mkdtempSync(join(tmpdir(), 'pe-import-repo-'));
    home = mkdtempSync(join(tmpdir(), 'pe-import-home-'));
    expect((await pe('login', '--server', t.base, '--token', token)).code).toBe(0);
    expect((await pe('link', 'HOME')).code).toBe(0);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await new Promise((r) => plane.close(r));
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('reads without sending on a dry run', async () => {
    const r = await pe('import', 'plane', '--project', 'pcode', '--dry-run');
    expect(r.out).toContain('Dry run: read 2 items, 1 comments, 2 history entries, 2 cycles');
    expect((await t.call<unknown[]>(ada, 'GET', W('/projects'))).body).toHaveLength(1);
  });

  it(
    'imports the project with its numbers, states, cycles, labels, comments and history',
    { timeout: 30_000 },
    async () => {
      const r = await pe('import', 'plane', '--project', 'PCODE');
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain('Imported PCODE');
      expect(r.out).toContain('2 items, 1 comments, 2 new history entries, 2 sprints');
      const projects = await t.call<{ id: string; key: string; name: string }[]>(
        ada,
        'GET',
        W('/projects'),
      );
      projectId = projects.body.find((p) => p.key === 'PCODE')?.id ?? '';
      expect(projectId).not.toBe('');

      const detail = await t.call<{ states: { name: string; group: string; color: string }[] }>(
        ada,
        'GET',
        W('/projects/' + projectId),
      );
      expect(detail.body.states.find((s) => s.name === 'QA')).toMatchObject({
        group: 'started',
        color: '#8b8d98',
      });
      const states = new Map(detail.body.states.map((s) => [s.name, s]));
      expect(states.size).toBe(9); // the eight defaults, matched by name, plus QA

      const items = await t.call<
        {
          id: string;
          ref: string;
          title: string;
          description: string;
          stateId: string;
          sprintId: string | null;
          parentId: string | null;
          labelIds: string[];
          createdAt: string;
        }[]
      >(ada, 'GET', W('/projects/' + projectId + '/items'));
      const [i12, i13] = items.body;
      expect(items.body.map((i) => i.ref)).toEqual(['PCODE-12', 'PCODE-13']);
      expect(i12?.description).toBe('Reprice from the **POS** payload.\n\n- [x] tested');
      expect(i12?.createdAt).toBe('2026-09-01T08:00:00.000Z');
      expect(i13?.parentId).toBe(i12?.id);

      const sprints = await t.call<{ id: string; name: string; status: string; number: number }[]>(
        ada,
        'GET',
        W('/projects/' + projectId + '/sprints'),
      );
      const byName = new Map(sprints.body.map((s) => [s.name, s]));
      expect(byName.get('Sprint 1 - old')?.status).toBe('completed');
      // [PCODE-109 | S15 | v0.1.0] the numbers (and so the S codes of fingerprints) follow Plane's names
      expect(byName.get('Sprint 1 - old')?.number).toBe(1);
      expect(byName.get('Sprint 15 - today')?.number).toBe(15);
      expect(byName.get('Sprint 15 - today')?.status).toBe('active');
      // in two cycles: the latest one wins
      expect(i13?.sprintId).toBe(byName.get('Sprint 15 - today')?.id);
      expect(i12?.sprintId).toBe(byName.get('Sprint 1 - old')?.id);

      const labels = await t.call<{ id: string; name: string }[]>(
        ada,
        'GET',
        W('/projects/' + projectId + '/labels'),
      );
      const names = labels.body
        .filter((l) => i12?.labelIds.includes(l.id))
        .map((l) => l.name)
        .sort();
      expect(names).toEqual(['feature', 'priority: high']);

      const comments = await t.call<{ authorName: string; body: string; createdAt: string }[]>(
        ada,
        'GET',
        W('/items/' + String(i12?.id) + '/comments'),
      );
      expect(comments.body).toEqual([
        expect.objectContaining({
          authorName: 'Claude Code',
          body: '**Done** by Claude Code — commit `abc1234`',
          createdAt: '2026-09-02T08:59:00.000Z',
        }),
      ]);

      const history = await t.call<
        {
          source: string;
          time: string;
          data: {
            actor: { name: string };
            changes?: Record<string, { from: unknown; to: unknown }>;
          };
        }[]
      >(ada, 'GET', W('/items/' + String(i12?.id) + '/history'));
      const imported = history.body.filter((h) => h.source === '/import/plane');
      expect(
        imported.map((h) => [h.time, h.data.actor.name, h.data.changes?.['state']?.to ?? null]),
      ).toEqual([
        ['2026-09-01T08:00:00.000Z', 'farivarz', null],
        ['2026-09-02T09:00:00.000Z', 'Claude Code', 'Done'],
      ]);

      // new items continue after the imported numbers
      const next = await t.call<{ ref: string }>(
        ada,
        'POST',
        W('/projects/' + projectId + '/items'),
        { title: 'After the import' },
      );
      expect(next.body.ref).toBe('PCODE-14');
    },
  );

  it('changes nothing when run again', { timeout: 30_000 }, async () => {
    const before = await t.call<unknown[]>(ada, 'GET', W('/projects/' + projectId + '/items'));
    requests = 0;
    const r = await pe('import', 'plane', '--project', 'PCODE');
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('0 new history entries');
    expect(requests).toBeGreaterThan(0);
    const after = await t.call<{ ref: string }[]>(
      ada,
      'GET',
      W('/projects/' + projectId + '/items'),
    );
    expect(after.body).toHaveLength(before.body.length);
    const i12 = (
      await t.call<{ id: string; ref: string }[]>(
        ada,
        'GET',
        W('/projects/' + projectId + '/items'),
      )
    ).body[0];
    expect(
      (await t.call<unknown[]>(ada, 'GET', W('/items/' + String(i12?.id) + '/comments'))).body,
    ).toHaveLength(1);
    expect(
      (await t.call<unknown[]>(ada, 'GET', W('/projects/' + projectId + '/sprints'))).body,
    ).toHaveLength(2);
  });

  it(
    'refuses to import over a project that already has the key, and lets only admins import',
    { timeout: 30_000 },
    async () => {
      // a project imported before is found again by its Plane id; a new one may not take a used key
      const taken = await t.call<{ error: { message: string } }>(ada, 'POST', W('/import/plane'), {
        project: { externalId: 'another-plane-project', key: 'HOME', name: 'Other' },
      });
      expect(taken.status).toBe(409);
      expect(taken.body.error.message).toContain('A project HOME already exists');
      const bob = await t.signup('Bob');
      await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
      const denied = await t.call(bob, 'POST', W('/import/plane'), {
        project: { externalId: 'x', key: 'NEW', name: 'New' },
      });
      expect(denied.status).toBe(403);
    },
  );

  it('says what is missing without a Plane key', async () => {
    const r = await run(['import', 'plane', '--project', 'PCODE'], {
      exec: spawnExec,
      loop: { cwd: repo, home, hostname: hostname(), env: {} },
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('PLANE_API_KEY');
  });
});
