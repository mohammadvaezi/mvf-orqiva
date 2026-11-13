// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
//    Why:  the optional bridges to Slack and Teams (admins keep them; the address is sealed and never shown
//          again), each person's calendar link with their dates, and the runs CI pipelines report, which
//          the agents' ci_failure trigger hears when one fails.
import { randomBytes } from 'node:crypto';
import { bridgeUrlOk, localDay, onCallAt, personalIcs, type CalendarEntry } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { open, seal } from '../agents/secrets.js';
import { inSystem, inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { postToBridge, type BridgeOptions } from '../integrations/bridges.js';
import { taskNumbers } from '../git/webhook.js';
import { actorOf, asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });

interface BridgeRow {
  id: string;
  kind: 'slack' | 'teams';
  name: string;
  topics: string[];
  channel_id: string | null;
  channel_name: string | null;
  active: boolean;
  sent: number;
  last_error: string;
  last_at: Date | null;
}

const bridgeJson = (b: BridgeRow): Record<string, unknown> => ({
  id: b.id,
  kind: b.kind,
  name: b.name,
  topics: b.topics,
  channelId: b.channel_id,
  channelName: b.channel_name,
  active: b.active,
  sent: b.sent,
  lastError: b.last_error,
  lastAt: b.last_at?.toISOString() ?? null,
});

const BRIDGE_SELECT = `SELECT b.id, b.kind, b.name, b.topics, b.channel_id, ch.name AS channel_name, b.active, b.sent, b.last_error, b.last_at
  FROM chat_bridges b LEFT JOIN channels ch ON ch.id = b.channel_id`;

/** A person's dates for the next weeks and the last month. */
export async function calendarOf(
  c: PoolClient,
  userId: string,
  base: string,
  now = new Date(),
): Promise<CalendarEntry[]> {
  const out: CalendarEntry[] = [];
  const next = (d: string): string =>
    new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
  const tasks = (
    await c.query<{ id: string; ref: string; title: string; due: string }>(
      `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.due_date::text AS due
         FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
        WHERE i.assignee_id = $1 AND i.due_date IS NOT NULL AND i.due_date > current_date - 30
          AND st.grp NOT IN ('completed', 'cancelled')`,
      [userId],
    )
  ).rows;
  for (const t of tasks)
    out.push({
      uid: 'due-' + t.id,
      summary: 'Due: ' + t.ref + ' ' + t.title,
      start: t.due,
      end: next(t.due),
      url: base + '/items/' + t.id,
    });
  const sprints = (
    await c.query<{ id: string; name: string; key: string; start: string; finish: string }>(
      `SELECT DISTINCT sp.id, sp.name, p.key, sp.start_date::text AS start, sp.end_date::text AS finish
         FROM sprints sp JOIN projects p ON p.id = sp.project_id
        WHERE sp.start_date IS NOT NULL AND sp.end_date IS NOT NULL AND sp.end_date > current_date - 30
          AND (EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)
               OR EXISTS (SELECT 1 FROM items i WHERE i.sprint_id = sp.id AND i.assignee_id = $1))`,
      [userId],
    )
  ).rows;
  for (const sp of sprints)
    out.push({
      uid: 'sprint-' + sp.id,
      summary: sp.key + ' ' + sp.name,
      start: sp.start,
      end: next(sp.finish),
    });
  const away = (
    await c.query<{ id: string; kind: string; starts_on: string; ends_on: string }>(
      `SELECT id, kind, starts_on::text AS starts_on, ends_on::text AS ends_on FROM absences
        WHERE user_id = $1 AND state = 'approved' AND ends_on > current_date - 30`,
      [userId],
    )
  ).rows;
  for (const a of away)
    out.push({
      uid: 'absence-' + a.id,
      summary: a.kind === 'holiday' ? 'Day off' : 'Away (' + a.kind + ')',
      start: a.starts_on,
      end: next(a.ends_on),
    });
  const meetings = (
    await c.query<{ id: string; title: string; starts_at: Date; minutes: number }>(
      `SELECT id, title, starts_at, minutes FROM meetings WHERE $1 = ANY (attendee_ids) AND starts_at > now() - interval '30 days'`,
      [userId],
    )
  ).rows;
  for (const m of meetings)
    out.push({
      uid: 'meeting-' + m.id,
      summary: m.title,
      start: m.starts_at.toISOString(),
      end: new Date(m.starts_at.getTime() + m.minutes * 60_000).toISOString(),
    });
  // on call: the days of the next eight weeks this person is primary, joined into stretches
  const schedules = (
    await c.query<{
      id: string;
      name: string;
      member_ids: string[];
      rotation_days: number;
      handoff_time: string;
      timezone: string;
      starts_on: string;
    }>(
      `SELECT id, name, member_ids, rotation_days, handoff_time::text AS handoff_time, timezone, starts_on::text AS starts_on
         FROM oncall_schedules WHERE $1 = ANY (member_ids)`,
      [userId],
    )
  ).rows;
  for (const sch of schedules) {
    const r = {
      memberIds: sch.member_ids,
      rotationDays: sch.rotation_days,
      handoffTime: sch.handoff_time.slice(0, 5),
      timezone: sch.timezone,
      startsOn: sch.starts_on,
    };
    let from: string | null = null;
    let day = localDay(now);
    for (let i = 0; i <= 56; i++) {
      const at = new Date(Date.parse(day + 'T12:00:00Z'));
      const mine = i < 56 && onCallAt(r, at).primary === userId;
      if (mine && !from) from = day;
      if (!mine && from) {
        out.push({
          uid: 'oncall-' + sch.id + '-' + from,
          summary: 'On call: ' + sch.name,
          start: from,
          end: day,
        });
        from = null;
      }
      day = next(day);
    }
  }
  return out;
}

