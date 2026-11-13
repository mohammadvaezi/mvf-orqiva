// ── [PCODE-363 | S15 | v0.1.0] T35.7e Rate limits shared across cluster nodes ──
// ── [PCODE-344 | S15 | v0.1.0] T34.3b Timer idle detection, time reminders, correction reasons for locked weeks ──
//    Why:  against the real database: time away comes off a running timer; an approved week is corrected
//          only with a reason, which is kept, sends the week back for approval and tells the manager; and
//          the end-of-day and Friday reminders reach the right people once.
import { autoStopAt } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { alertRound } from '../../src/push/alerts.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('idle time, corrections and time reminders (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let lu: Person;
  let item = '';
  const WEEK = '2026-09-28';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  type Entry = { kind: string; title: string; detail: string };
  const inbox = async (who: Person, kind: string): Promise<Entry[]> =>
    (await t.call<{ items: Entry[] }>(who, 'GET', W('/inbox'))).body.items.filter(
      (i) => i.kind === kind,
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    lu = await t.signup('Lu');
    for (const p of [mo, lu])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    const project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Live re-routing',
      })
    ).body.id;
    await sys(
      'INSERT INTO member_profiles (workspace_id, user_id, manager_id) VALUES ($1, $2, $3), ($1, $4, $3)',
      [ada.workspaceId, mo.id, ada.id, lu.id],
    );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  // [PCODE-363 | S15 | v0.1.0] a timer started an hour ago stops by itself at 19:00 or midnight (Berlin);
  // in the hour after either, no such timer can still run, so the case waits for another hour of the day
  const hourRuns = autoStopAt(new Date(Date.now() - 61 * 60_000)) > new Date();
  it.skipIf(!hourRuns)('takes the time away off a running timer', async () => {
    const started = await t.call<{ id: string }>(mo, 'POST', W('/time/timer'), { itemId: item });
    await sys("UPDATE time_entries SET started_at = now() - interval '60 minutes' WHERE id = $1", [
      started.body.id,
    ]);
    const away = new Date(Date.now() - 25 * 60_000).toISOString();
    const idle = await t.call<{ idleMinutes: number }>(mo, 'POST', W('/time/timer/idle'), {
      awayFrom: away,
    });
    expect(idle.body.idleMinutes).toBe(25);
    const week = await t.call<{ timer: { idleMinutes: number } | null }>(
      mo,
      'GET',
      W('/time/week'),
    );
    expect(week.body.timer?.idleMinutes).toBe(25);
    const stopped = await t.call<{ minutes: number }>(mo, 'POST', W('/time/timer/stop'), {});
    expect(stopped.body.minutes).toBeGreaterThanOrEqual(35);
    expect(stopped.body.minutes).toBeLessThanOrEqual(36);
    expect((await t.call(mo, 'POST', W('/time/timer/idle'), { awayFrom: away })).status).toBe(409);
  });

  it('corrects an approved week only with a reason, and sends it back for approval', async () => {
    const cell = (minutes: number, reason?: string) =>
      t.call<{ message?: string }>(mo, 'PUT', W('/time/cell'), {
        day: '2026-09-29',
        minutes,
        itemId: item,
        ...(reason ? { reason } : {}),
      });
    expect((await cell(240)).status).toBe(200);
    await t.call(mo, 'POST', W('/time/week/submit'), { week: WEEK });
    await t.call(ada, 'POST', W('/time/approvals/decision'), {
      userId: mo.id,
      week: WEEK,
      decision: 'approved',
    });
    const refused = await cell(300);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('give a reason to correct it');
    expect((await cell(300, 'Forgot the client call on Tuesday')).status).toBe(200);
    type Week = {
      state: string;
      corrections: { day: string; title: string; before: number; after: number; reason: string }[];
    };
    const w = (await t.call<Week>(mo, 'GET', W('/time/week?week=' + WEEK))).body;
    expect(w.state).toBe('submitted');
    expect(w.corrections).toEqual([
      expect.objectContaining({
        day: '2026-09-29',
        title: 'HEL-1 Live re-routing',
        before: 240,
        after: 300,
        reason: 'Forgot the client call on Tuesday',
      }),
    ]);
    const told = await inbox(ada, 'approval');
    expect(told.map((x) => x.title)).toContain('A locked week was corrected');
    expect(told.find((x) => x.title === 'A locked week was corrected')?.detail).toBe(
      'Mo corrected 29.09. from 4 h to 5 h; the week needs your approval again. Reason: Forgot the client call on Tuesday',
    );
  });

  it('reminds after 17:00 of a day with nothing booked, and on Friday of a week not submitted', async () => {
    // Lu booked Tuesday and did not submit; Mo's week is submitted
    await t.call(lu, 'PUT', W('/time/cell'), { day: '2026-09-29', minutes: 120, label: 'Reviews' });
    const friday = new Date('2026-10-02T15:30:00Z'); // 17:30 in Berlin
    const deps = { subject: 'mailto:ops@example.test' };
    await alertRound(t.db.pool, deps, friday);
    expect((await inbox(lu, 'reminder')).map((x) => x.title).sort()).toEqual([
      'No time booked today',
      'Submit your week',
    ]);
    expect((await inbox(mo, 'reminder')).map((x) => x.title)).toEqual(['No time booked today']);
    // Ada keeps no time: no reminders; and nothing twice
    expect(await inbox(ada, 'reminder')).toEqual([]);
    await alertRound(t.db.pool, deps, new Date('2026-10-02T16:30:00Z'));
    expect(await inbox(lu, 'reminder')).toHaveLength(2);
    // before 17:00 nothing is due
    await sys('DELETE FROM time_reminders');
    await sys("DELETE FROM inbox_items WHERE kind = 'reminder'");
    await alertRound(t.db.pool, deps, new Date('2026-10-02T12:00:00Z'));
    expect(await inbox(lu, 'reminder')).toEqual([]);
  });
});
