// ── [PCODE-257 | S15 | v0.1.0] T26.6 Hierarchy: initiatives, custom item types, custom fields ──
//    Why:  against the real server: an initiative rolls up its epics and every task below them; a project's
//          own type sets a task's kind; the project's fields are checked on every edit, filter the list and
//          go when the field goes.
import { fieldProblem } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe('custom field values', () => {
  it('follow the type of their field', () => {
    const choice = {
      key: 'tier',
      label: 'Tier',
      type: 'choice' as const,
      options: ['gold', 'silver'],
    };
    expect(fieldProblem(choice, 'gold')).toBeNull();
    expect(fieldProblem(choice, 'bronze')).toBe('Tier is one of gold, silver');
    expect(fieldProblem({ ...choice, type: 'number' }, '3')).toBe('Tier is a number');
    expect(fieldProblem({ ...choice, type: 'date' }, '2026-13-01')).toBe(
      'Tier is a day, YYYY-MM-DD',
    );
    expect(fieldProblem({ ...choice, type: 'date' }, null)).toBeNull();
  });
});

describe.skipIf(!hasDatabase)('hierarchy, types and fields (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let project = '';
  const st: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const add = async (title: string, extra: Record<string, unknown> = {}) =>
    t.call<{ id: string; kind: string; typeId: string | null; custom: Record<string, unknown> }>(
      ada,
      'POST',
      W('/projects/' + project + '/items'),
      { title, ...extra },
    );

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    for (const x of (
      await t.call<{ states: { id: string; name: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states)
      st[x.name] = x.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('rolls an initiative up from its epics and everything below them', async () => {
    const init = (await add('Self-service booking', { kind: 'initiative' })).body.id;
    const e1 = (await add('Booking', { kind: 'epic', parentId: init })).body.id;
    const e2 = (await add('Payments', { kind: 'epic', parentId: init })).body.id;
    await add('API', { parentId: e1, estimate: 3, stateId: st['Done'] });
    await add('Screen', { parentId: e1, estimate: 5 });
    await add('Stripe', { parentId: e2, estimate: 8, stateId: st['Done'] });
    await add('Dropped', { parentId: e2, estimate: 2, stateId: st['Cancelled'] });
    const r = await t.call<
      {
        ref: string;
        done: number;
        total: number;
        donePoints: number;
        totalPoints: number;
        epics: { title: string; done: number; total: number }[];
      }[]
    >(ada, 'GET', W('/projects/' + project + '/initiatives'));
    expect(r.body).toEqual([
      expect.objectContaining({
        ref: 'HEL-1',
        done: 2,
        total: 3,
        donePoints: 11,
        totalPoints: 16,
        epics: [
          expect.objectContaining({ title: 'Booking', done: 1, total: 2 }),
          expect.objectContaining({ title: 'Payments', done: 1, total: 1 }),
        ],
      }),
    ]);
  });

  it('gives a task the project’s own type, with its base kind', async () => {
    expect(
      (
        await t.call(mo, 'POST', W('/projects/' + project + '/item-types'), {
          name: 'Incident',
          baseKind: 'bug',
        })
      ).status,
    ).toBe(403);
    const types = await t.call<{ id: string; name: string }[]>(
      ada,
      'POST',
      W('/projects/' + project + '/item-types'),
      { name: 'Incident', baseKind: 'bug', color: '#b42318' },
    );
    const incident = types.body[0]?.id ?? '';
    const made = await add('Checkout down', { typeId: incident });
    expect(made.body).toMatchObject({ kind: 'bug', typeId: incident });
    const story = await add('Plain story', { kind: 'story' });
    const changed = await t.call<{ kind: string; typeId: string }>(
      ada,
      'PATCH',
      W('/items/' + story.body.id),
      { typeId: incident },
    );
    expect(changed.body).toMatchObject({ kind: 'bug', typeId: incident });
    const listed = await t.call<{ title: string }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/items?typeId=' + incident),
    );
    expect(listed.body.map((i) => i.title)).toEqual(['Checkout down', 'Plain story']);
  });

  it('keeps the project’s fields on tasks, checked, filterable, and gone with the field', async () => {
    const F = W('/projects/' + project + '/custom-fields');
    expect(
      (await t.call(ada, 'POST', F, { key: 'tier', label: 'Tier', type: 'choice' })).status,
    ).toBe(400);
    await t.call(ada, 'POST', F, { key: 'customer', label: 'Customer', type: 'text' });
    await t.call(ada, 'POST', F, {
      key: 'tier',
      label: 'Tier',
      type: 'choice',
      options: ['gold', 'silver'],
    });
    await t.call(ada, 'POST', F, { key: 'go_live', label: 'Go-live', type: 'date' });
    const fields = await t.call<{ id: string; key: string }[]>(ada, 'POST', F, {
      key: 'contact',
      label: 'Contact',
      type: 'person',
    });
    const a = await add('Export for Northwind', {
      custom: { customer: 'Northwind', tier: 'gold', contact: mo.id },
    });
    expect(a.body.custom).toEqual({ customer: 'Northwind', tier: 'gold', contact: mo.id });
    expect((await add('Bad', { custom: { tier: 'bronze' } })).status).toBe(400);
    expect((await add('Bad', { custom: { unknown: 1 } })).status).toBe(400);
    const b = await add('Export for Contoso', { custom: { customer: 'Contoso', tier: 'silver' } });
    const patched = await t.call<{ custom: Record<string, unknown> }>(
      ada,
      'PATCH',
      W('/items/' + b.body.id),
      { custom: { go_live: '2026-11-02', tier: null } },
    );
    expect(patched.body.custom).toEqual({ customer: 'Contoso', go_live: '2026-11-02' });
    const gold = await t.call<{ title: string }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/items?field=tier:gold'),
    );
    expect(gold.body.map((i) => i.title)).toEqual(['Export for Northwind']);
    const tierId = fields.body.find((f) => f.key === 'tier')?.id ?? '';
    await t.call(ada, 'DELETE', F + '/' + tierId);
    const after = await t.call<{ custom: Record<string, unknown> }>(
      ada,
      'GET',
      W('/items/' + a.body.id),
    );
    expect(after.body.custom).toEqual({ customer: 'Northwind', contact: mo.id });
  });
});
