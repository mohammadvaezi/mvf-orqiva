// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-137 | S15 | v0.1.0] Show coverage to requirements, the Tester agent and the G3 tests criterion ──
//    Why:  requirements and their tests side by side: for each task, each acceptance criterion with its
//          cases and their latest results, so the uncovered and the failing stand out. The Tester agent
//          drafts cases from the criteria; nothing is stored until a person accepts a draft. And the quality
//          gate is measured: a finished run where everything passed ticks G3's "All tests pass"; a run with
//          a failure takes back a tick the system made (a person's own tick is left alone).
import { jsonIn, type Actor } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_TESTCASES } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, requireUser } from './access.js';

const uuid = s.string({ format: 'uuid' });

export const TESTCASE_PROMPT =
  MODE_TESTCASES +
  ' Write test cases for the task below, at least one per numbered acceptance criterion. Each case has ' +
  'numbered steps a tester can follow and the expected result. Answer with one JSON object in a ```json ' +
  'block: {"cases": [{"criterion": <its number>, "title": "...", "steps": "1. ...\\n2. ...", "expected": "..."}]}.';

type Last = 'passed' | 'failed' | 'skipped' | 'blocked' | null;

/** A requirement's state from its cases' latest results: failing beats untested beats passing. */
export function requirementState(latest: Last[]): 'uncovered' | 'untested' | 'failing' | 'passing' {
  if (!latest.length) return 'uncovered';
  if (latest.some((x) => x === 'failed' || x === 'blocked')) return 'failing';
  if (latest.some((x) => x === null)) return 'untested';
  return latest.every((x) => x === 'passed' || x === 'skipped') &&
    latest.some((x) => x === 'passed')
    ? 'passing'
    : 'untested';
}

const reqOut = s.object({
  criterionId: s.nullable(s.string()),
  text: s.string(),
  cases: s.number({ integer: true }),
  state: s.string(),
});
const coverageOut = s.object({
  totals: s.object({
    requirements: s.number({ integer: true }),
    covered: s.number({ integer: true }),
    passing: s.number({ integer: true }),
    failing: s.number({ integer: true }),
  }),
  items: s.array(
    s.object({
      itemId: s.string(),
      ref: s.string(),
      title: s.string(),
      requirements: s.array(reqOut),
      otherCases: s.number({ integer: true }),
    }),
  ),
});

