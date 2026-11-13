// ── [PCODE-161 | S15 | v0.1.0] B0 data model v2: model for all approved screens and the foundation migrations ──
//    Why:  client isolation lives in the database, so it is tested there: a transaction opened for one
//          client sees only that client's projects, items, client-visible comments and shared files, can
//          write only comments meant for the client, and sees nothing of the team's structure.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { inSystem, inWorkspace } from '../../src/db/pool.js';
import { createTestDb, hasDatabase, type TestDb } from './testdb.js';

describe.skipIf(!hasDatabase)('data model v2: clients and the foundation (PostgreSQL)', () => {
  let db: TestDb;
  let ws = '';
  let helio = '';
  let nordwind = '';
  const ids: Record<string, string> = {};

  const one = async (sql: string, params: unknown[]): Promise<string> =>
    inSystem(db.pool, async (c) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id ?? '');

  beforeAll(async () => {
    db = await createTestDb();
    await migrate(db.pool);
    ws = await one(
      "INSERT INTO workspaces (slug, name) VALUES ('broszio', 'Broszio') RETURNING id",
      [],
    );
    helio = await one(
      "INSERT INTO clients (workspace_id, name, short_name, portal_domain) VALUES ($1, 'Helio Health AG', 'Helio', 'projects.helio-health.de') RETURNING id",
      [ws],
    );
    nordwind = await one(
      "INSERT INTO clients (workspace_id, name, short_name) VALUES ($1, 'Nordwind Logistik GmbH', 'Nordwind') RETURNING id",
      [ws],
    );
    for (const [key, client] of [
      ['HEL', helio],
      ['NWL', nordwind],
      ['PE', null],
    ] as const) {
      const p = await one(
        'INSERT INTO projects (workspace_id, key, name, client_id) VALUES ($1, $2, $2, $3) RETURNING id',
        [ws, key, client],
      );
      ids[key] = p;
      const state = await one(
        "INSERT INTO project_states (workspace_id, project_id, name, grp, color, position) VALUES ($1, $2, 'Todo', 'unstarted', '#3f76ff', 0) RETURNING id",
        [ws, p],
      );
      ids[key + '-item'] = await one(
        'INSERT INTO items (workspace_id, project_id, sequence, title, state_id) VALUES ($1, $2, 1, $3, $4) RETURNING id',
        [ws, p, key + ' task', state],
      );
      ids[key + '-file-shared'] = await one(
        "INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, client_visible) VALUES ($1, $2, 'shared.pdf', 'application/pdf', 10, repeat('a', 64), 'k', true) RETURNING id",
        [ws, p],
      );
      ids[key + '-file-team'] = await one(
        "INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key) VALUES ($1, $2, 'internal.pdf', 'application/pdf', 10, repeat('b', 64), 'k') RETURNING id",
        [ws, p],
      );
    }
    await inSystem(db.pool, async (c) => {
      await c.query(
        "INSERT INTO comments (workspace_id, item_id, body, visibility) VALUES ($1, $2, 'For Helio', 'client')",
        [ws, ids['HEL-item']],
      );
      await c.query(
        "INSERT INTO comments (workspace_id, item_id, body) VALUES ($1, $2, 'Internal: check the SMS cost first')",
        [ws, ids['HEL-item']],
      );
      await c.query("INSERT INTO teams (workspace_id, name) VALUES ($1, 'Delivery')", [ws]);
    });
  }, 60_000);

  afterAll(async () => {
    await db.drop();
  });

  it('shows the team everything of its workspace', async () => {
    const seen = await inWorkspace(db.pool, ws, async (c) => ({
      projects: (await c.query('SELECT 1 FROM projects')).rowCount,
      comments: (await c.query('SELECT 1 FROM comments')).rowCount,
      files: (await c.query('SELECT 1 FROM files')).rowCount,
    }));
    expect(seen).toEqual({ projects: 3, comments: 2, files: 6 });
  });

  it('shows a client only its own projects, items, comments meant for it and files shared with it', async () => {
    const seen = await inWorkspace(
      db.pool,
      ws,
      async (c) => ({
        clients: (await c.query<{ name: string }>('SELECT name FROM clients')).rows.map(
          (r) => r.name,
        ),
        projects: (
          await c.query<{ key: string }>('SELECT key FROM projects ORDER BY key')
        ).rows.map((r) => r.key),
        items: (await c.query<{ title: string }>('SELECT title FROM items')).rows.map(
          (r) => r.title,
        ),
        comments: (await c.query<{ body: string }>('SELECT body FROM comments')).rows.map(
          (r) => r.body,
        ),
        files: (await c.query<{ id: string }>('SELECT id FROM files')).rows.map((r) => r.id),
        teams: (await c.query('SELECT 1 FROM teams')).rowCount,
      }),
      { clientId: helio },
    );
    expect(seen).toEqual({
      clients: ['Helio Health AG'],
      projects: ['HEL'],
      items: ['HEL task'],
      comments: ['For Helio'],
      files: [ids['HEL-file-shared']],
      teams: 0,
    });
  });

  it('lets a client write only comments meant for the client, on its own items', async () => {
    const write = (item: string, visibility: string) =>
      inWorkspace(
        db.pool,
        ws,
        (c) =>
          c.query(
            'INSERT INTO comments (workspace_id, item_id, body, visibility) VALUES ($1, $2, $3, $4)',
            [ws, item, 'from Ines', visibility],
          ),
        { clientId: helio },
      );
    await expect(write(ids['HEL-item'] ?? '', 'client')).resolves.toBeDefined();
    await expect(write(ids['HEL-item'] ?? '', 'team')).rejects.toThrow(/row-level security/);
    await expect(write(ids['NWL-item'] ?? '', 'client')).rejects.toThrow(/row-level security/);
  });

  it('refuses an id that is not a uuid for the client scope', async () => {
    await expect(
      inWorkspace(db.pool, ws, () => Promise.resolve(1), { clientId: 'helio' }),
    ).rejects.toThrow(/client id/);
  });

  it('knows the new roles and keeps money and budgets well-formed', async () => {
    await inSystem(db.pool, async (c) => {
      const u = (
        await c.query<{ id: string }>(
          "INSERT INTO users (email, name) VALUES ('sara@example.test', 'Sara') RETURNING id",
        )
      ).rows[0]?.id;
      await c.query(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'tester')",
        [ws, u],
      );
      await expect(
        c.query(
          "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'boss')",
          [ws, u],
        ),
      ).rejects.toThrow();
    });
    await inSystem(db.pool, (c) =>
      c.query(
        "INSERT INTO budgets (workspace_id, scope_type, period, amount_cents) VALUES ($1, 'workspace', 'month', 240000)",
        [ws],
      ),
    );
    // a workspace budget has no scope id; any other has one
    await expect(
      inSystem(db.pool, (c) =>
        c.query(
          "INSERT INTO budgets (workspace_id, scope_type, period, amount_cents) VALUES ($1, 'project', 'month', 100)",
          [ws],
        ),
      ),
    ).rejects.toThrow(/check/);
    await inSystem(db.pool, (c) =>
      c.query(
        "INSERT INTO budgets (workspace_id, scope_type, scope_id, period, amount_cents) VALUES ($1, 'client', $2, 'total', 9500000)",
        [ws, helio],
      ),
    );
    const helioSees = await inWorkspace(
      db.pool,
      ws,
      async (c) => (await c.query('SELECT 1 FROM budgets')).rowCount,
      { clientId: helio },
    );
    expect(helioSees).toBe(1);
  });
});
