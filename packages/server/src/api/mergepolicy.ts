// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-305 | S15 | v0.1.0] T31.5b The merge queue: in order per branch, merged through the host when the policy passes ──
// ── [PCODE-304 | S15 | v0.1.0] T31.5a Conflicts, stacked pull requests, and merge policies the host enforces through a commit status ──
//    Why:  an admin sets the project's merge policy; each open pull request is checked against it, rule by
//          rule in words, with where it sits in its stack. With "post to the host" on, the verdict goes to
//          the host as the commit status orqiva/policy whenever a webhook changes the pull request (and on
//          "Check again", which also asks the host whether it still merges cleanly). The same verdict on
//          the same commit is not posted twice.
import {
  NO_POLICY,
  policyVerdict,
  stackOf,
  type MergePolicy,
  type Mergeable,
  type PolicyVerdict,
  type Stack,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inWorkspace } from '../db/pool.js';
import { HostError } from '../git/hostapi.js';
import type { Delivery } from '../git/hosts.js';
import { postStatus, readMergeable } from '../git/prstatus.js';
import { checkOf, pullOf } from '../git/pulls.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, requireProject, requireProjectAdmin } from './access.js';
import {
  connOf,
  current,
  hostFailure,
  loadPull,
  marksOf,
  PULL_SELECT,
  type FileRow,
  type PullRow,
} from './prreview.js';

const uuid = s.string({ format: 'uuid' });

const policyIn = s.object({
  requireTask: s.boolean(),
  requireFingerprints: s.boolean(),
  requireApproval: s.boolean(),
  requireChecks: s.boolean(),
  requireSensitiveApproval: s.boolean(),
  blockConflicts: s.boolean(),
  postStatus: s.boolean(),
});

const policyOut = s.object({
  requireTask: s.boolean(),
  requireFingerprints: s.boolean(),
  requireApproval: s.boolean(),
  requireChecks: s.boolean(),
  requireSensitiveApproval: s.boolean(),
  blockConflicts: s.boolean(),
  postStatus: s.boolean(),
  updatedAt: s.nullable(s.string()),
});

const pullPolicyOut = s.object({
  state: s.string(),
  description: s.string(),
  rules: s.array(
    s.object({ key: s.string(), label: s.string(), state: s.string(), why: s.string() }),
  ),
  mergeable: s.string(),
  stack: s.object({
    parent: s.nullable(s.number({ integer: true })),
    parentMerged: s.nullable(s.number({ integer: true })),
    children: s.array(s.number({ integer: true })),
    depth: s.number({ integer: true }),
  }),
  postStatus: s.boolean(),
  posted: s.nullable(s.object({ state: s.string(), at: s.string() })),
  error: s.string(),
});

interface PolicyRow {
  require_task: boolean;
  require_fingerprints: boolean;
  require_approval: boolean;
  require_checks: boolean;
  require_sensitive_approval: boolean;
  block_conflicts: boolean;
  post_status: boolean;
  updated_at: Date;
}

export async function policyOf(
  c: PoolClient,
  projectId: string,
): Promise<MergePolicy & { updatedAt: string | null }> {
  const r = (
    await c.query<PolicyRow>('SELECT * FROM merge_policies WHERE project_id = $1', [projectId])
  ).rows[0];
  if (!r) return { ...NO_POLICY, updatedAt: null };
  return {
    requireTask: r.require_task,
    requireFingerprints: r.require_fingerprints,
    requireApproval: r.require_approval,
    requireChecks: r.require_checks,
    requireSensitiveApproval: r.require_sensitive_approval,
    blockConflicts: r.block_conflicts,
    postStatus: r.post_status,
    updatedAt: r.updated_at.toISOString(),
  };
}

/** The verdict on a pull request from what is kept about it (files only when they describe its head). */
export function verdictOf(
  policy: MergePolicy,
  p: PullRow,
  files: readonly FileRow[] | null,
): PolicyVerdict {
  return policyVerdict(policy, {
    hasTask: p.item_ref !== null,
    reviewState: p.review_state,
    checksState: p.checks_state,
    unmarked: files ? files.filter((f) => marksOf(f, p.item_ref).missing).length : null,
    paths: files ? files.map((f) => f.path) : null,
    mergeable: p.mergeable,
    draft: p.draft,
  });
}

