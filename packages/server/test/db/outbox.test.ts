// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-89 | S15 | v0.1.0] Define the activity event envelope and the transactional outbox ──
import { eventProblems, type ActivityData } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { inSystem, inWorkspace } from '../../src/db/pool.js';
import { eventsAfter, recordEvent } from '../../src/events/outbox.js';
import { createTestDb, hasDatabase, type TestDb } from './testdb.js';

const created = (id: string, title: string): ActivityData => ({
  actor: { kind: 'user', id: 'u-1', name: 'Ada' },
  verb: 'created',
  object: { type: 'item', id, label: title },
});

describe.skipIf(!hasDatabase)('activity outbox (PostgreSQL)', () => {
  let db: TestDb;
  let A = '';
  let B = '';
  let projectA = '';

  beforeAll(async () => {
    db = await createTestDb();
    await migrate(db.pool);
    await inSystem(db.pool, async (c) => {
      A =
        (
          await c.query<{ id: string }>(
            "INSERT INTO workspaces (slug, name) VALUES ('acme', 'Acme') RETURNING id",
          )
        ).rows[0]?.id ?? '';
      B =
        (
          await c.query<{ id: string }>(
            "INSERT INTO workspaces (slug, name) VALUES ('bolt', 'Bolt') RETURNING id",
          )
        ).rows[0]?.id ?? '';
      projectA =
        (
          await c.query<{ id: string }>(
            "INSERT INTO projects (workspace_id, key, name) VALUES ($1, 'APP', 'App') RETURNING id",
            [A],
          )
        ).rows[0]?.id ?? '';
      // [PCODE-93 | S15 | v0.1.0] every item stands in one of its project's states
      await c.query(
        "INSERT INTO project_states (workspace_id, project_id, name, grp, color, position) VALUES ($1, $2, 'Todo', 'unstarted', '#3f76ff', 0)",
        [A, projectA],
      );
    });
  }, 60_000);

  afterAll(async () => {
    await db.drop();
  });

  it('stores a well-formed CloudEvents-shaped envelope with the change, numbered from 1', async () => {
    const event = await inWorkspace(db.pool, A, async (c) => {
      const item =
        (
          await c.query<{ id: string }>(
            "INSERT INTO items (workspace_id, project_id, sequence, title, state_id) VALUES ($1, $2, 1, 'First', (SELECT id FROM project_states WHERE project_id = $2 LIMIT 1)) RETURNING id",
            [A, projectA],
          )
        ).rows[0]?.id ?? '';
      return recordEvent(c, A, created(item, 'First'));
    });
    expect(eventProblems(event)).toEqual([]);
    expect(event).toMatchObject({
      specversion: '1.0',
      type: 'orqiva.item.created',
      source: '/workspaces/' + A,
      sequence: 1,
    });
  });

  it('leaves neither the change nor its event behind when the transaction aborts, and reuses no number', async () => {
    await expect(
      inWorkspace(db.pool, A, async (c) => {
        const item =
          (
            await c.query<{ id: string }>(
              "INSERT INTO items (workspace_id, project_id, sequence, title, state_id) VALUES ($1, $2, 2, 'Doomed', (SELECT id FROM project_states WHERE project_id = $2 LIMIT 1)) RETURNING id",
              [A, projectA],
            )
          ).rows[0]?.id ?? '';
        await recordEvent(c, A, created(item, 'Doomed'));
        throw new Error('abort after the event was written');
      }),
    ).rejects.toThrow('abort after the event was written');

    const after = await inWorkspace(db.pool, A, async (c) => ({
      items: (await c.query("SELECT 1 FROM items WHERE title = 'Doomed'")).rowCount,
      events: await eventsAfter(c, 0),
    }));
    expect(after.items).toBe(0);
    expect(after.events.map((e) => e.data.object.label)).toEqual(['First']);

    const next = await inWorkspace(db.pool, A, (c) => recordEvent(c, A, created('x', 'Second')));
    expect(next.sequence).toBe(2);
  });

  it('numbers concurrent writers in one workspace 1, 2, 3 … without gaps or duplicates', async () => {
    const before = await inWorkspace(db.pool, A, async (c) => (await eventsAfter(c, 0)).length);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_v, i) =>
        inWorkspace(db.pool, A, (c) =>
          recordEvent(c, A, created('c' + String(i), 'Concurrent ' + String(i))),
        ),
      ),
    );
    const seqs = results.map((e) => e.sequence).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_v, i) => before + 1 + i));
  });

  it('keeps a separate sequence per workspace and never shows one workspace the other’s events', async () => {
    const first = await inWorkspace(db.pool, B, (c) =>
      recordEvent(c, B, created('b1', 'Bolt one')),
    );
    expect(first.sequence).toBe(1);
    const seenByB = await inWorkspace(db.pool, B, (c) => eventsAfter(c, 0));
    expect(seenByB.map((e) => e.workspaceid)).toEqual([B]);
    await expect(
      inWorkspace(db.pool, B, (c) => recordEvent(c, A, created('sneak', 'Planted in A'))),
    ).rejects.toThrow(/row-level security/);
  });

  it('replays from a cursor in order', async () => {
    const all = await inWorkspace(db.pool, A, (c) => eventsAfter(c, 0));
    const tail = await inWorkspace(db.pool, A, (c) => eventsAfter(c, 20));
    expect(all.map((e) => e.sequence)).toEqual(all.map((_e, i) => i + 1));
    expect(tail[0]?.sequence).toBe(21);
  });

  it('treats events as history: the app role cannot change or delete them', async () => {
    await expect(
      inWorkspace(db.pool, A, (c) =>
        c.query("UPDATE activity_events SET type = 'orqiva.item.deleted'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inWorkspace(db.pool, A, (c) => c.query('DELETE FROM activity_events')),
    ).rejects.toThrow(/permission denied/);
  });
});
