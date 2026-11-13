// ── [PCODE-264 | S15 | v0.1.0] T27.6 Canvas pictures and sharing: PNG and PDF with page fitting, read-only share link with iCal subscription ──
//    Why:  the plan for people without an account: a member makes a link (a name, an end day if wanted), the
//          token is shown once and kept as a hash; anyone holding it reads the schedule (tasks, dates, links,
//          progress) and subscribes to it as a calendar, but sees no people, no comments and no code. A link
//          is withdrawn at once, and ends on its day.
import { planIcs } from '@orqiva/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject } from './access.js';
import { computePlan, scheduledOut } from './plan.js';

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const day = s.string({ min: 10, max: 10 });

interface ShareRow {
  id: string;
  workspace_id: string;
  project_id: string;
  label: string;
  created_at: Date;
  expires_on: string | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_by_name: string | null;
}
const shareOut = s.object({
  id: s.string(),
  label: s.string(),
  createdAt: s.string(),
  createdBy: s.nullable(s.string()),
  expiresOn: s.nullable(s.string()),
  revokedAt: s.nullable(s.string()),
  lastUsedAt: s.nullable(s.string()),
  active: s.boolean(),
});
const shareJson = (r: ShareRow, today: string) => ({
  id: r.id,
  label: r.label,
  createdAt: r.created_at.toISOString(),
  createdBy: r.created_by_name,
  expiresOn: r.expires_on,
  revokedAt: r.revoked_at?.toISOString() ?? null,
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
  active: !r.revoked_at && (!r.expires_on || r.expires_on >= today),
});
const BERLIN_TODAY = "(now() AT TIME ZONE 'Europe/Berlin')::date";

