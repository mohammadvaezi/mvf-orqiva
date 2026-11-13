// ── [PCODE-252 | S15 | v0.1.0] T26.1 Estimation: units, async planning poker, suggestions from similar tasks, estimate vs actual ──
//    Why:  estimation against the real server: a poker round hides the cards until it is revealed, shows the
//          spread and turns the accepted card into the estimate (T-shirt sizes stored as points); a new task
//          gets a suggestion from the finished tasks that read alike and what they took; estimate vs actual
//          sets each task's estimate against the hours logged.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Round {
  id: string;
  unit: string;
  deck: string[];
  status: string;
  voters: { name: string; card: string | null }[];
  myCard: string | null;
  summary: { low: number; high: number; agreed: boolean; suggested: string } | null;
}

describe.skipIf(!hasDatabase)('estimation (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const task = async (title: string, description = '', estimate?: number) =>
    (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title,
        description,
        ...(estimate !== undefined ? { estimate } : {}),
      })
    ).body.id;
  /** a finished task with hours logged on it */
  const finished = async (title: string, estimate: number, minutes: number) => {
    const id = await task(title, '', estimate);
    await inSystem(t.db.pool, async (c) => {
      await c.query("UPDATE items SET completed_at = now() - interval '3 days' WHERE id = $1", [
        id,
      ]);
      // a day holds at most 24 hours: the time goes on a day each in parts of 10 hours
      for (let left = minutes, d = 0; left > 0; left -= 600, d++)
        await c.query(
          "INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, day, minutes, source) VALUES ($1, $2, $3, $4, current_date - $6::int, $5, 'manual')",
          [ada.workspaceId, ada.id, id, project, Math.min(600, left), d],
        );
    });
    return id;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('plays a round of poker in T-shirt sizes: hidden cards, the spread, the accepted size', async () => {
    expect(
      (
        await t.call(ada, 'PUT', W('/settings/planning.estimate_unit'), {
          scope: 'project',
          scopeId: project,
          value: 'tshirt',
        })
      ).status,
    ).toBe(200);
    const item = await task('Export cancelled appointments');
    const start = await t.call<Round>(ada, 'POST', W('/items/' + item + '/poker'));
    expect(start.status).toBe(201);
    expect(start.body.deck).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '?']);
    expect((await t.call(bo, 'POST', W('/items/' + item + '/poker'))).status).toBe(409);
    const R = W('/poker/' + start.body.id);
    expect((await t.call(ada, 'POST', R + '/vote', { card: '7' })).status).toBe(400);
    await t.call(ada, 'POST', R + '/vote', { card: 'M' });
    const bos = await t.call<Round>(bo, 'POST', R + '/vote', { card: 'XL' });
    // before the reveal nobody sees another's card, only who voted
    expect(bos.body.voters).toEqual([
      expect.objectContaining({ name: 'Ada', card: null }),
      expect.objectContaining({ name: 'Bo', card: null }),
    ]);
    expect(bos.body.myCard).toBe('XL');
    expect((await t.call(ada, 'POST', R + '/accept', { card: 'L' })).status).toBe(409);
    const open = await t.call<{ ref: string; votes: number; voted: boolean }[]>(
      bo,
      'GET',
      W('/projects/' + project + '/poker'),
    );
    expect(open.body).toEqual([expect.objectContaining({ ref: 'HEL-1', votes: 2, voted: true })]);
    const shown = await t.call<Round>(bo, 'POST', R + '/reveal');
    expect(shown.body.summary).toMatchObject({ low: 3, high: 8, agreed: false, suggested: 'L' });
    expect(shown.body.voters.map((v) => v.card)).toEqual(['M', 'XL']);
    expect((await t.call(ada, 'POST', R + '/vote', { card: 'S' })).status).toBe(409);
    const done = await t.call<Round>(ada, 'POST', R + '/accept', { card: 'L' });
    expect(done.body.status).toBe('closed');
    const after = await t.call<{ estimate: number; version: number }>(
      ada,
      'GET',
      W('/items/' + item),
    );
    expect(after.body.estimate).toBe(5);
    // a new round can start once the last one is closed
    expect((await t.call(bo, 'POST', W('/items/' + item + '/poker'))).status).toBe(201);
  });

  it('suggests an estimate from finished tasks that read alike', async () => {
    await t.call(ada, 'PUT', W('/settings/planning.estimate_unit'), {
      scope: 'project',
      scopeId: project,
      value: 'points',
    });
    await finished('Export bookings to CSV for the accountant', 3, 20 * 60);
    await finished('Export invoices to CSV for the accountant', 5, 16 * 60);
    await finished('Export payments to CSV', 3, 0);
    await finished('Redesign the login page', 8, 30 * 60);
    const item = await task('Export appointments to CSV for the accountant');
    const r = await t.call<{
      unit: string;
      value: number;
      basis: string;
      similar: { ref: string; hours: number }[];
    }>(ada, 'GET', W('/items/' + item + '/estimate-suggestion'));
    expect(r.body.similar.map((x) => x.ref)).not.toContain('HEL-5');
    expect(r.body.similar.length).toBeGreaterThanOrEqual(2);
    // 18 hours logged in the middle, at 6 hours a point: 3 points
    expect(r.body).toMatchObject({ unit: 'points', basis: 'actual', value: 3 });
  });

  it('sets estimates against the hours logged', async () => {
    const r = await t.call<{
      estimatedHours: number;
      actualHours: number;
      tasks: { ref: string; estimatedHours: number; actualHours: number; ratio: number | null }[];
    }>(ada, 'GET', W('/projects/' + project + '/estimate-vs-actual'));
    expect(r.body.tasks[0]).toMatchObject({
      ref: 'HEL-2',
      estimatedHours: 18,
      actualHours: 20,
      ratio: 1.11,
    });
    expect(r.body.tasks.map((x) => x.ref)).toEqual(['HEL-2', 'HEL-5', 'HEL-3', 'HEL-4']);
    expect(r.body).toMatchObject({ estimatedHours: 114, actualHours: 66 });
  });
});
