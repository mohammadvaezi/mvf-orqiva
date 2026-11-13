// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
//    Why:  against the real server: a member keeps their own profile, an admin sets the manager and the
//          cost rate, and colleagues never see the rate; a person downloads everything kept about them and an
//          admin exports a member's data of the workspace, both without secrets; an offboarded person is
//          erased with their work kept under "Erased person"; and a task edit made on an old version is
//          refused instead of overwriting what someone else wrote.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzip } from '../../src/export/zip.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('profiles, personal data and safe task edits (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let cy: Person;
  let project = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const download = async (who: Person, path: string) => {
    const r = await fetch(t.base + path, { headers: { cookie: who.cookie } });
    const files = r.ok ? unzip(Buffer.from(await r.arrayBuffer())) : [];
    return {
      status: r.status,
      type: r.headers.get('content-type'),
      names: files.map((f) => f.name),
      text: (name: string) => files.find((f) => f.name === name)?.data.toString('utf8') ?? '',
      all: files.map((f) => f.data.toString('utf8')).join('\n'),
    };
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    item = (
      await t.call<{ id: string }>(mo, 'POST', W('/projects/' + project + '/items'), {
        title: 'Export cancelled appointments',
      })
    ).body.id;
    await t.call(mo, 'POST', W('/items/' + item + '/comments'), { body: 'I take this one' });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps a profile: the person’s own fields, the admin’s manager and cost rate', async () => {
    const P = W('/members/' + mo.id + '/profile');
    const own = await t.call(mo, 'PUT', P, {
      title: 'Backend developer',
      skills: ['TypeScript', 'PostgreSQL', 'TypeScript'],
      capacityHoursWeek: 32,
      focusFactor: 0.7,
      timezone: 'Europe/Lisbon',
      workingHours: { mon: ['09:00', '17:00'], tue: ['09:00', '17:00'] },
      quietHours: { from: '19:00' },
    });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      title: 'Backend developer',
      skills: ['TypeScript', 'PostgreSQL'],
      capacityHoursWeek: 32,
      focusFactor: 0.7,
      timezone: 'Europe/Lisbon',
      quietHours: { from: '19:00', to: '07:30' },
      costRateCents: null,
    });
    expect((await t.call(mo, 'PUT', P, { costRateCents: 9000 })).status).toBe(403);
    expect((await t.call(mo, 'PUT', P, { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await t.call(mo, 'PUT', P, { workingHours: { mon: ['17:00', '09:00'] } })).status).toBe(
      400,
    );
    expect((await t.call(cy, 'PUT', P, { title: 'Intern' })).status).toBe(403);
    const set = await t.call(ada, 'PUT', P, {
      managerId: ada.id,
      costRateCents: 9000,
    });
    expect(set.body).toMatchObject({ managerName: 'Ada', costRateCents: 9000 });
    // a colleague sees the profile, not the rate; the person sees their own
    const seen = await t.call(cy, 'GET', P);
    expect(seen.body).toMatchObject({ title: 'Backend developer', managerName: 'Ada' });
    expect('costRateCents' in seen.body).toBe(false);
    expect((await t.call(mo, 'GET', P)).body['costRateCents']).toBe(9000);
    // the history says the rate changed, never what it is
    const changed = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ changes: string }>(
            "SELECT envelope->'data'->>'changes' AS changes FROM activity_events WHERE object_type = 'member' AND object_id = $1 ORDER BY sequence DESC LIMIT 1",
            [mo.id],
          )
        ).rows[0]?.changes,
    );
    expect(changed).toContain('"costRate"');
    expect(changed).not.toContain('9000');
  });

  it('exports everything kept about a person, without secrets', async () => {
    await t.call(mo, 'POST', '/auth/tokens', { name: 'laptop' });
    const mine = await download(mo, '/auth/me/export');
    expect(mine.status).toBe(200);
    expect(mine.type).toBe('application/zip');
    expect(mine.names).toEqual(
      expect.arrayContaining([
        'README.txt',
        'account.json',
        'items.json',
        'comments.json',
        'member_profiles.json',
        'sessions.json',
        'api_tokens.json',
        'activity.json',
      ]),
    );
    expect(mine.text('account.json')).toContain(mo.email);
    expect(mine.text('comments.json')).toContain('I take this one');
    expect(mine.all).not.toMatch(/password_hash|token_hash/);
    // an admin's export of a member holds only this workspace, and no account-wide records
    expect((await download(cy, W('/members/' + mo.id + '/export'))).status).toBe(403);
    const theirs = await download(ada, W('/members/' + mo.id + '/export'));
    expect(theirs.names).toContain('items.json');
    expect(theirs.names).not.toContain('sessions.json');
    expect(theirs.text('README.txt')).toContain('in one workspace, exported by an admin');
  });

  it('erases a person who left, keeping their work under "Erased person"', async () => {
    const E = W('/members/' + mo.id + '/erase');
    expect((await t.call(ada, 'POST', E, { confirm: 'Mo' })).status).toBe(409);
    await t.call(ada, 'POST', W('/members/' + mo.id + '/offboard'), {
      handoverTo: ada.id,
      revokeTokens: true,
    });
    expect((await t.call(ada, 'POST', E, { confirm: 'Somebody' })).status).toBe(400);
    // Mo has a workspace of their own from sign-up: the account stays, this workspace forgets them
    const r = await t.call<{ accountErased: boolean; otherWorkspaces: number }>(ada, 'POST', E, {
      confirm: 'Mo',
    });
    expect(r.body).toEqual({ accountErased: false, otherWorkspaces: 1 });
    const left = await inSystem(t.db.pool, async (c) => ({
      member: (
        await c.query('SELECT 1 FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [
          mo.id,
          ada.workspaceId,
        ])
      ).rowCount,
      profile: (await c.query('SELECT 1 FROM member_profiles WHERE user_id = $1', [mo.id]))
        .rowCount,
      comment: (await c.query('SELECT 1 FROM comments WHERE author_id = $1', [mo.id])).rowCount,
    }));
    expect(left).toEqual({ member: 0, profile: 0, comment: 1 });

    // Cy belongs to no other workspace once their own is gone: the account is erased too
    await inSystem(t.db.pool, (c) =>
      c.query('DELETE FROM workspaces WHERE id = $1', [cy.workspaceId]),
    );
    await t.call(ada, 'POST', W('/members/' + cy.id + '/offboard'), {
      handoverTo: ada.id,
      revokeTokens: true,
    });
    const gone = await t.call<{ accountErased: boolean }>(
      ada,
      'POST',
      W('/members/' + cy.id + '/erase'),
      { confirm: 'Cy' },
    );
    expect(gone.body.accountErased).toBe(true);
    const account = await inSystem(
      t.db.pool,
      async (c) =>
        (
          await c.query<{ name: string; email: string; sessions: string }>(
            'SELECT name, email, (SELECT count(*) FROM sessions WHERE user_id = $1) AS sessions FROM users WHERE id = $1',
            [cy.id],
          )
        ).rows[0],
    );
    expect(account).toEqual({
      name: 'Erased person',
      email: 'erased-' + cy.id + '@erased.invalid',
      sessions: '0',
    });
    expect((await t.call(cy, 'GET', '/auth/me')).status).toBe(401);
  });

  it('refuses a task edit made on an older version', async () => {
    const it0 = (await t.call<{ version: number }>(ada, 'GET', W('/items/' + item))).body;
    const first = await t.call<{ version: number }>(ada, 'PATCH', W('/items/' + item), {
      description: 'Include the cancellation reason.',
      version: it0.version,
    });
    expect(first.status).toBe(200);
    const stale = await t.call<{ error: { message: string } }>(ada, 'PATCH', W('/items/' + item), {
      description: 'Something else',
      version: it0.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe(
      'HEL-1 changed since you opened it (by Ada); it is at version ' +
        String(first.body.version) +
        ' now. Reload it and make your change again.',
    );
    // If-Match says the same; an edit without a version stays last-write-wins
    const viaHeader = await fetch(t.base + W('/items/' + item), {
      method: 'PATCH',
      headers: {
        cookie: ada.cookie,
        'content-type': 'application/json',
        'if-match': '"' + String(it0.version) + '"',
      },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(viaHeader.status).toBe(409);
    expect((await t.call(ada, 'PATCH', W('/items/' + item), { title: 'Renamed' })).status).toBe(
      200,
    );
  });
});
