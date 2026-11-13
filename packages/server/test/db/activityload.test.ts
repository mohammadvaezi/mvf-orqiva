// ── [PCODE-438 | S15 | v0.1.0] T37 medium: Activity text search uses its index under row-level security ──
// ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
// ── [PCODE-412 | S15 | v0.1.0] T37 high: Activity takes 10 000 events per second ──
// ── [PCODE-409 | S15 | v0.1.0] T36.4 Load and scale: activity throughput and facets, 100 projects, live latency ──
//    Why:  the activity targets measured, not assumed: events written the way the server writes them
//          (counter, hash chain, notify; one transaction per action and in batches, one workspace and
//          several), and the facet search timed over a large table filled in bulk. The numbers go to
//          out/activity.json with the machine they ran on; the test fails when a measured number falls
//          below the floor written here, so a slower change shows.
import type { ActivityData } from '@orqiva/shared';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { recordEvent, recordEvents } from '../../src/events/outbox.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const FILL = Number(process.env['ORQIVA_ACTIVITY_ROWS'] ?? 1_000_000);

describe.skipIf(!hasDatabase)('activity under load (PostgreSQL)', () => {
  let t: TestApp;
  const people: Person[] = [];
  const results: Record<string, number | string> = {};

  beforeAll(async () => {
    t = await startTestApp();
    for (let i = 0; i < 8; i++) people.push(await t.signup('Writer ' + String(i)));
  }, 120_000);

  afterAll(async () => {
    results['cpus'] = cpus().length;
    results['cpu'] = cpus()[0]?.model ?? '';
    mkdirSync('../../out', { recursive: true });
    writeFileSync('../../out/activity.json', JSON.stringify(results, null, 2));
    await t.stop();
  });

  /** Writes `perWriter` events from each writer, `batch` per transaction, into the given workspaces. */
  async function write(workspaces: string[], perWriter: number, batch: number): Promise<number> {
    const started = performance.now();
    await Promise.all(
      workspaces.map(async (ws, w) => {
        for (let done = 0; done < perWriter; done += batch)
          await inSystem(t.db.pool, async (c) => {
            const data = (i: number): ActivityData => ({
              actor: {
                kind: 'user' as const,
                id: people[w % people.length]?.id ?? '',
                name: 'Writer',
              },
              verb: 'updated',
              object: { type: 'item', id: crypto.randomUUID(), label: 'APP-' + String(done + i) },
            });
            // [PCODE-412 | S15 | v0.1.0] one action, one event; a batch goes in with one call
            if (batch === 1) await recordEvent(c, ws, data(0));
            else
              await recordEvents(
                c,
                ws,
                Array.from({ length: batch }, (_, i) => ({ data: data(i) })),
              );
          });
      }),
    );
    const seconds = (performance.now() - started) / 1000;
    return Math.round((workspaces.length * perWriter) / seconds);
  }

  it('takes events in: one per action and in batches, in one workspace and in eight', async () => {
    const one = [people[0]?.workspaceId ?? ''];
    const eight = people.map((p) => p.workspaceId);
    results['perSecond_oneWorkspace_oneEach'] = await write(one, 2000, 1);
    results['perSecond_eightWorkspaces_oneEach'] = await write(eight, 1000, 1);
    results['perSecond_oneWorkspace_batch100'] = await write(one, 5000, 100);
    results['perSecond_eightWorkspaces_batch100'] = await write(eight, 5000, 100);
    console.log('activity in', results);
    // [PCODE-412 | S15 | v0.1.0] the target is 10 000 per second. Batches (one call, the chain built in the
    // database) reached 7 600 on a 6-core 1.8 GHz desktop with PostgreSQL beside it; one event per action is
    // bound by its transaction's commit. The floor keeps what was won.
    expect(results['perSecond_eightWorkspaces_batch100']).toBeGreaterThan(4000);
  }, 600_000);

  it('answers a faceted search over a large table', async () => {
    const ws = people[1]?.workspaceId ?? '';
    // filled in bulk: the search reads what the writers write, the fill only has to be fast
    const fillStarted = performance.now();
    await inSystem(t.db.pool, (c) =>
      c.query(
        `INSERT INTO activity_events (workspace_id, sequence, id, type, time, actor_kind, actor_id, object_type, object_id, envelope, hash)
         SELECT $1, 1000000 + g, gen_random_uuid(),
                'prodengine.item.' || (ARRAY['created','updated','moved','commented'])[1 + g % 4],
                now() - make_interval(secs => g % 2592000),
                (ARRAY['user','agent','system'])[1 + g % 3], $2,
                (ARRAY['item','doc','run','deploy'])[1 + g % 4], gen_random_uuid(),
                jsonb_build_object('data', jsonb_build_object('verb', 'updated', 'object', jsonb_build_object('label', 'APP-' || g))),
                md5(g::text) || md5(g::text)
           FROM generate_series(1, $3::int) g`,
        [ws, people[1]?.id ?? '', FILL],
      ),
    );
    // [PCODE-413 | S15 | v0.1.0] the hourly counts the writers keep, filled the way the migration fills them
    await inSystem(t.db.pool, (c) =>
      c.query(
        `INSERT INTO activity_rollup (workspace_id, hour, archived, type, actor_kind, object_type, verb, project_id, n)
         SELECT workspace_id, date_trunc('hour', time), false, type, actor_kind, object_type,
                coalesce(envelope->'data'->>'verb', ''), coalesce(project_id, ''), count(*)
           FROM activity_events WHERE workspace_id = $1 AND sequence > 1000000 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`,
        [ws],
      ),
    );
    // [PCODE-438 | S15 | v0.1.0] and the words, as the writers keep them
    await inSystem(t.db.pool, (c) =>
      c.query(
        'INSERT INTO activity_search (workspace_id, sequence, search) SELECT workspace_id, sequence, search FROM activity_events WHERE workspace_id = $1 AND sequence > 1000000',
        [ws],
      ),
    );
    await inSystem(t.db.pool, (c) => c.query('ANALYZE activity_events'));
    await inSystem(t.db.pool, (c) => c.query('ANALYZE activity_search'));
    results['filledRows'] = FILL;
    results['fillSeconds'] = Math.round((performance.now() - fillStarted) / 100) / 10;
    const W = (p: string): string => '/api/workspaces/' + ws + p;
    const times: number[] = [];
    for (const q of ['', 'actor:agent', 'type:deploy -verb:moved', 'since:7d', 'APP-12345']) {
      const started = performance.now();
      const r = await t.call<{ facets: unknown }>(
        people[1] ?? null,
        'GET',
        W('/activity/search?limit=100' + (q ? '&q=' + encodeURIComponent(q) : '')),
      );
      expect(r.status).toBe(200);
      times.push(performance.now() - started);
    }
    results['searchMs'] = times.map((x) => Math.round(x)).join(', ');
    results['searchMsWorst'] = Math.round(Math.max(...times));
    console.log('activity search', results);
    // [PCODE-413 | S15 | v0.1.0] the target is 1 s: everything but free text is counted from the hourly
    // rows (70-200 ms on a million events); free text through its own index (PCODE-438).
    expect(Math.max(...times.slice(0, 4))).toBeLessThan(1000);
    // [PCODE-438 | S15 | v0.1.0] words go through the side table's index
    expect(times[4]).toBeLessThan(1000);
  }, 900_000);
});
