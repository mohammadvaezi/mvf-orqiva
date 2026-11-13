// ── [PCODE-438 | S15 | v0.1.0] T37 medium: Activity text search uses its index under row-level security ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-87 | S15 | v0.1.0] Create the PostgreSQL schema v1 with our own migration runner and row-level security ──
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from '../../src/db/migrate.js';
import { assertNotSuperuser, inSystem, inWorkspace } from '../../src/db/pool.js';
import { createTestDb, hasDatabase, type TestDb } from './testdb.js';

describe('migration files', () => {
  it('are numbered without gaps and named NNNN_name.sql', () => {
    const m = loadMigrations();
    expect(m.map((x) => x.version)).toEqual(m.map((_x, i) => i + 1));
  });

  it('use no PostgreSQL extension', () => {
    for (const m of loadMigrations()) expect(m.sql, m.name).not.toMatch(/create\s+extension/i);
  });

  it('refuse a gap in the numbering', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-mig-'));
    writeFileSync(join(dir, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '0003_c.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/without gaps/);
  });
});

describe.skipIf(!hasDatabase)('migrations and row-level security (PostgreSQL)', () => {
  let db: TestDb;
  const A = { ws: '', project: '', item: '', state: '' };
  const B = { ws: '', project: '', item: '', state: '' };

  beforeAll(async () => {
    db = await createTestDb();
    await migrate(db.pool);
    // seed two workspaces, each with a project and an item, as the owner (outside any workspace)
    await inSystem(db.pool, async (c) => {
      for (const [t, slug] of [
        [A, 'acme'],
        [B, 'bolt'],
      ] as const) {
        t.ws =
          (
            await c.query<{ id: string }>(
              'INSERT INTO workspaces (slug, name) VALUES ($1, $1) RETURNING id',
              [slug],
            )
          ).rows[0]?.id ?? '';
        t.project =
          (
            await c.query<{ id: string }>(
              "INSERT INTO projects (workspace_id, key, name) VALUES ($1, 'APP', 'App') RETURNING id",
              [t.ws],
            )
          ).rows[0]?.id ?? '';
        // [PCODE-93 | S15 | v0.1.0] every item stands in one of its project's states
        t.state =
          (
            await c.query<{ id: string }>(
              "INSERT INTO project_states (workspace_id, project_id, name, grp, color, position) VALUES ($1, $2, 'Todo', 'unstarted', '#3f76ff', 0) RETURNING id",
              [t.ws, t.project],
            )
          ).rows[0]?.id ?? '';
        t.item =
          (
            await c.query<{ id: string }>(
              "INSERT INTO items (workspace_id, project_id, sequence, title, state_id) VALUES ($1, $2, 1, 'secret of ' || $3, $4) RETURNING id",
              [t.ws, t.project, slug, t.state],
            )
          ).rows[0]?.id ?? '';
      }
    });
  }, 60_000);

  afterAll(async () => {
    await db.drop();
  });

  it('applies each migration once and records it', async () => {
    const again = await migrate(db.pool);
    expect(again.applied).toEqual([]);
    const rows = (
      await db.pool.query<{ version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      )
    ).rows;
    expect(rows.map((r) => r.version)).toEqual(loadMigrations().map((m) => m.version));
  });

  it('refuses a migration that changed after it was applied', async () => {
    const changed = loadMigrations().map((m, i) => (i === 0 ? { ...m, checksum: 'different' } : m));
    await expect(migrate(db.pool, changed)).rejects.toThrow(/was changed after it was applied/);
  });

  it('forces row-level security on every table that has a workspace_id', async () => {
    const rows = (
      await db.pool.query<{ table: string; enabled: boolean; forced: boolean }>(`
        SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped)
               OR c.relname = 'workspaces')`)
    ).rows;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // [PCODE-438 | S15 | v0.1.0] the one exception, on purpose: the words of activity for the text index,
    // which PostgreSQL uses only without row policies. It holds no events, every query names the
    // workspace, and the events found are read through their own policies.
    const WITHOUT_POLICIES = new Set(['activity_search']);
    expect(
      rows
        .filter((r) => (!r.enabled || !r.forced) && !WITHOUT_POLICIES.has(r.table))
        .map((r) => r.table),
    ).toEqual([]);
  });

  const asA = <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> => inWorkspace(db.pool, A.ws, fn);

  it('shows workspace A only its own rows, even with no WHERE clause', async () => {
    await asA(async (c) => {
      expect((await c.query('SELECT id FROM workspaces')).rows).toEqual([{ id: A.ws }]);
      expect((await c.query('SELECT id FROM projects')).rows).toEqual([{ id: A.project }]);
      expect(
        (await c.query<{ title: string }>('SELECT title FROM items')).rows.map((r) => r.title),
      ).toEqual(['secret of acme']);
    });
  });

  it('finds nothing of B even when asked for it by id, through a join or a count', async () => {
    await asA(async (c) => {
      expect((await c.query('SELECT * FROM items WHERE id = $1', [B.item])).rowCount).toBe(0);
      expect(
        (
          await c.query(
            'SELECT * FROM projects p JOIN items i ON i.project_id = p.id WHERE p.id = $1',
            [B.project],
          )
        ).rowCount,
      ).toBe(0);
      expect((await c.query<{ n: string }>('SELECT count(*) AS n FROM items')).rows[0]?.n).toBe(
        '1',
      );
    });
  });

  it('cannot change or delete B rows, and cannot write rows into B', async () => {
    await asA(async (c) => {
      expect(
        (await c.query("UPDATE items SET title = 'pwned' WHERE id = $1", [B.item])).rowCount,
      ).toBe(0);
      expect((await c.query('DELETE FROM items WHERE id = $1', [B.item])).rowCount).toBe(0);
    });
    await expect(
      asA((c) =>
        c.query(
          "INSERT INTO items (workspace_id, project_id, sequence, title, state_id) VALUES ($1, $2, 2, 'planted', $3)",
          [B.ws, B.project, B.state],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asA((c) => c.query('UPDATE items SET workspace_id = $1 WHERE id = $2', [B.ws, A.item])),
    ).rejects.toThrow(/row-level security/);
    // outside any workspace even the owner sees nothing; system mode shows B's row untouched
    const title = await inSystem(
      db.pool,
      async (c) =>
        (await c.query<{ title: string }>('SELECT title FROM items WHERE id = $1', [B.item]))
          .rows[0]?.title,
    );
    expect((await db.pool.query('SELECT * FROM items')).rowCount).toBe(0);
    expect(title).toBe('secret of bolt');
  });

  it('stays in its workspace even after RESET ROLE, and cannot change the schema', async () => {
    const leaked = await asA(async (c) => {
      await c.query('RESET ROLE');
      return (await c.query<{ title: string }>('SELECT title FROM items')).rows.map((r) => r.title);
    });
    expect(leaked).toEqual(['secret of acme']);
    await expect(asA((c) => c.query('DROP TABLE items'))).rejects.toThrow(
      /must be owner|permission denied/,
    );
  });

  it('cannot switch on system mode from inside a workspace', async () => {
    const seen = await asA(async (c) => {
      await c.query("SELECT set_config('app.system', 'on', true)");
      return (await c.query('SELECT id FROM items')).rowCount;
    });
    expect(seen).toBe(1);
  });

  it('sees every workspace in system mode, for global operations', async () => {
    const n = await inSystem(
      db.pool,
      async (c) => (await c.query('SELECT id FROM workspaces')).rowCount,
    );
    expect(n).toBe(2);
  });

  it('runs as a role that is neither superuser nor exempt from row-level security', async () => {
    await expect(assertNotSuperuser(db.pool)).resolves.toBeUndefined();
  });

  it('sees no tenant rows at all when no workspace is set', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE orqiva_app');
      expect((await client.query('SELECT * FROM items')).rowCount).toBe(0);
      expect((await client.query('SELECT * FROM workspaces')).rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('refuses a workspace id that is not a uuid', async () => {
    await expect(inWorkspace(db.pool, "x' OR true --", () => Promise.resolve(1))).rejects.toThrow(
      /needs a workspace id/,
    );
  });
});