export function coverageRoutes(pool: Pool, models: ProviderFor): Route[] {
  const coverage = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/coverage',
    summary: 'Every acceptance criterion with its test cases and their latest results',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: coverageOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const crit = (
          await c.query<{
            item_id: string;
            ref: string;
            title: string;
            criterion_id: string;
            text: string;
          }>(
            `SELECT i.id AS item_id, $2::text || '-' || i.sequence AS ref, i.title, k.id AS criterion_id, k.text
               FROM item_criteria k JOIN items i ON i.id = k.item_id
              WHERE i.project_id = $1 ORDER BY i.sequence, k.position`,
            [p.id, p.key],
          )
        ).rows;
        const cases = (
          await c.query<{
            item_id: string | null;
            criterion_id: string | null;
            last: Last;
            ref: string | null;
            title: string | null;
          }>(
            `SELECT tc.item_id, tc.criterion_id, last.status AS last,
                    $2::text || '-' || i.sequence AS ref, i.title
               FROM test_cases tc LEFT JOIN items i ON i.id = tc.item_id
               LEFT JOIN LATERAL (SELECT r.status FROM test_results r WHERE r.case_id = tc.id ORDER BY r.at DESC LIMIT 1) last ON true
              WHERE tc.project_id = $1`,
            [p.id, p.key],
          )
        ).rows;
        const items = new Map<
          string,
          {
            itemId: string;
            ref: string;
            title: string;
            requirements: {
              criterionId: string | null;
              text: string;
              cases: number;
              state: string;
            }[];
            otherCases: number;
          }
        >();
        for (const k of crit) {
          const entry = items.get(k.item_id) ?? {
            itemId: k.item_id,
            ref: k.ref,
            title: k.title,
            requirements: [],
            otherCases: 0,
          };
          const mine = cases.filter((x) => x.criterion_id === k.criterion_id);
          entry.requirements.push({
            criterionId: k.criterion_id,
            text: k.text,
            cases: mine.length,
            state: requirementState(mine.map((x) => x.last)),
          });
          items.set(k.item_id, entry);
        }
        for (const x of cases)
          if (x.item_id && !x.criterion_id) {
            const entry = items.get(x.item_id) ?? {
              itemId: x.item_id,
              ref: x.ref ?? '',
              title: x.title ?? '',
              requirements: [],
              otherCases: 0,
            };
            entry.otherCases += 1;
            items.set(x.item_id, entry);
          }
        const reqs = [...items.values()].flatMap((i) => i.requirements);
        return {
          body: {
            totals: {
              requirements: reqs.length,
              covered: reqs.filter((r) => r.cases > 0).length,
              passing: reqs.filter((r) => r.state === 'passing').length,
              failing: reqs.filter((r) => r.state === 'failing').length,
            },
            items: [...items.values()],
          },
        };
      }),
  });

  const draftOut = s.object({
    cases: s.array(
      s.object({
        criterionId: s.nullable(s.string()),
        title: s.string(),
        steps: s.string(),
        expected: s.string(),
      }),
    ),
    runId: s.string(),
  });
  const draft = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/items/:itemId/test-cases/draft',
    summary:
      'The Tester agent drafts test cases from the task’s criteria; nothing is stored (member)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    response: draftOut,
    handler: async ({ params, req }) => {
      const before = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = (
          await c.query<{ project_id: string; ref: string; title: string; description: string }>(
            `SELECT i.project_id, p.key || '-' || i.sequence AS ref, i.title, i.description
               FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
            [params.itemId],
          )
        ).rows[0];
        if (!it) throw new HttpError(404, 'not_found', 'Item not found');
        await requireProject(c, a, it.project_id);
        const criteria = (
          await c.query<{ id: string; text: string }>(
            'SELECT id, text FROM item_criteria WHERE item_id = $1 ORDER BY position',
            [params.itemId],
          )
        ).rows;
        if (!criteria.length)
          throw new HttpError(
            409,
            'conflict',
            'Write the task’s acceptance criteria first; the cases are drafted from them',
          );
        return { it, criteria };
      });
      const user = await requireUser(pool, req);
      const brief = [
        'Task ' + before.it.ref + ': ' + before.it.title,
        ...(before.it.description ? ['', before.it.description] : []),
        '',
        'Acceptance criteria:',
        ...before.criteria.map((k, i) => String(i + 1) + '. ' + k.text),
      ].join('\n');
      const asked = await askAgent(pool, models, {
        workspaceId: params.workspaceId,
        projectId: before.it.project_id,
        agentKey: 'tester',
        requestedBy: user.id,
        instruction: 'Draft test cases for ' + before.it.ref,
        system: TESTCASE_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: brief }] }],
      });
      const answer = jsonIn(asked.text) as { cases?: unknown } | null;
      if (!answer || !Array.isArray(answer.cases))
        throw new HttpError(
          502,
          'bad_gateway',
          'The Tester agent’s answer could not be read. Try again.',
        );
      const cases = answer.cases.flatMap((x: unknown) => {
        if (typeof x !== 'object' || x === null) return [];
        const o = x as Record<string, unknown>;
        if (typeof o['title'] !== 'string' || !o['title'].trim()) return [];
        const n = typeof o['criterion'] === 'number' ? o['criterion'] : NaN;
        return [
          {
            criterionId: before.criteria[n - 1]?.id ?? null,
            title: o['title'].trim().slice(0, 300),
            steps: typeof o['steps'] === 'string' ? o['steps'].slice(0, 20_000) : '',
            expected: typeof o['expected'] === 'string' ? o['expected'].slice(0, 5000) : '',
          },
        ];
      });
      return { body: { cases, runId: asked.runId } };
    },
  });

  return [coverage, draft];
}

/** After a test run ends: ticks G3's "tests" criterion on a clean run, takes back the system's tick on a failing one. */
export async function afterTestRun(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  run: {
    project_id: string;
    project_key: string;
    name: string;
    passed: string;
    failed: string;
    skipped: string;
    blocked: string;
  },
): Promise<'ticked' | 'unticked' | null> {
  const passed = Number(run.passed);
  const bad = Number(run.failed) + Number(run.blocked);
  let change: 'ticked' | 'unticked' | null = null;
  if (bad === 0 && passed > 0) {
    const r = await c.query(
      `UPDATE gate_criteria SET met = true, met_by = NULL, met_at = now(), evidence = $2
        WHERE project_id = $1 AND gate_key = 'g3' AND criterion_key = 'tests' AND NOT met`,
      [
        run.project_id,
        (
          'Test run "' +
          run.name +
          '": ' +
          String(passed) +
          ' passed, ' +
          run.skipped +
          ' skipped'
        ).slice(0, 2000),
      ],
    );
    if (r.rowCount) change = 'ticked';
  } else if (bad > 0) {
    const r = await c.query(
      `UPDATE gate_criteria SET met = false, met_at = NULL, evidence = $2
        WHERE project_id = $1 AND gate_key = 'g3' AND criterion_key = 'tests' AND met AND met_by IS NULL`,
      [
        run.project_id,
        ('Test run "' + run.name + '" failed: ' + String(bad) + ' failing').slice(0, 2000),
      ],
    );
    if (r.rowCount) change = 'unticked';
  }
  if (change)
    await recordEvent(
      c,
      workspaceId,
      {
        actor,
        verb: 'updated',
        object: { type: 'gate', id: run.project_id + ':g3', label: run.project_key + ' G3' },
        parent: { type: 'project', id: run.project_id, label: run.project_key },
        changes: {
          criterion: {
            from: change === 'ticked' ? null : 'tests',
            to: change === 'ticked' ? 'tests' : null,
          },
        },
      },
      { projectId: run.project_id },
    );
  return change;
}
