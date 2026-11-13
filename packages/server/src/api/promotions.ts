// ── [PCODE-204 | S15 | v0.1.0] T17.2 Promotions with approval, rollback per environment, backports, go/no-go meeting notes ──
//    Why:  a version moves through a project's environments by promotion: what runs on one goes to the
//          next. Where an environment names an approver (production, say), the promotion waits for that
//          person, whose decision is an approval over project, version and environment; elsewhere it
//          deploys at once. Each environment rolls back to what ran there before. A fix in a newer release
//          goes back to an older line as a hotfix release (backport). Releases and trains keep the notes
//          of their go/no-go meeting.
import { backportVersion, compareVersions, lineOf, notYetOn } from '@orqiva/shared';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import {
  actorOf,
  asMember,
  atLeast,
  requireProject,
  type Access,
  type ProjectRow,
} from './access.js';
import { queueDeploy } from './deploys.js';
import { previousGoodRef, releaseEvent, releaseOf } from './versions.js';

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

interface EnvRow {
  id: string;
  project_id: string;
  key: string;
  name: string;
  position: number;
  approver_id: string | null;
  approver_name: string | null;
}
const ENV_SELECT = `SELECT e.id, e.project_id, e.key, e.name, e.position, e.approver_id, u.name AS approver_name
  FROM environments e LEFT JOIN users u ON u.id = e.approver_id`;

async function envOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<EnvRow & { project: ProjectRow }> {
  const e = (await c.query<EnvRow>(ENV_SELECT + ' WHERE e.id = $1', [id])).rows[0];
  if (!e) throw new HttpError(404, 'not_found', 'Environment not found');
  try {
    return { ...e, project: await requireProject(c, a, e.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Environment not found');
  }
}

interface RunningRow {
  id: string;
  ref: string;
  status: string;
  trigger: string;
  finished_at: Date | null;
  by: string | null;
}
/** The last deploy that ran well on an environment, and the latest deploy whatever its outcome. */
async function runningOn(
  c: PoolClient,
  envId: string,
): Promise<{ good: RunningRow | null; latest: RunningRow | null }> {
  const q = (where: string) =>
    c.query<RunningRow>(
      `SELECT d.id, d.ref, d.status, d.trigger, d.finished_at, u.name AS by FROM deploy_runs d
         LEFT JOIN users u ON u.id = d.requested_by
        WHERE d.environment_id = $1 ${where} ORDER BY d.created_at DESC LIMIT 1`,
      [envId],
    );
  return {
    good: (await q("AND d.status = 'succeeded'")).rows[0] ?? null,
    latest: (await q('')).rows[0] ?? null,
  };
}

interface PromotionRow {
  id: string;
  project_id: string;
  from_env_id: string | null;
  from_name: string | null;
  to_env_id: string;
  to_name: string;
  ref: string;
  status: string;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  note: string;
  deploy_id: string | null;
  approver_name: string | null;
}
const PROMO_SELECT = `SELECT p.id, p.project_id, p.from_env_id, f.name AS from_name, p.to_env_id, t.name AS to_name, p.ref, p.status,
       r.name AS requested_by_name, p.requested_at, d.name AS decided_by_name, p.decided_at, p.note, p.deploy_id, ap.name AS approver_name
  FROM release_promotions p JOIN environments t ON t.id = p.to_env_id LEFT JOIN environments f ON f.id = p.from_env_id
  LEFT JOIN users r ON r.id = p.requested_by LEFT JOIN users d ON d.id = p.decided_by LEFT JOIN users ap ON ap.id = t.approver_id`;
const promoOut = s.object({
  id: s.string(),
  from: s.nullable(s.string()),
  to: s.string(),
  toEnvironmentId: s.string(),
  ref: s.string(),
  status: s.string(),
  requestedBy: s.nullable(s.string()),
  requestedAt: s.string(),
  approver: s.nullable(s.string()),
  decidedBy: s.nullable(s.string()),
  decidedAt: s.nullable(s.string()),
  note: s.string(),
  deployId: s.nullable(s.string()),
});
const promoJson = (p: PromotionRow): Infer<typeof promoOut> => ({
  id: p.id,
  from: p.from_name,
  to: p.to_name,
  toEnvironmentId: p.to_env_id,
  ref: p.ref,
  status: p.status,
  requestedBy: p.requested_by_name,
  requestedAt: p.requested_at.toISOString(),
  approver: p.approver_name,
  decidedBy: p.decided_by_name,
  decidedAt: p.decided_at?.toISOString() ?? null,
  note: p.note,
  deployId: p.deploy_id,
});

async function promoEvent(
  c: PoolClient,
  a: Access,
  project: ProjectRow,
  p: { id: string; ref: string; to: string },
  verb: 'created' | 'completed' | 'updated',
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'deploy', id: p.id, label: project.key + ' ' + p.ref + ' to ' + p.to },
      parent: { type: 'project', id: project.id, label: project.key },
      changes: { promotion: { from: null, to: p.ref + ' → ' + p.to }, ...changes },
    },
    { projectId: project.id },
  );
}

