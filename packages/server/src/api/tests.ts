// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-177 | S15 | v0.1.0] B4.3 Test tab live in the web app: runs with matrix, steps, evidence, defects, repository, coverage, flaky, AI cases ──
// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
// ── [PCODE-135 | S15 | v0.1.0] Add test cases from acceptance criteria and test runs ──
// ── [PCODE-137 | S15 | v0.1.0] Show coverage to requirements, the Tester agent and the G3 tests criterion ──
//    Why:  test cases tied to the requirement they check, and runs that collect one result per case. A run
//          takes results in batches as they come (a person, an import, or a suite streaming them); a result
//          for an unknown automated test creates its case, so a suite never has to be described twice.
//          Every batch is a test_run event with the run's progress, which is what streams it to the page.
import { afterTestRun } from './coverage.js';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { maskerFor } from './testdata.js'; // [PCODE-318 | S15 | v0.1.0]
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { requireFeature } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const STATUSES = ['passed', 'failed', 'skipped', 'blocked'] as const;

export const caseOut = s.object({
  id: s.string(),
  projectId: s.string(),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  criterionId: s.nullable(s.string()),
  key: s.string(),
  title: s.string(),
  steps: s.string(),
  expected: s.string(),
  source: s.string(),
  lastStatus: s.nullable(s.string()),
  lastAt: s.nullable(s.string()),
  // [PCODE-177 | S15 | v0.1.0] the repository groups by suite and shows kind, version and quarantine
  suite: s.string(),
  kind: s.string(),
  version: s.number({ integer: true }),
  quarantined: s.boolean(),
});

export interface CaseRow {
  id: string;
  project_id: string;
  item_id: string | null;
  item_ref: string | null;
  criterion_id: string | null;
  key: string;
  title: string;
  steps: string;
  expected: string;
  source: string;
  last_status: string | null;
  last_at: Date | null;
  suite: string;
  kind: string;
  version: number;
  quarantined: boolean;
}

export const CASE_SELECT = `SELECT c.*, CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref,
         last.status AS last_status, last.at AS last_at
    FROM test_cases c JOIN projects p ON p.id = c.project_id LEFT JOIN items i ON i.id = c.item_id
    LEFT JOIN LATERAL (SELECT r.status, r.at FROM test_results r WHERE r.case_id = c.id ORDER BY r.at DESC LIMIT 1) last ON true`;

export const caseJson = (r: CaseRow): Infer<typeof caseOut> => ({
  id: r.id,
  projectId: r.project_id,
  itemId: r.item_id,
  itemRef: r.item_ref,
  criterionId: r.criterion_id,
  key: r.key,
  title: r.title,
  steps: r.steps,
  expected: r.expected,
  source: r.source,
  lastStatus: r.last_status,
  lastAt: r.last_at?.toISOString() ?? null,
  suite: r.suite,
  kind: r.kind,
  version: r.version,
  quarantined: r.quarantined,
});

export const runOut = s.object({
  id: s.string(),
  projectId: s.string(),
  name: s.string(),
  source: s.string(),
  status: s.string(),
  startedBy: s.nullable(s.string()),
  startedAt: s.string(),
  finishedAt: s.nullable(s.string()),
  passed: s.number({ integer: true }),
  failed: s.number({ integer: true }),
  skipped: s.number({ integer: true }),
  blocked: s.number({ integer: true }),
  clientRound: s.boolean(), // [PCODE-186 | S15 | v0.1.0] shared with the client as an acceptance round
});

export interface RunRow {
  id: string;
  project_id: string;
  project_key: string;
  name: string;
  source: string;
  status: string;
  started_by_name: string | null;
  started_at: Date;
  finished_at: Date | null;
  passed: string;
  failed: string;
  skipped: string;
  blocked: string;
  client_round: boolean; // [PCODE-186 | S15 | v0.1.0]
}

const RUN_SELECT = `SELECT t.*, p.key AS project_key, u.name AS started_by_name,
         count(*) FILTER (WHERE r.status = 'passed') AS passed, count(*) FILTER (WHERE r.status = 'failed') AS failed,
         count(*) FILTER (WHERE r.status = 'skipped') AS skipped, count(*) FILTER (WHERE r.status = 'blocked') AS blocked
    FROM test_runs t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.started_by
    LEFT JOIN test_results r ON r.run_id = t.id`;
const RUN_GROUP = ' GROUP BY t.id, p.key, u.name';

