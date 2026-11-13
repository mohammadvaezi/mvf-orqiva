// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-132 | S15 | v0.1.0] Run deploys through our own runner and stream each step ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
//    Why:  people ask for a deploy; a runner on the customer's machine does it. Runners have tokens of their
//          own (orq_runner_…, hash only stored), claim one queued run at a time (FOR UPDATE SKIP LOCKED, so two
//          runners never take the same), receive the environment's secrets for that run only, and post
//          every step as it happens. Each step is a deploy event, which is what streams it to the page.
// [PCODE-203 | S15 | v0.1.0] a train follows its deploys
import { deployAlert } from './monitoring.js'; // [PCODE-340 | S15 | v0.1.0]
import { trainAfterDeploy } from './trains.js';
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { open } from '../agents/secrets.js';
// [PCODE-325 | S15 | v0.1.0]
import { redactSecrets } from '@orqiva/shared';
import { revokeLeaks } from '../auth/leaks.js';
import { recordLeaks } from '../security/leaks.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { visibleEnvironment } from './environments.js';
// [PCODE-133 | S15 | v0.1.0]
import { afterDeploy } from './infragate.js';
import type { Actor } from '@orqiva/shared';

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const ACTIVE = ['queued', 'running'];

export const deployOut = s.object({
  id: s.string(),
  projectId: s.string(),
  environmentId: s.string(),
  environment: s.string(),
  status: s.string(),
  ref: s.string(),
  trigger: s.string(),
  requestedBy: s.nullable(s.string()),
  runner: s.nullable(s.string()),
  error: s.string(),
  createdAt: s.string(),
  startedAt: s.nullable(s.string()),
  finishedAt: s.nullable(s.string()),
});
const stepOut = s.object({
  seq: s.number({ integer: true }),
  name: s.string(),
  command: s.string(),
  status: s.string(),
  output: s.string(),
  exitCode: s.nullable(s.number({ integer: true })),
  startedAt: s.string(),
  finishedAt: s.nullable(s.string()),
});

