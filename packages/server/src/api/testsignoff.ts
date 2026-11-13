// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
//    Why:  someone answers for a run. A run names its approver; once it is finished, that person (an admin
//          when nobody is named) signs it off, and the results are kept as they stood then. A release's
//          tests (those of its tasks, by their latest result) and its signed runs are what the release
//          policies' test rules read.
import type { PolicyTests } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast } from './access.js';
import { loadRun } from './tests.js';

const uuid = s.string({ format: 'uuid' });

/** A release's tests: the cases of its tasks by their latest result, and its signed-off runs. */
export async function releaseTests(c: PoolClient, releaseId: string): Promise<PolicyTests> {
  const t = (
    await c.query<{ cases: string; failing: string; passing: string; signed: string }>(
      `WITH latest AS (
         SELECT tc.id, (SELECT r.status FROM test_results r WHERE r.case_id = tc.id ORDER BY r.at DESC LIMIT 1) AS status
           FROM test_cases tc JOIN release_items x ON x.item_id = tc.item_id WHERE x.release_id = $1)
       SELECT count(*) AS cases,
              count(*) FILTER (WHERE status IN ('failed', 'blocked')) AS failing,
              count(*) FILTER (WHERE status = 'passed') AS passing,
              (SELECT count(*) FROM test_runs WHERE release_id = $1 AND signed_at IS NOT NULL) AS signed
         FROM latest`,
      [releaseId],
    )
  ).rows[0];
  const cases = Number(t?.cases ?? 0);
  const failing = Number(t?.failing ?? 0);
  return {
    cases,
    failing,
    untested: cases - failing - Number(t?.passing ?? 0),
    signedRuns: Number(t?.signed ?? 0),
  };
}

const signOut = s.object({
  approverId: s.nullable(s.string()),
  approverName: s.nullable(s.string()),
  signedBy: s.nullable(s.string()),
  signedAt: s.nullable(s.string()),
  note: s.string(),
  snapshot: s.nullable(s.anyObject()),
});

interface SignRow {
  approver_id: string | null;
  approver_name: string | null;
  signer_name: string | null;
  signed_at: Date | null;
  sign_note: string;
  snapshot: Record<string, unknown> | null;
}
const SIGN_SELECT = `SELECT t.approver_id, a.name AS approver_name, sb.name AS signer_name, t.signed_at, t.sign_note, t.snapshot
  FROM test_runs t LEFT JOIN users a ON a.id = t.approver_id LEFT JOIN users sb ON sb.id = t.signed_by WHERE t.id = $1`;
const signJson = (r: SignRow | undefined) => ({
  approverId: r?.approver_id ?? null,
  approverName: r?.approver_name ?? null,
  signedBy: r?.signer_name ?? null,
  signedAt: r?.signed_at?.toISOString() ?? null,
  note: r?.sign_note ?? '',
  snapshot: r?.snapshot ?? null,
});

export function testSignoffRoutes(pool: Pool): Route[] {
  const params = s.object({ workspaceId: uuid, runId: uuid });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/signoff',
    summary:
      'A run’s approver and, once signed off, who signed, when, the note and the frozen results',
    tags: ['tests'],
    params,
    response: signOut,
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const run = await loadRun(c, a, p.runId);
        return { body: signJson((await c.query<SignRow>(SIGN_SELECT, [run.id])).rows[0]) };
      }),
  });

  const approver = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/approver',
    summary: 'Name the person who signs the run off, or nobody (then an admin does) (member)',
    tags: ['tests'],
    params,
    body: s.object({ userId: s.nullable(uuid) }),
    response: signOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const run = await loadRun(c, a, p.runId);
        const signed = (await c.query<SignRow>(SIGN_SELECT, [run.id])).rows[0];
        if (signed?.signed_at) throw new HttpError(409, 'conflict', 'The run is signed off');
        if (body.userId) {
          const ok = await c.query(
            "SELECT 1 FROM workspace_members WHERE user_id = $1 AND role <> 'guest'",
            [body.userId],
          );
          if (!ok.rowCount)
            throw new HttpError(400, 'invalid_request', 'Name a member of the team', [
              { path: 'body.userId', message: 'is not a team member' },
            ]);
        }
        await c.query('UPDATE test_runs SET approver_id = $2 WHERE id = $1', [run.id, body.userId]);
        return { body: signJson((await c.query<SignRow>(SIGN_SELECT, [run.id])).rows[0]) };
      }),
  });

  const sign = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/signoff',
    summary:
      'Sign a finished run off as its approver (an admin when nobody is named); its results are frozen as they stand',
    tags: ['tests'],
    params,
    body: s.object({ note: s.optional(s.string({ max: 2000 })) }),
    response: signOut,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const run = await loadRun(c, a, p.runId);
        const now = (await c.query<SignRow>(SIGN_SELECT, [run.id])).rows[0];
        if (now?.signed_at) throw new HttpError(409, 'conflict', 'The run is signed off already');
        if (run.status !== 'done')
          throw new HttpError(409, 'conflict', 'Finish the run before signing it off');
        if (now?.approver_id ? now.approver_id !== a.user.id : !atLeast(a.role, 'admin'))
          throw new HttpError(
            403,
            'forbidden',
            now?.approver_id
              ? (now.approver_name ?? 'The named approver') + ' signs this run off'
              : 'An admin signs off a run that names nobody',
          );
        const results = (
          await c.query<{
            case_id: string;
            key: string;
            title: string;
            case_version: number | null;
            status: string;
            message: string;
            defect: string | null;
          }>(
            `SELECT r.case_id, tc.key, tc.title, r.case_version, r.status, r.message,
                    dp.key || '-' || d.sequence AS defect
               FROM test_results r JOIN test_cases tc ON tc.id = r.case_id
               LEFT JOIN items d ON d.id = r.defect_item_id LEFT JOIN projects dp ON dp.id = d.project_id
              WHERE r.run_id = $1 ORDER BY tc.suite, tc.key, tc.title`,
            [run.id],
          )
        ).rows;
        const planned = (
          await c.query<{ n: number }>(
            'SELECT cardinality(planned_case_ids) AS n FROM test_runs WHERE id = $1',
            [run.id],
          )
        ).rows[0]?.n;
        const count = (st: string): number => results.filter((r) => r.status === st).length;
        const snapshot = {
          totals: {
            planned: Math.max(planned ?? 0, results.length),
            passed: count('passed'),
            failed: count('failed'),
            blocked: count('blocked'),
            skipped: count('skipped'),
            untested: Math.max(0, (planned ?? 0) - results.length),
          },
          results: results.map((r) => ({
            caseId: r.case_id,
            key: r.key,
            title: r.title,
            version: r.case_version,
            status: r.status,
            message: r.message.slice(0, 2000),
            defect: r.defect,
          })),
        };
        await c.query(
          'UPDATE test_runs SET signed_by = $2, signed_at = now(), sign_note = $3, snapshot = $4 WHERE id = $1',
          [run.id, a.user.id, body.note?.trim() ?? '', JSON.stringify(snapshot)],
        );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'approved',
            object: { type: 'test_run', id: run.id, label: run.name },
          },
          { projectId: run.project_id },
        );
        return { body: signJson((await c.query<SignRow>(SIGN_SELECT, [run.id])).rows[0]) };
      }),
  });

  return [get, approver, sign];
}
