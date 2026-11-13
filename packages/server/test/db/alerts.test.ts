// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
//    Why:  the alert round against the real database: a budget warns at its percentage and when used up,
//          once each; an unusual day of AI spend alerts once; a burst of changes to a watched page is one
//          notice after a quiet moment, never to the person who made them; a stale flag and a quiet idea
//          remind their owners once, and again only after they moved; each lands in the right inbox.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alertRound, WATCH_QUIET_MS } from '../../src/push/alerts.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

interface Entry {
  kind: string;
  title: string;
  detail: string;
  url: string;
}

describe.skipIf(!hasDatabase)('alerts and reminders (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  const deps = { subject: 'mailto:ops@example.test' };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const inbox = async (who: Person, kind: string): Promise<Entry[]> =>
    (await t.call<{ items: Entry[] }>(who, 'GET', W('/inbox'))).body.items.filter(
      (i) => i.kind === kind,
    );
  /** a finished run of the Analyst that cost this many micro-dollars, `daysAgo` days back */
  const spend = (micros: number, daysAgo = 0) =>
    inSystem(t.db.pool, (c) =>
      c.query(
        `INSERT INTO agent_runs (workspace_id, project_id, agent_id, instruction, status, model, cost_micros, created_at)
         SELECT $1, $2, a.id, 'work', 'succeeded', 'm', $3, now() - make_interval(days => $4::int)
           FROM agents a WHERE a.workspace_id = $1 AND a.key = 'analyst'`,
        [ada.workspaceId, project, micros, daysAgo],
      ),
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    await t.call(ada, 'GET', W('/agents'));
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('warns at a budget’s percentage and when it is used up, once each, and on an unusual day', async () => {
    expect(
      (
        await t.call(ada, 'POST', W('/budgets'), {
          scopeType: 'workspace',
          measure: 'ai',
          period: 'day',
          amountCents: 1000,
          warnPct: 80,
          hardStop: true,
        })
      ).status,
    ).toBe(201);
    // five ordinary days of about 0,90 €, then today 8,55 € at the fallback rate of 0,92
    for (const d of [1, 2, 3, 4, 5]) await spend(980_000, d);
    await spend(9_300_000);
    expect(await alertRound(t.db.pool, deps)).toMatchObject({ budgets: 1, anomalies: 1 });
    expect(await alertRound(t.db.pool, deps)).toMatchObject({ budgets: 0, anomalies: 0 });
    let budget = await inbox(ada, 'budget');
    expect(budget.map((b) => b.title).sort()).toEqual([
      'Budget at 85 %: the workspace, today',
      'Unusual AI spend today: 8,56 €',
    ]);
    expect(budget.find((b) => b.title.startsWith('Budget'))).toMatchObject({
      detail: '8,56 € of 10,00 € spent on AI today. Agent runs stop at 100 %.',
      url: '/tokens',
    });
    // a member who neither set it nor answers for it hears nothing
    expect(await inbox(bo, 'budget')).toEqual([]);

    await spend(2_000_000);
    expect((await alertRound(t.db.pool, deps)).budgets).toBe(1);
    budget = await inbox(ada, 'budget');
    expect(budget.map((b) => b.title)).toContain('Budget used up: the workspace, today');
  });

  it('tells a page’s watchers of a burst of changes once, after a quiet moment', async () => {
    const P = (p: string): string => W('/projects/' + project + p);
    const page = (
      await t.call<{ page: { id: string } }>(ada, 'POST', P('/docs'), { title: 'Runbook' })
    ).body.page.id;
    const watch = await t.call<{ watching: boolean }>(bo, 'POST', W('/docs/' + page + '/watch'));
    expect([watch.status, JSON.stringify(watch.body)]).toEqual([200, '{"watching":true}']);
    await t.call(ada, 'PUT', W('/docs/' + page), { body: 'Step one', baseVersion: 1 });
    await t.call(ada, 'PUT', W('/docs/' + page), { body: 'Step one\nStep two', baseVersion: 2 });
    await t.call(ada, 'POST', W('/docs/' + page + '/comments'), { body: 'Bo, check step two' });
    // Bo's own change tells Bo nothing
    await t.call(bo, 'PATCH', W('/docs/' + page), { status: 'in_review' });
    expect((await alertRound(t.db.pool, deps)).watch).toBe(0);
    const later = new Date(Date.now() + WATCH_QUIET_MS + 1000);
    expect((await alertRound(t.db.pool, deps, later)).watch).toBe(1);
    expect(await inbox(bo, 'watch')).toEqual([
      expect.objectContaining({
        title: 'Runbook changed',
        detail: 'Ada edited it (2 times) · Ada commented: Bo, check step two.',
        url: '/projects/' + project + '/documents?page=' + page,
      }),
    ]);
    expect(await inbox(ada, 'watch')).toEqual([]);
    expect((await alertRound(t.db.pool, deps, later)).watch).toBe(0);
  });

  it('reminds of a stale flag and a quiet idea once, and again after they moved', async () => {
    await t.call(ada, 'POST', W('/projects/' + project + '/flags'), { key: 'new-export' });
    const idea = (
      await t.call<{ id: string }>(bo, 'POST', W('/projects/' + project + '/ideas'), {
        title: 'Export by client',
      })
    ).body.id;
    expect(
      (await t.call(ada, 'PUT', W('/settings/ideas.stale_days'), { scope: 'workspace', value: 7 }))
        .status,
    ).toBe(200);
    await inSystem(t.db.pool, async (c) => {
      await c.query("UPDATE feature_flags SET updated_at = now() - interval '31 days'");
      await c.query("UPDATE ideas SET last_activity_at = now() - interval '8 days'");
    });
    expect((await alertRound(t.db.pool, deps)).reminders).toBe(2);
    expect((await alertRound(t.db.pool, deps)).reminders).toBe(0);
    expect((await inbox(ada, 'reminder')).map((r) => [r.title, r.url])).toEqual([
      ['Flag new-export in HEL unchanged for 30 days', '/projects/' + project + '/versions'],
    ]);
    expect((await inbox(bo, 'reminder')).map((r) => [r.title, r.url])).toEqual([
      ['Idea HEL #1 Export by client went quiet', '/ideas/' + idea],
    ]);
    // activity, then quiet again: a second reminder
    await inSystem(t.db.pool, (c) =>
      c.query(
        "UPDATE ideas SET last_activity_at = now() - interval '8 days', reminded_at = now() - interval '9 days'",
      ),
    );
    expect((await alertRound(t.db.pool, deps)).reminders).toBe(1);
  });
});
