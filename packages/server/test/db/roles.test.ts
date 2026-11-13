// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
//    Why:  what a person may do decided by more than the base role, against the real server: a custom role
//          keeps only its permissions (a contractor writes tasks but ships nothing and runs no tests), a
//          condition limits a permission to hours in the workspace's time zone, a project role makes a member a
//          viewer of one project, and the access checker says why.
import { wallClock } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('custom roles, conditions and project roles (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let gus: Person;
  let project = '';
  let other = '';
  let role = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const task = (who: Person, projectId: string) =>
    t.call<{ id: string; error?: { message: string } }>(
      who,
      'POST',
      W('/projects/' + projectId + '/items'),
      { title: 'A task' },
    );
  const message = (r: { body: unknown }): string =>
    (r.body as { error: { message: string } }).error.message;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    other = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'OTH', name: 'Other' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets a custom role do only what it keeps', async () => {
    const made = await t.call<{ id: string; name: string }[]>(ada, 'POST', W('/roles'), {
      name: 'Contractor',
      baseRole: 'member',
      permissions: ['read', 'write', 'agents'],
    });
    role = made.body.find((r) => r.name === 'Contractor')?.id ?? '';
    await t.call(ada, 'PUT', W('/members/' + mo.id + '/custom-role'), { roleId: role });
    expect((await task(mo, project)).status).toBe(201);
    const release = await t.call(mo, 'POST', W('/projects/' + project + '/releases'), {
      version: '1.0.0',
    });
    expect(release.status).toBe(403);
    expect(message(release)).toBe(
      'The role Contractor does not allow this: Plan and ship releases',
    );
    const tests = await t.call(mo, 'POST', W('/projects/' + project + '/test-runs'), {
      name: 'Nightly',
    });
    expect(message(tests)).toBe(
      'The role Contractor does not allow this: Run tests and record results',
    );
    // reading is untouched, and the costs page needs a permission the role does not keep
    expect((await t.call(mo, 'GET', W('/projects/' + project + '/items'))).status).toBe(200);
    expect((await t.call(mo, 'GET', W('/ai-spend'))).status).toBe(403);
  });

  it('holds a permission only under its conditions, in the workspace time zone', async () => {
    const h = wallClock(new Date(), 'Europe/Berlin').hour;
    const closed: [number, number] = h < 23 ? [h + 1, 24] : [0, 23];
    const open: [number, number] = [h, h + 1];
    const bad = await t.call(ada, 'PATCH', W('/roles/' + role), {
      conditions: { write: { weekdays: [0, 8] } },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await t.call(ada, 'PATCH', W('/roles/' + role), {
          conditions: { write: { hours: closed } },
        })
      ).status,
    ).toBe(200);
    const refused = await task(mo, project);
    expect(refused.status).toBe(403);
    expect(message(refused)).toBe(
      'The role Contractor allows "Create and change tasks, plans and documents" only ' +
        String(closed[0]).padStart(2, '0') +
        ':00–' +
        String(closed[1]).padStart(2, '0') +
        ':00 (Europe/Berlin)',
    );
    await t.call(ada, 'PATCH', W('/roles/' + role), { conditions: { write: { hours: open } } });
    expect((await task(mo, project)).status).toBe(201);
    const roles = await t.call<{ custom: { name: string; conditions: unknown }[] }>(
      ada,
      'GET',
      W('/roles'),
    );
    expect(roles.body.custom.find((r) => r.name === 'Contractor')?.conditions).toEqual({
      write: { hours: open },
    });
    await t.call(ada, 'PUT', W('/members/' + mo.id + '/custom-role'), { roleId: null });
  });

  it('makes a member a viewer of one project', async () => {
    const item = (await task(mo, project)).body.id;
    expect(
      (
        await t.call(ada, 'PUT', W('/projects/' + project + '/members/' + mo.id), {
          role: 'viewer',
        })
      ).status,
    ).toBe(200);
    const change = await t.call(mo, 'PATCH', W('/items/' + item), { title: 'Renamed' });
    expect(change.status).toBe(403);
    expect(message(change)).toBe('You are a viewer in HEL: you can read it, not change it');
    expect((await task(mo, project)).status).toBe(403);
    // reading HEL and writing elsewhere are as before
    expect((await t.call(mo, 'GET', W('/items/' + item))).status).toBe(200);
    expect((await task(mo, other)).status).toBe(201);
    const list = await t.call<{ name: string; role: string; workspaceRole: string }[]>(
      mo,
      'GET',
      W('/projects/' + project + '/members'),
    );
    expect(list.body).toEqual([
      { userId: mo.id, name: 'Mo', workspaceRole: 'member', role: 'viewer' },
    ]);
    // only an admin sets project roles, and a guest comes in by invitation
    expect(
      (await t.call(mo, 'PUT', W('/projects/' + project + '/members/' + mo.id), { role: 'lead' }))
        .status,
    ).toBe(403);
    expect(
      (
        await t.call(ada, 'PUT', W('/projects/' + project + '/members/' + gus.id), {
          role: 'member',
        })
      ).status,
    ).toBe(409);

    const check = await t.call<{ allowed: boolean; steps: { ok: boolean; text: string }[] }>(
      ada,
      'GET',
      W('/access-check?userId=' + mo.id + '&projectId=' + project + '&permission=write'),
    );
    expect(check.body.allowed).toBe(false);
    expect(check.body.steps.map((s) => s.text)).toEqual([
      'Mo is a member with the member role.',
      'The member role may: Create and change tasks, plans and documents.',
      'Every member sees every project of the workspace, so HEL too.',
      'In HEL they are viewer: they can read it, not change it.',
      'A viewer of HEL changes nothing there.',
    ]);

    await t.call(ada, 'DELETE', W('/projects/' + project + '/members/' + mo.id));
    expect((await t.call(mo, 'PATCH', W('/items/' + item), { title: 'Renamed' })).status).toBe(200);
  });
});