interface DeployRow {
  id: string;
  workspace_id: string;
  project_id: string;
  project_key: string;
  environment_id: string;
  environment_name: string;
  status: string;
  ref: string;
  trigger: string;
  requested_by_name: string | null;
  runner_name: string | null;
  error: string;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const DEPLOY_SELECT = `SELECT d.*, p.key AS project_key, e.name AS environment_name, u.name AS requested_by_name, r.name AS runner_name
                         FROM deploy_runs d JOIN projects p ON p.id = d.project_id JOIN environments e ON e.id = d.environment_id
                         LEFT JOIN users u ON u.id = d.requested_by LEFT JOIN runners r ON r.id = d.runner_id`;

export const deployJson = (r: DeployRow): Infer<typeof deployOut> => ({
  id: r.id,
  projectId: r.project_id,
  environmentId: r.environment_id,
  environment: r.environment_name,
  status: r.status,
  ref: r.ref,
  trigger: r.trigger,
  requestedBy: r.requested_by_name,
  runner: r.runner_name,
  error: r.error,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
});

async function loadDeploy(c: PoolClient, id: string): Promise<DeployRow> {
  const r = (await c.query<DeployRow>(DEPLOY_SELECT + ' WHERE d.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Deploy not found');
  return r;
}

/** A deploy event: created, started, a step (progressed), completed or failed. */
export async function deployEvent(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  r: DeployRow,
  verb: 'created' | 'started' | 'progressed' | 'completed' | 'failed' | 'updated',
  changes: Record<string, { from: unknown; to: unknown }> = {},
): Promise<void> {
  await recordEvent(
    c,
    workspaceId,
    {
      actor,
      verb,
      object: { type: 'deploy', id: r.id, label: r.project_key + ' ' + r.environment_name },
      parent: { type: 'environment', id: r.environment_id, label: r.environment_name },
      changes,
    },
    { projectId: r.project_id },
  );
}

/** Queues a deploy of the environment; shared by the Deploy button and the gate trigger. */
export async function queueDeploy(
  c: PoolClient,
  a: Pick<Access, 'workspaceId'> & { user: { id: string; name: string } },
  environmentId: string,
  ref: string,
  trigger: string,
): Promise<DeployRow> {
  const env = (
    await c.query<{ project_id: string }>('SELECT project_id FROM environments WHERE id = $1', [
      environmentId,
    ])
  ).rows[0];
  if (!env) throw new HttpError(404, 'not_found', 'Environment not found');
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO deploy_runs (workspace_id, project_id, environment_id, ref, trigger, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [a.workspaceId, env.project_id, environmentId, ref, trigger, a.user.id],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('deploy insert returned nothing');
  const run = await loadDeploy(c, id);
  await deployEvent(
    c,
    a.workspaceId,
    { kind: 'user', id: a.user.id, name: a.user.name },
    run,
    'created',
    {
      status: { from: null, to: 'queued' },
      trigger: { from: null, to: trigger },
    },
  );
  return run;
}

interface RunnerRow {
  id: string;
  workspace_id: string;
  name: string;
}

/** The runner a request comes from, by its Bearer token. */
async function runnerOf(pool: Pool, req: IncomingMessage): Promise<RunnerRow> {
  const token = /^Bearer ((?:orq|pe)_runner_[A-Za-z0-9_-]{43})$/.exec(
    req.headers.authorization ?? '',
  )?.[1];
  if (!token) throw new HttpError(401, 'unauthorized', 'Send the runner token as Bearer');
  const r = await inSystem(
    pool,
    async (c) =>
      (
        await c.query<RunnerRow>(
          `UPDATE runners SET last_seen_at = now() WHERE token_hash = $1 AND revoked_at IS NULL
           RETURNING id, workspace_id, name`,
          [sha256(token)],
        )
      ).rows[0],
  );
  if (!r) throw new HttpError(401, 'unauthorized', 'This runner token is not valid (revoked?)');
  return r;
}

const runnerActor = (r: RunnerRow): Actor => ({
  kind: 'integration',
  id: r.id,
  name: 'Runner ' + r.name,
});

/** The run, if it belongs to this runner and is still running. */
async function ownRun(c: PoolClient, runner: RunnerRow, id: string): Promise<DeployRow> {
  const run = await loadDeploy(c, id).catch(() => null);
  const owner = (
    await c.query<{ runner_id: string | null }>('SELECT runner_id FROM deploy_runs WHERE id = $1', [
      id,
    ])
  ).rows[0]?.runner_id;
  if (!run || owner !== runner.id)
    throw new HttpError(404, 'not_found', 'Not a run of this runner');
  if (run.status !== 'running')
    throw new HttpError(409, 'conflict', 'This run is ' + run.status + '; stop working on it');
  return run;
}

const OUTPUT_MAX = 20_000;
const tail = (s: string): string => (s.length > OUTPUT_MAX ? '…' + s.slice(-OUTPUT_MAX) : s);

// [PCODE-325 | S15 | v0.1.0] a log's text with its secrets replaced; Orqiva tokens revoked, others reported
async function cleanLog(
  pool: Pool,
  c: PoolClient,
  workspaceId: string,
  projectId: string,
  text: string,
  location: string,
): Promise<string> {
  if (!text) return text;
  const r = redactSecrets(text);
  if (!r.found.length) return text;
  if (r.found.includes('Orqiva token'))
    await revokeLeaks(pool, workspaceId, [text], { foundIn: 'log', location });
  const others = r.found.filter((k) => k !== 'Orqiva token');
  if (others.length)
    await recordLeaks(c, workspaceId, projectId, others, { foundIn: 'log', location });
  return r.text;
}

export function deployRoutes(pool: Pool): Route[] {
  // ── runners, managed by admins ──
  const runnerOut = s.object({
    id: s.string(),
    name: s.string(),
    createdAt: s.string(),
    lastSeenAt: s.nullable(s.string()),
  });
  const listRunners = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/runners',
    summary: 'The workspace’s deploy runners (member)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(runnerOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: (
          await c.query<{ id: string; name: string; created_at: Date; last_seen_at: Date | null }>(
            'SELECT id, name, created_at, last_seen_at FROM runners WHERE revoked_at IS NULL ORDER BY created_at',
          )
        ).rows.map((r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.created_at.toISOString(),
          lastSeenAt: r.last_seen_at?.toISOString() ?? null,
        })),
      })),
  });
  const createRunner = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/runners',
    summary: 'Register a runner; its token is shown once (admin)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({ name: s.string({ min: 1, max: 80 }) }),
    response: s.object({ id: s.string(), name: s.string(), token: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const token = 'orq_runner_' + randomBytes(32).toString('base64url'); // [PCODE-192 | S15 | v0.1.0]
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO runners (workspace_id, name, token_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
            [a.workspaceId, body.name.trim(), sha256(token), a.user.id],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('runner insert returned nothing');
        return { status: 201, body: { id, name: body.name.trim(), token } };
      }),
  });
  const revokeRunner = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/runners/:runnerId',
    summary: 'Revoke a runner’s token (admin)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid, runnerId: uuid }),
    response: s.object({ revoked: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = await c.query(
          'UPDATE runners SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
          [params.runnerId],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Runner not found');
        return { body: { revoked: true } };
      }),
  });

  // ── deploys, as people see them ──
  const start = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/environments/:environmentId/deploys',
    summary: 'Deploy to the environment: queued for a runner (member)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid, environmentId: uuid }),
    body: s.object({ ref: s.optional(s.string({ max: 200 })) }),
    response: deployOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const env = await visibleEnvironment(c, a, params.environmentId);
        const busy = (
          await c.query(
            "SELECT 1 FROM deploy_runs WHERE environment_id = $1 AND status IN ('queued', 'running')",
            [env.id],
          )
        ).rowCount;
        if (busy)
          throw new HttpError(
            409,
            'conflict',
            env.name + ' is being deployed; wait for that run to end',
          );
        const run = await queueDeploy(c, a, env.id, body.ref?.trim() ?? '', 'manual');
        return { status: 201, body: deployJson(run) };
      }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/deploys',
    summary: 'The project’s deploys, newest first (member)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ environmentId: s.optional(uuid) }),
    response: s.array(deployOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<DeployRow>(
            DEPLOY_SELECT +
              ' WHERE d.project_id = $1 AND ($2::uuid IS NULL OR d.environment_id = $2) ORDER BY d.created_at DESC LIMIT 50',
            [p.id, query.environmentId ?? null],
          )
        ).rows;
        return { body: rows.map(deployJson) };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/deploys/:deployId',
    summary: 'One deploy with its steps so far (member)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid, deployId: uuid }),
    response: s.object({ deploy: deployOut, steps: s.array(stepOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await loadDeploy(c, params.deployId);
        await requireProject(c, a, run.project_id);
        const steps = (
          await c.query<{
            seq: number;
            name: string;
            command: string;
            status: string;
            output: string;
            exit_code: number | null;
            started_at: Date;
            finished_at: Date | null;
          }>('SELECT * FROM deploy_steps WHERE run_id = $1 ORDER BY seq', [run.id])
        ).rows;
        return {
          body: {
            deploy: deployJson(run),
            steps: steps.map((x) => ({
              seq: x.seq,
              name: x.name,
              command: x.command,
              status: x.status,
              output: x.output,
              exitCode: x.exit_code,
              startedAt: x.started_at.toISOString(),
              finishedAt: x.finished_at?.toISOString() ?? null,
            })),
          },
        };
      }),
  });

  const cancel = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/deploys/:deployId/cancel',
    summary: 'Cancel a queued or running deploy; the runner stops at its next step (member)',
    tags: ['deploys'],
    params: s.object({ workspaceId: uuid, deployId: uuid }),
    response: deployOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = await loadDeploy(c, params.deployId);
        await requireProject(c, a, run.project_id);
        if (!ACTIVE.includes(run.status))
          throw new HttpError(409, 'conflict', 'This deploy has ended');
        await c.query(
          "UPDATE deploy_runs SET status = 'cancelled', finished_at = now() WHERE id = $1",
          [run.id],
        );
        const after = await loadDeploy(c, run.id);
        await deployEvent(c, a.workspaceId, actorOf(a), after, 'updated', {
          status: { from: run.status, to: 'cancelled' },
        });
        return { body: deployJson(after) };
      }),
  });

  // ── the runner protocol ──
  const claimOut = s.object({
    run: s.nullable(
      s.object({
        id: s.string(),
        ref: s.string(),
        project: s.string(),
        environment: s.object({
          key: s.string(),
          name: s.string(),
          kind: s.string(),
          settings: s.anyObject(),
          healthUrl: s.string(),
        }),
        secrets: s.anyObject(),
      }),
    ),
  });
  const claim = route({
    method: 'POST',
    path: '/api/runner/claim',
    summary:
      'A runner takes the oldest queued deploy of its workspace, with that environment’s secrets',
    tags: ['runner'],
    response: claimOut,
    handler: async ({ req }) => {
      const runner = await runnerOf(pool, req);
      return inWorkspace(pool, runner.workspace_id, async (c) => {
        const id = (
          await c.query<{ id: string }>(
            `UPDATE deploy_runs SET status = 'running', runner_id = $1, started_at = now()
              WHERE id = (SELECT id FROM deploy_runs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
              RETURNING id`,
            [runner.id],
          )
        ).rows[0]?.id;
        if (!id) return { body: { run: null } };
        const run = await loadDeploy(c, id);
        const env = (
          await c.query<{
            key: string;
            name: string;
            kind: string;
            settings: Record<string, unknown>;
            health_url: string;
          }>('SELECT key, name, kind, settings, health_url FROM environments WHERE id = $1', [
            run.environment_id,
          ])
        ).rows[0];
        if (!env) throw new Error('environment vanished');
        const sealed = (
          await c.query<{ name: string; ciphertext: string }>(
            'SELECT name, ciphertext FROM environment_secrets WHERE environment_id = $1',
            [run.environment_id],
          )
        ).rows;
        await deployEvent(c, runner.workspace_id, runnerActor(runner), run, 'started', {
          status: { from: 'queued', to: 'running' },
        });
        return {
          body: {
            run: {
              id: run.id,
              ref: run.ref,
              project: run.project_key,
              environment: {
                key: env.key,
                name: env.name,
                kind: env.kind,
                settings: env.settings,
                healthUrl: env.health_url,
              },
              secrets: Object.fromEntries(sealed.map((k) => [k.name, open(k.ciphertext)])),
            },
          },
        };
      });
    },
  });

  const step = route({
    method: 'POST',
    path: '/api/runner/deploys/:deployId/steps',
    summary: 'A runner reports a step as it starts, while it runs and when it ends',
    tags: ['runner'],
    params: s.object({ deployId: uuid }),
    body: s.object({
      seq: s.number({ integer: true, min: 1, max: 1000 }),
      name: s.string({ min: 1, max: 120 }),
      command: s.optional(s.string({ max: 2000 })),
      status: s.enum(['running', 'ok', 'failed', 'skipped']),
      output: s.optional(s.string({ max: 200_000 })),
      exitCode: s.optional(s.nullable(s.number({ integer: true }))),
    }),
    response: s.object({ cancelled: s.boolean() }),
    handler: async ({ params, body, req }) => {
      const runner = await runnerOf(pool, req);
      return inWorkspace(pool, runner.workspace_id, async (c) => {
        const run = await loadDeploy(c, params.deployId).catch(() => null);
        if (run?.status === 'cancelled') return { body: { cancelled: true } };
        const own = await ownRun(c, runner, params.deployId);
        const ended = body.status !== 'running';
        // [PCODE-325 | S15 | v0.1.0] a log keeps no secret: tokens revoked, others reported, values replaced
        const log = await cleanLog(
          pool,
          c,
          runner.workspace_id,
          own.project_id,
          tail(body.output ?? ''),
          'the log of deploy ' + own.id.slice(0, 8) + ', step ' + body.name,
        );
        await c.query(
          `INSERT INTO deploy_steps (workspace_id, run_id, seq, name, command, status, output, exit_code, finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() END)
           ON CONFLICT (run_id, seq) DO UPDATE SET status = $6, output = $7, exit_code = $8,
             finished_at = CASE WHEN $9 THEN now() ELSE deploy_steps.finished_at END`,
          [
            runner.workspace_id,
            own.id,
            body.seq,
            body.name,
            body.command ?? '',
            body.status,
            log,
            body.exitCode ?? null,
            ended,
          ],
        );
        await deployEvent(c, runner.workspace_id, runnerActor(runner), own, 'progressed', {
          step: { from: null, to: { seq: body.seq, name: body.name, status: body.status } },
        });
        return { body: { cancelled: false } };
      });
    },
  });

  const finish = route({
    method: 'POST',
    path: '/api/runner/deploys/:deployId/finish',
    summary: 'A runner ends its run: succeeded or failed',
    tags: ['runner'],
    params: s.object({ deployId: uuid }),
    body: s.object({
      status: s.enum(['succeeded', 'failed']),
      error: s.optional(s.string({ max: 5000 })),
    }),
    response: deployOut,
    handler: async ({ params, body, req }) => {
      const runner = await runnerOf(pool, req);
      return inWorkspace(pool, runner.workspace_id, async (c) => {
        const own = await ownRun(c, runner, params.deployId);
        await c.query(
          'UPDATE deploy_runs SET status = $2, error = $3, finished_at = now() WHERE id = $1',
          [
            own.id,
            body.status,
            // [PCODE-325 | S15 | v0.1.0]
            await cleanLog(
              pool,
              c,
              runner.workspace_id,
              own.project_id,
              body.error ?? '',
              'the error of deploy ' + own.id.slice(0, 8),
            ),
          ],
        );
        const after = await loadDeploy(c, own.id);
        await deployEvent(
          c,
          runner.workspace_id,
          runnerActor(runner),
          after,
          body.status === 'succeeded' ? 'completed' : 'failed',
          { status: { from: 'running', to: body.status } },
        );
        // [PCODE-133 | S15 | v0.1.0] a successful deploy is evidence for G2
        if (body.status === 'succeeded')
          await afterDeploy(c, runner.workspace_id, runnerActor(runner), own.project_id);
        // [PCODE-203 | S15 | v0.1.0] a train follows its deploys, succeeded or not
        await trainAfterDeploy(c, runner.workspace_id, runnerActor(runner), own.id);
        // [PCODE-340 | S15 | v0.1.0] a failed deploy raises an alert, the next good one clears it
        await deployAlert(c, runner.workspace_id, after, body.status, body.error ?? '');
        return { body: deployJson(after) };
      });
    },
  });

  return [listRunners, createRunner, revokeRunner, start, list, get, cancel, claim, step, finish];
}
