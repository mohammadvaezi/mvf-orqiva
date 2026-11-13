// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-343 | S15 | v0.1.0] T34.3a Hour budgets with alerts, time reports by person, sprint and task, DATEV export ──
//    Why:  against the real database: a project's monthly hour budget warns the admins once at its warning
//          level and once when used up; time is summed over a range by person, sprint and task with its
//          amount; and the billable amounts leave as a DATEV Buchungsstapel with the client's account.
import { localDay } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('hour budgets, breakdowns and DATEV (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let client = '';
  let project = '';
  let item = '';
  const today = localDay(new Date());
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Entry = { kind: string; title: string; detail: string };
  const budgetAlerts = async (): Promise<Entry[]> =>
    (await t.call<{ items: Entry[] }>(ada, 'GET', W('/inbox'))).body.items.filter(
      (i) => i.kind === 'budget',
    );
  const book = (minutes: number, extra: Record<string, unknown>) =>
    t.call(mo, 'PUT', W('/time/cell'), { day: today, minutes, billable: true, ...extra });

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio app' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: client });
    const sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 7',
        startDate: today,
        endDate: today,
      })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Live re-routing',
      })
    ).body.id;
    await inSystem(t.db.pool, (c) =>
      c.query('UPDATE items SET sprint_id = $2 WHERE id = $1', [item, sprint]),
    );
    await t.call(ada, 'POST', W('/time/rates'), {
      scopeType: 'client',
      scopeKey: client,
      kind: 'billable',
      centsPerHour: 10000,
      validFrom: '2026-01-01',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('warns once at the warning level and once when the hours are used up', async () => {
    expect(
      (
        await t.call(mo, 'PUT', W('/time/hour-budgets'), {
          scopeType: 'project',
          scopeId: project,
          period: 'month',
          hours: 10,
        })
      ).status,
    ).toBe(403);
    const b = await t.call<{ hours: number; warnPct: number; usedHours: number }>(
      ada,
      'PUT',
      W('/time/hour-budgets'),
      {
        scopeType: 'project',
        scopeId: project,
        period: 'month',
        hours: 10,
      },
    );
    expect(b.body).toMatchObject({ hours: 10, warnPct: 80, usedHours: 0 });
    await book(420, { itemId: item });
    // [PCODE-351 | S15 | v0.1.0] half the hours tell first
    expect((await budgetAlerts()).map((e) => e.title)).toEqual([
      'HEL Helio app: 70 % of the hour budget',
    ]);
    await book(90, { projectId: project, label: 'Reviews' });
    expect((await budgetAlerts()).map((e) => e.title).sort()).toEqual([
      'HEL Helio app: 70 % of the hour budget',
      'HEL Helio app: 85 % of the hour budget',
    ]);
    await book(150, { projectId: project, label: 'Pairing' });
    await book(30, { projectId: project, label: 'Support' });
    const all = await budgetAlerts();
    expect(all.map((e) => e.title).sort()).toEqual([
      'HEL Helio app: 70 % of the hour budget',
      'HEL Helio app: 85 % of the hour budget',
      'HEL Helio app: hour budget used up',
    ]);
    expect(all.find((e) => e.title.endsWith('used up'))?.detail).toContain(
      '11 of 10 h booked this month.',
    );
    const list = (
      await t.call<{ budgets: { usedHours: number; pct: number }[] }>(
        ada,
        'GET',
        W('/time/hour-budgets'),
      )
    ).body.budgets;
    expect(list).toEqual([expect.objectContaining({ usedHours: 11.5, pct: 115 })]);
  });

  it('sums a range by person, sprint and task, with the amount', async () => {
    type B = {
      minutes: number;
      cents: number;
      rows: { label: string; minutes: number; cents: number }[];
    };
    const q = (by: string) => W('/time/breakdown?from=' + today + '&to=' + today + '&by=' + by);
    expect((await t.call(mo, 'GET', q('person'))).status).toBe(403);
    const person = (await t.call<B>(ada, 'GET', q('person'))).body;
    expect(person).toMatchObject({ minutes: 690, cents: 115000 });
    expect(person.rows).toEqual([expect.objectContaining({ label: 'Mo', minutes: 690 })]);
    const sprint = (await t.call<B>(ada, 'GET', q('sprint'))).body.rows.map((r) => [
      r.label,
      r.minutes,
    ]);
    expect(sprint).toEqual([
      ['Sprint 7', 420],
      ['No sprint', 270],
    ]);
    const task = (await t.call<B>(ada, 'GET', q('task'))).body.rows.map((r) => r.label);
    expect(task).toEqual(['HEL-1 Live re-routing', 'Pairing', 'Reviews', 'Support']);
    const csv = await fetch(t.base + q('task').replace('/breakdown?', '/breakdown.csv?'), {
      headers: { cookie: ada.cookie },
    });
    expect(await csv.text()).toContain('"HEL-1 Live re-routing","7,00","7,00","700,00"');
    expect(
      (await t.call(ada, 'GET', W('/time/breakdown?from=2026-10-02&to=2026-10-01'))).status,
    ).toBe(400);
  });

  it('exports the billable amounts as a DATEV Buchungsstapel', async () => {
    await t.call(ada, 'PUT', W('/clients/' + client + '/datev-account'), { account: '10042' });
    const r = await fetch(
      t.base +
        W(
          '/time/datev.csv?from=' +
            today +
            '&to=' +
            today +
            '&revenueAccount=8400&consultant=1001&client=1',
        ),
      { headers: { cookie: ada.cookie } },
    );
    expect(r.status).toBe(200);
    const lines = (await r.text()).split('\r\n');
    expect(lines[0]).toMatch(/^"EXTF";700;21;"Buchungsstapel";13;\d{17};;"OR";"orqiva";"";1001;1;/);
    expect(lines[1]).toContain('Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen');
    expect(lines[2]).toBe(
      '1150,00;"S";"EUR";;;;10042;8400;"";' +
        today.slice(8, 10) +
        today.slice(5, 7) +
        ';"ORQ' +
        today.slice(0, 7).replace('-', '') +
        '-1";"";;"Leistungen Helio HEL 11,50 h"',
    );
    expect(
      (
        await t.call(
          mo,
          'GET',
          W(
            '/time/datev.csv?from=' +
              today +
              '&to=' +
              today +
              '&revenueAccount=8400&consultant=1001&client=1',
          ),
        )
      ).status,
    ).toBe(403);
  });
});
