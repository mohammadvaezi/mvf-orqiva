// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-92 | S15 | v0.1.0] Add workspaces, projects, members and roles to the API ──
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inWorkspace } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('workspaces, members and projects (PostgreSQL)', () => {
  let t: TestApp;
  let owner: Person;
  let admin: Person;
  let member: Person;
  let guest: Person;
  let stranger: Person;
  let ws = '';

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.signup('Olga Owner');
    admin = await t.signup('Adam Admin');
    member = await t.signup('Mia Member');
    guest = await t.signup('Gus Guest');
    stranger = await t.signup('Sam Stranger');
    ws = owner.workspaceId;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  const W = (path = ''): string => '/api/workspaces/' + ws + path;

  describe('members and roles', () => {
    it('lets the owner add people by email with a role', async () => {
      for (const [p, role] of [
        [admin, 'admin'],
        [member, 'member'],
        [guest, 'guest'],
      ] as const) {
        const r = await t.call(owner, 'POST', W('/members'), { email: p.email, role });
        expect(r.status, p.name).toBe(201);
      }
      const list = await t.call<{ name: string; role: string }[]>(owner, 'GET', W('/members'));
      expect(list.body.map((m) => m.name + ':' + m.role)).toEqual([
        'Olga Owner:owner',
        'Adam Admin:admin',
        'Mia Member:member',
        'Gus Guest:guest',
      ]);
    });

    it('refuses an unknown email, a second membership, and an admin making an owner', async () => {
      expect(
        (
          await t.call(owner, 'POST', W('/members'), {
            email: 'nobody@example.test',
            role: 'member',
          })
        ).status,
      ).toBe(404);
      expect(
        (await t.call(owner, 'POST', W('/members'), { email: member.email, role: 'member' }))
          .status,
      ).toBe(409);
      expect(
        (await t.call(admin, 'POST', W('/members'), { email: stranger.email, role: 'owner' }))
          .status,
      ).toBe(403);
    });

    it('answers 404 to someone outside the workspace, so it does not reveal it exists', async () => {
      expect((await t.call(stranger, 'GET', W())).status).toBe(404);
      expect((await t.call(stranger, 'GET', W('/projects'))).status).toBe(404);
      expect((await t.call(null, 'GET', W())).status).toBe(401);
    });

    it('checks roles: a member cannot rename, an admin can', async () => {
      expect((await t.call(member, 'PATCH', W(), { name: 'Hacked' })).status).toBe(403);
      const r = await t.call<{ name: string; role: string; memberCount: number }>(
        admin,
        'PATCH',
        W(),
        { name: 'Olga Owner Co (renamed)' },
      );
      expect(r.body).toMatchObject({
        name: 'Olga Owner Co (renamed)',
        role: 'admin',
        memberCount: 4,
      });
    });

    it('never leaves a workspace without an owner', async () => {
      expect(
        (await t.call(owner, 'PATCH', W('/members/' + owner.id), { role: 'admin' })).status,
      ).toBe(409);
      expect((await t.call(owner, 'DELETE', W('/members/' + owner.id))).status).toBe(409);
      expect(
        (await t.call(admin, 'PATCH', W('/members/' + owner.id), { role: 'member' })).status,
      ).toBe(403);
    });

    it('shows people only through a shared workspace, even to a query without a WHERE', async () => {
      const seen = await inWorkspace(t.db.pool, ws, async (c) =>
        (await c.query<{ email: string }>('SELECT email FROM users ORDER BY email')).rows.map(
          (r) => r.email,
        ),
      );
      expect(seen).toHaveLength(4);
      expect(seen).not.toContain(stranger.email);
      const hashes = inWorkspace(t.db.pool, ws, (c) => c.query('SELECT password_hash FROM users'));
      await expect(hashes).rejects.toThrow(/permission denied/);
    });
  });

  describe('projects', () => {
    let projectId = '';
    let secretId = '';

    it('creates a project with the eight board states', async () => {
      const r = await t.call<{
        id: string;
        key: string;
        states: { name: string; group: string }[];
      }>(member, 'POST', W('/projects'), { key: 'APP', name: 'The App' });
      expect(r.status).toBe(201);
      projectId = r.body.id;
      expect(r.body.states.map((st) => st.name)).toEqual([
        'Backlog',
        'Todo',
        'In Progress',
        'Review',
        'Test',
        'Blocked',
        'Done',
        'Cancelled',
      ]);
      secretId = (
        await t.call<{ id: string }>(member, 'POST', W('/projects'), { key: 'SEC', name: 'Secret' })
      ).body.id;
    });

    it('refuses a duplicate key, a lowercase key and a guest creating projects', async () => {
      expect(
        (await t.call(member, 'POST', W('/projects'), { key: 'APP', name: 'Again' })).status,
      ).toBe(409);
      expect(
        (await t.call(member, 'POST', W('/projects'), { key: 'app', name: 'Lower' })).status,
      ).toBe(400);
      expect(
        (await t.call(guest, 'POST', W('/projects'), { key: 'GST', name: 'Guest' })).status,
      ).toBe(403);
    });

    it('shows a guest only the projects they are invited to', async () => {
      expect((await t.call<unknown[]>(guest, 'GET', W('/projects'))).body).toEqual([]);
      expect((await t.call(guest, 'GET', W('/projects/' + projectId))).status).toBe(404);
      expect(
        (
          await t.call(member, 'POST', W('/projects/' + projectId + '/guests'), {
            userId: guest.id,
          })
        ).status,
      ).toBe(403);
      const invited = await t.call<{ guests: { userId: string }[] }>(
        admin,
        'POST',
        W('/projects/' + projectId + '/guests'),
        { userId: guest.id },
      );
      expect(invited.body.guests.map((g) => g.userId)).toEqual([guest.id]);
      const list = await t.call<{ key: string }[]>(guest, 'GET', W('/projects'));
      expect(list.body.map((p) => p.key)).toEqual(['APP']);
      expect((await t.call(guest, 'GET', W('/projects/' + secretId))).status).toBe(404);
    });

    it('invites only guests to single projects', async () => {
      expect(
        (
          await t.call(admin, 'POST', W('/projects/' + projectId + '/guests'), {
            userId: member.id,
          })
        ).status,
      ).toBe(409);
    });

    it('lets members edit and only admins archive', async () => {
      expect(
        (await t.call(member, 'PATCH', W('/projects/' + projectId), { description: 'What it is' }))
          .status,
      ).toBe(200);
      expect(
        (await t.call(member, 'PATCH', W('/projects/' + projectId), { archived: true })).status,
      ).toBe(403);
      const r = await t.call<{ archived: boolean }>(admin, 'PATCH', W('/projects/' + secretId), {
        archived: true,
      });
      expect(r.body.archived).toBe(true);
    });

    it('records every change as an activity event under its parent', async () => {
      const rows = await inWorkspace(
        t.db.pool,
        ws,
        async (c) =>
          (
            await c.query<{ type: string; parent_type: string | null }>(
              "SELECT type, parent_type FROM activity_events WHERE object_type IN ('project', 'member') ORDER BY sequence",
            )
          ).rows,
      );
      expect(rows.map((r) => r.type)).toEqual(
        expect.arrayContaining([
          'orqiva.member.created',
          'orqiva.project.created',
          'orqiva.member.assigned',
          'orqiva.project.updated',
        ]),
      );
      expect(rows.every((r) => r.parent_type !== null)).toBe(true);
    });
  });

  describe('leaving', () => {
    it('lets a member leave and an admin remove a guest; the guest loses project access', async () => {
      expect((await t.call(member, 'DELETE', W('/members/' + member.id))).status).toBe(200);
      expect((await t.call(member, 'GET', W())).status).toBe(404);
      expect((await t.call(admin, 'DELETE', W('/members/' + guest.id))).status).toBe(200);
      expect((await t.call(guest, 'GET', W('/projects'))).status).toBe(404);
    });

    it('lets anyone create another workspace they own', async () => {
      const r = await t.call<{ role: string }>(stranger, 'POST', '/api/workspaces', {
        name: 'Side Project',
      });
      expect(r).toMatchObject({ status: 201, body: { role: 'owner' } });
    });
  });
});
