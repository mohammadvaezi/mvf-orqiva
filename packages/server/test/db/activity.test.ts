// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-106 | S15 | v0.1.0] Add the team activity feed panel to VS Code ──
import type { ActivityEvent } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('recent activity (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let app = '';
  let ops = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Feed = { sequence: number; events: ActivityEvent[] };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    app = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' }))
      .body.id;
    ops = (await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' }))
      .body.id;
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
    for (let n = 1; n <= 3; n++) {
      await t.call(ada, 'POST', W('/projects/' + app + '/items'), { title: 'App ' + String(n) });
      await t.call(ada, 'POST', W('/projects/' + ops + '/items'), { title: 'Ops ' + String(n) });
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('gives a member the newest events, oldest first, and the sequence to follow on from', async () => {
    const r = await t.call<Feed>(ada, 'GET', W('/activity?limit=4'));
    expect(r.status).toBe(200);
    const seqs = r.body.events.map((e) => e.sequence);
    expect(seqs).toHaveLength(4);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(seqs.at(-1)).toBe(r.body.sequence);
    expect(r.body.events.at(-1)?.data.object.label).toContain('Ops 3');
  });

  it('narrows to one project', async () => {
    const r = await t.call<Feed>(ada, 'GET', W('/activity?projectId=' + ops));
    expect(r.body.events.length).toBeGreaterThanOrEqual(3);
    expect(r.body.events.every((e) => e.projectid === ops)).toBe(true);
  });

  it('shows a guest only the projects they are invited to', async () => {
    const r = await t.call<Feed>(gus, 'GET', W('/activity?limit=200'));
    expect(r.body.events.length).toBeGreaterThanOrEqual(3);
    expect(r.body.events.every((e) => e.projectid === app)).toBe(true);
    expect((await t.call<Feed>(gus, 'GET', W('/activity?projectId=' + ops))).body.events).toEqual(
      [],
    );
  });

  it('is closed to people outside the workspace', async () => {
    const eve = await t.signup('Eve');
    expect((await t.call(eve, 'GET', W('/activity'))).status).toBe(404);
  });
});
