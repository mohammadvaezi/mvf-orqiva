// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
//    Why:  a read-only link to a plan against PostgreSQL: made by a member (not a guest), read without a
//          session and without people, comments or code in it, subscribed to as a calendar, and dead at once
//          when withdrawn or past its day; the token is kept only as a hash.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('plan share links (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada Lovelace');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHR', name: 'Shared plan' })
    ).body.id;
    const a = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), {
        title: 'Secret-free design',
        startDate: '2027-05-03',
        durationDays: 3,
        assigneeId: ada.id,
        description: 'internal notes',
      })
    ).body.id;
    const m = (
      await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Launch', kind: 'milestone' })
    ).body.id;
    await t.call(ada, 'POST', P('/dependencies'), { predecessorId: a, successorId: m });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('makes a link whose token is shown once and kept as a hash', async () => {
    const made = await t.call<{ id: string; token: string }>(ada, 'POST', P('/plan/shares'), {
      label: 'Steering board',
    });
    expect(made.status).toBe(201);
    expect(made.body.token.length).toBeGreaterThanOrEqual(32);
    const stored = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ token_hash: string }>(
            'SELECT token_hash FROM plan_shares WHERE id = $1',
            [made.body.id],
          )
        ).rows[0]?.token_hash,
    );
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(made.body.token);
    const list = await t.call<{ label: string; active: boolean; createdBy: string }[]>(
      ada,
      'GET',
      P('/plan/shares'),
    );
    expect(list.body).toEqual([
      expect.objectContaining({ label: 'Steering board', active: true, createdBy: 'Ada Lovelace' }),
    ]);

    // read without signing in: the schedule, nobody's name, no description
    const r = await t.call<{
      project: { name: string };
      tasks: Record<string, unknown>[];
      schedule: { start: string }[];
      dependencies: unknown[];
    }>(null, 'GET', '/api/share/plan/' + made.body.token);
    expect(r.status).toBe(200);
    expect(r.body.project.name).toBe('Shared plan');
    expect(r.body.tasks.map((x) => x['title'])).toEqual(['Secret-free design', 'Launch']);
    expect(r.body.dependencies).toHaveLength(1);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain(ada.id);
    expect(raw).not.toContain('internal notes');
    expect(raw).not.toContain('Ada');

    // the calendar
    const ics = await fetch(t.base + '/api/share/plan/' + made.body.token + '/ics');
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    expect(await ics.text()).toContain('DTSTART;VALUE=DATE:20270503');

    // withdrawn: dead at once
    await t.call(ada, 'DELETE', W('/plan-shares/' + made.body.id));
    expect((await t.call(null, 'GET', '/api/share/plan/' + made.body.token)).status).toBe(404);
    expect(
      (await t.call<{ active: boolean }[]>(ada, 'GET', P('/plan/shares'))).body[0]?.active,
    ).toBe(false);
  });

  it('ends on its day, refuses a wrong token, and is for members only', async () => {
    const old = await t.call<{ token: string }>(ada, 'POST', P('/plan/shares'), {
      expiresOn: '2020-01-01',
    });
    expect((await t.call(null, 'GET', '/api/share/plan/' + old.body.token)).status).toBe(404);
    const later = await t.call<{ token: string }>(ada, 'POST', P('/plan/shares'), {
      expiresOn: '2999-12-31',
    });
    expect((await t.call(null, 'GET', '/api/share/plan/' + later.body.token)).status).toBe(200);
    expect((await t.call(null, 'GET', '/api/share/plan/' + 'x'.repeat(32))).status).toBe(404);

    const gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    await t.call(ada, 'POST', P('/guests'), { userId: gus.id });
    expect(
      (await t.call({ ...gus, workspaceId: ada.workspaceId }, 'POST', P('/plan/shares'), {}))
        .status,
    ).toBe(403);
  });
});
