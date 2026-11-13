// ── [PCODE-206 | S15 | v0.1.0] T17.4 Release management in the web app: trains, environments with promote and rollback, notes approval, backport, go/no-go notes, changelog ──
// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
//    Why:  the releases of several projects ship together on a train: one freeze, one go/no-go, one ship
//          and, when something goes wrong, one rollback. Shipping is all or nothing on the release
//          policies; then every release ships and its deploy is queued for the runner. The train follows
//          its deploys (shipped when all succeeded, partly shipped when one failed) and a rollback
//          redeploys, per environment, what ran there before.
import { trainChecks, trainProgress, type Actor, type DeployStatus } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, atLeast, requireProject, type Access } from './access.js';
import { mayOverride } from './posture.js';
import {
  releaseEvent,
  releaseOf,
  releaseViolations,
  rollbackRelease,
  shipRelease,
} from './versions.js';

const uuid = s.string({ format: 'uuid' });
const ws = s.object({ workspaceId: uuid });
const trainParams = s.object({ workspaceId: uuid, trainId: uuid });

interface TrainRow {
  id: string;
  name: string;
  state: string;
  freeze_at: Date | null;
  target_date: string | null;
  note: string;
  shipped_by_name: string | null;
  shipped_at: Date | null;
  rollback_reason: string;
  rolled_back_at: Date | null;
  created_at: Date;
}
const TRAIN_SELECT = `SELECT t.id, t.name, t.state, t.freeze_at, t.target_date::text AS target_date, t.note, u.name AS shipped_by_name,
       t.shipped_at, t.rollback_reason, t.rolled_back_at, t.created_at
  FROM release_trains t LEFT JOIN users u ON u.id = t.shipped_by`;

interface MemberRow {
  id: string;
  project_id: string;
  project_key: string;
  project_name: string;
  version: string;
  state: string;
  environment_id: string | null;
  environment_name: string | null;
  items: string;
  done: string;
  deploy_id: string | null;
  deploy_status: DeployStatus | null;
  deploy_ref: string | null;
}
const MEMBERS = `SELECT r.id, r.project_id, p.key AS project_key, p.name AS project_name, r.version, r.state, r.environment_id,
       e.name AS environment_name,
       (SELECT count(*) FROM release_items x WHERE x.release_id = r.id) AS items,
       (SELECT count(*) FROM release_items x JOIN items i ON i.id = x.item_id JOIN project_states st ON st.id = i.state_id
         WHERE x.release_id = r.id AND st.grp IN ('completed', 'cancelled')) AS done,
       d.id AS deploy_id, d.status AS deploy_status, d.ref AS deploy_ref
  FROM releases r JOIN projects p ON p.id = r.project_id LEFT JOIN environments e ON e.id = r.environment_id
  LEFT JOIN LATERAL (SELECT id, status, ref FROM deploy_runs WHERE release_id = r.id ORDER BY created_at DESC LIMIT 1) d ON true
 WHERE r.train_id = $1 ORDER BY p.key`;

const memberOut = s.object({
  releaseId: s.string(),
  projectId: s.string(),
  projectKey: s.string(),
  projectName: s.string(),
  version: s.string(),
  state: s.string(),
  environmentId: s.nullable(s.string()),
  environmentName: s.nullable(s.string()),
  items: s.number({ integer: true }),
  done: s.number({ integer: true }),
  deploy: s.nullable(s.object({ id: s.string(), status: s.string(), ref: s.string() })),
});
const trainOut = s.object({
  id: s.string(),
  name: s.string(),
  state: s.string(),
  freezeAt: s.nullable(s.string()),
  targetDate: s.nullable(s.string()),
  note: s.string(),
  shippedBy: s.nullable(s.string()),
  shippedAt: s.nullable(s.string()),
  rollbackReason: s.string(),
  rolledBackAt: s.nullable(s.string()),
  createdAt: s.string(),
  releases: s.array(memberOut),
});
type TrainOut = Infer<typeof trainOut>;