/** Deploys a promotion: queues the deploy (linked to the release of that version, if any). */
async function deployPromotion(
  c: PoolClient,
  a: Access,
  promotionId: string,
  projectId: string,
  envId: string,
  ref: string,
): Promise<string> {
  const run = await queueDeploy(c, a, envId, ref, 'promotion');
  const rel = (
    await c.query<{ id: string }>(
      'SELECT id FROM releases WHERE project_id = $1 AND version = $2',
      [projectId, ref],
    )
  ).rows[0];
  if (rel) await c.query('UPDATE deploy_runs SET release_id = $2 WHERE id = $1', [run.id, rel.id]);
  await c.query('UPDATE release_promotions SET deploy_id = $2 WHERE id = $1', [
    promotionId,
    run.id,
  ]);
  return run.id;
}

const goNoGoIn = s.object({
  decision: s.enum(['go', 'no_go']),
  notes: s.string({ max: 20_000 }),
  attendees: s.optional(s.array(s.string({ min: 1, max: 120 }), { max: 40 })),
});
const goNoGoOut = s.object({
  decision: s.string(),
  notes: s.string(),
  attendees: s.array(s.string()),
  by: s.string(),
  at: s.string(),
});

export function promotionRoutes(pool: Pool): Route[] {
  const pipeline = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/pipeline',
    summary:
      'The environments in order: what runs on each, a promotion waiting, and what the next one does not have yet',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(
      s.object({
        id: s.string(),
        key: s.string(),
        name: s.string(),
        approver: s.nullable(s.object({ id: s.string(), name: s.string() })),
        running: s.nullable(
          s.object({
            ref: s.string(),
            at: s.nullable(s.string()),
            by: s.nullable(s.string()),
            trigger: s.string(),
          }),
        ),
        latest: s.nullable(s.object({ id: s.string(), ref: s.string(), status: s.string() })),
        waiting: s.nullable(promoOut),
        ahead: s.object({
          versions: s.array(s.string()),
          tasks: s.number({ integer: true }),
          fixes: s.number({ integer: true }),
        }),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const envs = (
          await c.query<EnvRow>(
            ENV_SELECT + ' WHERE e.project_id = $1 ORDER BY e.position, e.name',
            [p.id],
          )
        ).rows;
        const releases = (
          await c.query<{ version: string; tasks: string; fixes: string }>(
            `SELECT r.version,
                    (SELECT count(*) FROM release_items x JOIN items i ON i.id = x.item_id WHERE x.release_id = r.id AND i.kind <> 'bug') AS tasks,
                    (SELECT count(*) FROM release_items x JOIN items i ON i.id = x.item_id WHERE x.release_id = r.id AND i.kind = 'bug') AS fixes
               FROM releases r WHERE r.project_id = $1`,
            [p.id],
          )
        ).rows.map((r) => ({ version: r.version, tasks: Number(r.tasks), fixes: Number(r.fixes) }));
        const runs = [];
        for (const e of envs) runs.push(await runningOn(c, e.id));
        const out = [];
        for (const [i, e] of envs.entries()) {
          const run = runs[i];
          const next = runs[i + 1];
          const waiting = (
            await c.query<PromotionRow>(
              PROMO_SELECT + " WHERE p.to_env_id = $1 AND p.status = 'requested'",
              [e.id],
            )
          ).rows[0];
          out.push({
            id: e.id,
            key: e.key,
            name: e.name,
            approver:
              e.approver_id && e.approver_name
                ? { id: e.approver_id, name: e.approver_name }
                : null,
            running: run?.good
              ? {
                  ref: run.good.ref,
                  at: run.good.finished_at?.toISOString() ?? null,
                  by: run.good.by,
                  trigger: run.good.trigger,
                }
              : null,
            latest: run?.latest
              ? { id: run.latest.id, ref: run.latest.ref, status: run.latest.status }
              : null,
            waiting: waiting ? promoJson(waiting) : null,
            ahead:
              i + 1 < envs.length
                ? notYetOn(
                    releases,
                    run?.good?.ref ?? null,
                    next?.good?.ref ?? null,
                    compareVersions,
                  )
                : { versions: [], tasks: 0, fixes: 0 },
          });
        }
        return { body: out };
      }),
  });

  const setApprover = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/approver',
    summary:
      'Who approves promotions into this environment; none: promotions deploy at once (admin)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, environmentId: uuid }),
    body: s.object({ userId: s.nullable(uuid) }),
    response: s.object({ approver: s.nullable(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const e = await envOf(c, a, params.environmentId);
        if (body.userId) {
          const m = (
            await c.query<{ role: string }>(
              'SELECT role FROM workspace_members WHERE user_id = $1',
              [body.userId],
            )
          ).rows[0];
          if (!m || !atLeast(m.role as Access['role'], 'member'))
            throw new HttpError(
              400,
              'invalid_request',
              'The approver must be a member of the workspace',
              [{ path: 'body.userId', message: 'is not a member' }],
            );
        }
        await c.query('UPDATE environments SET approver_id = $2 WHERE id = $1', [
          e.id,
          body.userId,
        ]);
        const after = await envOf(c, a, e.id);
        return { body: { approver: after.approver_name } };
      }),
  });

  const promote = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/promote',
    summary:
      'Promote what runs on the environment before this one (or a version) here; waits for the approver when the environment names one (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, environmentId: uuid }),
    body: s.optional(
      s.object({
        fromEnvironmentId: s.optional(uuid),
        ref: s.optional(s.string({ min: 1, max: 200 })),
      }),
    ),
    response: promoOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const to = await envOf(c, a, params.environmentId);
        let from: EnvRow | null = null;
        if (body?.fromEnvironmentId) {
          from = await envOf(c, a, body.fromEnvironmentId);
          if (from.project_id !== to.project_id)
            throw new HttpError(400, 'invalid_request', 'Both environments belong to one project', [
              { path: 'body.fromEnvironmentId', message: 'is of another project' },
            ]);
        } else if (!body?.ref) {
          from =
            (
              await c.query<EnvRow>(
                ENV_SELECT +
                  ' WHERE e.project_id = $1 AND (e.position, e.name) < ($2, $3) ORDER BY e.position DESC, e.name DESC LIMIT 1',
                [to.project_id, to.position, to.name],
              )
            ).rows[0] ?? null;
          if (!from)
            throw new HttpError(
              409,
              'conflict',
              to.name + ' is the first environment; name a version to promote',
            );
        }
        const ref = body?.ref ?? (from ? (await runningOn(c, from.id)).good?.ref : undefined);
        if (!ref)
          throw new HttpError(
            409,
            'conflict',
            (from?.name ?? 'The environment') + ' runs nothing yet',
          );
        if ((await runningOn(c, to.id)).good?.ref === ref)
          throw new HttpError(409, 'conflict', to.name + ' already runs ' + ref);
        if (
          (
            await c.query(
              "SELECT 1 FROM release_promotions WHERE to_env_id = $1 AND status = 'requested'",
              [to.id],
            )
          ).rowCount
        )
          throw new HttpError(409, 'conflict', 'A promotion to ' + to.name + ' already waits');
        const rel = (
          await c.query<{ id: string }>(
            'SELECT id FROM releases WHERE project_id = $1 AND version = $2',
            [to.project_id, ref],
          )
        ).rows[0];
        const waits = to.approver_id !== null && to.approver_id !== a.user.id;
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO release_promotions (workspace_id, project_id, from_env_id, to_env_id, ref, release_id, status, requested_by, decided_by, decided_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              a.workspaceId,
              to.project_id,
              from?.id ?? null,
              to.id,
              ref,
              rel?.id ?? null,
              waits ? 'requested' : 'approved',
              a.user.id,
              waits ? null : a.user.id,
              waits ? null : new Date(),
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('promotion insert returned nothing');
        if (!waits) await deployPromotion(c, a, id, to.project_id, to.id, ref);
        await promoEvent(
          c,
          a,
          to.project,
          { id, ref, to: to.name },
          waits ? 'created' : 'completed',
          {
            status: { from: null, to: waits ? 'requested' : 'approved' },
            ...(waits && to.approver_id ? { approver: { from: null, to: to.approver_id } } : {}),
          },
        );
        const p = (await c.query<PromotionRow>(PROMO_SELECT + ' WHERE p.id = $1', [id])).rows[0];
        if (!p) throw new Error('promotion vanished');
        return { status: 201, body: promoJson(p) };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/promotions/:promotionId/decision',
    summary: 'The approver lets a promotion deploy, or declines it with a note',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, promotionId: uuid }),
    body: s.object({ approve: s.boolean(), note: s.optional(s.string({ max: 2000 })) }),
    response: promoOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = (
          await c.query<PromotionRow>(PROMO_SELECT + ' WHERE p.id = $1 FOR UPDATE OF p', [
            params.promotionId,
          ])
        ).rows[0];
        if (!p) throw new HttpError(404, 'not_found', 'Promotion not found');
        const to = await envOf(c, a, p.to_env_id);
        if (p.status !== 'requested')
          throw new HttpError(409, 'conflict', 'This promotion is ' + p.status);
        if (to.approver_id !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(
            403,
            'forbidden',
            (to.approver_name ?? 'The approver') + ' decides promotions to ' + to.name,
          );
        const note = body.note?.trim() ?? '';
        if (!body.approve && !note)
          throw new HttpError(400, 'invalid_request', 'Say why it does not go', [
            { path: 'body.note', message: 'is required to decline' },
          ]);
        await c.query(
          'UPDATE release_promotions SET status = $2, decided_by = $3, decided_at = now(), note = $4 WHERE id = $1',
          [p.id, body.approve ? 'approved' : 'declined', a.user.id, note],
        );
        await c.query(
          `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, note)
           VALUES ($1, $2, 'release', $3, $4, $5, $6, $7)`,
          [
            a.workspaceId,
            p.project_id,
            p.id,
            sha256(p.project_id + '|' + p.ref + '|' + p.to_env_id),
            a.user.id,
            body.approve ? 'approved' : 'declined',
            note,
          ],
        );
        if (body.approve) await deployPromotion(c, a, p.id, p.project_id, p.to_env_id, p.ref);
        await promoEvent(
          c,
          a,
          to.project,
          { id: p.id, ref: p.ref, to: p.to_name },
          body.approve ? 'completed' : 'updated',
          {
            status: { from: 'requested', to: body.approve ? 'approved' : 'declined' },
          },
        );
        const after = (await c.query<PromotionRow>(PROMO_SELECT + ' WHERE p.id = $1', [p.id]))
          .rows[0];
        if (!after) throw new Error('promotion vanished');
        return { body: promoJson(after) };
      }),
  });

  const rollbackEnv = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/rollback',
    summary: 'Roll the environment back to what ran there before, with the reason (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, environmentId: uuid }),
    body: s.object({ reason: s.string({ max: 2000 }) }),
    response: s.object({ deployId: s.string(), ref: s.string(), from: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const e = await envOf(c, a, params.environmentId);
        if (!body.reason.trim())
          throw new HttpError(400, 'invalid_request', 'Say why it rolls back', [
            { path: 'body.reason', message: 'is required' },
          ]);
        const now = (await runningOn(c, e.id)).latest;
        if (!now) throw new HttpError(409, 'conflict', e.name + ' has no deploy to roll back');
        const ref = await previousGoodRef(c, e.id, now.ref);
        if (!ref)
          throw new HttpError(409, 'conflict', 'Nothing ran on ' + e.name + ' before ' + now.ref);
        const run = await queueDeploy(c, a, e.id, ref, 'rollback');
        // a shipped release behind the version rolls back with it
        const rel = (
          await c.query<{ id: string }>(
            "SELECT id FROM releases WHERE project_id = $1 AND version = $2 AND state = 'released'",
            [e.project_id, now.ref],
          )
        ).rows[0];
        if (rel) {
          const r = await releaseOf(c, a, rel.id);
          await c.query(
            "UPDATE releases SET state = 'rolled_back', notes_team = notes_team || $2 WHERE id = $1",
            [r.id, '\n\n## Rolled back on ' + e.name + '\n\n' + body.reason.trim() + '\n'],
          );
          await releaseEvent(c, a, r.project, {
            from: r.version + ' released',
            to: r.version + ' rolled_back',
          });
        }
        await c.query('UPDATE deploy_runs SET release_id = $2 WHERE id = $1', [
          run.id,
          rel?.id ?? null,
        ]);
        return { status: 201, body: { deployId: run.id, ref, from: now.ref } };
      }),
  });

  const backport = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/backport',
    summary:
      'Take fixes of this release back to an older line: a hotfix release on that line (next patch of its last shipped version) with the tasks (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, releaseId: uuid }),
    body: s.object({
      line: s.string({ min: 3, max: 20 }),
      itemIds: s.array(uuid, { min: 1, max: 200 }),
    }),
    response: s.object({ releaseId: s.string(), version: s.string(), created: s.boolean() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        if (!/^\d+\.\d+$/.test(body.line))
          throw new HttpError(400, 'invalid_request', 'A line is major.minor, e.g. 1.3', [
            { path: 'body.line', message: 'is not major.minor' },
          ]);
        if (lineOf(r.version) === body.line)
          throw new HttpError(409, 'conflict', r.version + ' is on ' + body.line + ' already');
        const inRelease = (
          await c.query<{ item_id: string }>(
            'SELECT item_id FROM release_items WHERE release_id = $1',
            [r.id],
          )
        ).rows.map((x) => x.item_id);
        const foreign = body.itemIds.filter((i) => !inRelease.includes(i));
        if (foreign.length)
          throw new HttpError(400, 'invalid_request', 'Backport tasks of this release only', [
            { path: 'body.itemIds', message: String(foreign.length) + ' are not in ' + r.version },
          ]);
        const shipped = (
          await c.query<{ id: string; version: string }>(
            "SELECT id, version FROM releases WHERE project_id = $1 AND state = 'released'",
            [r.project_id],
          )
        ).rows;
        // an open hotfix on the line takes the fix; otherwise a new one
        const open = (
          await c.query<{ id: string; version: string }>(
            "SELECT id, version FROM releases WHERE project_id = $1 AND state IN ('planned', 'frozen') AND hotfix_of IS NOT NULL",
            [r.project_id],
          )
        ).rows.find((x) => lineOf(x.version) === body.line);
        let target = open;
        if (!target) {
          const version = backportVersion(
            shipped.map((x) => x.version),
            body.line,
          );
          if (!version)
            throw new HttpError(
              409,
              'conflict',
              'Nothing on ' + body.line + ' was shipped; there is no line to backport to',
            );
          const base = shipped
            .filter((x) => lineOf(x.version) === body.line)
            .sort((x, y) => compareVersions(y.version, x.version))[0];
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO releases (workspace_id, project_id, version, name, hotfix_of, created_by)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [
                a.workspaceId,
                r.project_id,
                version,
                'Backport from ' + r.version,
                base?.id ?? null,
                a.user.id,
              ],
            )
          ).rows[0]?.id;
          if (!id) throw new Error('release insert returned nothing');
          target = { id, version };
        }
        for (const item of body.itemIds)
          await c.query(
            `INSERT INTO release_items (workspace_id, release_id, item_id, added_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (release_id, item_id) DO NOTHING`,
            [a.workspaceId, target.id, item, a.user.id],
          );
        await releaseEvent(c, a, r.project, {
          from: null,
          to:
            String(body.itemIds.length) +
            ' fixes of ' +
            r.version +
            ' backported to ' +
            target.version,
        });
        return {
          status: 201,
          body: { releaseId: target.id, version: target.version, created: !open },
        };
      }),
  });

  const goNoGo = (what: 'releases' | 'trains') =>
    route({
      method: 'PUT',
      path: '/api/workspaces/:workspaceId/' + what + '/:id/go-no-go',
      summary: 'The notes of the go/no-go meeting: decision, who was there, what was said (member)',
      tags: ['versions'],
      params: s.object({ workspaceId: uuid, id: uuid }),
      body: goNoGoIn,
      response: goNoGoOut,
      handler: ({ params, body, req }) =>
        asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
          if (what === 'releases') await releaseOf(c, a, params.id);
          else if (
            !(await c.query('SELECT 1 FROM release_trains WHERE id = $1', [params.id])).rowCount
          )
            throw new HttpError(404, 'not_found', 'Train not found');
          const record = {
            decision: body.decision,
            notes: body.notes,
            attendees: body.attendees ?? [],
            by: a.user.name,
            at: new Date().toISOString(),
          };
          await c.query(
            'UPDATE ' +
              (what === 'releases' ? 'releases' : 'release_trains') +
              ' SET go_no_go = $2 WHERE id = $1',
            [params.id, JSON.stringify(record)],
          );
          return { body: record };
        }),
    });

  const readGoNoGo = (what: 'releases' | 'trains') =>
    route({
      method: 'GET',
      path: '/api/workspaces/:workspaceId/' + what + '/:id/go-no-go',
      summary: 'The notes of the last go/no-go meeting, if any',
      tags: ['versions'],
      params: s.object({ workspaceId: uuid, id: uuid }),
      response: s.object({ meeting: s.nullable(goNoGoOut) }),
      handler: ({ params, req }) =>
        asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
          if (what === 'releases') await releaseOf(c, a, params.id);
          const row = (
            await c.query<{ go_no_go: Infer<typeof goNoGoOut> | null }>(
              'SELECT go_no_go FROM ' +
                (what === 'releases' ? 'releases' : 'release_trains') +
                ' WHERE id = $1',
              [params.id],
            )
          ).rows[0];
          if (!row) throw new HttpError(404, 'not_found', 'Not found');
          return { body: { meeting: row.go_no_go } };
        }),
    });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/promotions',
    summary: 'The project’s promotions, newest first',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(promoOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<PromotionRow>(
            PROMO_SELECT + ' WHERE p.project_id = $1 ORDER BY p.requested_at DESC LIMIT 50',
            [params.projectId],
          )
        ).rows;
        return { body: rows.map(promoJson) };
      }),
  });

  return [
    pipeline,
    setApprover,
    promote,
    decide,
    rollbackEnv,
    backport,
    goNoGo('releases'),
    goNoGo('trains'),
    readGoNoGo('releases'),
    readGoNoGo('trains'),
    list,
  ];
}
