// ── [PCODE-182 | S15 | v0.1.0] B5.3 People live: members, teams, roles, sign-in rules and sessions, access reviews, access checker, offboarding ──
//    Why:  the People section against the real database: the member list with seats, teams, custom
//          roles that only narrow their base role, sign-in rules that are enforced (second factor, session
//          age) without locking out the admin, the access checker's explanation, access reviews, sessions,
//          and offboarding that hands over work, revokes tokens, suspends and frees the seat.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('people (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let gus: Person;
  let project = '';
  let other = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type PersonRow = {
    userId: string;
    role: string;
    teams: string[];
    secondFactor: boolean;
    takesSeat: boolean;
    suspendedAt: string | null;
    customRoleName: string | null;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'PPL', name: 'People' })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects/' + project + '/guests'), { userId: gus.id });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lists everyone with role, seat and second factor, and keeps teams', async () => {
    const r = await t.call<{ people: PersonRow[]; seats: { used: number } }>(
      mo,
      'GET',
      W('/people'),
    );
    expect(r.body.people.map((p) => [p.role, p.secondFactor, p.takesSeat])).toEqual(
      expect.arrayContaining([
        ['owner', false, true],
        ['member', false, true],
        ['guest', false, true],
      ]),
    );
    expect(r.body.seats.used).toBe(3);
    expect(
      (await t.call(mo, 'PUT', W('/teams'), { name: 'Core', memberIds: [mo.id] })).status,
    ).toBe(403);
    const teams = await t.call<{ name: string; members: { userId: string; lead: boolean }[] }[]>(
      ada,
      'PUT',
      W('/teams'),
      { name: 'Core', memberIds: [ada.id, mo.id], leadIds: [ada.id] },
    );
    expect(teams.body[0]?.members.find((m) => m.userId === ada.id)?.lead).toBe(true);
    expect((await t.call(ada, 'PUT', W('/teams'), { name: 'Core', memberIds: [] })).status).toBe(
      409,
    );
    const again = await t.call<{ people: PersonRow[] }>(ada, 'GET', W('/people'));
    expect(again.body.people.find((p) => p.userId === mo.id)?.teams).toEqual(['Core']);
  });

  it('builds custom roles that only narrow their base role', async () => {
    const roles = await t.call<{ builtIn: { key: string; roles: string[] }[] }>(
      mo,
      'GET',
      W('/roles'),
    );
    expect(roles.body.builtIn.find((p) => p.key === 'people')?.roles).toEqual(['owner', 'admin']);
    expect(
      (
        await t.call(ada, 'POST', W('/roles'), {
          name: 'Reader',
          baseRole: 'guest',
          permissions: ['read', 'write'],
        })
      ).status,
    ).toBe(400);
    const made = await t.call<{ id: string; name: string }[]>(ada, 'POST', W('/roles'), {
      name: 'Reviewer',
      baseRole: 'tester',
      permissions: ['read', 'test'],
    });
    const id = made.body.find((r) => r.name === 'Reviewer')?.id ?? '';
    const p = await t.call<PersonRow>(ada, 'PUT', W('/members/' + mo.id + '/custom-role'), {
      roleId: id,
    });
    expect(p.body).toMatchObject({ role: 'tester', customRoleName: 'Reviewer' });
    await t.call(ada, 'PATCH', W('/members/' + mo.id), { role: 'member' });
  });

  it('enforces the sign-in rules and never locks out the admin who sets them', async () => {
    const rules = { sessionIdleHours: null, sessionMaxDays: null };
    expect(
      (await t.call(ada, 'PUT', W('/sign-in-rules'), { ...rules, mfaRoles: ['owner'] })).status,
    ).toBe(409);
    await t.call(ada, 'PUT', W('/sign-in-rules'), { ...rules, mfaRoles: ['member'] });
    const blocked = await t.call<{ error: { code: string } }>(mo, 'GET', W('/projects'));
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'second_factor_required']);
    await t.call(ada, 'PUT', W('/sign-in-rules'), { ...rules, mfaRoles: [], sessionMaxDays: 7 });
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE sessions SET created_at = now() - interval '10 days' WHERE user_id = $1", [
        mo.id,
      ]),
    );
    expect((await t.call(mo, 'GET', W('/projects'))).status).toBe(401);
    await t.call(ada, 'PUT', W('/sign-in-rules'), { ...rules, mfaRoles: [] });
    expect((await t.call(mo, 'GET', W('/projects'))).status).toBe(200);
  });

  it('explains why a person can or cannot see a project or task', async () => {
    type Check = { allowed: boolean; steps: { ok: boolean; text: string }[]; hint: string };
    expect(
      (await t.call(mo, 'GET', W('/access-check?userId=' + gus.id + '&projectId=' + other))).status,
    ).toBe(403);
    const no = await t.call<Check>(
      ada,
      'GET',
      W('/access-check?userId=' + gus.id + '&projectId=' + other),
    );
    expect(no.body.allowed).toBe(false);
    expect(no.body.steps.at(-1)?.text).toContain('Guests see only projects they are invited to');
    expect(no.body.hint).toContain('Invite them to OTH');
    const item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Shared work',
      })
    ).body.id;
    const yes = await t.call<Check>(
      ada,
      'GET',
      W('/access-check?userId=' + gus.id + '&itemId=' + item),
    );
    expect(yes.body.allowed).toBe(true);
    expect(yes.body.steps.map((s) => s.text)).toContain('They were invited to PPL as a guest.');
    expect(
      (await t.call<Check>(ada, 'GET', W('/access-check?userId=' + mo.id + '&projectId=' + other)))
        .body.allowed,
    ).toBe(true);
  });

  it('runs an access review until everyone is decided', async () => {
    const started = await t.call<{ id: string; items: { userId: string }[] }[]>(
      ada,
      'POST',
      W('/access-reviews'),
      { title: 'Q4 review', dueOn: '2026-10-15' },
    );
    expect(started.body[0]?.items).toHaveLength(3);
    expect((await t.call(ada, 'POST', W('/access-reviews'), { title: 'Again' })).status).toBe(409);
    const id = started.body[0]?.id ?? '';
    for (const u of [ada.id, mo.id])
      await t.call(ada, 'POST', W('/access-reviews/' + id + '/items/' + u), { decision: 'keep' });
    const last = await t.call<{ closedAt: string | null }[]>(
      ada,
      'POST',
      W('/access-reviews/' + id + '/items/' + gus.id),
      { decision: 'remove', note: 'project ended' },
    );
    expect(last.body[0]?.closedAt).toBeTruthy();
  });

  it('lists your sessions and ends the others', async () => {
    const list = await t.call<{ id: string; current: boolean; device: string }[]>(
      mo,
      'GET',
      '/auth/sessions',
    );
    expect(list.body.filter((s) => s.current)).toHaveLength(1);
    expect(
      (await t.call<{ ended: number }>(mo, 'POST', '/auth/sessions/end-others')).body.ended,
    ).toBe(list.body.length - 1);
    expect((await t.call(mo, 'GET', W('/projects'))).status).toBe(200);
  });

  it('offboards: hands over work and agents, revokes tokens, suspends and frees the seat', async () => {
    const st = (
      await t.call<{ states: { id: string; group: string }[] }>(
        ada,
        'GET',
        W('/projects/' + project),
      )
    ).body.states.find((s) => s.group === 'started')?.id;
    const task = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/items'), {
        title: 'Mo works on it',
        assigneeId: mo.id,
        stateId: st,
      })
    ).body.id;
    const agent = (await t.call<{ id: string }[]>(ada, 'GET', W('/agents'))).body[0]?.id ?? '';
    await t.call(ada, 'PATCH', W('/agents/' + agent), { ownerId: mo.id });
    const tok = await t.call<{ token: string }>(mo, 'POST', W('/access-tokens'), {
      name: 'Mo CLI',
      scopes: ['read'],
    });
    expect(
      (
        await t.call(mo, 'POST', W('/members/' + ada.id + '/offboard'), {
          handoverTo: null,
          revokeTokens: true,
        })
      ).status,
    ).toBe(403);
    const off = await t.call<{ tasks: number; agents: number; tokens: number; person: PersonRow }>(
      ada,
      'POST',
      W('/members/' + mo.id + '/offboard'),
      { handoverTo: ada.id, revokeTokens: true },
    );
    expect(off.body).toMatchObject({
      tasks: 1,
      agents: 1,
      tokens: 1,
      person: { takesSeat: false },
    });
    expect(off.body.person.suspendedAt).toBeTruthy();
    expect(
      (await t.call<{ assigneeId: string }>(ada, 'GET', W('/items/' + task))).body.assigneeId,
    ).toBe(ada.id);
    expect((await t.call(mo, 'GET', W('/projects'))).status).toBe(404);
    const res = await fetch(t.base + W('/projects'), {
      headers: { authorization: 'Bearer ' + tok.body.token },
    });
    expect(res.status).toBe(401);
    expect(
      (await t.call<{ workspaces: { id: string }[] }>(mo, 'GET', '/auth/me')).body.workspaces.map(
        (w) => w.id,
      ),
    ).not.toContain(ada.workspaceId);
    expect(
      (await t.call<{ seats: { used: number } }>(ada, 'GET', W('/people'))).body.seats.used,
    ).toBe(2);
    expect(
      (await t.call<PersonRow>(ada, 'POST', W('/members/' + mo.id + '/restore'))).body.suspendedAt,
    ).toBeNull();
    expect((await t.call(mo, 'GET', W('/projects'))).status).toBe(200);
  });
});