export function bridgeRoutes(pool: Pool, deps: BridgeOptions = {}): Route[] {
  const ws = s.object({ workspaceId: uuid });
  const base = (deps.publicUrl ?? '').replace(/\/$/, '');

  const listBridges = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/chat-bridges',
    summary: 'The Slack and Teams bridges (admin)',
    tags: ['integrations'],
    params: ws,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          bridges: (await c.query<BridgeRow>(BRIDGE_SELECT + ' ORDER BY b.created_at')).rows.map(
            bridgeJson,
          ),
        },
      })),
  });

  const addBridge = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/chat-bridges',
    summary:
      'Add a bridge to a Slack or Teams incoming webhook; it posts what comes from now on (admin)',
    tags: ['integrations'],
    params: ws,
    body: s.object({
      kind: s.enum(['slack', 'teams']),
      name: s.string({ min: 1, max: 80 }),
      url: s.string({ min: 10, max: 1000 }),
      topics: s.array(s.enum(['incidents', 'releases', 'deploys', 'ci']), { max: 4 }),
      channelId: s.optional(s.nullable(uuid)),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (!bridgeUrlOk(body.kind, body.url.trim()))
          throw new HttpError(
            400,
            'invalid_request',
            body.kind === 'slack'
              ? 'Use the Slack incoming webhook address (https://hooks.slack.com/services/…)'
              : 'Use the address of a Teams workflow that takes webhooks',
            [
              {
                path: 'body.url',
                message:
                  'is not an incoming webhook of ' + (body.kind === 'slack' ? 'Slack' : 'Teams'),
              },
            ],
          );
        if (!body.topics.length && !body.channelId)
          throw new HttpError(400, 'invalid_request', 'Choose what the bridge posts', [
            { path: 'body.topics', message: 'or a channel is needed' },
          ]);
        if (
          body.channelId &&
          !(
            await c.query("SELECT 1 FROM channels WHERE id = $1 AND kind <> 'direct'", [
              body.channelId,
            ])
          ).rowCount
        )
          throw new HttpError(400, 'invalid_request', 'Choose one of the workspace’s channels');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO chat_bridges (workspace_id, kind, name, url_ciphertext, topics, channel_id, cursor, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(sequence), 0) FROM activity_events WHERE workspace_id = $1), $7)
             RETURNING id`,
            [
              a.workspaceId,
              body.kind,
              body.name.trim(),
              seal(body.url.trim()),
              body.topics,
              body.channelId ?? null,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<BridgeRow>(BRIDGE_SELECT + ' WHERE b.id = $1', [id])).rows[0];
        if (!row) throw new Error('bridge insert returned nothing');
        return { status: 201, body: bridgeJson(row) };
      }),
  });

  const testBridge = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/chat-bridges/:bridgeId/test',
    summary: 'Post a test message through the bridge (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid, bridgeId: uuid }),
    response: s.object({ ok: s.boolean(), error: s.string() }),
    handler: async ({ params, req }) => {
      const b = await asMember(
        pool,
        req,
        params.workspaceId,
        'admin',
        async (c) =>
          (
            await c.query<{ kind: 'slack' | 'teams'; url_ciphertext: string; name: string }>(
              'SELECT kind, url_ciphertext, name FROM chat_bridges WHERE id = $1',
              [params.bridgeId],
            )
          ).rows[0],
      );
      if (!b) throw new HttpError(404, 'not_found', 'Bridge not found');
      try {
        await postToBridge(
          b.kind,
          open(b.url_ciphertext),
          {
            title: 'Orqiva is connected',
            text: 'This bridge posts here: ' + b.name,
            ...(base ? { url: base } : {}),
          },
          deps,
        );
        await inSystem(pool, (c) =>
          c.query(
            "UPDATE chat_bridges SET last_error = '', failures = 0, active = true WHERE id = $1",
            [params.bridgeId],
          ),
        );
        return { body: { ok: true, error: '' } };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await inSystem(pool, (c) =>
          c.query('UPDATE chat_bridges SET last_error = $2 WHERE id = $1', [
            params.bridgeId,
            error.slice(0, 300),
          ]),
        );
        return { body: { ok: false, error } };
      }
    },
  });

  const removeBridge = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/chat-bridges/:bridgeId',
    summary: 'Remove a bridge (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid, bridgeId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM chat_bridges WHERE id = $1', [params.bridgeId])).rowCount,
          ),
        },
      })),
  });

  // ── the personal calendar ──
  const myFeed = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/calendar-feed',
    summary: 'Your calendar link, if you made one',
    tags: ['integrations'],
    params: ws,
    response: s.object({ url: s.nullable(s.string()), readAt: s.nullable(s.string()) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<{ token: string; read_at: Date | null }>(
            'SELECT token, read_at FROM calendar_feeds WHERE user_id = $1',
            [a.user.id],
          )
        ).rows[0];
        return {
          body: {
            url: r ? base + '/calendar/' + r.token + '.ics' : null,
            readAt: r?.read_at?.toISOString() ?? null,
          },
        };
      }),
  });

  const makeFeed = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/calendar-feed',
    summary: 'Make your calendar link; an old one stops working',
    tags: ['integrations'],
    params: ws,
    response: s.object({ url: s.string() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const token = randomBytes(20).toString('hex');
        await c.query(
          `INSERT INTO calendar_feeds (token, workspace_id, user_id) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET token = EXCLUDED.token, created_at = now(), read_at = NULL`,
          [token, a.workspaceId, a.user.id],
        );
        return { body: { url: base + '/calendar/' + token + '.ics' } };
      }),
  });

  const dropFeed = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/calendar-feed',
    summary: 'Stop your calendar link',
    tags: ['integrations'],
    params: ws,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: {
          removed: Boolean(
            (await c.query('DELETE FROM calendar_feeds WHERE user_id = $1', [a.user.id])).rowCount,
          ),
        },
      })),
  });

  const feed = route({
    method: 'GET',
    path: '/calendar/:file',
    summary: 'A person’s calendar from their secret link (no sign-in; calendar apps read it)',
    tags: ['integrations'],
    params: s.object({ file: s.string({ pattern: /^[a-z0-9]{32,64}\.ics$/ }) }),
    response: s.anyObject(),
    handler: async ({ params }) => {
      const token = params.file.replace(/\.ics$/, '');
      const f = await inSystem(pool, async (c) => {
        const row = (
          await c.query<{ workspace_id: string; user_id: string; name: string; ws: string }>(
            `SELECT f.workspace_id, f.user_id, u.name, w.name AS ws FROM calendar_feeds f JOIN users u ON u.id = f.user_id
               JOIN workspaces w ON w.id = f.workspace_id JOIN workspace_members m ON m.workspace_id = f.workspace_id AND m.user_id = f.user_id
              WHERE f.token = $1 AND m.suspended_at IS NULL`,
            [token],
          )
        ).rows[0];
        if (row)
          await c.query('UPDATE calendar_feeds SET read_at = now() WHERE token = $1', [token]);
        return row;
      });
      if (!f) throw new HttpError(404, 'not_found', 'This calendar link does not work any more');
      // only this workspace's dates, never another one the person is in
      const entries = await inWorkspace(pool, f.workspace_id, (c) =>
        calendarOf(c, f.user_id, base),
      );
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
      const body = personalIcs(f.ws + ' · ' + f.name, stamp, entries);
      return {
        body: {},
        file: {
          data: Buffer.from(body, 'utf8'),
          contentType: 'text/calendar; charset=utf-8',
          name: 'orqiva.ics',
        },
      };
    },
  });

  // ── CI runs ──
  const report = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/ci-runs',
    summary: 'A CI pipeline reports a run (use an access token); the same external id updates it',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      externalId: s.string({ min: 1, max: 200 }),
      pipeline: s.string({ min: 1, max: 120 }),
      status: s.enum(['running', 'passed', 'failed', 'cancelled']),
      branch: s.optional(s.string({ max: 250 })),
      sha: s.optional(s.string({ pattern: /^[0-9a-f]{7,64}$/ })),
      url: s.optional(s.string({ max: 500 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const refs = taskNumbers(p.key, body.branch ?? '').map((n) => p.key + '-' + String(n));
        const before = (
          await c.query<{ status: string }>(
            'SELECT status FROM ci_runs WHERE project_id = $1 AND external_id = $2',
            [p.id, body.externalId],
          )
        ).rows[0]?.status;
        const done = body.status !== 'running';
        const r = (
          await c.query<{ id: string }>(
            `INSERT INTO ci_runs (workspace_id, project_id, external_id, pipeline, status, branch, sha, url, item_refs, finished_at, reported_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10 THEN now() END, $11)
             ON CONFLICT (project_id, external_id) DO UPDATE SET status = EXCLUDED.status, pipeline = EXCLUDED.pipeline,
               branch = EXCLUDED.branch, sha = EXCLUDED.sha, url = EXCLUDED.url, item_refs = EXCLUDED.item_refs,
               finished_at = CASE WHEN $10 THEN now() ELSE ci_runs.finished_at END
             RETURNING id`,
            [
              a.workspaceId,
              p.id,
              body.externalId,
              body.pipeline.trim(),
              body.status,
              body.branch ?? '',
              body.sha ?? '',
              body.url ?? '',
              refs,
              done,
              a.user.id,
            ],
          )
        ).rows[0];
        if (!r) throw new Error('ci run insert returned nothing');
        // a run that failed now is an event: the agents' ci_failure trigger and the bridges hear it
        if (body.status === 'failed' && before !== 'failed')
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'failed',
              object: {
                type: 'ci_run',
                id: r.id,
                label: body.pipeline.trim() + (body.branch ? ' on ' + body.branch : ''),
              },
            },
            { projectId: p.id },
          );
        return { body: { id: r.id, status: body.status, itemRefs: refs } };
      }),
  });

  const runs = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/ci-runs',
    summary: 'A project’s latest CI runs',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            pipeline: string;
            status: string;
            branch: string;
            sha: string;
            url: string;
            item_refs: string[];
            started_at: Date;
            finished_at: Date | null;
          }>(
            'SELECT id, pipeline, status, branch, sha, url, item_refs, started_at, finished_at FROM ci_runs WHERE project_id = $1 ORDER BY started_at DESC LIMIT 20',
            [params.projectId],
          )
        ).rows;
        return {
          body: {
            runs: rows.map((r) => ({
              id: r.id,
              pipeline: r.pipeline,
              status: r.status,
              branch: r.branch,
              sha: r.sha,
              url: r.url,
              itemRefs: r.item_refs,
              startedAt: r.started_at.toISOString(),
              finishedAt: r.finished_at?.toISOString() ?? null,
            })),
          },
        };
      }),
  });

  return [
    listBridges,
    addBridge,
    testBridge,
    removeBridge,
    myFeed,
    makeFeed,
    dropFeed,
    feed,
    report,
    runs,
  ];
}
