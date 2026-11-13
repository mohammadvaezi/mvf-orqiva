// ── [PCODE-317 | S15 | v0.1.0] T32.4a AI triage of test failures and impacted tests first ──
//    Why:  a failed test asks one question first: is it the product, the test, the environment, or a test
//          that flakes? The Tester agent reads the result with the case's recent history and the commits of
//          its task and answers in one shape, kept with the result. And a change's impacted tests: the
//          cases whose tasks wrote the changed files, are named after them or import them.
import {
  flakiness,
  impactedCases,
  parseFailureTriage,
  type FailureTriage,
  type ImpactCase,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_FAILURE } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { inWorkspace } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, requireUser, type Access } from './access.js';
import { loadRun } from './tests.js';

const uuid = s.string({ format: 'uuid' });

export const FAILURE_PROMPT =
  MODE_FAILURE +
  ' A test failed or was blocked. Say what it most likely is: product_bug (the product does not do what' +
  ' the steps expect), test_bug (the test itself is wrong or out of date), environment (a service, data' +
  ' or network the test needs was not right), or flaky (it passes and fails without a change). Answer' +
  ' with a JSON object only: {"category": "...", "confidence": 0.0 to 1.0, "reason": "one or two' +
  ' sentences", "next": "the next thing a person should do"}.';

const triageOut = s.object({
  category: s.string(),
  confidence: s.number(),
  reason: s.string(),
  next: s.string(),
  at: s.string(),
});

interface Failure {
  run_id: string;
  case_id: string;
  project_id: string;
  title: string;
  key: string;
  step_list: { action: string; expected: string }[];
  status: string;
  message: string;
  step_results: { status: string; note: string }[] | null;
  config: Record<string, unknown>;
  item_id: string | null;
  item_ref: string | null;
}

/** What the agent reads about a failed result. */
async function briefOf(c: PoolClient, f: Failure): Promise<string> {
  const history = (
    await c.query<{ status: string }>(
      'SELECT status FROM test_results WHERE case_id = $1 ORDER BY at DESC LIMIT 20',
      [f.case_id],
    )
  ).rows.map((r) => r.status);
  const commits = f.item_id
    ? (
        await c.query<{ ref: string; title: string }>(
          "SELECT ref, title FROM item_git_links WHERE item_id = $1 AND kind = 'commit' ORDER BY at DESC LIMIT 5",
          [f.item_id],
        )
      ).rows
    : [];
  const flips = flakiness(history).flips;
  return [
    'Case: ' + (f.key ? f.key + ' ' : '') + f.title,
    'Result: ' + f.status,
    'What happened: ' + (f.message || '(no message)').replace(/\s+/g, ' ').slice(0, 4000),
    'Configuration: ' +
      (Object.entries(f.config)
        .map(([k, v]) => k + ' ' + String(v))
        .join(', ') || 'default'),
    'Flips in the last results: ' + String(flips),
    'Last results, newest first: ' + history.join(', '),
    '',
    'Steps:',
    ...f.step_list.map(
      (x, i) =>
        String(i + 1) +
        '. ' +
        x.action +
        (x.expected ? ' → expected: ' + x.expected : '') +
        (f.step_results?.[i]
          ? ' [' +
            f.step_results[i].status +
            (f.step_results[i].note ? ': ' + f.step_results[i].note : '') +
            ']'
          : ''),
    ),
    ...(commits.length
      ? [
          '',
          'Recent commits of ' + (f.item_ref ?? 'its task') + ':',
          ...commits.map((x) => '- ' + x.ref.slice(0, 9) + ' ' + x.title),
        ]
      : []),
  ].join('\n');
}

const FAILURE_SELECT = `SELECT r.run_id, r.case_id, t.project_id, tc.title, tc.key, tc.step_list, r.status, r.message, r.step_results,
    t.config, tc.item_id, p.key || '-' || i.sequence AS item_ref
  FROM test_results r JOIN test_runs t ON t.id = r.run_id JOIN test_cases tc ON tc.id = r.case_id
  LEFT JOIN items i ON i.id = tc.item_id LEFT JOIN projects p ON p.id = i.project_id`;

