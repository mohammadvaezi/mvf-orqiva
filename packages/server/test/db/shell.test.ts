// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
//    Why:  the live shell's server side against PostgreSQL: a mention reaches the right inbox through the
//          dispatcher, entries move through read, snooze, reopen and done, a decision closes what waited
//          for it, notification rules and settings resolve per scope, and the top bar adds up the day.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { recordEvent } from '../../src/events/outbox.js';
import { pumpWorkspace, vapidKeys } from '../../src/push/dispatch.js';
import { isQuiet } from '../../src/push/quiet.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '7d'.repeat(32);

describe('quiet hours', () => {
  it('wraps midnight, follows the time zone and lets incidents through', () => {
    const q = { from: '20:00', to: '07:30', except: ['incident'] };
    // 21:30 in Berlin (summer time) is 19:30 UTC
    expect(isQuiet(new Date('2026-10-04T19:30:00Z'), 'Europe/Berlin', q, 'mention')).toBe(true);
    expect(isQuiet(new Date('2026-10-04T19:30:00Z'), 'Europe/Berlin', q, 'incident')).toBe(false);
    expect(isQuiet(new Date('2026-10-04T06:00:00Z'), 'Europe/Berlin', q, 'mention')).toBe(false);
    expect(isQuiet(new Date('2026-10-04T04:00:00Z'), 'Europe/Berlin', q, 'mention')).toBe(true);
    expect(isQuiet(new Date(), 'Europe/Berlin', null, 'mention')).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('the live shell (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person; // owner
  let bob: Person; // member
  let project = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const pump = () =>
    pumpWorkspace(t.db.pool, ada.workspaceId, {
      subject: 'mailto:ops@example.test',
      keys: () => vapidKeys(t.db.pool),
    });
  type Inbox = {
    items: {
      id: string;
      kind: string;
      title: string;
      url: string;
      state: string;
      readAt: string | null;
    }[];
    counts: { open: number; unread: number; done: number };
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export the report',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('files a mention in the inbox of the person mentioned, once, with the page it opens', async () => {
    await t.call(bob, 'POST', W('/items/' + item + '/comments'), {
      body: 'Could @' + (ada.email.split('@')[0] ?? '') + ' look at this?',
    });
    await pump();
    await pump();
    const inbox = await t.call<Inbox>(ada, 'GET', W('/inbox'));
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({
      kind: 'mention',
      state: 'open',
      url: '/items/' + item,
      readAt: null,
    });
    expect(inbox.body.counts).toMatchObject({ open: 1, unread: 1 });
    // the writer is not told about their own comment
    expect((await t.call<Inbox>(bob, 'GET', W('/inbox'))).body.items).toHaveLength(0);
  });

  it('moves an entry through read, snooze, reopen and done', async () => {
    const id = (await t.call<Inbox>(ada, 'GET', W('/inbox'))).body.items[0]?.id ?? '';
    const read = await t.call<{ readAt: string | null }>(ada, 'POST', W('/inbox/' + id), {
      action: 'read',
    });
    expect(read.body.readAt).not.toBeNull();
    expect(
      (
        await t.call(ada, 'POST', W('/inbox/' + id), {
          action: 'snooze',
          until: '2020-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(400);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (
        await t.call<{ state: string }>(ada, 'POST', W('/inbox/' + id), {
          action: 'snooze',
          until: later,
        })
      ).body.state,
    ).toBe('snoozed');
    expect((await t.call<Inbox>(ada, 'GET', W('/inbox'))).body.items).toHaveLength(0);
    expect(
      (await t.call<{ state: string }>(ada, 'POST', W('/inbox/' + id), { action: 'reopen' })).body
        .state,
    ).toBe('open');
    expect(
      (await t.call<{ state: string }>(ada, 'POST', W('/inbox/' + id), { action: 'done' })).body
        .state,
    ).toBe('done');
    expect((await t.call<Inbox>(ada, 'GET', W('/inbox?state=done'))).body.items).toHaveLength(1);
    // someone else's entry is not found
    expect((await t.call(bob, 'POST', W('/inbox/' + id), { action: 'reopen' })).status).toBe(404);
  });

  it('closes an approval in every inbox once the run is decided', async () => {
    const run = '00000000-0000-4000-8000-000000000042';
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO inbox_items (workspace_id, user_id, kind, object_type, object_id, title) VALUES ($1, $2, 'approval', 'agent_run', $3, 'Coder waits')",
        [ada.workspaceId, ada.id, run],
      ),
    );
    await inSystem(t.db.pool, (c) =>
      recordEvent(c, ada.workspaceId, {
        actor: { kind: 'user', id: ada.id, name: 'Ada' },
        verb: 'updated',
        object: { type: 'agent_run', id: run },
        changes: { decision: { from: 'waiting', to: 'approved' } },
      }),
    );
    await pump();
    const left = await inSystem(t.db.pool, (c) =>
      c.query<{ state: string }>('SELECT state FROM inbox_items WHERE object_id = $1', [run]),
    );
    expect(left.rows.map((r) => r.state)).toEqual(['done']);
  });

  it('keeps notification rules per kind and feeds the phone setting from them', async () => {
    const before = await t.call<{ rules: { eventKind: string; channels: string[] }[] }>(
      ada,
      'GET',
      W('/notification-rules'),
    );
    expect(before.body.rules.find((r) => r.eventKind === 'mentions')?.channels).toEqual([
      'in_app',
      'push',
    ]);
    expect(
      (
        await t.call(ada, 'PUT', W('/notification-rules/mentions'), {
          channels: ['in_app', 'email', 'email'],
        })
      ).body,
    ).toEqual({
      eventKind: 'mentions',
      channels: ['in_app', 'email'],
    });
    expect(
      (await t.call(ada, 'PUT', W('/notification-rules/mentions'), { channels: ['fax'] })).status,
    ).toBe(400);
    const push = await t.call<{ preferences: Record<string, boolean> }>(ada, 'GET', '/api/push');
    expect(push.body.preferences).toMatchObject({ mentions: false, approvals: true });
  });

  it('resolves settings from the most specific scope and says where each value comes from', async () => {
    type S = { key: string; value: unknown; source: string }[];
    const get = async (who: Person, q = ''): Promise<S> =>
      (await t.call<S>(who, 'GET', W('/settings' + q))).body;
    const of = (list: S, key: string) => list.find((s) => s.key === key);
    expect(of(await get(ada), 'money.format')).toMatchObject({ value: 'de-DE', source: 'default' });
    expect(
      (
        await t.call(bob, 'PUT', W('/settings/planning.sprint_weeks'), {
          scope: 'workspace',
          value: 3,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(ada, 'PUT', W('/settings/planning.sprint_weeks'), {
          scope: 'workspace',
          value: 3,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.call(ada, 'PUT', W('/settings/planning.sprint_weeks'), {
          scope: 'project',
          scopeId: project,
          value: 1,
        })
      ).status,
    ).toBe(200);
    expect(of(await get(ada), 'planning.sprint_weeks')).toMatchObject({
      value: 3,
      source: 'workspace',
    });
    expect(of(await get(ada, '?projectId=' + project), 'planning.sprint_weeks')).toMatchObject({
      value: 1,
      source: 'project',
    });
    // wrong values and scopes are refused with the reason
    const bad = await t.call<{ error: { message: string } }>(
      ada,
      'PUT',
      W('/settings/planning.sprint_weeks'),
      { scope: 'workspace', value: 9 },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('at most 6');
    expect(
      (
        await t.call(ada, 'PUT', W('/settings/money.format'), {
          scope: 'project',
          scopeId: project,
          value: 'en-GB',
        })
      ).status,
    ).toBe(400);
    // a person's own value applies only to them
    expect(
      (await t.call(bob, 'PUT', W('/settings/locale.language'), { scope: 'user', value: 'de' }))
        .status,
    ).toBe(200);
    expect(of(await get(bob), 'locale.language')).toMatchObject({ value: 'de', source: 'user' });
    expect(of(await get(ada), 'locale.language')).toMatchObject({ value: 'en', source: 'default' });
    expect(
      (
        await t.call(bob, 'PUT', W('/settings/locale.language'), {
          scope: 'user',
          scopeId: ada.id,
          value: 'de',
        })
      ).status,
    ).toBe(403);
    // clearing the project value lets the workspace value apply again
    expect(
      (
        await t.call(
          ada,
          'DELETE',
          W('/settings/planning.sprint_weeks?scope=project&scopeId=' + project),
        )
      ).body,
    ).toEqual({ removed: true });
    expect(of(await get(ada, '?projectId=' + project), 'planning.sprint_weeks')).toMatchObject({
      value: 3,
      source: 'workspace',
    });
  });

  it('adds up the top bar: inbox, agents at work and today’s AI spend in euro', async () => {
    // the workspace's agents are created when the list is first read
    await t.call(ada, 'GET', W('/agents'));
    await inSystem(t.db.pool, async (c) => {
      await c.query(
        "INSERT INTO fx_rates (day, usd_eur, source) VALUES (current_date, 0.9, 'test')",
      );
      const agent = (
        await c.query<{ id: string }>('SELECT id FROM agents WHERE workspace_id = $1 LIMIT 1', [
          ada.workspaceId,
        ])
      ).rows[0]?.id;
      await c.query(
        "INSERT INTO agent_runs (workspace_id, project_id, agent_id, instruction, model, status, cost_micros) VALUES ($1, $2, $3, 'x', 'm', 'running', 2500000)",
        [ada.workspaceId, project, agent],
      );
    });
    type Shell = {
      role: string;
      inbox: { open: number };
      agents: { running: number };
      spend: { todayCents: number; usdEur: number; rateSource: string };
      ide: { connected: boolean };
    };
    const s = (await t.call<Shell>(ada, 'GET', W('/shell'))).body;
    expect(s).toMatchObject({
      role: 'owner',
      agents: { running: 1 },
      spend: { todayCents: 225, usdEur: 0.9, rateSource: 'test' },
      ide: { connected: false },
    });
  });
});
