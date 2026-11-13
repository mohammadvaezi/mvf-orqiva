// ── [PCODE-319 | S15 | v0.1.0] T32.5a Bug capture on the server: a report with page, device, console, network and actions becomes a bug ──
// ── [PCODE-318 | S15 | v0.1.0] T32.4b Masking of personal data in test results and the test-data vault ──
// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
// ── [PCODE-315 | S15 | v0.1.0] T32.3a Cypress and Allure import, defects in the trace, leakage and burndown ──
// ── [PCODE-314 | S15 | v0.1.0] T32.2 Runs: assignment and workload, keyboard entry, timers, reopen when the defect is done ──
// ── [PCODE-313 | S15 | v0.1.0] T32.1 Test repository: shared steps, parameters in the screen, structured BDD ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-177 | S15 | v0.1.0] B4.3 Test tab live in the web app: runs with matrix, steps, evidence, defects, repository, coverage, flaky, AI cases ──
// ── [PCODE-175 | S15 | v0.1.0] B4.1 Test and Versions on the server: suites, steps, configs, evidence, flaky, Playwright, pull requests, releases, notes, flags, DORA ──
//    Why:  the Test tab of the approved design on top of the cases and runs built before. Cases sit in
//          suites with steps and expected results and a version; a run pins the version it ran, is planned
//          for a set of cases and a configuration (or an exploratory charter), assigns them to people, and
//          records each step, the evidence and the defect a failure turned into. Health shows flaky and
//          quarantined cases and what each sprint's tasks have; two runs compare; Playwright's report
//          imports as a run.
import {
  expandSteps,
  fillPlaceholders,
  fillTestData, // [PCODE-318 | S15 | v0.1.0]
  flakiness,
  gherkinSteps,
  examplesAsParameters,
  parseGherkin,
  parsePlaywright,
  parseAllure, // [PCODE-315 | S15 | v0.1.0]
  parseMochawesome,
  type ShownStep,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { visibleFile } from './files.js';
import { loadCase, loadRun, runEvent, runJson, runOut } from './tests.js';
import { sharedStepsOf } from './testdesign.js'; // [PCODE-313 | S15 | v0.1.0]
import { maskerFor, testDataOf } from './testdata.js'; // [PCODE-318 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const STEP_STATUSES = ['passed', 'failed', 'skipped', 'blocked', 'untested'] as const;

interface Step {
  action: string;
  expected: string;
  /** [PCODE-313 | S15 | v0.1.0] a reference to the project's shared steps */
  shared?: string;
}
interface DesignRow {
  id: string;
  project_id: string;
  key: string;
  title: string;
  suite: string;
  kind: string;
  step_list: Step[];
  parameters: Record<string, string[]>;
  version: number;
  quarantined: boolean;
  quarantine_note: string;
  item_id: string | null;
  // [PCODE-313 | S15 | v0.1.0] the Gherkin of a BDD case, and the steps as shown (shared ones expanded)
  gherkin: string;
  shown: ShownStep[];
}
const designOut = s.object({
  id: s.string(),
  key: s.string(),
  title: s.string(),
  suite: s.string(),
  kind: s.string(),
  steps: s.array(
    s.object({ action: s.string(), expected: s.string(), shared: s.optional(s.string()) }),
  ),
  parameters: s.anyObject(),
  version: s.number({ integer: true }),
  quarantined: s.boolean(),
  quarantineNote: s.string(),
  // [PCODE-313 | S15 | v0.1.0]
  gherkin: s.string(),
  shown: s.array(
    s.object({
      action: s.string(),
      expected: s.string(),
      from: s.optional(s.object({ id: s.string(), name: s.string() })),
    }),
  ),
});
const designJson = (r: DesignRow): Infer<typeof designOut> => ({
  id: r.id,
  key: r.key,
  title: r.title,
  suite: r.suite,
  kind: r.kind,
  steps: r.step_list,
  parameters: r.parameters,
  version: r.version,
  quarantined: r.quarantined,
  quarantineNote: r.quarantine_note,
  gherkin: r.gherkin, // [PCODE-313 | S15 | v0.1.0]
  shown: r.shown,
});
const DESIGN_SELECT =
  'SELECT id, project_id, key, title, suite, kind, step_list, parameters, version, quarantined, quarantine_note, item_id, gherkin FROM test_cases';

async function designOf(c: PoolClient, a: Access, id: string): Promise<DesignRow> {
  await loadCase(c, a, id);
  const r = (await c.query<DesignRow>(DESIGN_SELECT + ' WHERE id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Test case not found');
  // [PCODE-313 | S15 | v0.1.0] shared steps expanded, as everyone reads and runs the case
  r.shown = expandSteps(r.step_list, await sharedStepsOf(c, r.project_id));
  return r;
}

/** A new task in the project's first open state: used for defects found in a run. */
// [PCODE-319 | S15 | v0.1.0] also for bugs captured in the browser, at their own priority
export async function createItem(
  c: PoolClient,
  a: Access,
  projectId: string,
  title: string,
  description: string,
  kind: string,
  priority = 'high',
): Promise<{ id: string; ref: string }> {
  const p = (
    await c.query<{ key: string; archived_at: Date | null }>(
      'SELECT key, archived_at FROM projects WHERE id = $1',
      [projectId],
    )
  ).rows[0];
  if (!p) throw new HttpError(404, 'not_found', 'Project not found');
  if (p.archived_at)
    throw new HttpError(409, 'conflict', 'The project is archived; restore it first');
  const state = (
    await c.query<{ id: string }>(
      `SELECT id FROM project_states WHERE project_id = $1 ORDER BY CASE grp WHEN 'unstarted' THEN 0 WHEN 'backlog' THEN 1 ELSE 2 END, position LIMIT 1`,
      [projectId],
    )
  ).rows[0];
  if (!state) throw new HttpError(409, 'conflict', 'The project has no states');
  const seq =
    (
      await c.query<{ seq: number }>(
        'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
        [projectId],
      )
    ).rows[0]?.seq ?? 0;
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, kind, priority, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT coalesce(min(rank), 0) - 1 FROM items WHERE project_id = $2)) RETURNING id`,
      [
        a.workspaceId,
        projectId,
        seq,
        title.slice(0, 255),
        description.slice(0, 100_000),
        state.id,
        a.user.id,
        kind,
        priority,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('item insert returned nothing');
  const ref = p.key + '-' + String(seq);
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'created',
      object: { type: 'item', id, label: ref + ' ' + title },
      parent: { type: 'project', id: projectId, label: p.key },
    },
    { projectId },
  );
  return { id, ref };
}

const planCaseOut = s.object({
  caseId: s.string(),
  key: s.string(),
  title: s.string(),
  suite: s.string(),
  kind: s.string(),
  version: s.number({ integer: true }),
  steps: s.array(s.object({ action: s.string(), expected: s.string() })),
  status: s.string(),
  stepResults: s.array(s.object({ status: s.string(), note: s.string() })),
  message: s.string(),
  ranVersion: s.nullable(s.number({ integer: true })),
  assigneeId: s.nullable(s.string()),
  assigneeName: s.nullable(s.string()),
  defectId: s.nullable(s.string()),
  defectRef: s.nullable(s.string()),
  /** blocked by a defect that is done now: ready to run again */
  unblocked: s.boolean(),
  evidence: s.number({ integer: true }),
  quarantined: s.boolean(),
  // [PCODE-314 | S15 | v0.1.0] the time spent on it, and the defect whose fix reopened it
  durationMs: s.nullable(s.number({ integer: true })),
  reopenedBy: s.nullable(s.string()),
  triage: s.nullable(s.anyObject()), // [PCODE-317 | S15 | v0.1.0] the Tester agent's view of a failure
});

export function testLabRoutes(pool: Pool): Route[] {
  const suites = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-suites',
    summary: 'The suites of a project with their counts',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(
      s.object({
        suite: s.string(),
        cases: s.number({ integer: true }),
        automated: s.number({ integer: true }),
        quarantined: s.number({ integer: true }),
        failing: s.number({ integer: true }),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            suite: string;
            cases: string;
            automated: string;
            quarantined: string;
            failing: string;
          }>(
            `SELECT c.suite, count(*) AS cases, count(*) FILTER (WHERE c.kind = 'automated') AS automated,
                    count(*) FILTER (WHERE c.quarantined) AS quarantined,
                    count(*) FILTER (WHERE last.status = 'failed') AS failing
               FROM test_cases c
               LEFT JOIN LATERAL (SELECT r.status FROM test_results r WHERE r.case_id = c.id ORDER BY r.at DESC LIMIT 1) last ON true
              WHERE c.project_id = $1 GROUP BY c.suite ORDER BY c.suite`,
            [params.projectId],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            suite: r.suite,
            cases: Number(r.cases),
            automated: Number(r.automated),
            quarantined: Number(r.quarantined),
            failing: Number(r.failing),
          })),
        };
      }),
  });

  const caseParams = s.object({ workspaceId: uuid, caseId: uuid });
  const design = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/test-cases/:caseId/design',
    summary:
      'A case’s suite, kind, steps, parameters and version, with its recent results and whether it flakes',
    tags: ['tests'],
    params: caseParams,
    response: s.object({
      design: designOut,
      history: s.array(
        s.object({
          runId: s.string(),
          runName: s.string(),
          config: s.anyObject(),
          status: s.string(),
          version: s.nullable(s.number({ integer: true })),
          at: s.string(),
        }),
      ),
      flips: s.number({ integer: true }),
      flaky: s.boolean(),
      passRate: s.number({ integer: true }),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const d = await designOf(c, a, params.caseId);
        const history = (
          await c.query<{
            run_id: string;
            name: string;
            config: Record<string, unknown>;
            status: string;
            case_version: number | null;
            at: Date;
          }>(
            'SELECT r.run_id, t.name, t.config, r.status, r.case_version, r.at FROM test_results r JOIN test_runs t ON t.id = r.run_id WHERE r.case_id = $1 ORDER BY r.at DESC LIMIT 20',
            [d.id],
          )
        ).rows;
        const f = flakiness(history.map((h) => h.status));
        return {
          body: {
            design: designJson(d),
            history: history.map((h) => ({
              runId: h.run_id,
              runName: h.name,
              config: h.config,
              status: h.status,
              version: h.case_version,
              at: h.at.toISOString(),
            })),
            ...f,
          },
        };
      }),
  });

  const setDesign = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/test-cases/:caseId/design',
    summary:
      'Change a case’s suite, kind, steps or parameters; changed steps make a new version (member)',
    tags: ['tests'],
    params: caseParams,
    body: s.object({
      suite: s.optional(s.string({ max: 300 })),
      kind: s.optional(s.enum(['manual', 'bdd', 'exploratory', 'automated'])),
      steps: s.optional(
        s.array(
          s.object({
            action: s.string({ max: 2000 }),
            expected: s.string({ max: 2000 }),
            shared: s.optional(uuid), // [PCODE-313 | S15 | v0.1.0]
          }),
          { max: 100 },
        ),
      ),
      parameters: s.optional(s.anyObject()),
      // [PCODE-313 | S15 | v0.1.0] a BDD case's Gherkin: one scenario, its steps and parameters made from it
      gherkin: s.optional(s.string({ max: 50_000 })),
    }),
    response: designOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const d = await designOf(c, a, params.caseId);
        // [PCODE-313 | S15 | v0.1.0] Gherkin makes the steps and, for an outline, the parameters
        let gherkin: string | null = null;
        if (body.gherkin !== undefined && body.gherkin.trim()) {
          const g = parseGherkin(body.gherkin);
          if (!g.errors.length && g.scenarios.length !== 1)
            g.errors.push({ line: 0, message: 'One scenario per case; import a feature for more' });
          if (g.errors.length)
            throw new HttpError(
              400,
              'invalid_request',
              'The Gherkin has mistakes',
              g.errors.slice(0, 20).map((e) => ({
                path: 'body.gherkin' + (e.line ? ':' + String(e.line) : ''),
                message: e.message,
              })),
            );
          const sc = g.scenarios[0];
          if (sc) {
            body.steps = gherkinSteps(g.background, sc);
            if (sc.outline) body.parameters = examplesAsParameters(sc);
            body.kind = 'bdd';
          }
          gherkin = body.gherkin.trim() + '\n';
        } else if (body.gherkin !== undefined) gherkin = '';
        if (body.steps) {
          const shared = await sharedStepsOf(c, d.project_id);
          for (const [i, x] of body.steps.entries())
            if (x.shared ? !shared.has(x.shared) : !x.action.trim())
              throw new HttpError(400, 'invalid_request', 'A step needs an action', [
                {
                  path: 'body.steps.' + String(i),
                  message: x.shared ? 'names shared steps of another project' : 'has no action',
                },
              ]);
        }
        if (body.parameters)
          for (const [k, v] of Object.entries(body.parameters))
            if (
              !/^[a-z][a-z0-9_]{0,30}$/i.test(k) ||
              !Array.isArray(v) ||
              v.length > 30 ||
              !v.every((x) => typeof x === 'string' && x.length <= 100)
            )
              throw new HttpError(
                400,
                'invalid_request',
                'Parameters are names with lists of values',
                [{ path: 'body.parameters.' + k, message: 'is a list of up to 30 short texts' }],
              );
        const steps = body.steps?.map((x) =>
          x.shared
            ? { action: '', expected: '', shared: x.shared }
            : { action: x.action.trim(), expected: x.expected.trim() },
        );
        const changed =
          steps !== undefined && JSON.stringify(steps) !== JSON.stringify(d.step_list);
        await c.query(
          `UPDATE test_cases SET suite = coalesce($2, suite), kind = coalesce($3, kind), step_list = coalesce($4::jsonb, step_list),
                  parameters = coalesce($5::jsonb, parameters), version = version + $6,
                  steps = CASE WHEN $4::jsonb IS NULL THEN steps ELSE $7 END, gherkin = coalesce($8, gherkin)
            WHERE id = $1`,
          [
            d.id,
            body.suite?.trim() ?? null,
            body.kind ?? null,
            steps ? JSON.stringify(steps) : null,
            body.parameters ? JSON.stringify(body.parameters) : null,
            changed ? 1 : 0,
            (steps ?? [])
              .map(
                (x, i) =>
                  String(i + 1) +
                  '. ' +
                  (x.shared ? '(shared steps)' : x.action) +
                  (x.expected ? ' → ' + x.expected : ''),
              )
              .join('\n'),
            gherkin, // [PCODE-313 | S15 | v0.1.0]
          ],
        );
        return { body: designJson(await designOf(c, a, d.id)) };
      }),
  });

  const quarantine = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-cases/:caseId/quarantine',
    summary: 'Put a flaky case in quarantine (its failures stop counting) or take it out (member)',
    tags: ['tests'],
    params: caseParams,
    body: s.object({ on: s.boolean(), note: s.optional(s.string({ max: 1000 })) }),
    response: designOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const d = await designOf(c, a, params.caseId);
        if (body.on && !body.note?.trim())
          throw new HttpError(400, 'invalid_request', 'Say why it is quarantined', [
            { path: 'body.note', message: 'is required to quarantine' },
          ]);
        await c.query(
          'UPDATE test_cases SET quarantined = $2, quarantine_note = $3 WHERE id = $1',
          [d.id, body.on, body.on ? (body.note?.trim() ?? '') : ''],
        );
        return { body: designJson(await designOf(c, a, d.id)) };
      }),
  });

  const health = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-health',
    summary:
      'Flaky and quarantined cases, failing cases, and the tests behind the active sprint’s tasks',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.object({
      flaky: s.array(
        s.object({
          caseId: s.string(),
          key: s.string(),
          title: s.string(),
          flips: s.number({ integer: true }),
          passRate: s.number({ integer: true }),
          quarantined: s.boolean(),
        }),
      ),
      quarantined: s.array(s.object({ caseId: s.string(), title: s.string(), note: s.string() })),
      failing: s.array(
        s.object({
          caseId: s.string(),
          title: s.string(),
          itemRef: s.nullable(s.string()),
          since: s.string(),
        }),
      ),
      sprint: s.nullable(
        s.object({
          name: s.string(),
          tasks: s.number({ integer: true }),
          withTests: s.number({ integer: true }),
          passing: s.number({ integer: true }),
          failing: s.number({ integer: true }),
          untested: s.number({ integer: true }),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const hist = (
          await c.query<{
            id: string;
            key: string;
            title: string;
            quarantined: boolean;
            quarantine_note: string;
            statuses: string[];
            last_at: Date | null;
            item_ref: string | null;
          }>(
            `SELECT c.id, c.key, c.title, c.quarantined, c.quarantine_note,
                    coalesce((SELECT array_agg(x.status ORDER BY x.at DESC) FROM (SELECT r.status, r.at FROM test_results r WHERE r.case_id = c.id ORDER BY r.at DESC LIMIT 10) x), '{}') AS statuses,
                    (SELECT max(r.at) FROM test_results r WHERE r.case_id = c.id) AS last_at,
                    CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref
               FROM test_cases c JOIN projects p ON p.id = c.project_id LEFT JOIN items i ON i.id = c.item_id
              WHERE c.project_id = $1`,
            [params.projectId],
          )
        ).rows;
        const flaky = hist
          .map((h) => ({ h, f: flakiness(h.statuses) }))
          .filter((x) => x.f.flaky)
          .map((x) => ({
            caseId: x.h.id,
            key: x.h.key,
            title: x.h.title,
            flips: x.f.flips,
            passRate: x.f.passRate,
            quarantined: x.h.quarantined,
          }));
        const sprint = (
          await c.query<{
            name: string;
            tasks: string;
            with_tests: string;
            passing: string;
            failing: string;
            untested: string;
          }>(
            `SELECT s.name, count(DISTINCT i.id) AS tasks, count(DISTINCT i.id) FILTER (WHERE tc.id IS NOT NULL) AS with_tests,
                    count(DISTINCT tc.id) FILTER (WHERE last.status = 'passed') AS passing,
                    count(DISTINCT tc.id) FILTER (WHERE last.status = 'failed') AS failing,
                    count(DISTINCT tc.id) FILTER (WHERE last.status IS NULL) AS untested
               FROM sprints s JOIN items i ON i.sprint_id = s.id
               LEFT JOIN test_cases tc ON tc.item_id = i.id
               LEFT JOIN LATERAL (SELECT r.status FROM test_results r WHERE r.case_id = tc.id ORDER BY r.at DESC LIMIT 1) last ON true
              WHERE s.project_id = $1 AND s.status = 'active' GROUP BY s.id`,
            [params.projectId],
          )
        ).rows[0];
        return {
          body: {
            flaky,
            quarantined: hist
              .filter((h) => h.quarantined)
              .map((h) => ({ caseId: h.id, title: h.title, note: h.quarantine_note })),
            failing: hist
              .filter((h) => h.statuses[0] === 'failed' && !h.quarantined)
              .map((h) => ({
                caseId: h.id,
                title: h.title,
                itemRef: h.item_ref,
                since: h.last_at?.toISOString() ?? '',
              })),
            sprint: sprint
              ? {
                  name: sprint.name,
                  tasks: Number(sprint.tasks),
                  withTests: Number(sprint.with_tests),
                  passing: Number(sprint.passing),
                  failing: Number(sprint.failing),
                  untested: Number(sprint.untested),
                }
              : null,
          },
        };
      }),
  });

  const compare = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/test-run-comparison',
    summary: 'What changed between two runs: newly failing, fixed, and cases only one of them ran',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ a: uuid, b: uuid }),
    response: s.object({
      a: s.object({ id: s.string(), name: s.string() }),
      b: s.object({ id: s.string(), name: s.string() }),
      changes: s.array(
        s.object({
          caseId: s.string(),
          title: s.string(),
          from: s.nullable(s.string()),
          to: s.nullable(s.string()),
        }),
      ),
      broken: s.number({ integer: true }),
      fixed: s.number({ integer: true }),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const [ra, rb] = [await loadRun(c, a, query.a), await loadRun(c, a, query.b)];
        const rows = (
          await c.query<{ case_id: string; title: string; sa: string | null; sb: string | null }>(
            `SELECT c.id AS case_id, c.title, x.status AS sa, y.status AS sb
               FROM test_cases c
               LEFT JOIN test_results x ON x.case_id = c.id AND x.run_id = $1
               LEFT JOIN test_results y ON y.case_id = c.id AND y.run_id = $2
              WHERE (x.case_id IS NOT NULL OR y.case_id IS NOT NULL) AND x.status IS DISTINCT FROM y.status
              ORDER BY c.title`,
            [ra.id, rb.id],
          )
        ).rows;
        return {
          body: {
            a: { id: ra.id, name: ra.name },
            b: { id: rb.id, name: rb.name },
            changes: rows.map((r) => ({ caseId: r.case_id, title: r.title, from: r.sa, to: r.sb })),
            broken: rows.filter((r) => r.sb === 'failed' && r.sa !== 'failed').length,
            fixed: rows.filter((r) => r.sa === 'failed' && r.sb === 'passed').length,
          },
        };
      }),
  });

  const matrix = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-runs/plan',
    summary:
      'Plan runs: one per configuration, for the cases chosen (or a suite), or one exploratory session (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 200 }),
      caseIds: s.optional(s.array(uuid, { max: 2000 })),
      suite: s.optional(s.string({ max: 300 })),
      configs: s.optional(s.array(s.anyObject(), { max: 20 })),
      charter: s.optional(s.string({ max: 4000 })),
      timeboxMinutes: s.optional(s.number({ integer: true, min: 1, max: 600 })),
      releaseId: s.optional(uuid),
    }),
    response: s.array(runOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        let cases: string[] = [];
        if (body.caseIds?.length) {
          cases = (
            await c.query<{ id: string }>(
              'SELECT id FROM test_cases WHERE project_id = $1 AND id = ANY($2::uuid[])',
              [p.id, body.caseIds],
            )
          ).rows.map((r) => r.id);
          if (cases.length !== new Set(body.caseIds).size)
            throw new HttpError(400, 'invalid_request', 'Every case belongs to this project', [
              { path: 'body.caseIds', message: 'names a case of another project' },
            ]);
        } else if (body.suite !== undefined)
          cases = (
            await c.query<{ id: string }>(
              "SELECT id FROM test_cases WHERE project_id = $1 AND (suite = $2 OR suite LIKE $2 || ' / %') AND NOT quarantined ORDER BY key, title",
              [p.id, body.suite],
            )
          ).rows.map((r) => r.id);
        if (!cases.length && !body.charter?.trim())
          throw new HttpError(
            400,
            'invalid_request',
            'Plan cases, a suite or an exploratory charter',
            [{ path: 'body', message: 'has no cases and no charter' }],
          );
        if (body.releaseId) {
          const rel = (
            await c.query<{ project_id: string }>('SELECT project_id FROM releases WHERE id = $1', [
              body.releaseId,
            ])
          ).rows[0];
          if (rel?.project_id !== p.id)
            throw new HttpError(400, 'invalid_request', 'The release belongs to another project', [
              { path: 'body.releaseId', message: 'is not a release of this project' },
            ]);
        }
        const configs = body.configs?.length ? body.configs : [{}];
        for (const cfg of configs)
          for (const [k, v] of Object.entries(cfg))
            if (!/^[a-z][a-z0-9_]{0,30}$/i.test(k) || typeof v !== 'string' || v.length > 100)
              throw new HttpError(
                400,
                'invalid_request',
                'A configuration names short values, e.g. browser: webkit',
                [{ path: 'body.configs', message: k + ' is not a short text' }],
              );
        const out = [];
        for (const cfg of configs) {
          const label = Object.values(cfg).join(' · ');
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO test_runs (workspace_id, project_id, name, source, started_by, config, charter, timebox_minutes, planned_case_ids, release_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
              [
                a.workspaceId,
                p.id,
                body.name.trim() + (label ? ' (' + label + ')' : ''),
                body.charter?.trim() ? 'exploratory' : 'manual',
                a.user.id,
                JSON.stringify(cfg),
                body.charter?.trim() ?? '',
                body.timeboxMinutes ?? null,
                cases,
                body.releaseId ?? null,
              ],
            )
          ).rows[0]?.id;
          const run = await loadRun(c, a, id ?? '');
          await runEvent(c, a, run, 'created');
          out.push(runJson(run));
        }
        return { status: 201, body: out };
      }),
  });

  const runParams = s.object({ workspaceId: uuid, runId: uuid });
  const plan = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/plan',
    summary:
      'A run with its configuration or charter, and each planned case with its result, steps, assignee, defect and evidence',
    tags: ['tests'],
    params: runParams,
    response: s.object({
      run: runOut,
      config: s.anyObject(),
      charter: s.string(),
      timeboxMinutes: s.nullable(s.number({ integer: true })),
      notes: s.string(),
      cases: s.array(planCaseOut),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        const meta = (
          await c.query<{
            config: Record<string, unknown>;
            charter: string;
            timebox_minutes: number | null;
            notes: string;
            planned_case_ids: string[];
            assignments: Record<string, string>;
            reopened: Record<string, { defect: string }>;
          }>(
            'SELECT config, charter, timebox_minutes, notes, planned_case_ids, assignments, reopened FROM test_runs WHERE id = $1',
            [run.id],
          )
        ).rows[0];
        const rows = (
          await c.query<{
            id: string;
            key: string;
            title: string;
            suite: string;
            kind: string;
            version: number;
            step_list: Step[];
            quarantined: boolean;
            status: string | null;
            step_results: { status: string; note: string }[] | null;
            message: string | null;
            case_version: number | null;
            defect_item_id: string | null;
            defect_ref: string | null;
            defect_group: string | null;
            evidence: string;
            duration_ms: number | null;
            triage: Record<string, unknown> | null;
          }>(
            `SELECT c.id, c.key, c.title, c.suite, c.kind, c.version, c.step_list, c.quarantined, r.status, r.step_results, r.message, r.case_version, r.duration_ms, r.triage,
                    r.defect_item_id, dp.key || '-' || d.sequence AS defect_ref, ds.grp AS defect_group,
                    (SELECT count(*) FROM test_evidence e WHERE e.run_id = $1 AND e.case_id = c.id) AS evidence
               FROM test_cases c
               LEFT JOIN test_results r ON r.run_id = $1 AND r.case_id = c.id
               LEFT JOIN items d ON d.id = r.defect_item_id LEFT JOIN projects dp ON dp.id = d.project_id
               LEFT JOIN project_states ds ON ds.id = d.state_id
              WHERE c.id = ANY($2::uuid[]) OR r.case_id IS NOT NULL
              ORDER BY c.suite, c.key, c.title`,
            [run.id, meta?.planned_case_ids ?? []],
          )
        ).rows;
        const assign = meta?.assignments ?? {};
        // [PCODE-314 | S15 | v0.1.0] the defects that reopened cases, by their reference
        const reopened = meta?.reopened ?? {};
        const defectRefs = new Map(
          (
            await c.query<{ id: string; ref: string }>(
              `SELECT i.id, p.key || '-' || i.sequence AS ref FROM items i JOIN projects p ON p.id = i.project_id
                WHERE i.id = ANY($1::uuid[])`,
              [Object.values(reopened).map((x) => x.defect)],
            )
          ).rows.map((x) => [x.id, x.ref]),
        );
        // [PCODE-313 | S15 | v0.1.0] shared steps expanded, <parameters> filled from the run's configuration
        const shared = await sharedStepsOf(c, run.project_id);
        const cfg = meta?.config ?? {};
        // [PCODE-318 | S15 | v0.1.0] open test data filled in; a sensitive value stays {{data:name}}
        const open = new Map(
          (await testDataOf(c, run.project_id))
            .filter((d) => !d.sensitive)
            .map((d) => [d.name, d.value]),
        );
        const fill = (t: string): string => fillTestData(fillPlaceholders(t, cfg), open);
        const shownOf = (list: Step[]) =>
          expandSteps(list, shared).map((x) => ({
            action: fill(x.action),
            expected: fill(x.expected),
          }));
        const names = new Map(
          (
            await c.query<{ id: string; name: string }>(
              'SELECT id, name FROM users WHERE id = ANY($1::uuid[])',
              [Object.values(assign)],
            )
          ).rows.map((u) => [u.id, u.name]),
        );
        return {
          body: {
            run: runJson(run),
            config: meta?.config ?? {},
            charter: meta?.charter ?? '',
            timeboxMinutes: meta?.timebox_minutes ?? null,
            notes: meta?.notes ?? '',
            cases: rows.map((r) => ({
              caseId: r.id,
              key: r.key,
              title: r.title,
              suite: r.suite,
              kind: r.kind,
              version: r.version,
              steps: shownOf(r.step_list),
              status: r.status ?? 'untested',
              stepResults: r.step_results ?? [],
              message: r.message ?? '',
              ranVersion: r.case_version,
              assigneeId: assign[r.id] ?? null,
              assigneeName: assign[r.id] ? (names.get(assign[r.id] ?? '') ?? null) : null,
              defectId: r.defect_item_id,
              defectRef: r.defect_ref,
              unblocked:
                r.status === 'blocked' &&
                (r.defect_group === 'completed' || r.defect_group === 'cancelled'),
              evidence: Number(r.evidence),
              quarantined: r.quarantined,
              durationMs: r.duration_ms,
              triage: r.triage,
              reopenedBy:
                r.status === null && reopened[r.id]
                  ? (defectRefs.get(reopened[r.id]?.defect ?? '') ?? null)
                  : null,
            })),
          },
        };
      }),
  });

  // [PCODE-314 | S15 | v0.1.0] who has what to test in the running runs
  const workload = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-workload',
    summary:
      'Per person, the cases assigned in the project’s running runs: done, failing and left; and what nobody has',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.object({
      people: s.array(
        s.object({
          userId: s.string(),
          name: s.string(),
          assigned: s.number({ integer: true }),
          done: s.number({ integer: true }),
          failing: s.number({ integer: true }),
          left: s.number({ integer: true }),
          runs: s.number({ integer: true }),
          spentMs: s.number({ integer: true }),
        }),
      ),
      unassigned: s.number({ integer: true }),
      runs: s.number({ integer: true }),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const runs = (
          await c.query<{
            id: string;
            planned_case_ids: string[];
            assignments: Record<string, string>;
          }>(
            "SELECT id, planned_case_ids, assignments FROM test_runs WHERE project_id = $1 AND status = 'running' LIMIT 500",
            [p.id],
          )
        ).rows;
        const results = (
          await c.query<{
            run_id: string;
            case_id: string;
            status: string;
            duration_ms: number | null;
          }>(
            'SELECT run_id, case_id, status, duration_ms FROM test_results WHERE run_id = ANY($1::uuid[])',
            [runs.map((r) => r.id)],
          )
        ).rows;
        const resultOf = new Map(results.map((r) => [r.run_id + ':' + r.case_id, r]));
        const per = new Map<
          string,
          { assigned: number; done: number; failing: number; runs: Set<string>; spentMs: number }
        >();
        let unassigned = 0;
        for (const run of runs) {
          const cases = new Set([
            ...run.planned_case_ids,
            ...results.filter((r) => r.run_id === run.id).map((r) => r.case_id),
          ]);
          for (const caseId of cases) {
            const who = run.assignments[caseId];
            const res = resultOf.get(run.id + ':' + caseId);
            if (!who) {
              if (!res) unassigned++;
              continue;
            }
            const x = per.get(who) ?? {
              assigned: 0,
              done: 0,
              failing: 0,
              runs: new Set(),
              spentMs: 0,
            };
            x.assigned++;
            x.runs.add(run.id);
            if (res) {
              x.done++;
              if (res.status === 'failed' || res.status === 'blocked') x.failing++;
              x.spentMs += res.duration_ms ?? 0;
            }
            per.set(who, x);
          }
        }
        const names = new Map(
          (
            await c.query<{ id: string; name: string }>(
              'SELECT id, name FROM users WHERE id = ANY($1::uuid[])',
              [[...per.keys()]],
            )
          ).rows.map((u) => [u.id, u.name]),
        );
        return {
          body: {
            people: [...per.entries()]
              .map(([userId, x]) => ({
                userId,
                name: names.get(userId) ?? 'someone',
                assigned: x.assigned,
                done: x.done,
                failing: x.failing,
                left: x.assigned - x.done,
                runs: x.runs.size,
                spentMs: x.spentMs,
              }))
              .sort((x, y) => y.left - x.left || x.name.localeCompare(y.name)),
            unassigned,
            runs: runs.length,
          },
        };
      }),
  });

  const runningRun = async (c: PoolClient, a: Access, id: string) => {
    const run = await loadRun(c, a, id);
    if (run.status !== 'running') throw new HttpError(409, 'conflict', 'This run has ended');
    return run;
  };
  const caseOfRun = async (
    c: PoolClient,
    a: Access,
    runProject: string,
    caseId: string,
  ): Promise<DesignRow> => {
    const d = await designOf(c, a, caseId);
    if (d.project_id !== runProject)
      throw new HttpError(400, 'invalid_request', 'The case belongs to another project', [
        { path: 'params.caseId', message: 'is not a case of this project' },
      ]);
    return d;
  };

  const result = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/cases/:caseId',
    summary: 'Record a case’s result in the run, step by step; the case version is pinned (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid, caseId: uuid }),
    body: s.object({
      status: s.enum(['passed', 'failed', 'skipped', 'blocked']),
      steps: s.optional(
        s.array(
          s.object({ status: s.enum(STEP_STATUSES), note: s.optional(s.string({ max: 2000 })) }),
          { max: 100 },
        ),
      ),
      message: s.optional(s.string({ max: 20_000 })),
      durationMs: s.optional(s.number({ integer: true, min: 0, max: 86_400_000 })),
    }),
    response: runOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        const run = await runningRun(c, a, params.runId);
        const d = await caseOfRun(c, a, run.project_id, params.caseId);
        if (body.steps && body.steps.length !== d.shown.length)
          throw new HttpError(
            400,
            'invalid_request',
            'One result per step of version ' + String(d.version),
            [
              {
                path: 'body.steps',
                message:
                  'has ' +
                  String(body.steps.length) +
                  ' entries for ' +
                  String(d.shown.length) +
                  ' steps',
              },
            ],
          );
        const mask = await maskerFor(c, run.project_id); // [PCODE-318 | S15 | v0.1.0]
        await c.query(
          `INSERT INTO test_results (workspace_id, run_id, case_id, status, duration_ms, message, step_results, case_version, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (run_id, case_id) DO UPDATE SET status = $4, duration_ms = coalesce($5, test_results.duration_ms), message = $6,
             step_results = $7, case_version = $8, at = now()`,
          [
            a.workspaceId,
            run.id,
            d.id,
            body.status,
            body.durationMs ?? null,
            mask(body.message?.trim() ?? ''),
            JSON.stringify(
              (body.steps ?? []).map((x) => ({
                status: x.status,
                note: mask(x.note?.trim() ?? ''),
              })),
            ),
            d.version,
          ],
        );
        await c.query(
          'UPDATE test_runs SET planned_case_ids = CASE WHEN $2 = ANY(planned_case_ids) THEN planned_case_ids ELSE array_append(planned_case_ids, $2) END WHERE id = $1',
          [run.id, d.id],
        );
        const after = await loadRun(c, a, run.id);
        await runEvent(c, a, after, 'progressed');
        return { body: runJson(after) };
      }),
  });

  const assign = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/assign',
    summary: 'Give a planned case of the run to a person, or take it back (member)',
    tags: ['tests'],
    params: runParams,
    body: s.object({ caseId: uuid, userId: s.nullable(uuid) }),
    response: s.object({ assignments: s.anyObject() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await runningRun(c, a, params.runId);
        await caseOfRun(c, a, run.project_id, body.caseId);
        if (body.userId) {
          const ok = await c.query(
            "SELECT 1 FROM workspace_members WHERE user_id = $1 AND role <> 'guest'",
            [body.userId],
          );
          if (!ok.rowCount)
            throw new HttpError(400, 'invalid_request', 'Assign a member of the team', [
              { path: 'body.userId', message: 'is not a team member' },
            ]);
        }
        const r = (
          await c.query<{ assignments: Record<string, string> }>(
            `UPDATE test_runs SET assignments = CASE WHEN $3::uuid IS NULL THEN assignments - $2 ELSE assignments || jsonb_build_object($2, $3::text) END
              WHERE id = $1 RETURNING assignments`,
            [run.id, body.caseId, body.userId],
          )
        ).rows[0];
        return { body: { assignments: r?.assignments ?? {} } };
      }),
  });

  const evidenceOut = s.object({
    id: s.string(),
    caseId: s.string(),
    step: s.nullable(s.number({ integer: true })),
    kind: s.string(),
    note: s.string(),
    fileName: s.string(),
    mime: s.string(),
    url: s.string(),
    at: s.string(),
  });
  const addEvidence = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/cases/:caseId/evidence',
    summary:
      'Attach an uploaded screenshot, recording, log or voice note to a case of the run, optionally to a step (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid, caseId: uuid }),
    body: s.object({
      fileId: uuid,
      kind: s.optional(
        s.enum(['screenshot', 'recording', 'console', 'network', 'voice', 'document']),
      ),
      step: s.optional(s.number({ integer: true, min: 1, max: 100 })),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: evidenceOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        const d = await caseOfRun(c, a, run.project_id, params.caseId);
        const f = await visibleFile(c, a, body.fileId);
        if (f.project_id !== run.project_id)
          throw new HttpError(400, 'invalid_request', 'The file belongs to another project', [
            { path: 'body.fileId', message: 'is not a file of this project' },
          ]);
        const kind =
          body.kind ??
          (f.mime.startsWith('video/')
            ? 'recording'
            : f.mime.startsWith('audio/')
              ? 'voice'
              : f.mime.startsWith('image/')
                ? 'screenshot'
                : 'document');
        const row = (
          await c.query<{ id: string; created_at: Date }>(
            'INSERT INTO test_evidence (workspace_id, run_id, case_id, step, file_id, kind, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at',
            [
              a.workspaceId,
              run.id,
              d.id,
              body.step ?? null,
              f.id,
              kind,
              (await maskerFor(c, run.project_id))(body.note?.trim() ?? ''), // [PCODE-318 | S15 | v0.1.0]
              a.user.id,
            ],
          )
        ).rows[0];
        if (!row) throw new Error('evidence vanished');
        return {
          status: 201,
          body: {
            id: row.id,
            caseId: d.id,
            step: body.step ?? null,
            kind,
            note: (await maskerFor(c, run.project_id))(body.note?.trim() ?? ''),
            fileName: f.name,
            mime: f.mime,
            url: '/api/workspaces/' + a.workspaceId + '/files/' + f.id + '/content',
            at: row.created_at.toISOString(),
          },
        };
      }),
  });
  const evidence = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/evidence',
    summary: 'The evidence of a run',
    tags: ['tests'],
    params: runParams,
    response: s.array(evidenceOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        const rows = (
          await c.query<{
            id: string;
            case_id: string;
            step: number | null;
            kind: string;
            note: string;
            name: string;
            mime: string;
            file_id: string;
            created_at: Date;
          }>(
            'SELECT e.id, e.case_id, e.step, e.kind, e.note, f.name, f.mime, e.file_id, e.created_at FROM test_evidence e JOIN files f ON f.id = e.file_id WHERE e.run_id = $1 ORDER BY e.created_at',
            [run.id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            caseId: r.case_id,
            step: r.step,
            kind: r.kind,
            note: r.note,
            fileName: r.name,
            mime: r.mime,
            url: '/api/workspaces/' + a.workspaceId + '/files/' + r.file_id + '/content',
            at: r.created_at.toISOString(),
          })),
        };
      }),
  });

  const defect = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/cases/:caseId/defect',
    summary:
      'File a bug from a failed or blocked result: the steps, the failure and the evidence go into it, and the result links it (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid, caseId: uuid }),
    body: s.object({
      title: s.optional(s.string({ min: 1, max: 255 })),
      blocked: s.optional(s.boolean()),
    }),
    response: s.object({ itemId: s.string(), ref: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        const run = await loadRun(c, a, params.runId);
        const d = await caseOfRun(c, a, run.project_id, params.caseId);
        const res = (
          await c.query<{
            status: string;
            message: string;
            step_results: { status: string; note: string }[];
            defect_item_id: string | null;
          }>(
            'SELECT status, message, step_results, defect_item_id FROM test_results WHERE run_id = $1 AND case_id = $2',
            [run.id, d.id],
          )
        ).rows[0];
        if (res?.defect_item_id)
          throw new HttpError(409, 'conflict', 'This result already has its defect');
        const cfg =
          (
            await c.query<{ config: Record<string, string> }>(
              'SELECT config FROM test_runs WHERE id = $1',
              [run.id],
            )
          ).rows[0]?.config ?? {};
        const files = (
          await c.query<{ name: string; kind: string; step: number | null }>(
            'SELECT f.name, e.kind, e.step FROM test_evidence e JOIN files f ON f.id = e.file_id WHERE e.run_id = $1 AND e.case_id = $2',
            [run.id, d.id],
          )
        ).rows;
        const failedAt = (res?.step_results ?? []).findIndex((x) => x.status === 'failed');
        const failNote = res?.step_results.at(failedAt)?.note ?? '';
        const text = [
          'Found in the run "' +
            run.name +
            '"' +
            (Object.keys(cfg).length
              ? ' on ' +
                Object.entries(cfg)
                  .map(([k, v]) => k + ' ' + v)
                  .join(', ')
              : '') +
            '.',
          '',
          '## Steps (case ' + (d.key || d.title) + ', version ' + String(d.version) + ')',
          ...d.shown.map(
            (x, i) =>
              String(i + 1) +
              '. ' +
              x.action +
              (x.expected ? ' → expected: ' + x.expected : '') +
              (i === failedAt ? ' ← fails here' + (failNote ? ': ' + failNote : '') : ''),
          ),
          '',
          ...(res?.message ? ['## What happened', '', res.message, ''] : []),
          ...(files.length
            ? [
                '## Evidence',
                '',
                ...files.map(
                  (f) =>
                    '- ' +
                    f.kind +
                    ': ' +
                    f.name +
                    (f.step ? ' (step ' + String(f.step) + ')' : ''),
                ),
              ]
            : []),
        ].join('\n');
        const item = await createItem(
          c,
          a,
          run.project_id,
          body.title?.trim() ?? 'Fails: ' + d.title,
          text,
          'bug',
        );
        const status = body.blocked ? 'blocked' : 'failed';
        await c.query(
          `INSERT INTO test_results (workspace_id, run_id, case_id, status, defect_item_id, case_version) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id, case_id) DO UPDATE SET defect_item_id = $5, status = CASE WHEN $7 THEN 'blocked' ELSE test_results.status END`,
          [a.workspaceId, run.id, d.id, status, item.id, d.version, Boolean(body.blocked)],
        );
        return { status: 201, body: { itemId: item.id, ref: item.ref } };
      }),
  });

  const session = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/session',
    summary: 'The notes of an exploratory session (member)',
    tags: ['tests'],
    params: runParams,
    body: s.object({ notes: s.string({ max: 50_000 }) }),
    response: s.object({ notes: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        const run = await runningRun(c, a, params.runId);
        // [PCODE-318 | S15 | v0.1.0]
        const notes = (await maskerFor(c, run.project_id))(body.notes);
        await c.query('UPDATE test_runs SET notes = $2 WHERE id = $1', [run.id, notes]);
        return { body: { notes } };
      }),
  });

  const importRun = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-runs/import',
    summary:
      'Import a Playwright JSON, Cypress mochawesome JSON or Allure results report as a finished run; unknown tests become automated cases in their suite (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      // [PCODE-315 | S15 | v0.1.0] Allure's report is { results: [the result files' contents] }
      format: s.enum(['playwright', 'cypress', 'allure']),
      name: s.optional(s.string({ min: 1, max: 200 })),
      report: s.anyObject(),
      config: s.optional(s.anyObject()),
    }),
    response: s.object({
      run: runOut,
      created: s.number({ integer: true }),
      results: s.number({ integer: true }),
    }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const results =
          body.format === 'cypress'
            ? parseMochawesome(body.report)
            : body.format === 'allure'
              ? parseAllure(Array.isArray(body.report['results']) ? body.report['results'] : [])
              : parsePlaywright(body.report);
        const TOOL = { playwright: 'Playwright', cypress: 'Cypress', allure: 'Allure' } as const;
        if (!results.length)
          throw new HttpError(
            400,
            'invalid_request',
            body.format === 'cypress'
              ? 'The report has no tests (use the mochawesome JSON reporter)'
              : body.format === 'allure'
                ? 'No test results (send the -result.json files of allure-results)'
                : 'The report has no tests (use Playwright’s JSON reporter)',
            [{ path: 'body.report', message: 'has no tests' }],
          );
        if (results.length > 5000)
          throw new HttpError(400, 'invalid_request', 'At most 5000 tests per import', [
            { path: 'body.report', message: 'is too large' },
          ]);
        const runId = (
          await c.query<{ id: string }>(
            'INSERT INTO test_runs (workspace_id, project_id, name, source, started_by, config) VALUES ($1, $2, $3, $6, $4, $5) RETURNING id',
            [
              a.workspaceId,
              p.id,
              body.name?.trim() ??
                TOOL[body.format] + ' ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
              a.user.id,
              JSON.stringify(body.config ?? {}),
              body.format,
            ],
          )
        ).rows[0]?.id;
        let created = 0;
        const mask = await maskerFor(c, p.id); // [PCODE-318 | S15 | v0.1.0]
        for (const r of results) {
          let caseRow = (
            await c.query<{ id: string; version: number }>(
              'SELECT id, version FROM test_cases WHERE project_id = $1 AND key = $2',
              [p.id, r.key],
            )
          ).rows[0];
          if (!caseRow) {
            caseRow = (
              await c.query<{ id: string; version: number }>(
                "INSERT INTO test_cases (workspace_id, project_id, key, title, source, suite, kind, created_by) VALUES ($1, $2, $3, $4, 'import', $5, 'automated', $6) RETURNING id, version",
                [a.workspaceId, p.id, r.key, r.title, r.suite, a.user.id],
              )
            ).rows[0];
            created++;
          }
          if (!caseRow) continue;
          await c.query(
            `INSERT INTO test_results (workspace_id, run_id, case_id, status, duration_ms, message, case_version) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (run_id, case_id) DO UPDATE SET status = $4, duration_ms = $5, message = $6`,
            [
              a.workspaceId,
              runId,
              caseRow.id,
              r.status,
              r.durationMs,
              mask(r.message),
              caseRow.version,
            ],
          );
        }
        await c.query("UPDATE test_runs SET status = 'done', finished_at = now() WHERE id = $1", [
          runId,
        ]);
        const run = await loadRun(c, a, runId ?? '');
        await runEvent(c, a, run, Number(run.failed) ? 'failed' : 'completed');
        return { status: 201, body: { run: runJson(run), created, results: results.length } };
      }),
  });

  // [PCODE-177 | S15 | v0.1.0] the bugs found by testing, for the Test tab's Bugs view
  const defects = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-defects',
    summary:
      'The bugs filed from test results: the run and case they came from and where each stands',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(
      s.object({
        itemId: s.string(),
        ref: s.string(),
        title: s.string(),
        priority: s.string(),
        stateName: s.string(),
        stateGroup: s.string(),
        runId: s.string(),
        runName: s.string(),
        caseId: s.string(),
        caseTitle: s.string(),
        result: s.string(),
        at: s.string(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            item_id: string;
            ref: string;
            title: string;
            priority: string;
            state_name: string;
            grp: string;
            run_id: string;
            run_name: string;
            case_id: string;
            case_title: string;
            status: string;
            at: Date;
          }>(
            // [PCODE-314 | S15 | v0.1.0] with the cases a done defect reopened (their result was cleared)
            `SELECT * FROM (
              SELECT d.id AS item_id, dp.key || '-' || d.sequence AS ref, d.title, d.priority, st.name AS state_name, st.grp,
                    r.run_id, tr.name AS run_name, r.case_id, tc.title AS case_title, r.status, r.at
               FROM test_results r JOIN test_runs tr ON tr.id = r.run_id JOIN test_cases tc ON tc.id = r.case_id
               JOIN items d ON d.id = r.defect_item_id JOIN projects dp ON dp.id = d.project_id JOIN project_states st ON st.id = d.state_id
              WHERE tr.project_id = $1
             UNION ALL
              SELECT d.id, dp.key || '-' || d.sequence, d.title, d.priority, st.name, st.grp,
                    tr.id, tr.name, tc.id, tc.title, 'reopened', (e.value->>'at')::timestamptz
               FROM test_runs tr CROSS JOIN LATERAL jsonb_each(tr.reopened) e
               JOIN test_cases tc ON tc.id = e.key::uuid
               JOIN items d ON d.id = (e.value->>'defect')::uuid JOIN projects dp ON dp.id = d.project_id JOIN project_states st ON st.id = d.state_id
              WHERE tr.project_id = $1 AND NOT EXISTS (
                SELECT 1 FROM test_results r2 WHERE r2.run_id = tr.id AND r2.case_id = tc.id AND r2.defect_item_id = d.id)
             ) x ORDER BY at DESC LIMIT 200`,
            [p.id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            itemId: r.item_id,
            ref: r.ref,
            title: r.title,
            priority: r.priority,
            stateName: r.state_name,
            stateGroup: r.grp,
            runId: r.run_id,
            runName: r.run_name,
            caseId: r.case_id,
            caseTitle: r.case_title,
            result: r.status,
            at: r.at.toISOString(),
          })),
        };
      }),
  });

  return [
    suites,
    design,
    setDesign,
    quarantine,
    health,
    compare,
    matrix,
    plan,
    result,
    assign,
    addEvidence,
    evidence,
    defect,
    session,
    importRun,
    defects,
    workload,
  ];
}