export function testTriageRoutes(pool: Pool, models: ProviderFor): Route[] {
  /** Asks the agent about one failure and keeps its answer with the result. */
  const triageOne = async (
    workspaceId: string,
    userId: string,
    f: Failure,
  ): Promise<FailureTriage & { at: string }> => {
    const brief = await inWorkspace(pool, workspaceId, (c) => briefOf(c, f));
    const asked = await askAgent(pool, models, {
      workspaceId,
      projectId: f.project_id,
      agentKey: 'tester',
      requestedBy: userId,
      instruction: 'Triage the failed test ' + f.title,
      system: FAILURE_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: brief }] }],
    });
    const t = parseFailureTriage(asked.text) ?? {
      category: 'product_bug' as const,
      confidence: 0,
      reason: 'The agent did not answer in the expected form: ' + asked.text.slice(0, 300),
      next: 'Look at the result yourself.',
    };
    const at = new Date().toISOString();
    await inWorkspace(pool, workspaceId, (c) =>
      c.query('UPDATE test_results SET triage = $3 WHERE run_id = $1 AND case_id = $2', [
        f.run_id,
        f.case_id,
        JSON.stringify({ ...t, runId: asked.runId, at }),
      ]),
    );
    return { ...t, at };
  };

  const loadFailure = async (c: PoolClient, a: Access, runId: string, caseId: string) => {
    await loadRun(c, a, runId);
    const f = (
      await c.query<Failure>(FAILURE_SELECT + ' WHERE r.run_id = $1 AND r.case_id = $2', [
        runId,
        caseId,
      ])
    ).rows[0];
    if (!f) throw new HttpError(404, 'not_found', 'The case has no result in this run');
    if (f.status !== 'failed' && f.status !== 'blocked')
      throw new HttpError(409, 'conflict', 'Only a failed or blocked result is triaged');
    return f;
  };

  const one = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/cases/:caseId/triage',
    summary:
      'The Tester agent says what a failed or blocked result most likely is: product bug, test bug, environment or flaky (tester)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid, caseId: uuid }),
    response: triageOut,
    handler: async ({ params, req }) => {
      const f = await asMember(pool, req, params.workspaceId, 'tester', (c, a) =>
        loadFailure(c, a, params.runId, params.caseId),
      );
      const user = await requireUser(pool, req);
      return { body: await triageOne(params.workspaceId, user.id, f) };
    },
  });

  const all = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/triage',
    summary:
      'Triage every failed or blocked result of a run that has no triage yet, at most 20 at a time (tester)',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    response: s.object({
      triaged: s.number({ integer: true }),
      left: s.number({ integer: true }),
      counts: s.anyObject(),
    }),
    handler: async ({ params, req }) => {
      const list = await asMember(pool, req, params.workspaceId, 'tester', async (c, a) => {
        await loadRun(c, a, params.runId);
        return (
          await c.query<Failure>(
            FAILURE_SELECT +
              " WHERE r.run_id = $1 AND r.status IN ('failed', 'blocked') AND r.triage IS NULL ORDER BY tc.suite, tc.title",
            [params.runId],
          )
        ).rows;
      });
      const user = await requireUser(pool, req);
      const counts: Record<string, number> = {};
      for (const f of list.slice(0, 20)) {
        const t = await triageOne(params.workspaceId, user.id, f);
        counts[t.category] = (counts[t.category] ?? 0) + 1;
      }
      return {
        body: { triaged: Math.min(20, list.length), left: Math.max(0, list.length - 20), counts },
      };
    },
  });

  const impacted = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/test-cases/impacted',
    summary:
      'The cases a change touches, the most directly covered first: give the changed paths or a pull request',
    tags: ['tests'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      paths: s.optional(s.array(s.string({ min: 1, max: 1000 }), { max: 5000 })),
      pullRequestId: s.optional(uuid),
    }),
    response: s.object({
      changed: s.number({ integer: true }),
      cases: s.array(
        s.object({
          caseId: s.string(),
          title: s.string(),
          score: s.number({ integer: true }),
          reasons: s.array(s.string()),
        }),
      ),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        let paths = body.paths ?? [];
        if (body.pullRequestId) {
          const pr = (
            await c.query<{ id: string }>(
              'SELECT id FROM pull_requests WHERE id = $1 AND project_id = $2',
              [body.pullRequestId, p.id],
            )
          ).rows[0];
          if (!pr) throw new HttpError(404, 'not_found', 'Pull request not found');
          paths = [
            ...paths,
            ...(
              await c.query<{ path: string; old_path: string | null }>(
                'SELECT path, old_path FROM pull_request_files WHERE pull_request_id = $1',
                [pr.id],
              )
            ).rows.flatMap((f) => (f.old_path ? [f.path, f.old_path] : [f.path])),
          ];
        }
        if (!paths.length)
          throw new HttpError(400, 'invalid_request', 'Give the changed paths or a pull request', [
            { path: 'body.paths', message: 'is empty' },
          ]);
        const rows = (
          await c.query<{
            id: string;
            title: string;
            key: string;
            suite: string;
            item_ref: string | null;
            files: string[] | null;
          }>(
            `SELECT tc.id, tc.title, tc.key, tc.suite, p.key || '-' || i.sequence AS item_ref,
                    (SELECT array_agg(DISTINCT f.path) FROM item_fingerprints f WHERE f.item_id = tc.item_id) AS files
               FROM test_cases tc LEFT JOIN items i ON i.id = tc.item_id LEFT JOIN projects p ON p.id = i.project_id
              WHERE tc.project_id = $1 AND NOT tc.quarantined LIMIT 20000`,
            [p.id],
          )
        ).rows;
        const imports = new Map(
          (
            await c.query<{ path: string; imports: string[] }>(
              'SELECT path, imports FROM code_files WHERE project_id = $1 AND imports IS NOT NULL',
              [p.id],
            )
          ).rows.map((r) => [r.path, r.imports]),
        );
        const cases: ImpactCase[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          key: r.key,
          suite: r.suite,
          itemRef: r.item_ref,
          itemFiles: r.files ?? [],
        }));
        return {
          body: {
            changed: new Set(paths).size,
            cases: impactedCases([...new Set(paths)], cases, imports).slice(0, 300),
          },
        };
      }),
  });

  return [one, all, impacted];
}
