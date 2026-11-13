// ── [PCODE-429 | S15 | v0.1.0] T37 low: A very short timer says why it booked nothing ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
//    Why:  Time against the real database: an IDE session becomes time on its task, the web timer runs and
//          stops, a forgotten one stops at 19:00 and is flagged, hours are corrected per day, a submitted
//          week is locked, the manager approves it (rates are kept) or returns it, absences are asked for
//          and decided (a colleague sees "away", not why), and the month report prices the hours.
import { localDay } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] ??= '7d'.repeat(32);

describe.skipIf(!hasDatabase)('time (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let lu: Person;
  let client = '';
  let project = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const sys = (sql: string, args: unknown[] = []) => inSystem(t.db.pool, (c) => c.query(sql, args));
  // [PCODE-216 | S15 | v0.1.0] the server's own day (local time), not UTC: they differ just after midnight
  const today = localDay(new Date());
  // a fixed past week keeps the test away from today's timers
  const WEEK = '2026-09-28';
  type Week = {
    state: string;
    rows: { itemId: string | null; label: string; billable: boolean; minutes: number[] }[];
    perDay: number[];
    total: number;
    timer: { id: string } | null;
    flags: { day: string; text: string }[];
    capacityMinutes: number;
    approver: string | null;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    lu = await t.signup('Lu');
    for (const p of [mo, lu])
      await t.call(ada, 'POST', W('/members'), { email: p.email, role: 'member' });
    client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
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

  it('turns an ended IDE session into billable time on its task', async () => {
    const ws = (
      await sys(
        `INSERT INTO work_sessions (workspace_id, user_id, item_id, client, sprint_code, version, started_at)
         VALUES ($1, $2, $3, 'laptop:/app', 'S15', 'v0.1.0', '2026-09-29T07:45:00Z') RETURNING id`,
        [ada.workspaceId, mo.id, item],
      )
    ).rows[0] as { id: string };
    await sys("UPDATE work_sessions SET ended_at = '2026-09-29T10:00:00Z' WHERE id = $1", [ws.id]);
    const w = await t.call<Week>(mo, 'GET', W('/time/week?week=' + WEEK));
    expect(w.body.rows).toEqual([
      expect.objectContaining({ itemId: item, billable: true, minutes: [0, 135, 0, 0, 0, 0, 0] }),
    ]);
    expect(w.body.approver).toBe('Ada');
  });

  it('runs a timer, and stops a forgotten one at 19:00 with a flag', async () => {
    const started = await t.call<{ id: string }>(mo, 'POST', W('/time/timer'), { itemId: item });
    expect(started.status).toBe(201);
    expect((await t.call<Week>(mo, 'GET', W('/time/week'))).body.timer?.id).toBe(started.body.id);
    const stopped = await t.call<{ minutes: number; dropped?: boolean }>(
      mo,
      'POST',
      W('/time/timer/stop'),
      {},
    );
    // [PCODE-429 | S15 | v0.1.0] stopped within a minute: nothing booked, and the answer says so
    expect(stopped.body).toMatchObject({ minutes: 0, dropped: true });
    expect((await t.call(mo, 'POST', W('/time/timer/stop'), {})).status).toBe(409);
    // a timer started on Wednesday morning and never stopped
    await sys(
      `INSERT INTO time_entries (workspace_id, user_id, item_id, project_id, day, source, started_at, billable)
       VALUES ($1, $2, $3, $4, '2026-09-30', 'timer', '2026-09-30T07:00:00Z', true)`,
      [ada.workspaceId, mo.id, item, project],
    );
    const w = await t.call<Week>(mo, 'GET', W('/time/week?week=' + WEEK));
    expect(w.body.perDay[2]).toBe(600);
    expect(w.body.flags.map((f) => f.text)).toContain(
      'A timer ran until 19:00 and was stopped: keep the time?',
    );
  });

  it('corrects hours per day, but never below what was tracked', async () => {
    const put = (minutes: number, extra: Record<string, unknown> = { itemId: item }) =>
      t.call(mo, 'PUT', W('/time/cell'), { day: '2026-09-29', minutes, ...extra });
    expect((await put(60)).status).toBe(409);
    expect((await put(180)).status).toBe(200);
    expect((await put(90, { label: 'Reviews and pairing' })).status).toBe(200);
    const w = await t.call<Week>(mo, 'GET', W('/time/week?week=' + WEEK));
    expect(w.body.rows.map((r) => [r.label, r.minutes[1], r.billable])).toEqual([
      ['', 180, true],
      ['Reviews and pairing', 90, false],
    ]);
    expect((await put(0, { label: 'Reviews and pairing' })).status).toBe(200);
    expect(
      (await t.call<Week>(mo, 'GET', W('/time/week?week=' + WEEK))).body.rows.map(
        (r) => r.minutes[1],
      ),
    ).toEqual([180]);
  });

  it('locks a submitted week; the manager returns it or approves it with the rates of the day', async () => {
    await t.call(ada, 'POST', W('/time/rates'), {
      scopeType: 'client',
      scopeKey: client,
      kind: 'billable',
      centsPerHour: 11000,
      validFrom: '2026-01-01',
    });
    await t.call(ada, 'POST', W('/time/rates'), {
      scopeType: 'workspace',
      kind: 'cost',
      centsPerHour: 6000,
      validFrom: '2026-01-01',
    });
    expect((await t.call(mo, 'POST', W('/time/week/submit'), { week: WEEK })).status).toBe(200);
    expect(
      (await t.call(mo, 'PUT', W('/time/cell'), { day: '2026-09-29', minutes: 240, itemId: item }))
        .status,
    ).toBe(409);
    const list = await t.call<{ weeks: { name: string; state: string; minutes: number }[] }>(
      ada,
      'GET',
      W('/time/approvals'),
    );
    expect(list.body.weeks).toEqual([
      expect.objectContaining({ name: 'Mo', state: 'submitted', minutes: 780 }),
    ]);
    expect(
      (await t.call<{ weeks: unknown[] }>(lu, 'GET', W('/time/approvals'))).body.weeks,
    ).toEqual([]);
    const decide = (decision: string, note?: string, who: Person = ada) =>
      t.call(who, 'POST', W('/time/approvals/decision'), {
        userId: mo.id,
        week: WEEK,
        decision,
        ...(note ? { note } : {}),
      });
    expect((await decide('approved', undefined, lu)).status).toBe(403);
    expect((await decide('returned')).status).toBe(400);
    expect((await decide('returned', 'Wednesday looks too long')).status).toBe(200);
    expect((await t.call<Week>(mo, 'GET', W('/time/week?week=' + WEEK))).body.state).toBe(
      'returned',
    );
    await t.call(mo, 'POST', W('/time/week/submit'), { week: WEEK });
    expect((await decide('approved')).status).toBe(200);
    const rates = (
      await sys(
        "SELECT DISTINCT rate_cents, cost_cents FROM time_entries WHERE user_id = $1 AND day BETWEEN '2026-09-28' AND '2026-10-04' AND billable",
        [mo.id],
      )
    ).rows;
    expect(rates).toEqual([{ rate_cents: '11000', cost_cents: '6000' }]);
  });

  it('prices the month per client against its budget', async () => {
    await sys(
      "INSERT INTO budgets (workspace_id, scope_type, scope_id, measure, period, amount_cents) VALUES ($1, 'client', $2, 'total', 'total', 500000)",
      [ada.workspaceId, client],
    );
    const r = await t.call<{
      clients: {
        name: string;
        minutes: number;
        billableMinutes: number;
        peopleCents: number;
        budgetCents: number;
      }[];
      unapprovedMinutes: number;
    }>(ada, 'GET', W('/time/report?month=2026-09'));
    const helio = r.body.clients.find((c) => c.name === 'Helio');
    // Mon 29 Sep: 3 h on the task; Tue 30 Sep: the 10 h timer
    expect(helio).toMatchObject({
      minutes: 780,
      billableMinutes: 780,
      peopleCents: 143000,
      budgetCents: 500000,
    });
    expect((await t.call(mo, 'GET', W('/time/report'))).status).toBe(403);
    const csv = await fetch(t.base + W('/time/report.csv?month=2026-09'), {
      headers: { cookie: ada.cookie },
    });
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain('Helio');
  });

  it('asks for time off; the manager decides; colleagues see only that someone is away', async () => {
    const asked = await t.call<{ id: string; state: string }>(mo, 'POST', W('/time/absences'), {
      startsOn: today,
      endsOn: today,
      kind: 'holiday',
      note: 'family',
    });
    expect(asked.body.state).toBe('requested');
    const sick = await t.call<{ state: string }>(lu, 'POST', W('/time/absences'), {
      startsOn: today,
      endsOn: today,
      kind: 'sick',
    });
    expect(sick.body.state).toBe('approved');
    expect(
      (
        await t.call(lu, 'POST', W('/time/absences/' + asked.body.id + '/decision'), {
          decision: 'approved',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(ada, 'POST', W('/time/absences/' + asked.body.id + '/decision'), {
          decision: 'approved',
        })
      ).status,
    ).toBe(200);
    const seen = await t.call<{ absences: { name: string; kind: string; note: string }[] }>(
      lu,
      'GET',
      W('/time/absences'),
    );
    expect(seen.body.absences.find((x) => x.name === 'Mo')).toMatchObject({
      kind: 'away',
      note: '',
    });
    expect(seen.body.absences.find((x) => x.name === 'Lu')).toMatchObject({ kind: 'sick' });
    const w = await t.call<Week>(mo, 'GET', W('/time/week'));
    const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
    expect(w.body.capacityMinutes).toBe(weekday === 0 || weekday === 6 ? 2400 : 1920);
  });

  it('tells the manager about a submitted week and a request for time off', async () => {
    await pumpWorkspace(t.db.pool, ada.workspaceId, {
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
    const titles = (
      await sys('SELECT title FROM inbox_items WHERE user_id = $1 ORDER BY created_at', [ada.id])
    ).rows.map((r) => (r as { title: string }).title);
    expect(titles).toEqual(
      expect.arrayContaining(['Mo submitted week 40', 'Mo asks for time off']),
    );
  });
});
