// ── [PCODE-254 | S15 | v0.1.0] T26.3 Flow and backlog: links, WIP limits, warnings, definition of done, triage, templates, recurring tasks ──
//    Why:  the flow rules against the real database: links read from both sides and a duplicate closes into
//          its original; the sprint's warnings name blocked tasks, tasks due after the sprint, tasks waiting on
//          work outside it and columns over their limit; the definitions are ticked off on the task and a
//          strict definition of done asks for a reason; triage holds outside work until a person decides;
//          templates make tasks, and a repeating one makes the next on its day, once.
import { nextRepeat } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recurRound } from '../../src/api/flow.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('repeating templates', () => {
  it('find their next day', () => {
    expect(nextRepeat('daily', null, '2026-10-11')).toBe('2026-10-12');
    // Sunday 11 Oct 2026: the next Monday, then a week later
    expect(nextRepeat('weekly', 1, '2026-10-11')).toBe('2026-10-12');
    expect(nextRepeat('weekly', 1, '2026-10-12')).toBe('2026-10-19');
    expect(nextRepeat('weekly', 7, '2026-10-11')).toBe('2026-10-18');
    expect(nextRepeat('monthly', 1, '2026-10-11')).toBe('2026-11-01');
    expect(nextRepeat('monthly', 15, '2026-10-11')).toBe('2026-10-15');
    expect(nextRepeat('none', null, '2026-10-11')).toBeNull();
  });
});

interface Link {
  kind: string;
  text: string;
  item: { ref: string; open: boolean };
}