const memberJson = (m: MemberRow): Infer<typeof memberOut> => ({
  releaseId: m.id,
  projectId: m.project_id,
  projectKey: m.project_key,
  projectName: m.project_name,
  version: m.version,
  state: m.state,
  environmentId: m.environment_id,
  environmentName: m.environment_name,
  items: Number(m.items),
  done: Number(m.done),
  deploy:
    m.deploy_id && m.deploy_status
      ? { id: m.deploy_id, status: m.deploy_status, ref: m.deploy_ref ?? '' }
      : null,
});

/** The members of a train the caller may see (releases of projects they cannot see stay hidden). */
async function membersOf(c: PoolClient, a: Access, trainId: string): Promise<MemberRow[]> {
  const rows = (await c.query<MemberRow>(MEMBERS, [trainId])).rows;
  const out: MemberRow[] = [];
  for (const m of rows) {
    try {
      await requireProject(c, a, m.project_id);
      out.push(m);
    } catch {
      // not visible to this role
    }
  }
  return out;
}

async function trainOf(c: PoolClient, a: Access, id: string): Promise<TrainOut> {
  const t = (await c.query<TrainRow>(TRAIN_SELECT + ' WHERE t.id = $1', [id])).rows[0];
  if (!t) throw new HttpError(404, 'not_found', 'Train not found');
  return {
    id: t.id,
    name: t.name,
    state: t.state,
    freezeAt: t.freeze_at?.toISOString() ?? null,
    targetDate: t.target_date,
    note: t.note,
    shippedBy: t.shipped_by_name,
    shippedAt: t.shipped_at?.toISOString() ?? null,
    rollbackReason: t.rollback_reason,
    rolledBackAt: t.rolled_back_at?.toISOString() ?? null,
    createdAt: t.created_at.toISOString(),
    releases: (await membersOf(c, a, t.id)).map(memberJson),
  };
}

async function trainEvent(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  t: { id: string; name: string },
  verb: 'created' | 'updated' | 'completed' | 'failed',
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  await recordEvent(c, workspaceId, {
    actor,
    verb,
    object: { type: 'train', id: t.id, label: 'Train ' + t.name },
    changes,
  });
}

/** Every release of a train must be one the caller can change. */
async function needAll(c: PoolClient, a: Access, trainId: string): Promise<MemberRow[]> {
  const all = (await c.query<MemberRow>(MEMBERS, [trainId])).rows;
  const seen = await membersOf(c, a, trainId);
  if (seen.length !== all.length)
    throw new HttpError(403, 'forbidden', 'The train carries releases of projects you cannot see');
  return all;
}

/**
 * After a deploy of a train's release finished: the train follows its deploys. Called by the runner's
 * finish route; does nothing for deploys of no train.
 */
export async function trainAfterDeploy(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  deployId: string,
): Promise<void> {
  const t = (
    await c.query<{ id: string; name: string; state: string }>(
      `SELECT t.id, t.name, t.state FROM deploy_runs d JOIN releases r ON r.id = d.release_id
         JOIN release_trains t ON t.id = r.train_id WHERE d.id = $1`,
      [deployId],
    )
  ).rows[0];
  if (!t || (t.state !== 'shipping' && t.state !== 'rolling_back')) return;
  const deploys = (await c.query<MemberRow>(MEMBERS, [t.id])).rows.map((m) => m.deploy_status);
  const next = trainProgress(t.state, deploys);
  if (next === t.state) return;
  await c.query(
    'UPDATE release_trains SET state = $2, rolled_back_at = CASE WHEN $2 = $3 THEN now() ELSE rolled_back_at END WHERE id = $1',
    [t.id, next, 'rolled_back'],
  );
  await trainEvent(c, workspaceId, actor, t, next === 'partial' ? 'failed' : 'completed', {
    state: { from: t.state, to: next },
  });
}