export const runJson = (r: RunRow): Infer<typeof runOut> => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  source: r.source,
  status: r.status,
  startedBy: r.started_by_name,
  startedAt: r.started_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
  passed: Number(r.passed),
  failed: Number(r.failed),
  skipped: Number(r.skipped),
  blocked: Number(r.blocked),
  clientRound: r.client_round, // [PCODE-186 | S15 | v0.1.0]
});

export async function loadRun(c: PoolClient, a: Access, id: string): Promise<RunRow> {
  const r = (await c.query<RunRow>(RUN_SELECT + ' WHERE t.id = $1' + RUN_GROUP, [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Test run not found');
  try {
    await requireProject(c, a, r.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Test run not found');
  }
  return r;
}

// [PCODE-175 | S15 | v0.1.0]
export async function loadCase(c: PoolClient, a: Access, id: string): Promise<CaseRow> {
  const r = (await c.query<CaseRow>(CASE_SELECT + ' WHERE c.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Test case not found');
  await requireProject(c, a, r.project_id);
  return r;
}

// [PCODE-175 | S15 | v0.1.0] the test lab sends the same run events
export async function runEvent(
  c: PoolClient,
  a: Access,
  r: RunRow,
  verb: 'created' | 'progressed' | 'completed' | 'failed' | 'updated',
  changes: Record<string, { from: unknown; to: unknown }> = {},
): Promise<void> {
  const total = Number(r.passed) + Number(r.failed) + Number(r.skipped) + Number(r.blocked);
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'test_run', id: r.id, label: r.project_key + ' ' + r.name },
      parent: { type: 'project', id: r.project_id, label: r.project_key },
      progress: { done: Number(r.passed), total, unit: 'tests' },
      changes,
    },
    { projectId: r.project_id },
  );
}

/** The item and criterion a case is tied to must be of its project. */
async function checkLinks(
  c: PoolClient,
  projectId: string,
  itemId: string | null | undefined,
  criterionId: string | null | undefined,
): Promise<string | null> {
  let item = itemId ?? null;
  if (criterionId) {
    const k = (
      await c.query<{ item_id: string }>(
        'SELECT k.item_id FROM item_criteria k JOIN items i ON i.id = k.item_id WHERE k.id = $1 AND i.project_id = $2',
        [criterionId, projectId],
      )
    ).rows[0];
    if (!k)
      throw new HttpError(400, 'invalid_request', 'The criterion is not of this project', [
        { path: 'body.criterionId', message: 'is not a criterion of this project' },
      ]);
    item ??= k.item_id;
  }
  if (
    item &&
    !(await c.query('SELECT 1 FROM items WHERE id = $1 AND project_id = $2', [item, projectId]))
      .rowCount
  )
    throw new HttpError(400, 'invalid_request', 'The task is not of this project', [
      { path: 'body.itemId', message: 'is not a task of this project' },
    ]);
  return item;
}

export function testRoutes(pool: Pool): Route[] {
  const listCases = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-cases',
    summary: 'The project’s test cases with their latest result',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ itemId: s.optional(uuid) }),
    response: s.array(caseOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<CaseRow>(
            CASE_SELECT +
              ' WHERE c.project_id = $1 AND ($2::uuid IS NULL OR c.item_id = $2) ORDER BY i.sequence NULLS LAST, c.created_at, c.title',
            [p.id, query.itemId ?? null],
          )
        ).rows;
        return { body: rows.map(caseJson) };
      }),
  });

  const createCase = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-cases',
    summary: 'Write a test case (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      title: s.string({ min: 1, max: 300 }),
      itemId: s.optional(s.nullable(uuid)),
      criterionId: s.optional(s.nullable(uuid)),
      steps: s.optional(s.string({ max: 20_000 })),
      expected: s.optional(s.string({ max: 5000 })),
      key: s.optional(s.string({ max: 500 })),
    }),
    response: caseOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'test-management', 'Test management'); // [PCODE-359 | S15 | v0.1.0]
        const p = await requireProject(c, a, params.projectId);
        const item = await checkLinks(c, p.id, body.itemId, body.criterionId);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO test_cases (workspace_id, project_id, item_id, criterion_id, key, title, steps, expected, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              item,
              body.criterionId ?? null,
              body.key?.trim() ?? '',
              body.title.trim(),
              body.steps ?? '',
              body.expected ?? '',
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('case insert returned nothing');
        return { status: 201, body: caseJson(await loadCase(c, a, id)) };
      }),
  });

  const updateCase = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/test-cases/:caseId',
    summary: 'Change a test case (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, caseId: uuid }),
    body: s.object({
      title: s.optional(s.string({ min: 1, max: 300 })),
      steps: s.optional(s.string({ max: 20_000 })),
      expected: s.optional(s.string({ max: 5000 })),
      itemId: s.optional(s.nullable(uuid)),
      criterionId: s.optional(s.nullable(uuid)),
    }),
    response: caseOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const tc = await loadCase(c, a, params.caseId);
        const linking = body.itemId !== undefined || body.criterionId !== undefined;
        const item = linking
          ? await checkLinks(c, tc.project_id, body.itemId ?? null, body.criterionId ?? null)
          : tc.item_id;
        await c.query(
          `UPDATE test_cases SET title = coalesce($2, title), steps = coalesce($3, steps), expected = coalesce($4, expected),
                  item_id = $5, criterion_id = CASE WHEN $6 THEN $7::uuid ELSE criterion_id END WHERE id = $1`,
          [
            tc.id,
            body.title?.trim() ?? null,
            body.steps ?? null,
            body.expected ?? null,
            item,
            body.criterionId !== undefined,
            body.criterionId ?? null,
          ],
        );
        return { body: caseJson(await loadCase(c, a, tc.id)) };
      }),
  });

  const deleteCase = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/test-cases/:caseId',
    summary: 'Remove a test case and its results (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, caseId: uuid }),
    response: s.object({ deleted: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const tc = await loadCase(c, a, params.caseId);
        await c.query('DELETE FROM test_cases WHERE id = $1', [tc.id]);
        return { body: { deleted: true } };
      }),
  });

  const fromCriteria = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/test-cases/from-criteria',
    summary: 'One test case per acceptance criterion of the task that has none yet (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: s.array(caseOut),
    status: 201,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'test-management', 'Test management'); // [PCODE-359 | S15 | v0.1.0]
        const it = (
          await c.query<{ project_id: string }>('SELECT project_id FROM items WHERE id = $1', [
            params.itemId,
          ])
        ).rows[0];
        if (!it) throw new HttpError(404, 'not_found', 'Item not found');
        await requireProject(c, a, it.project_id);
        const open = (
          await c.query<{ id: string; text: string }>(
            `SELECT k.id, k.text FROM item_criteria k
              WHERE k.item_id = $1 AND NOT EXISTS (SELECT 1 FROM test_cases tc WHERE tc.criterion_id = k.id)
              ORDER BY k.position`,
            [params.itemId],
          )
        ).rows;
        for (const k of open)
          await c.query(
            `INSERT INTO test_cases (workspace_id, project_id, item_id, criterion_id, title, expected, source, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'criteria', $7)`,
            [
              a.workspaceId,
              it.project_id,
              params.itemId,
              k.id,
              k.text.slice(0, 300),
              k.text,
              a.user.id,
            ],
          );
        const rows = (
          await c.query<CaseRow>(CASE_SELECT + ' WHERE c.item_id = $1 ORDER BY c.created_at', [
            params.itemId,
          ])
        ).rows;
        return { status: 201, body: rows.map(caseJson) };
      }),
  });

  const listRuns = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-runs',
    summary: 'The project’s test runs, newest first, with their totals',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(runOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<RunRow>(
            RUN_SELECT +
              ' WHERE t.project_id = $1' +
              RUN_GROUP +
              ' ORDER BY t.started_at DESC LIMIT 50',
            [p.id],
          )
        ).rows;
        return { body: rows.map(runJson) };
      }),
  });

  const startRun = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-runs',
    summary: 'Start a test run (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 200 }),
      source: s.optional(s.enum(['manual', 'stream', 'junit'])),
    }),
    response: runOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO test_runs (workspace_id, project_id, name, source, started_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [a.workspaceId, p.id, body.name.trim(), body.source ?? 'manual', a.user.id],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('run insert returned nothing');
        const run = await loadRun(c, a, id);
        await runEvent(c, a, run, 'created');
        return { status: 201, body: runJson(run) };
      }),
  });

  const resultOut = s.object({
    caseId: s.string(),
    title: s.string(),
    key: s.string(),
    itemRef: s.nullable(s.string()),
    status: s.string(),
    durationMs: s.nullable(s.number({ integer: true })),
    message: s.string(),
    at: s.string(),
  });
  const getRun = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/test-runs/:runId',
    summary: 'One test run with every result so far',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    response: s.object({ run: runOut, results: s.array(resultOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        const results = (
          await c.query<{
            case_id: string;
            title: string;
            key: string;
            item_ref: string | null;
            status: string;
            duration_ms: number | null;
            message: string;
            at: Date;
          }>(
            `SELECT r.case_id, c.title, c.key, CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref,
                    r.status, r.duration_ms, r.message, r.at
               FROM test_results r JOIN test_cases c ON c.id = r.case_id JOIN projects p ON p.id = c.project_id
               LEFT JOIN items i ON i.id = c.item_id
              WHERE r.run_id = $1 ORDER BY r.at, c.title`,
            [run.id],
          )
        ).rows;
        return {
          body: {
            run: runJson(run),
            results: results.map((x) => ({
              caseId: x.case_id,
              title: x.title,
              key: x.key,
              itemRef: x.item_ref,
              status: x.status,
              durationMs: x.duration_ms,
              message: x.message,
              at: x.at.toISOString(),
            })),
          },
        };
      }),
  });

  const report = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/results',
    summary:
      'Add results to a running run, by case or by automated test name (a new name creates its case) (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    body: s.object({
      results: s.array(
        s.object({
          caseId: s.optional(uuid),
          key: s.optional(s.string({ min: 1, max: 500 })),
          status: s.enum([...STATUSES]),
          durationMs: s.optional(s.nullable(s.number({ integer: true, min: 0 }))),
          message: s.optional(s.string({ max: 20_000 })),
        }),
        { min: 1, max: 500 },
      ),
    }),
    response: runOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        if (run.status !== 'running') throw new HttpError(409, 'conflict', 'This run has ended');
        const mask = await maskerFor(c, run.project_id); // [PCODE-318 | S15 | v0.1.0]
        for (const [n, r] of body.results.entries()) {
          let caseId = r.caseId;
          if (caseId) {
            if (
              !(
                await c.query('SELECT 1 FROM test_cases WHERE id = $1 AND project_id = $2', [
                  caseId,
                  run.project_id,
                ])
              ).rowCount
            )
              throw new HttpError(400, 'invalid_request', 'Unknown test case', [
                {
                  path: 'body.results.' + String(n) + '.caseId',
                  message: 'is not a case of this project',
                },
              ]);
          } else if (r.key) {
            const key = r.key.trim();
            caseId = (
              await c.query<{ id: string }>(
                `INSERT INTO test_cases (workspace_id, project_id, key, title, source, created_by)
                 VALUES ($1, $2, $3, $4, 'import', $5)
                 ON CONFLICT (project_id, key) WHERE key <> '' DO UPDATE SET key = EXCLUDED.key RETURNING id`,
                [
                  a.workspaceId,
                  run.project_id,
                  key,
                  key.split(' > ').pop()?.slice(0, 300) || key.slice(0, 300),
                  a.user.id,
                ],
              )
            ).rows[0]?.id;
          } else
            throw new HttpError(400, 'invalid_request', 'Name the case: caseId or key', [
              { path: 'body.results.' + String(n), message: 'needs caseId or key' },
            ]);
          await c.query(
            `INSERT INTO test_results (workspace_id, run_id, case_id, status, duration_ms, message)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (run_id, case_id) DO UPDATE SET status = $4, duration_ms = $5, message = $6, at = now()`,
            [a.workspaceId, run.id, caseId, r.status, r.durationMs ?? null, mask(r.message ?? '')],
          );
        }
        const after = await loadRun(c, a, run.id);
        await runEvent(c, a, after, 'progressed', {
          results: { from: null, to: body.results.length },
        });
        return { body: runJson(after) };
      }),
  });

  const finish = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/finish',
    summary: 'End a run; it passed when no result failed (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    response: runOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        if (run.status !== 'running') throw new HttpError(409, 'conflict', 'This run has ended');
        await c.query("UPDATE test_runs SET status = 'done', finished_at = now() WHERE id = $1", [
          run.id,
        ]);
        const after = await loadRun(c, a, run.id);
        await runEvent(c, a, after, Number(after.failed) ? 'failed' : 'completed', {
          status: { from: 'running', to: 'done' },
        });
        // [PCODE-137 | S15 | v0.1.0] the run is G3's evidence, one way or the other
        await afterTestRun(c, a.workspaceId, actorOf(a), after);
        return { body: runJson(after) };
      }),
  });

  return [
    listCases,
    createCase,
    updateCase,
    deleteCase,
    fromCriteria,
    listRuns,
    startRun,
    getRun,
    report,
    finish,
  ];
}
