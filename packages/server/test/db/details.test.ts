// ── [PCODE-255 | S15 | v0.1.0] T26.4 Planning details: keys, bulk edit, undo, shared views, item history, Git moves, bug SLAs ──
//    Why:  against the real server: one request changes many tasks and says what they were, so undoing is
//          applying that back; views are saved per surface and shared with the team; a branch, a pull request
//          and a merge move their tasks forward and never back; a bug past its fix time alerts once.
import { slaDue, slaLeftText } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sign } from '../../src/git/webhook.js';
import { alertRound } from '../../src/push/alerts.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('bug fix times', () => {
  it('follow the priority', () => {
    expect(slaDue('2026-10-12T08:00:00Z', 'high')).toBe('2026-10-13T08:00:00.000Z');
    expect(slaDue('2026-10-12T08:00:00Z', 'none')).toBeNull();
    expect(slaLeftText('2026-10-12T11:00:00Z', new Date('2026-10-12T08:00:00Z'))).toBe('3 h left');
    expect(slaLeftText('2026-10-12T08:00:00Z', new Date('2026-10-15T08:00:00Z'))).toBe('3 d over');
  });
});

describe.skipIf(!hasDatabase)('planning details (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let bo: Person;
  let project = '';
  const st: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const state = (name: string): string => st[name] ?? '';
  const task = async (title: string, extra: Record<string, unknown> = {}): Promise<string> =>
    (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title,
        ...extra,
      })
    ).body.id;
  const item = async (id: string) =>
    (
      await t.call<{
        stateId: string;
        assigneeId: string | null;
        priority: string;
        labelIds: string[];
      }>(ada, 'GET', W('/items/' + id))
    ).body;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    bo = await t.signup('Bo');
    await t.call(ada, 'POST', W('/members'), { email: bo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    for (const s of (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states)
      st[s.name] = s.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('changes many tasks at once and says what they were', async () => {
    const a = await task('One');
    const b = await task('Two', { assigneeId: bo.id, priority: 'low' });
    const label = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/labels'), {
        name: 'export',
        color: '#3f76ff',
      })
    ).body.id;
    const r = await t.call<{
      updated: number;
      before: { id: string; fields: Record<string, unknown> }[];
    }>(ada, 'POST', W('/projects/' + project + '/items/bulk'), {
      itemIds: [a, b],
      set: {
        stateId: state('In Progress'),
        assigneeId: ada.id,
        priority: 'high',
        addLabelIds: [label],
      },
    });
    expect(r.body.updated).toBe(2);
    expect(await item(b)).toMatchObject({
      stateId: state('In Progress'),
      assigneeId: ada.id,
      priority: 'high',
      labelIds: [label],
    });
    expect(r.body.before.find((x) => x.id === b)?.fields).toEqual({
      stateId: state('Backlog'),
      assigneeId: bo.id,
      priority: 'low',
      labelIds: [],
    });
    // undo: the earlier values applied back
    for (const x of r.body.before) await t.call(ada, 'PATCH', W('/items/' + x.id), x.fields);
    expect(await item(b)).toMatchObject({
      stateId: state('Backlog'),
      assigneeId: bo.id,
      priority: 'low',
      labelIds: [],
    });
    // a strict definition of done holds back what is not done by it
    await t.call(ada, 'PUT', W('/settings/planning.enforce_definition_of_done'), {
      scope: 'project',
      scopeId: project,
      value: true,
    });
    const done = await t.call<{ updated: number; refused: { ref: string }[] }>(
      ada,
      'POST',
      W('/projects/' + project + '/items/bulk'),
      { itemIds: [a], set: { stateId: state('Done') } },
    );
    expect(done.body).toMatchObject({ updated: 0, refused: [{ ref: 'HEL-1' }] });
    const gone = await t.call<{ deleted: number }>(
      ada,
      'POST',
      W('/projects/' + project + '/items/bulk'),
      { itemIds: [a, b], delete: true },
    );
    expect(gone.body.deleted).toBe(2);
    expect((await t.call(ada, 'GET', W('/items/' + a))).status).toBe(404);
    // tasks of another project are refused as a whole
    const other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
    const foreign = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + other + '/items'), { title: 'x' })
    ).body.id;
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + project + '/items/bulk'), {
          itemIds: [foreign],
          set: { priority: 'high' },
        })
      ).status,
    ).toBe(400);
  });

  it('saves views per surface and shares them with the team', async () => {
    const F = W('/projects/' + project + '/filters');
    await t.call(ada, 'POST', F, {
      name: 'My bugs',
      surface: 'board',
      query: { lanes: 'person', quick: ['mine', 'bugs'] },
    });
    await t.call(ada, 'POST', F, {
      name: 'Team blockers',
      surface: 'board',
      shared: true,
      query: { quick: ['blocked'] },
    });
    await t.call(ada, 'POST', F, { name: 'A list filter', query: { q: 'export' } });
    const mine = await t.call<{ name: string; mine: boolean }[]>(ada, 'GET', F + '?surface=board');
    expect(mine.body.map((v) => v.name)).toEqual(['My bugs', 'Team blockers']);
    const theirs = await t.call<{ name: string; mine: boolean; owner: string }[]>(
      bo,
      'GET',
      F + '?surface=board',
    );
    expect(theirs.body.map((v) => [v.name, v.mine, v.owner])).toEqual([
      ['Team blockers', false, 'Ada'],
    ]);
  });

  it('moves tasks forward on a branch, a pull request and a merge, never back', async () => {
    await t.call(ada, 'PUT', W('/settings/git.moves'), {
      scope: 'project',
      scopeId: project,
      value: { branch: 'In Progress', opened: 'Review', merged: 'Done' },
    });
    await t.call(ada, 'PUT', W('/settings/planning.enforce_definition_of_done'), {
      scope: 'project',
      scopeId: project,
      value: false,
    });
    const x = await task('Export appointments');
    const ref =
      'HEL-' +
      String((await t.call<{ sequence: number }>(ada, 'GET', W('/items/' + x))).body.sequence);
    const conn = (
      await t.call<{ connection: { webhookPath: string }; secret: string }>(
        ada,
        'POST',
        W('/projects/' + project + '/git'),
        { provider: 'github', repo: 'acme/helio' },
      )
    ).body;
    const deliver = async (event: string, payload: Record<string, unknown>) => {
      const body = Buffer.from(
        JSON.stringify({ repository: { full_name: 'acme/helio' }, ...payload }),
      );
      return fetch(t.base + conn.connection.webhookPath, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-github-event': event,
          'x-hub-signature-256': 'sha256=' + sign(conn.secret, body),
        },
        body,
      });
    };
    const pr = (state: string, merged: boolean) => ({
      pull_request: {
        number: 7,
        title: ref + ' export',
        html_url: 'https://github.com/acme/helio/pull/7',
        state,
        merged,
        head: { ref: ref.toLowerCase() + '-export' },
        user: { login: 'ada' },
      },
    });
    expect(
      (await deliver('create', { ref_type: 'branch', ref: ref.toLowerCase() + '-export' })).status,
    ).toBe(200);
    expect((await item(x)).stateId).toBe(state('In Progress'));
    await deliver('pull_request', pr('open', false));
    expect((await item(x)).stateId).toBe(state('Review'));
    // a commit after the PR does not move it back
    await deliver('push', {
      ref: 'refs/heads/' + ref.toLowerCase() + '-export',
      commits: [
        { id: 'a'.repeat(40), message: ref + ' fix', url: '', author: { username: 'ada' } },
      ],
    });
    expect((await item(x)).stateId).toBe(state('Review'));
    await deliver('pull_request', pr('closed', true));
    expect((await item(x)).stateId).toBe(state('Done'));
  });

  it('shows bugs with their fix time and alerts once when one is past it', async () => {
    const bug = await task('Export crashes', {
      kind: 'bug',
      priority: 'urgent',
      assigneeId: bo.id,
    });
    await task('Typo', { kind: 'bug', priority: 'none' });
    const list = await t.call<{ title: string; overdue: boolean }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/bug-slas'),
    );
    // a bug without a fix time for its priority has none to show
    expect(list.body).toEqual([
      expect.objectContaining({ title: 'Export crashes', priority: 'urgent', overdue: false }),
    ]);
    const later = new Date(Date.now() + 9 * 3_600_000);
    const deps = { subject: 'mailto:ops@example.test' };
    expect((await alertRound(t.db.pool, deps, later)).slas).toBe(1);
    expect((await alertRound(t.db.pool, deps, later)).slas).toBe(0);
    const inbox = await t.call<{ items: { kind: string; title: string; url: string }[] }>(
      bo,
      'GET',
      W('/inbox'),
    );
    const reminder = inbox.body.items.find((i) => i.kind === 'reminder');
    expect(reminder?.title).toMatch(/^Bug HEL-\d+ is past its fix time$/);
    expect(reminder?.url).toBe('/items/' + bug);
  });
});