export function planShareRoutes(pool: Pool): Route[] {
  const P = '/api/workspaces/:workspaceId/projects/:projectId/plan/shares';
  const list = route({
    method: 'GET',
    path: P,
    summary: "The project plan's share links (member)",
    tags: ['plan'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(shareOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const today =
          (await c.query<{ d: string }>(`SELECT ${BERLIN_TODAY}::text AS d`)).rows[0]?.d ?? '';
        const rows = (
          await c.query<ShareRow>(
            `SELECT sh.id, sh.workspace_id, sh.project_id, sh.label, sh.created_at, sh.expires_on::text AS expires_on,
                    sh.revoked_at, sh.last_used_at, u.name AS created_by_name
               FROM plan_shares sh LEFT JOIN users u ON u.id = sh.created_by
              WHERE sh.project_id = $1 ORDER BY sh.created_at DESC`,
            [params.projectId],
          )
        ).rows;
        return { body: rows.map((r) => shareJson(r, today)) };
      }),
  });

  const create = route({
    method: 'POST',
    path: P,
    summary: 'Make a read-only link to the plan; the token is in the answer once (member)',
    tags: ['plan'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      label: s.optional(s.string({ max: 80 })),
      expiresOn: s.optional(s.nullable(day)),
    }),
    status: 201,
    response: s.object({ id: s.string(), token: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        if (body.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(body.expiresOn))
          throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
            { path: 'body.expiresOn', message: 'is not a date' },
          ]);
        const token = randomBytes(24).toString('base64url');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO plan_shares (workspace_id, project_id, token_hash, label, created_by, expires_on)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
              a.workspaceId,
              project.id,
              sha256(token),
              (body.label ?? '').trim(),
              a.user.id,
              body.expiresOn ?? null,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('share insert returned nothing');
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'created',
            object: { type: 'project', id: project.id, label: project.key },
            changes: { planShared: { from: null, to: body.label?.trim() || 'a read-only link' } },
          },
          { projectId: project.id },
        );
        return { status: 201, body: { id, token } };
      }),
  });

  const revoke = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/plan-shares/:shareId',
    summary: 'Withdraw a share link at once (member)',
    tags: ['plan'],
    params: s.object({ workspaceId: uuid, shareId: uuid }),
    response: s.object({ ok: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<{ project_id: string }>(
            'UPDATE plan_shares SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 RETURNING project_id',
            [params.shareId],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Share link not found');
        const project = await requireProject(c, a, r.project_id);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: project.id, label: project.key },
            changes: { planShareWithdrawn: { from: params.shareId, to: null } },
          },
          { projectId: project.id },
        );
        return { body: { ok: true } };
      }),
  });

  /** The share behind a token, if it still holds; the plan as anyone may see it. */
  const shared = async (token: string) =>
    inSystem(pool, async (c) => {
      const sh = (
        await c.query<{
          id: string;
          workspace_id: string;
          project_id: string;
          name: string;
          key: string;
        }>(
          `SELECT sh.id, sh.workspace_id, sh.project_id, p.name, p.key
             FROM plan_shares sh JOIN projects p ON p.id = sh.project_id
            WHERE sh.token_hash = $1 AND sh.revoked_at IS NULL
              AND (sh.expires_on IS NULL OR sh.expires_on >= ${BERLIN_TODAY})`,
          [sha256(token)],
        )
      ).rows[0];
      // one answer for a wrong, withdrawn or ended link
      if (!sh)
        throw new HttpError(404, 'not_found', 'This link does not lead to a plan (any more)');
      await c.query('UPDATE plan_shares SET last_used_at = now() WHERE id = $1', [sh.id]);
      const p = await computePlan(c, { workspaceId: sh.workspace_id }, sh.project_id);
      return { sh, p };
    });

  const tokenParams = s.object({ token: s.string({ min: 20, max: 100 }) });
  const read = route({
    method: 'GET',
    path: '/api/share/plan/:token',
    summary: 'A shared plan, read-only and without signing in: tasks, dates, links and progress',
    tags: ['plan'],
    params: tokenParams,
    response: s.object({
      project: s.object({ name: s.string(), key: s.string() }),
      today: s.string(),
      workingDays: s.array(s.string()),
      start: s.string(),
      finish: s.string(),
      tasks: s.array(
        s.object({
          id: s.string(),
          ref: s.string(),
          title: s.string(),
          kind: s.string(),
          stateGroup: s.string(),
          parentId: s.nullable(s.string()),
        }),
      ),
      schedule: s.array(scheduledOut),
      dependencies: s.array(
        s.object({
          id: s.string(),
          predecessorId: s.string(),
          successorId: s.string(),
          kind: s.string(),
          lagDays: s.number({ integer: true }),
        }),
      ),
    }),
    handler: async ({ params }) => {
      const { sh, p } = await shared(params.token);
      return {
        headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
        body: {
          project: { name: sh.name, key: sh.key },
          today: p.today,
          workingDays: p.workingDays,
          start: p.sched.start,
          finish: p.sched.finish,
          tasks: p.rows.map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            kind: r.kind,
            stateGroup: r.grp,
            parentId: r.parent_id,
          })),
          schedule: p.sched.tasks,
          dependencies: p.deps.map((d) => ({
            id: d.id,
            predecessorId: d.predecessor_id,
            successorId: d.successor_id,
            kind: d.kind,
            lagDays: d.lag_days,
          })),
        },
      };
    },
  });

  const ics = route({
    method: 'GET',
    path: '/api/share/plan/:token/ics',
    summary: 'A shared plan as a calendar to subscribe to',
    tags: ['plan'],
    params: tokenParams,
    response: s.anyObject(),
    handler: async ({ params }) => {
      const { sh, p } = await shared(params.token);
      const row = new Map(p.rows.map((r) => [r.id, r]));
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
      return {
        body: {},
        headers: { 'cache-control': 'no-store' },
        file: {
          data: Buffer.from(
            planIcs({
              name: sh.name,
              stamp,
              tasks: p.sched.tasks
                .filter((t) => !t.summary)
                .map((t) => ({
                  id: t.id,
                  ref: row.get(t.id)?.ref ?? '',
                  title: row.get(t.id)?.title ?? '',
                  start: t.start,
                  finish: t.finish,
                  milestone: t.milestone,
                  percentDone: t.percentDone,
                })),
            }),
            'utf8',
          ),
          contentType: 'text/calendar; charset=utf-8',
          name: sh.key.toLowerCase() + '-plan.ics',
          inline: true,
        },
      };
    },
  });

  return [list, create, revoke, read, ics];
}
