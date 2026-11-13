// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
//    Why:  recorded Cypress and Allure reports import as finished runs with their cases; a test's bug hangs
//          under it in the trace graph; a release's leakage counts the bugs its runs caught against the
//          bugs written after it shipped that no test found; its burndown works the planned cases down.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL('../fixtures/testreports/' + name, import.meta.url), 'utf8'),
  ) as unknown;

interface Imported {
  run: {
    id: string;
    name: string;
    source: string;
    passed: number;
    failed: number;
    skipped: number;
  };
  created: number;
  results: number;
}

describe.skipIf(!hasDatabase)(
  'test imports, defects in the trace, leakage and burndown (PostgreSQL)',
  () => {
    let t: TestApp;
    let ada: Person;
    let project = '';
    let story = '';
    let release = '';
    const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
    const P = (p: string): string => W('/projects/' + project + p);
    const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
      inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);

    beforeAll(async () => {
      t = await startTestApp();
      ada = await t.signup('Ada');
      project = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
      ).body.id;
      story = (
        await t.call<{ id: string }>(ada, 'POST', P('/items'), { title: 'Cart keeps items' })
      ).body.id;
      release = (await t.call<{ id: string }>(ada, 'POST', P('/releases'), { version: '1.4.0' }))
        .body.id;
    }, 60_000);

    afterAll(async () => {
      await t.stop();
    });

    it('imports Cypress and Allure reports as finished runs', async () => {
      const cy = await t.call<Imported>(ada, 'POST', P('/test-runs/import'), {
        format: 'cypress',
        report: fixture('cypress-mochawesome.json'),
      });
      expect(cy.status).toBe(201);
      expect(cy.body).toMatchObject({
        created: 4,
        results: 4,
        run: { source: 'cypress', passed: 2, failed: 1, skipped: 1 },
      });
      expect(cy.body.run.name).toMatch(/^Cypress /);
      const allure = await t.call<Imported>(ada, 'POST', P('/test-runs/import'), {
        format: 'allure',
        name: 'Nightly pytest',
        report: { results: fixture('allure-results.json') },
      });
      expect(allure.body).toMatchObject({
        created: 4,
        results: 4,
        run: { name: 'Nightly pytest', source: 'allure', passed: 2, failed: 1, skipped: 1 },
      });
      // the same report again finds its cases
      const again = await t.call<Imported>(ada, 'POST', P('/test-runs/import'), {
        format: 'cypress',
        report: fixture('cypress-mochawesome.json'),
      });
      expect(again.body.created).toBe(0);
      const empty = await t.call<{ error: { message: string } }>(
        ada,
        'POST',
        P('/test-runs/import'),
        {
          format: 'allure',
          report: { results: [] },
        },
      );
      expect(empty.status).toBe(400);
      expect(empty.body.error.message).toBe(
        'No test results (send the -result.json files of allure-results)',
      );
    });

    it('hangs a test’s bug under it in the trace graph', async () => {
      const tc = (
        await t.call<{ id: string }>(ada, 'POST', P('/test-cases'), {
          title: 'Cart survives a reload',
          itemId: story,
        })
      ).body.id;
      const run =
        (
          await t.call<{ id: string }[]>(ada, 'POST', P('/test-runs/plan'), {
            name: 'Release check',
            caseIds: [tc],
            releaseId: release,
          })
        ).body[0]?.id ?? '';
      await t.call(ada, 'PUT', W('/test-runs/' + run + '/cases/' + tc), { status: 'failed' });
      const bug = await t.call<{ itemId: string; ref: string }>(
        ada,
        'POST',
        W('/test-runs/' + run + '/cases/' + tc + '/defect'),
        {},
      );
      const g = await t.call<{
        nodes: { id: string; kind: string; label: string }[];
        edges: { from: string; to: string }[];
      }>(ada, 'GET', W('/trace?itemId=' + story));
      const defect = g.body.nodes.find((n) => n.kind === 'defect');
      expect(defect?.label).toBe(bug.body.ref);
      expect(g.body.edges).toContainEqual({ from: 'test:' + tc, to: 'defect:' + bug.body.itemId });
    });

    it('measures the release’s leakage and burns its planned cases down', async () => {
      // the release shipped two days ago; one bug came after it, one before (not counted)
      await sys(
        "UPDATE releases SET state = 'released', released_at = now() - interval '2 days' WHERE id = $1",
        [release],
      );
      for (const [title, ago] of [
        ['Total wrong after reload', '1 day'],
        ['Old bug', '5 days'],
      ] as const) {
        const id = (await t.call<{ id: string }>(ada, 'POST', P('/items'), { title, kind: 'bug' }))
          .body.id;
        await sys('UPDATE items SET created_at = now() - $2::interval WHERE id = $1', [id, ago]);
      }
      const q = await t.call<{
        releases: {
          version: string;
          runs: number;
          caught: number;
          escaped: number;
          leakage: number | null;
        }[];
      }>(ada, 'GET', P('/test-quality'));
      expect(q.body.releases).toEqual([
        expect.objectContaining({ version: '1.4.0', runs: 1, caught: 1, escaped: 1, leakage: 50 }),
      ]);
      // the run started three days ago; its one planned case failed two and a half days ago
      await sys(
        "UPDATE test_runs SET started_at = now() - interval '3 days' WHERE release_id = $1",
        [release],
      );
      await sys(
        "UPDATE test_results SET at = now() - interval '60 hours' WHERE run_id IN (SELECT id FROM test_runs WHERE release_id = $1)",
        [release],
      );
      const b = await t.call<{
        version: string;
        planned: number;
        days: { remaining: number; failed: number }[];
      }>(ada, 'GET', W('/releases/' + release + '/test-burndown'));
      expect(b.body.version).toBe('1.4.0');
      expect(b.body.planned).toBe(1);
      expect(b.body.days.length).toBeGreaterThanOrEqual(2);
      expect(b.body.days.at(-1)).toEqual(expect.objectContaining({ remaining: 0, failed: 1 }));
    });
  },
);