/** The pull requests of the same repository, for its stack. */
// [PCODE-305 | S15 | v0.1.0] exported for the merge queue
export async function stackFor(c: PoolClient, p: PullRow): Promise<Stack> {
  const all = (
    await c.query<{
      id: string;
      number: number;
      branch: string;
      base: string;
      state: string;
      connection_id: string;
    }>(
      `SELECT id, number, branch, base, state, connection_id FROM pull_requests
        WHERE connection_id = $1 AND (state = 'open' OR merged_at > now() - interval '90 days')`,
      [p.connection_id],
    )
  ).rows;
  return stackOf(
    all.map((x) => ({ ...x, connection: x.connection_id })),
    p.id,
  );
}

// [PCODE-305 | S15 | v0.1.0] exported for the merge queue
export async function filesOf(c: PoolClient, p: PullRow): Promise<FileRow[] | null> {
  if (!current(p)) return null;
  return (
    await c.query<FileRow>('SELECT * FROM pull_request_files WHERE pull_request_id = $1', [p.id])
  ).rows;
}

/** The verdict for a pull request; posted to the host when the policy says so and it changed. */
async function checkAndPost(
  pool: Pool,
  workspaceId: string,
  pullId: string,
  o: { refresh: boolean; fetchImpl?: typeof fetch; publicUrl?: string },
): Promise<void> {
  const p = await inWorkspace(pool, workspaceId, async (c) => {
    const row = (await c.query<PullRow>(PULL_SELECT + ' WHERE x.id = $1', [pullId])).rows[0];
    return row ?? null;
  });
  if (!p || p.state !== 'open') return;
  let mergeable: Mergeable | null = null;
  if (o.refresh) {
    try {
      mergeable = await readMergeable(connOf(p, 'it is read with it'), p.number, o.fetchImpl);
    } catch (e) {
      throw hostFailure(e);
    }
  }
  const job = await inWorkspace(pool, workspaceId, async (c) => {
    if (mergeable)
      await c.query('UPDATE pull_requests SET mergeable = $2 WHERE id = $1', [p.id, mergeable]);
    const fresh = { ...p, mergeable: mergeable ?? p.mergeable };
    const policy = await policyOf(c, p.project_id);
    const verdict = verdictOf(policy, fresh, await filesOf(c, fresh));
    const key = p.head_sha + ':' + verdict.state + ':' + verdict.description;
    return policy.postStatus && p.head_sha && p.api_token && key !== p.policy_posted
      ? { verdict, key }
      : null;
  });
  if (!job) return;
  let error = '';
  try {
    await postStatus(
      connOf(p, 'the status is posted with it'),
      {
        number: p.number,
        sha: p.head_sha,
        state: job.verdict.state,
        description: job.verdict.description,
        url: o.publicUrl
          ? o.publicUrl.replace(/\/+$/, '') + '/projects/' + p.project_id + '/versions'
          : null,
      },
      o.fetchImpl,
    );
  } catch (e) {
    if (!(e instanceof HostError || e instanceof HttpError)) throw e;
    error = e.message.slice(0, 300);
  }
  await inWorkspace(pool, workspaceId, (c) =>
    error
      ? c.query('UPDATE pull_requests SET policy_error = $2 WHERE id = $1', [p.id, error])
      : c.query(
          "UPDATE pull_requests SET policy_posted = $2, policy_posted_at = now(), policy_error = '' WHERE id = $1",
          [p.id, job.key.slice(0, 300)],
        ),
  );
}