export function trainRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/trains',
    summary: 'The release trains, newest first, with their releases',
    tags: ['versions'],
    params: ws,
    response: s.array(trainOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const ids = (
          await c.query<{ id: string }>(
            'SELECT id FROM release_trains ORDER BY coalesce(target_date, created_at::date) DESC, created_at DESC LIMIT 100',
          )
        ).rows;
        const out: TrainOut[] = [];
        for (const r of ids) out.push(await trainOf(c, a, r.id));
        return { body: out };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/trains',
    summary: 'Plan a release train: a name, when it freezes, when it ships (member)',
    tags: ['versions'],
    params: ws,
    body: s.object({
      name: s.string({ min: 1, max: 60 }),
      freezeAt: s.optional(s.nullable(s.string({ format: 'date-time' }))),
      targetDate: s.optional(s.nullable(s.string({ min: 10, max: 10 }))),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: trainOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const name = body.name.trim();
        if ((await c.query('SELECT 1 FROM release_trains WHERE name = $1', [name])).rowCount)
          throw new HttpError(409, 'conflict', 'A train named ' + name + ' exists');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO release_trains (workspace_id, name, freeze_at, target_date, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              a.workspaceId,
              name,
              body.freezeAt ?? null,
              body.targetDate ?? null,
              body.note ?? '',
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('train insert returned nothing');
        await trainEvent(c, a.workspaceId, actorOf(a), { id, name }, 'created', {
          state: { from: null, to: 'planned' },
        });
        return { status: 201, body: await trainOf(c, a, id) };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/trains/:trainId',
    summary: 'One train with its releases and their latest deploys',
    tags: ['versions'],
    params: trainParams,
    response: trainOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => ({
        body: await trainOf(c, a, params.trainId),
      })),
  });

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/trains/:trainId',
    summary: 'Rename a train, move its freeze or target date, or note something (member)',
    tags: ['versions'],
    params: trainParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 60 })),
      freezeAt: s.optional(s.nullable(s.string({ format: 'date-time' }))),
      targetDate: s.optional(s.nullable(s.string({ min: 10, max: 10 }))),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: trainOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await trainOf(c, a, params.trainId);
        await c.query(
          `UPDATE release_trains SET name = coalesce($2, name), note = coalesce($3, note),
                  freeze_at = CASE WHEN $4 THEN $5::timestamptz ELSE freeze_at END,
                  target_date = CASE WHEN $6 THEN $7::date ELSE target_date END WHERE id = $1`,
          [
            t.id,
            body.name?.trim() ?? null,
            body.note ?? null,
            body.freezeAt !== undefined,
            body.freezeAt ?? null,
            body.targetDate !== undefined,
            body.targetDate ?? null,
          ],
        );
        if (body.name)
          await c.query('UPDATE releases SET train = $2 WHERE train_id = $1', [
            t.id,
            body.name.trim(),
          ]);
        return { body: await trainOf(c, a, t.id) };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/trains/:trainId/releases',
    summary:
      'Put a project’s planned release on the train, with the environment it ships to (member)',
    tags: ['versions'],
    params: trainParams,
    body: s.object({ releaseId: uuid, environmentId: s.optional(s.nullable(uuid)) }),
    response: trainOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await trainOf(c, a, params.trainId);
        if (t.state !== 'planned' && t.state !== 'frozen')
          throw new HttpError(
            409,
            'conflict',
            'The train is ' + t.state + '; releases join before it ships',
          );
        const r = await releaseOf(c, a, body.releaseId);
        if (r.state !== 'planned' && r.state !== 'frozen')
          throw new HttpError(
            409,
            'conflict',
            r.version + ' is ' + r.state + '; only an open release joins a train',
          );
        if (t.releases.some((m) => m.projectId === r.project_id && m.releaseId !== r.id))
          throw new HttpError(
            409,
            'conflict',
            r.project.key + ' already has a release on this train',
          );
        if (body.environmentId) {
          const env = (
            await c.query<{ project_id: string }>(
              'SELECT project_id FROM environments WHERE id = $1',
              [body.environmentId],
            )
          ).rows[0];
          if (env?.project_id !== r.project_id)
            throw new HttpError(
              400,
              'invalid_request',
              'The environment belongs to another project',
              [
                {
                  path: 'body.environmentId',
                  message: 'is not an environment of ' + r.project.key,
                },
              ],
            );
        }
        await c.query(
          `UPDATE releases SET train_id = $2, train = $3, environment_id = coalesce($4, environment_id),
                  state = CASE WHEN $5 = 'frozen' THEN 'frozen' ELSE state END,
                  freeze_at = CASE WHEN $5 = 'frozen' THEN coalesce(freeze_at, now()) ELSE coalesce($6, freeze_at) END
            WHERE id = $1`,
          [r.id, t.id, t.name, body.environmentId ?? null, t.state, t.freezeAt],
        );
        await releaseEvent(c, a, r.project, { from: null, to: r.version + ' on train ' + t.name });
        return { body: await trainOf(c, a, t.id) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/trains/:trainId/releases/:releaseId',
    summary: 'Take a release off the train before it ships (member)',
    tags: ['versions'],
    params: s.object({ workspaceId: uuid, trainId: uuid, releaseId: uuid }),
    response: trainOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await trainOf(c, a, params.trainId);
        if (t.state !== 'planned' && t.state !== 'frozen')
          throw new HttpError(409, 'conflict', 'The train is ' + t.state);
        const r = await releaseOf(c, a, params.releaseId);
        await c.query(
          "UPDATE releases SET train_id = NULL, train = '' WHERE id = $1 AND train_id = $2",
          [r.id, t.id],
        );
        return { body: await trainOf(c, a, t.id) };
      }),
  });

  const freeze = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/trains/:trainId/freeze',
    summary: 'Freeze the train: every release on it takes fixes only (member)',
    tags: ['versions'],
    params: trainParams,
    response: trainOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await trainOf(c, a, params.trainId);
        if (t.state !== 'planned')
          throw new HttpError(
            409,
            'conflict',
            'Only a planned train freezes; this one is ' + t.state,
          );
        await needAll(c, a, t.id);
        await c.query(
          "UPDATE releases SET state = 'frozen', freeze_at = coalesce(freeze_at, now()) WHERE train_id = $1 AND state = 'planned'",
          [t.id],
        );
        await c.query(
          "UPDATE release_trains SET state = 'frozen', freeze_at = coalesce(freeze_at, now()) WHERE id = $1",
          [t.id],
        );
        await trainEvent(c, a.workspaceId, actorOf(a), t, 'updated', {
          state: { from: t.state, to: 'frozen' },
        });
        return { body: await trainOf(c, a, t.id) };
      }),
  });

  const checkOut = s.object({
    ready: s.boolean(),
    releases: s.array(
      s.object({
        project: s.string(),
        version: s.string(),
        ready: s.boolean(),
        missing: s.array(s.string()),
      }),
    ),
  });
  const gather = async (c: PoolClient, a: Access, trainId: string) => {
    // [PCODE-206 | S15 | v0.1.0] a release that already shipped (an old train label) is not shipped again
    const all = (await needAll(c, a, trainId)).filter(
      (m) => m.state === 'planned' || m.state === 'frozen',
    );
    const members = [];
    for (const m of all)
      members.push({
        project: m.project_key,
        version: m.version,
        items: Number(m.items),
        done: Number(m.done),
        environment: m.environment_name,
        violations: await releaseViolations(c, m),
      });
    const checks = trainChecks(members);
    return { all, checks, ready: all.length > 0 && checks.every((x) => x.ready) };
  };

  const check = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/trains/:trainId/check',
    summary: 'Go / no-go: what each release on the train still needs',
    tags: ['versions'],
    params: trainParams,
    response: checkOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await trainOf(c, a, params.trainId);
        const g = await gather(c, a, params.trainId);
        return { body: { ready: g.ready, releases: g.checks } };
      }),
  });

  const ship = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/trains/:trainId/ship',
    summary:
      'Ship the train: all releases or none; each queues its deploy. An admin may override the policies with a reason (member)',
    tags: ['versions'],
    params: trainParams,
    body: s.optional(
      s.object({ override: s.optional(s.boolean()), reason: s.optional(s.string({ max: 2000 })) }),
    ),
    response: trainOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await c.query('SELECT 1 FROM release_trains WHERE id = $1 FOR UPDATE', [params.trainId]);
        const t = await trainOf(c, a, params.trainId);
        if (t.state !== 'planned' && t.state !== 'frozen')
          throw new HttpError(409, 'conflict', 'The train is ' + t.state);
        const g = await gather(c, a, t.id);
        if (!g.all.length) throw new HttpError(409, 'conflict', 'The train carries no release');
        const blocked = g.checks.filter((x) => !x.ready);
        const why = blocked
          .map((x) => x.project + ' ' + x.version + ': ' + x.missing.join('; '))
          .join(' | ');
        // what an override may pass: policies only; a missing environment or open tasks never ship
        const hard = g.all.filter((m) => !m.environment_id || Number(m.done) < Number(m.items));
        if (blocked.length) {
          if (!body?.override || hard.length)
            throw new HttpError(409, 'conflict', 'Not ready: ' + why);
          if (!mayOverride(a))
            throw new HttpError(
              403,
              'forbidden',
              'Only an admin ships despite the release policies',
            );
          if (!body.reason?.trim())
            throw new HttpError(
              400,
              'invalid_request',
              'Say why the train ships despite its policies',
              [{ path: 'body.reason', message: 'is required to override' }],
            );
          await c.query('UPDATE release_trains SET note = note || $2 WHERE id = $1', [
            t.id,
            '\n\nShipped despite policies: ' + why + '\nReason: ' + body.reason.trim(),
          ]);
        }
        for (const m of g.all) {
          const r = await releaseOf(c, a, m.id);
          await shipRelease(c, a, r, null, 'train ' + t.name);
          await releaseEvent(c, a, r.project, {
            from: r.version + ' ' + r.state,
            to: r.version + ' released',
          });
        }
        await c.query(
          "UPDATE release_trains SET state = 'shipping', shipped_by = $2, shipped_at = now() WHERE id = $1",
          [t.id, a.user.id],
        );
        await trainEvent(c, a.workspaceId, actorOf(a), t, 'updated', {
          state: { from: t.state, to: 'shipping' },
        });
        return { body: await trainOf(c, a, t.id) };
      }),
  });

  const rollback = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/trains/:trainId/rollback',
    summary:
      'Roll the whole train back, with the reason: every shipped release rolls back and its environment redeploys what ran before (member)',
    tags: ['versions'],
    params: trainParams,
    body: s.object({ reason: s.string({ max: 2000 }) }),
    response: trainOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await c.query('SELECT 1 FROM release_trains WHERE id = $1 FOR UPDATE', [params.trainId]);
        const t = await trainOf(c, a, params.trainId);
        if (!['shipping', 'shipped', 'partial'].includes(t.state))
          throw new HttpError(
            409,
            'conflict',
            'Only a shipped train rolls back; this one is ' + t.state,
          );
        if (!body.reason.trim())
          throw new HttpError(400, 'invalid_request', 'Say why the train rolls back', [
            { path: 'body.reason', message: 'is required' },
          ]);
        if (!atLeast(a.role, 'member'))
          throw new HttpError(403, 'forbidden', 'Members roll trains back');
        const all = await needAll(c, a, t.id);
        for (const m of all) {
          if (m.state !== 'released') continue;
          const r = await releaseOf(c, a, m.id);
          await rollbackRelease(
            c,
            a,
            r,
            'Train ' + t.name + ': ' + body.reason.trim(),
            'rollback of train ' + t.name,
          );
          await releaseEvent(c, a, r.project, {
            from: r.version + ' released',
            to: r.version + ' rolled_back',
          });
        }
        await c.query(
          "UPDATE release_trains SET state = 'rolling_back', rollback_reason = $2 WHERE id = $1",
          [t.id, body.reason.trim()],
        );
        // nothing to redeploy anywhere: rolled back at once
        const moving = (await c.query<MemberRow>(MEMBERS, [t.id])).rows.map((m) => m.deploy_status);
        const now = trainProgress(
          'rolling_back',
          moving.map((d) => (d === 'queued' || d === 'running' ? d : null)),
        );
        if (now === 'rolled_back')
          await c.query(
            "UPDATE release_trains SET state = 'rolled_back', rolled_back_at = now() WHERE id = $1",
            [t.id],
          );
        await trainEvent(c, a.workspaceId, actorOf(a), t, 'updated', {
          state: { from: t.state, to: now },
        });
        return { body: await trainOf(c, a, t.id) };
      }),
  });

  return [list, create, get, change, add, remove, freeze, check, ship, rollback];
}