describe.skipIf(!hasDatabase)('flow and backlog (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let sprint = '';
  const states: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const id = (k: string): string => ids[k] ?? '';
  const st = (k: string): string => states[k] ?? '';
  const add = async (title: string, extra: Record<string, unknown> = {}) =>
    (ids[title] = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title,
        ...extra,
      })
    ).body.id);

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    for (const st of (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states)
      states[st.name] = st.id;
    sprint = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/sprints'), {
        name: 'Sprint 1',
        startDate: '2026-10-19',
        endDate: '2026-10-30',
      })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('links tasks from both sides and closes a duplicate into its original', async () => {
    await add('Booking API');
    await add('Booking screen');
    await add('Booking screen (again)');
    const made = await t.call<Link[]>(ada, 'POST', W('/items/' + id('Booking API') + '/links'), {
      to: 'HEL-2',
      kind: 'blocks',
    });
    expect(made.status).toBe(201);
    expect(made.body.map((l) => l.text + ' ' + l.item.ref)).toEqual(['blocks HEL-2']);
    const other = await t.call<Link[]>(ada, 'GET', W('/items/' + id('Booking screen') + '/links'));
    expect(other.body.map((l) => l.text + ' ' + l.item.ref)).toEqual(['is blocked by HEL-1']);
    // the other way round would be a loop of two
    expect(
      (
        await t.call(ada, 'POST', W('/items/' + id('Booking screen') + '/links'), {
          to: 'HEL-1',
          kind: 'blocks',
        })
      ).status,
    ).toBe(409);
    const dup = await t.call<Link[]>(
      ada,
      'POST',
      W('/items/' + id('Booking screen (again)') + '/duplicate-of'),
      { of: 'HEL-2' },
    );
    expect(dup.body.map((l) => l.text + ' ' + l.item.ref)).toEqual(['duplicates HEL-2']);
    const closed = await t.call<{ stateId: string }>(
      ada,
      'GET',
      W('/items/' + id('Booking screen (again)')),
    );
    expect(closed.body.stateId).toBe(st('Cancelled'));
  });

  it('warns of what holds the sprint up', async () => {
    await t.call(ada, 'PATCH', W('/items/' + id('Booking screen')), {
      sprintId: sprint,
      stateId: st('In Progress'),
      dueDate: '2026-11-04',
    });
    await add('Export', { sprintId: sprint, stateId: st('In Progress') });
    await t.call(ada, 'POST', W('/projects/' + project + '/dependencies'), {
      predecessorId: id('Booking API'),
      successorId: id('Export'),
    });
    const wip = await t.call<{ wipLimit: number }>(
      ada,
      'PUT',
      W('/projects/' + project + '/states/' + st('In Progress') + '/wip'),
      { limit: 1 },
    );
    expect(wip.body.wipLimit).toBe(1);
    const p = await t.call<{ states: { name: string; wipLimit: number | null }[] }>(
      ada,
      'GET',
      W('/projects/' + project),
    );
    expect(p.body.states.find((s) => s.name === 'In Progress')?.wipLimit).toBe(1);
    const w = await t.call<{ kind: string; text: string }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/warnings?sprintId=' + sprint),
    );
    expect(w.body.map((x) => [x.kind, x.text])).toEqual([
      ['blocked', 'HEL-2 is blocked by HEL-1'],
      ['due_after_sprint', 'HEL-2 is due 2026-11-04, after the sprint ends on 2026-10-30'],
      ['depends_outside', 'HEL-4 waits for HEL-1, which is not in the sprint'],
      ['over_wip', 'In Progress holds 2 tasks; its limit is 1'],
    ]);
  });

  it('ticks off the definitions, and a strict definition of done asks why', async () => {
    const C = W('/items/' + id('Export') + '/checks');
    expect((await t.call(ada, 'PUT', C, { list: 'ready', ticked: ['vibes'] })).status).toBe(400);
    const r = await t.call<{ isReady: boolean; ready: string[] }>(ada, 'PUT', C, {
      list: 'ready',
      ticked: ['acceptance criteria', 'estimate', 'no open questions'],
    });
    expect(r.body.isReady).toBe(true);
    await t.call(ada, 'PUT', C, { list: 'done', ticked: ['criteria met', 'tests green'] });
    // without the strict setting, done is done
    await add('Small fix', { stateId: st('In Progress') });
    expect(
      (await t.call(ada, 'PATCH', W('/items/' + id('Small fix')), { stateId: st('Done') })).status,
    ).toBe(200);
    await t.call(ada, 'PUT', W('/settings/planning.enforce_definition_of_done'), {
      scope: 'project',
      scopeId: project,
      value: true,
    });
    const refused = await t.call<{ error: { message: string } }>(
      ada,
      'PATCH',
      W('/items/' + id('Export')),
      { stateId: st('Done') },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe(
      'Not done by the definition yet: review approved, docs updated. Tick them off, or say why it is done anyway.',
    );
    expect(
      (
        await t.call(ada, 'PATCH', W('/items/' + id('Export')), {
          stateId: st('Done'),
          doneReason: 'Docs follow in HEL-9',
        })
      ).status,
    ).toBe(200);
    const comments = await t.call<{ body: string }[]>(
      ada,
      'GET',
      W('/items/' + id('Export') + '/comments'),
    );
    expect(comments.body.map((c) => c.body)).toContain(
      'Done with review approved, docs updated open: Docs follow in HEL-9',
    );
  });

  it('holds outside work in triage until a person decides', async () => {
    await add('From the support tool', { triage: true });
    await add('Spam from the tool', { triage: true });
    const list = await t.call<{ ref: string }[]>(ada, 'GET', W('/projects/' + project + '/triage'));
    expect(list.body.map((x) => x.ref)).toEqual(['HEL-6', 'HEL-7']);
    await t.call(ada, 'POST', W('/items/' + id('From the support tool') + '/triage'), {
      action: 'accept',
    });
    const declined = await t.call<{ state: string }>(
      ada,
      'POST',
      W('/items/' + id('Spam from the tool') + '/triage'),
      { action: 'decline', reason: 'not ours' },
    );
    expect(declined.body.state).toBe('Cancelled');
    expect(
      (await t.call<unknown[]>(ada, 'GET', W('/projects/' + project + '/triage'))).body,
    ).toEqual([]);
  });

  it('makes tasks from templates, and a repeating template on its day, once', async () => {
    const tpl = await t.call<{ id: string; nextOn: string | null }>(
      ada,
      'POST',
      W('/projects/' + project + '/templates'),
      { name: 'Release check', title: 'Check the release', kind: 'task', estimate: 2 },
    );
    expect(tpl.status).toBe(201);
    expect(tpl.body.nextOn).toBeNull();
    const used = await t.call<{ ref: string }>(
      ada,
      'POST',
      W('/templates/' + tpl.body.id + '/use'),
      {
        sprintId: sprint,
      },
    );
    expect(used.body.ref).toBe('HEL-8');
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + project + '/templates'), {
          name: 'Weekly',
          title: 'x',
          repeat: 'weekly',
        })
      ).status,
    ).toBe(400);
    const weekly = await t.call<{ nextOn: string }>(
      ada,
      'POST',
      W('/projects/' + project + '/templates'),
      {
        name: 'Dependency updates',
        title: 'Update the dependencies',
        repeat: 'weekly',
        repeatOn: 1,
      },
    );
    const day = new Date(weekly.body.nextOn + 'T09:00:00Z');
    expect(await recurRound(t.db.pool, new Date(day.getTime() - 86_400_000))).toBe(0);
    expect(await recurRound(t.db.pool, day)).toBe(1);
    expect(await recurRound(t.db.pool, day)).toBe(0);
    const items = (
      await t.call<{ title: string; sprintId: string | null }[]>(
        ada,
        'GET',
        W('/projects/' + project + '/items'),
      )
    ).body;
    expect(items.filter((i) => i.title === 'Update the dependencies').length).toBe(1);
    expect(items.find((i) => i.title === 'Check the release')?.sprintId).toBe(sprint);
  });
});