/** After a webhook changed pull requests: their verdicts, posted where the policy says so. */
export function policyAfterDeliveries(
  pool: Pool,
  o: {
    fetchImpl?: typeof fetch;
    publicUrl?: string;
    log?: (msg: string, data?: Record<string, unknown>) => void;
  } = {},
): (workspaceId: string, connectionId: string, deliveries: readonly Delivery[]) => Promise<void> {
  return async (workspaceId, connectionId, deliveries) => {
    const numbers = deliveries.flatMap((d) => {
      const pr = d.event.startsWith('pull_request') ? pullOf(d.payload) : null;
      return pr ? [pr.number] : [];
    });
    const shas = deliveries.flatMap((d) => {
      const ch = checkOf(d.event, d.payload);
      return ch ? [ch.sha] : [];
    });
    if (!numbers.length && !shas.length) return;
    const ids = await inWorkspace(pool, workspaceId, async (c) =>
      (
        await c.query<{ id: string }>(
          `SELECT x.id FROM pull_requests x JOIN merge_policies m ON m.project_id = x.project_id AND m.post_status
            WHERE x.connection_id = $1 AND x.state = 'open' AND (x.number = ANY($2::int[]) OR x.head_sha = ANY($3::text[]))`,
          [connectionId, numbers, shas],
        )
      ).rows.map((r) => r.id),
    );
    for (const id of ids)
      await checkAndPost(pool, workspaceId, id, {
        refresh: false,
        ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
        ...(o.publicUrl ? { publicUrl: o.publicUrl } : {}),
      }).catch((e: unknown) => {
        o.log?.('merge policy status failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      });
  };
}

export function mergePolicyRoutes(
  pool: Pool,
  o: { fetchImpl?: typeof fetch; publicUrl?: string } = {},
): Route[] {
  const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
  const pullParams = s.object({ workspaceId: uuid, pullId: uuid });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/merge-policy',
    summary: 'What a pull request of the project needs before it merges',
    tags: ['review'],
    params: projectParams,
    response: policyOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return { body: await policyOf(c, params.projectId) };
      }),
  });

  const put = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/merge-policy',
    summary:
      'Set the merge policy (admins); with postStatus the verdict goes to the host as the commit status orqiva/policy',
    tags: ['review'],
    params: projectParams,
    body: policyIn,
    response: policyOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        await requireProject(c, a, params.projectId);
        await c.query(
          `INSERT INTO merge_policies (project_id, workspace_id, require_task, require_fingerprints, require_approval, require_checks,
                                       require_sensitive_approval, block_conflicts, post_status, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (project_id) DO UPDATE SET require_task = $3, require_fingerprints = $4, require_approval = $5,
             require_checks = $6, require_sensitive_approval = $7, block_conflicts = $8, post_status = $9,
             updated_by = $10, updated_at = now()`,
          [
            params.projectId,
            params.workspaceId,
            body.requireTask,
            body.requireFingerprints,
            body.requireApproval,
            body.requireChecks,
            body.requireSensitiveApproval,
            body.blockConflicts,
            body.postStatus,
            a.user.id,
          ],
        );
        return { body: await policyOf(c, params.projectId) };
      }),
  });

  const pullPolicy = async (c: PoolClient, p: PullRow): Promise<Infer<typeof pullPolicyOut>> => {
    const policy = await policyOf(c, p.project_id);
    const v = verdictOf(policy, p, await filesOf(c, p));
    const [sha, state] = p.policy_posted.split(':');
    return {
      ...v,
      mergeable: p.mergeable,
      stack: await stackFor(c, p),
      postStatus: policy.postStatus,
      posted:
        p.policy_posted_at && sha === p.head_sha && state
          ? { state, at: p.policy_posted_at.toISOString() }
          : null,
      error: p.policy_error,
    };
  };

  const show = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/policy',
    summary:
      'The merge policy’s rules for a pull request, met or not in words; whether it merges cleanly; its stack',
    tags: ['review'],
    params: pullParams,
    response: pullPolicyOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: await pullPolicy(c, await loadPull(c, a, params.pullId)),
      })),
  });

  const check = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/pull-requests/:pullId/policy/check',
    summary:
      'Ask the host again whether the pull request merges cleanly, check the policy, and post the verdict when the policy says so',
    tags: ['review'],
    params: pullParams,
    response: pullPolicyOut,
    handler: async ({ params, req }) => {
      const p = await asMember(pool, req, params.workspaceId, 'member', (c, a) =>
        loadPull(c, a, params.pullId),
      );
      if (p.state !== 'open')
        throw new HttpError(409, 'conflict', 'The pull request is ' + p.state);
      await checkAndPost(pool, params.workspaceId, p.id, {
        refresh: true,
        ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
        ...(o.publicUrl ? { publicUrl: o.publicUrl } : {}),
      });
      return asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: await pullPolicy(c, await loadPull(c, a, params.pullId)),
      }));
    },
  });

  return [get, put, show, check];
}
