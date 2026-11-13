// ── [PCODE-413 | S15 | v0.1.0] T37 high: Activity facets answer under 1 s ──
// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-355 | S15 | v0.1.0] T35.4c Activity: query autocomplete, columns, group-by, drag to zoom, heat map ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
//    Why:  the Activity page's server: any query over the events (and the archive if asked), page by page
//          with a cursor, with facet counts and a histogram of the same filter; what made a peak; an
//          object's whole story; one event by its link; saved views; exports of any query; the retention
//          and the archive; a check of the hash chain; and webhooks that stream events, signed.
import { parseActivityQuery, toCsv } from '@orqiva/shared';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { seal, SecretKeyMissing } from '../agents/secrets.js';
import { archiveOld, deliverOne } from '../activity/worker.js';
import { EVENTS_FROM, rollupWhereOf, whereOf, type Scope } from '../activity/query.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { workspaceTimeZone } from './timezone.js'; // [PCODE-355 | S15 | v0.1.0]
import { asMember, atLeast, type Access } from './access.js';
import { isPublicUrl } from './documents.js';
import { requireFeature } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });
const searchQuery = s.object({
  q: s.optional(s.string({ max: 500 })),
  mode: s.optional(s.enum(['all', 'mine'])),
  from: s.optional(s.string({ format: 'date-time' })),
  to: s.optional(s.string({ format: 'date-time' })),
  cursor: s.optional(s.string({ max: 80 })),
  limit: s.optional(s.string({ pattern: /^\d{1,3}$/ })),
});
const BINS = 48;

/** The parsed query and scope of a request; a query with mistakes is refused with what is wrong. */
function scopeOf(
  a: Access,
  query: { q?: string; mode?: 'all' | 'mine'; from?: string; to?: string },
) {
  const q = parseActivityQuery(query.q ?? '');
  if (q.errors.length)
    throw new HttpError(
      400,
      'invalid_request',
      q.errors.join('; '),
      q.errors.map((m) => ({ path: 'query.q', message: m })),
    );
  const scope: Scope = {
    workspaceId: a.workspaceId,
    role: a.role,
    userId: a.user.id,
    mode: query.mode ?? 'all',
    from: query.from ? new Date(query.from) : null,
    to: query.to ? new Date(query.to) : null,
  };
  return { q, scope };
}

interface Row {
  sequence: string;
  time: Date;
  envelope: Record<string, unknown>;
  archived: boolean;
}

// [PCODE-413 | S15 | v0.1.0] everything the side of the page shows, from one pass over the matching events: hourly
// counts (the total, the span, the heat map, and the histogram when its bins are an hour or wider), finer
// buckets when the window is short, and the facets. The project facet groups by id and looks the keys up
// once, instead of once per event.
interface Summary {
  total: number;
  lo: Date | null;
  hi: Date | null;
  hours: { at: Date; n: number }[];
  fine: { b: number; n: number }[];
  /** every value's count (projects by id): summaries add up before the top eight are taken */
  facets: Record<FacetSet, Map<string, number>>;
}
type FacetSet = 'actor' | 'type' | 'verb' | 'project';
const FACET_SETS: FacetSet[] = ['actor', 'type', 'verb', 'project'];

/** Two summaries of separate parts (hourly rows and the edge events of a window) as one. */
function mergeSummaries(a: Summary, b: Summary): Summary {
  const hours = new Map<number, number>();
  for (const h of [...a.hours, ...b.hours])
    hours.set(h.at.getTime(), (hours.get(h.at.getTime()) ?? 0) + h.n);
  const list = [...hours.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([t, n]) => ({ at: new Date(t), n }));
  const facets = {} as Summary['facets'];
  for (const set of FACET_SETS) {
    const m = new Map(a.facets[set]);
    for (const [k, n] of b.facets[set]) m.set(k, (m.get(k) ?? 0) + n);
    facets[set] = m;
  }
  return {
    total: a.total + b.total,
    lo: list[0]?.at ?? null,
    hi: list.at(-1)?.at ?? null,
    hours: list,
    fine: [...a.fine, ...b.fine],
    facets,
  };
}

/** The top eight of each facet, projects by their key. */
async function facetsOf(
  c: PoolClient,
  sum: Summary,
): Promise<Record<FacetSet, { key: string; count: number }[]>> {
  const top = (set: FacetSet) =>
    [...sum.facets[set].entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 8);
  const projects = top('project');
  const keys = projects.length
    ? new Map(
        (
          await c.query<{ id: string; key: string }>(
            'SELECT id::text AS id, key FROM projects WHERE id::text = ANY($1::text[])',
            [projects.map((x) => x.key)],
          )
        ).rows.map((r) => [r.id, r.key]),
      )
    : new Map<string, string>();
  return {
    actor: top('actor'),
    type: top('type'),
    verb: top('verb'),
    project: projects
      .map((x) => ({ key: keys.get(x.key) ?? '', count: x.count }))
      .filter((x) => x.key),
  };
}

async function summaryOf(
  c: PoolClient,
  from: string,
  where: { sql: string; params: unknown[] },
  fine: { lo: Date; seconds: number } | null,
  // the hourly counts instead of the events: same columns, a count per row
  rollup = false,
): Promise<Summary> {
  const n = where.params.length;
  const hourExpr = rollup ? 'e.hour' : "date_trunc('hour', e.time)";
  const verbExpr = rollup ? 'e.verb' : "e.envelope->'data'->>'verb'";
  const countExpr = rollup ? 'sum(e.n)' : 'count(*)';
  const fineExpr = fine
    ? `floor(extract(epoch FROM (e.time - $${String(n + 1)}::timestamptz)) / $${String(n + 2)})::int`
    : 'NULL::int';
  const rows = (
    await c.query<{
      set: string;
      at: Date | null;
      b: number | null;
      k: string | null;
      n: string;
    }>(
      `SELECT CASE
                WHEN GROUPING(${hourExpr}) = 0 THEN 'hour'
                ${fine ? 'WHEN GROUPING(' + fineExpr + ") = 0 THEN 'fine'" : ''}
                WHEN GROUPING(e.actor_kind) = 0 THEN 'actor'
                WHEN GROUPING(e.object_type) = 0 THEN 'type'
                WHEN GROUPING(${verbExpr}) = 0 THEN 'verb'
                ELSE 'project' END AS set,
              ${hourExpr} AS at, ${fineExpr} AS b,
              coalesce(e.actor_kind, e.object_type, ${verbExpr}, nullif(e.project_id, '')) AS k,
              ${countExpr} AS n
         FROM ${from} WHERE ${where.sql}
        GROUP BY GROUPING SETS ((${hourExpr}), ${fine ? '(' + fineExpr + '), ' : ''}(e.actor_kind),
                 (e.object_type), (${verbExpr}), (e.project_id))`,
      fine ? [...where.params, fine.lo, fine.seconds] : where.params,
    )
  ).rows;
  const all = (set: FacetSet) =>
    new Map(rows.filter((r) => r.set === set && r.k).map((r) => [r.k ?? '', Number(r.n)]));
  const hours = rows
    .filter((r) => r.set === 'hour' && r.at)
    .map((r) => ({ at: r.at ?? new Date(0), n: Number(r.n) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    total: hours.reduce((sum, h) => sum + h.n, 0),
    lo: hours[0]?.at ?? null,
    hi: hours.at(-1)?.at ?? null,
    hours,
    fine: rows
      .filter((r) => r.set === 'fine' && r.b !== null)
      .map((r) => ({ b: r.b ?? 0, n: Number(r.n) })),
    facets: { actor: all('actor'), type: all('type'), verb: all('verb'), project: all('project') },
  };
}

/** Weekday (1 = Monday) and hour of a moment in a time zone. */
function dayHour(at: Date, timeZone: string): { d: number; h: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const wd = parts.find((x) => x.type === 'weekday')?.value ?? 'Mon';
  return {
    d: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd) + 1,
    h: Number(parts.find((x) => x.type === 'hour')?.value ?? '0'),
  };
}

export function activitySearchRoutes(pool: Pool): Route[] {
  const search = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/search',
    summary:
      'Events matching a query, newest first, page by page; with the total, facet counts and a histogram of the same filter',
    tags: ['activity'],
    params: wsParams,
    query: searchQuery,
    response: s.object({
      events: s.array(
        s.object({
          sequence: s.number({ integer: true }),
          archived: s.boolean(),
          event: s.anyObject(),
        }),
      ),
      next: s.nullable(s.string()),
      total: s.number({ integer: true }),
      facets: s.object({
        actor: s.array(s.object({ key: s.string(), count: s.number({ integer: true }) })),
        type: s.array(s.object({ key: s.string(), count: s.number({ integer: true }) })),
        verb: s.array(s.object({ key: s.string(), count: s.number({ integer: true }) })),
        project: s.array(s.object({ key: s.string(), count: s.number({ integer: true }) })),
      }),
      histogram: s.object({
        from: s.string(),
        to: s.string(),
        bins: s.array(s.number({ integer: true })),
      }),
      // [PCODE-355 | S15 | v0.1.0] weekday (Monday first) by hour
      heat: s.array(s.array(s.number({ integer: true }))),
      timeZone: s.string(),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const { q, scope } = scopeOf(a, query);
        const from = EVENTS_FROM(q.archive);
        const where = whereOf(q, scope);
        const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));
        const cur = query.cursor ? /^(\d{4}-[^|]+)\|(\d+)$/.exec(query.cursor) : null;
        if (query.cursor && !cur)
          throw new HttpError(400, 'invalid_request', 'The cursor is not one this server gave', [
            { path: 'query.cursor', message: 'is not a cursor' },
          ]);
        const page = (
          await c.query<Row>(
            // [PCODE-413 | S15 | v0.1.0] words: find the few matches first (text index), then sort them;
            // otherwise the planner walks the time index through every event looking for them
            (q.terms.some((x) => x.field === 'text')
              ? `WITH m AS MATERIALIZED (SELECT e.sequence, e.time, e.envelope, e.archived FROM ${from} WHERE ${where.sql})
                 SELECT e.sequence, e.time, e.envelope, e.archived FROM m e WHERE true`
              : `SELECT e.sequence, e.time, e.envelope, e.archived FROM ${from} WHERE ${where.sql}`) +
              ` ${cur ? 'AND (e.time, e.sequence) < ($' + String(where.params.length + 1) + '::timestamptz, $' + String(where.params.length + 2) + '::bigint)' : ''}
              ORDER BY e.time DESC, e.sequence DESC LIMIT ${String(limit + 1)}`,
            cur ? [...where.params, cur[1], cur[2]] : where.params,
          )
        ).rows;
        // [PCODE-413 | S15 | v0.1.0] one pass for the total, the span, the histogram, the heat map and the facets
        const hi = scope.to ?? new Date();
        const known =
          scope.from ??
          (q.sinceHours !== null ? new Date(Date.now() - q.sinceHours * 3_600_000) : null);
        const knownWidth = known ? Math.max(1, hi.getTime() - known.getTime()) : 0;
        const binSeconds = knownWidth / 1000 / BINS;
        // whole hours from the hourly rows when the bins are an hour or wider; the partial hours at
        // the edges of a window, and everything a filter needs the events for, from the events
        const hourly = binSeconds >= 3600 || !known ? rollupWhereOf(q, scope, hi) : null;
        let sum = hourly
          ? await summaryOf(c, 'activity_rollup e', hourly, null, true)
          : await summaryOf(
              c,
              from,
              where,
              known && binSeconds < 3600 ? { lo: known, seconds: Math.max(1, binSeconds) } : null,
            );
        for (const edge of hourly?.edges ?? [])
          sum = mergeSummaries(
            sum,
            await summaryOf(c, from, whereOf(q, { ...scope, from: edge.from, to: edge.to }), null),
          );
        const total = sum.total;
        const lo = known ?? sum.lo ?? new Date(Date.now() - 86_400_000);
        const width = Math.max(1, hi.getTime() - lo.getTime());
        const bins = new Array<number>(BINS).fill(0);
        const add = (b: number, n: number): void => {
          const i = Math.min(BINS - 1, Math.max(0, b));
          bins[i] = (bins[i] ?? 0) + n;
        };
        if (sum.fine.length) for (const f of sum.fine) add(f.b, f.n);
        else
          for (const h of sum.hours) {
            if (h.at.getTime() + 3_600_000 <= lo.getTime()) continue;
            add(Math.floor(((h.at.getTime() - lo.getTime()) / width) * BINS), h.n);
          }
        // [PCODE-355 | S15 | v0.1.0] weekday by hour, in the workspace's time zone
        const tz = await workspaceTimeZone(c, params.workspaceId);
        const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
        for (const h of sum.hours) {
          if (h.at.getTime() + 3_600_000 <= lo.getTime()) continue;
          const { d, h: hour } = dayHour(h.at, tz);
          const row = heat[d - 1];
          if (row) row[hour] = (row[hour] ?? 0) + h.n;
        }
        const more = page.length > limit;
        const rows = page.slice(0, limit);
        const last = rows.at(-1);
        return {
          body: {
            events: rows.map((r) => ({
              sequence: Number(r.sequence),
              archived: r.archived,
              event: r.envelope,
            })),
            next: more && last ? last.time.toISOString() + '|' + last.sequence : null,
            total,
            facets: await facetsOf(c, sum),
            histogram: { from: lo.toISOString(), to: hi.toISOString(), bins },
            heat, // [PCODE-355 | S15 | v0.1.0]
            timeZone: tz,
          },
        };
      }),
  });

  const peak = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/explain',
    summary:
      'What made a stretch of time busy: the actors, kinds of object, projects and verbs behind most of its events',
    tags: ['activity'],
    params: wsParams,
    query: searchQuery,
    response: s.object({
      total: s.number({ integer: true }),
      sentence: s.string(),
      actors: s.array(s.object({ key: s.string(), count: s.number({ integer: true }) })),
      types: s.array(s.object({ key: s.string(), count: s.number({ integer: true }) })),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const { q, scope } = scopeOf(a, query);
        const from = EVENTS_FROM(q.archive);
        const where = whereOf(q, scope);
        const top = async (expr: string) =>
          (
            await c.query<{ k: string; n: string }>(
              `SELECT ${expr} AS k, count(*) AS n FROM ${from} WHERE ${where.sql} GROUP BY 1 ORDER BY 2 DESC LIMIT 3`,
              where.params,
            )
          ).rows.map((r) => ({ key: r.k, count: Number(r.n) }));
        const total = Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*) AS n FROM ${from} WHERE ${where.sql}`,
              where.params,
            )
          ).rows[0]?.n ?? 0,
        );
        const actors = await top("coalesce(e.envelope->'data'->'actor'->>'name', e.actor_kind)");
        const types = await top("e.object_type || ' ' || (e.envelope->'data'->>'verb')");
        const lead = actors[0];
        const sentence = !total
          ? 'Nothing happened here.'
          : (lead
              ? lead.key +
                ' made ' +
                String(Math.round((lead.count / total) * 100)) +
                ' % of the ' +
                String(total) +
                ' events'
              : String(total) + ' events') +
            (types[0]
              ? ', most of them ' +
                types[0].key.replace(/_/g, ' ') +
                ' (' +
                String(types[0].count) +
                ')'
              : '') +
            '.';
        return { body: { total, sentence, actors, types } };
      }),
  });

  const story = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/story/:objectType/:objectId',
    summary:
      'The whole story of one object: its events and those of everything under it, oldest first, from both tiers',
    tags: ['activity'],
    params: s.object({
      workspaceId: uuid,
      objectType: s.string({ pattern: /^[a-z_]{2,30}$/ }),
      objectId: s.string({ min: 1, max: 80 }),
    }),
    response: s.array(s.object({ sequence: s.number({ integer: true }), event: s.anyObject() })),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const vis =
          a.role === 'guest'
            ? ' AND e.project_id IN (SELECT pr.id::text FROM projects pr WHERE guest_sees_project(pr.id, $4::uuid))'
            : '';
        const rows = (
          await c.query<{ sequence: string; envelope: Record<string, unknown> }>(
            `SELECT e.sequence, e.envelope FROM ${EVENTS_FROM(true)}
              WHERE e.workspace_id = $1 AND ((e.object_type = $2 AND e.object_id = $3) OR (e.parent_type = $2 AND e.parent_id = $3))
                AND e.type NOT IN ('orqiva.agent_run.progressed', 'orqiva.deploy.progressed', 'orqiva.test_run.progressed')${vis}
              ORDER BY e.sequence LIMIT 500`,
            a.role === 'guest'
              ? [a.workspaceId, params.objectType, params.objectId, a.user.id]
              : [a.workspaceId, params.objectType, params.objectId],
          )
        ).rows;
        return { body: rows.map((r) => ({ sequence: Number(r.sequence), event: r.envelope })) };
      }),
  });

  const one = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/events/:eventId',
    summary: 'One event by its id (a permalink), with its place in the audit chain',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid, eventId: uuid }),
    response: s.object({
      sequence: s.number({ integer: true }),
      archived: s.boolean(),
      hash: s.nullable(s.string()),
      event: s.anyObject(),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const r = (
          await c.query<Row & { hash: string | null; project_id: string | null }>(
            `SELECT e.sequence, e.time, e.envelope, e.hash, e.project_id, e.archived FROM ${EVENTS_FROM(true)} WHERE e.workspace_id = $1 AND e.id = $2`,
            [a.workspaceId, params.eventId],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Event not found');
        if (
          a.role === 'guest' &&
          !(
            r.project_id &&
            (
              await c.query('SELECT 1 WHERE guest_sees_project($1::uuid, $2)', [
                r.project_id,
                a.user.id,
              ])
            ).rowCount
          )
        )
          throw new HttpError(404, 'not_found', 'Event not found');
        return {
          body: {
            sequence: Number(r.sequence),
            archived: r.archived,
            hash: r.hash,
            event: r.envelope,
          },
        };
      }),
  });

  // ── saved views ──
  const viewOut = s.object({
    id: s.string(),
    name: s.string(),
    query: s.string(),
    mode: s.string(),
    shared: s.boolean(),
    mine: s.boolean(),
    ownerName: s.string(),
  });
  const viewsOf = async (c: PoolClient, me: string) =>
    (
      await c.query<{
        id: string;
        name: string;
        query: string;
        mode: string;
        shared: boolean;
        owner_id: string;
        owner: string;
      }>(
        'SELECT v.id, v.name, v.query, v.mode, v.shared, v.owner_id, u.name AS owner FROM activity_views v JOIN users u ON u.id = v.owner_id WHERE v.owner_id = $1 OR v.shared ORDER BY v.name',
        [me],
      )
    ).rows.map((v) => ({
      id: v.id,
      name: v.name,
      query: v.query,
      mode: v.mode,
      shared: v.shared,
      mine: v.owner_id === me,
      ownerName: v.owner,
    }));
  const views = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/views',
    summary: 'Your saved views and those shared with the workspace',
    tags: ['activity'],
    params: wsParams,
    response: s.array(viewOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => ({
        body: await viewsOf(c, a.user.id),
      })),
  });
  const saveView = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/activity/views',
    summary: 'Save a query as a view, for yourself or shared (member)',
    tags: ['activity'],
    params: wsParams,
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      query: s.string({ max: 500 }),
      mode: s.optional(s.enum(['all', 'mine'])),
      shared: s.optional(s.boolean()),
    }),
    response: s.array(viewOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const q = parseActivityQuery(body.query);
        if (q.errors.length)
          throw new HttpError(400, 'invalid_request', q.errors.join('; '), [
            { path: 'body.query', message: q.errors[0] ?? '' },
          ]);
        await c.query(
          'INSERT INTO activity_views (workspace_id, owner_id, name, query, mode, shared) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            a.workspaceId,
            a.user.id,
            body.name.trim(),
            body.query.trim(),
            body.mode ?? 'all',
            body.shared ?? false,
          ],
        );
        return { status: 201, body: await viewsOf(c, a.user.id) };
      }),
  });
  const removeView = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/activity/views/:viewId',
    summary: 'Remove one of your views (or any shared one, as an admin)',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid, viewId: uuid }),
    response: s.array(viewOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await c.query(
          'DELETE FROM activity_views WHERE id = $1 AND (owner_id = $2 OR ($3 AND shared))',
          [params.viewId, a.user.id, atLeast(a.role, 'admin')],
        );
        return { body: await viewsOf(c, a.user.id) };
      }),
  });

  // ── export ──
  const exportRoute = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/export',
    summary:
      'Every event of a query (up to 100 000) as CSV or JSON; the export itself is logged (member)',
    tags: ['activity'],
    params: wsParams,
    query: s.object({
      q: s.optional(s.string({ max: 500 })),
      mode: s.optional(s.enum(['all', 'mine'])),
      from: s.optional(s.string({ format: 'date-time' })),
      to: s.optional(s.string({ format: 'date-time' })),
      format: s.enum(['csv', 'json']),
    }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireFeature(c, a.workspaceId, 'audit-log', 'The audit log export'); // [PCODE-359 | S15 | v0.1.0]
        const { q, scope } = scopeOf(a, query);
        const where = whereOf(q, scope);
        const rows = (
          await c.query<{
            envelope: {
              id: string;
              time: string;
              type: string;
              data: {
                actor: { kind: string; name?: string };
                verb: string;
                object: { type: string; id: string; label?: string };
                parent?: { label?: string };
              };
            };
            key: string | null;
          }>(
            `SELECT e.envelope, (SELECT pr.key FROM projects pr WHERE pr.id::text = e.project_id) AS key FROM ${EVENTS_FROM(q.archive)} WHERE ${where.sql} ORDER BY e.time, e.sequence LIMIT 100000`,
            where.params,
          )
        ).rows;
        await c.query(
          'INSERT INTO activity_exports (workspace_id, requested_by, query, format, rows) VALUES ($1, $2, $3, $4, $5)',
          [a.workspaceId, a.user.id, query.q ?? '', query.format, rows.length],
        );
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const data =
          query.format === 'json'
            ? JSON.stringify(
                rows.map((r) => r.envelope),
                null,
                1,
              )
            : toCsv([
                [
                  'time',
                  'actor',
                  'actor kind',
                  'verb',
                  'object type',
                  'object',
                  'parent',
                  'project',
                  'event id',
                ],
                ...rows.map((r) => {
                  const d = r.envelope.data;
                  return [
                    r.envelope.time,
                    d.actor.name ?? '',
                    d.actor.kind,
                    d.verb,
                    d.object.type,
                    d.object.label ?? d.object.id,
                    d.parent?.label ?? '',
                    r.key ?? '',
                    r.envelope.id,
                  ];
                }),
              ]);
        return {
          body: {},
          file: {
            data: Buffer.from(data, 'utf8'),
            contentType: query.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
            name: 'activity-' + stamp + '.' + query.format,
          },
        };
      }),
  });

  // ── retention, archive, audit chain ──
  const settingsOut = s.object({
    retentionDays: s.number({ integer: true }),
    hot: s.number({ integer: true }),
    archived: s.number({ integer: true }),
    oldest: s.nullable(s.string()),
  });
  const settingsOf = async (c: PoolClient) => {
    const r = (
      await c.query<{ retention_days: number }>('SELECT retention_days FROM activity_settings')
    ).rows[0];
    const n = (
      await c.query<{ hot: string; arch: string; oldest: Date | null }>(
        'SELECT (SELECT count(*) FROM activity_events) AS hot, (SELECT count(*) FROM activity_archive) AS arch, (SELECT min(time) FROM activity_archive) AS oldest',
      )
    ).rows[0];
    return {
      retentionDays: r?.retention_days ?? 90,
      hot: Number(n?.hot ?? 0),
      archived: Number(n?.arch ?? 0),
      oldest: n?.oldest?.toISOString() ?? null,
    };
  };
  const getSettings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/settings',
    summary:
      'How long events stay searchable before they move to the archive, and how many are where (member)',
    tags: ['activity'],
    params: wsParams,
    response: settingsOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: await settingsOf(c),
      })),
  });
  const setSettings = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/activity/settings',
    summary: 'Set the retention of the hot tier (admin)',
    tags: ['activity'],
    params: wsParams,
    body: s.object({ retentionDays: s.number({ integer: true, min: 7, max: 3650 }) }),
    response: settingsOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await c.query(
          'INSERT INTO activity_settings (workspace_id, retention_days) VALUES ($1, $2) ON CONFLICT (workspace_id) DO UPDATE SET retention_days = $2, updated_at = now()',
          [a.workspaceId, body.retentionDays],
        );
        return { body: await settingsOf(c) };
      }),
  });
  const archiveNow = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/activity/archive',
    summary:
      'Move events past the retention to the archive now (it also happens every hour) (admin)',
    tags: ['activity'],
    params: wsParams,
    response: s.object({ moved: s.number({ integer: true }) }),
    handler: async ({ params, req }) => {
      const a = await asMember(pool, req, params.workspaceId, 'admin', (_c, acc) =>
        Promise.resolve(acc),
      );
      return { body: { moved: await archiveOld(pool, a.workspaceId) } };
    },
  });
  const verify = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/activity/verify',
    summary: 'Check the audit chain: every event’s hash must include the one before (admin)',
    tags: ['activity'],
    params: wsParams,
    response: s.object({
      checked: s.number({ integer: true }),
      unhashed: s.number({ integer: true }),
      firstBreak: s.nullable(s.number({ integer: true })),
      intact: s.boolean(),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = (
          await c.query<{ checked: string; unhashed: string; first_break: string | null }>(
            `WITH chain AS (
               SELECT sequence, hash, envelope, lag(hash) OVER (ORDER BY sequence) AS prev, lag(sequence) OVER (ORDER BY sequence) AS prev_seq
                 FROM (SELECT sequence, hash, envelope FROM activity_events UNION ALL SELECT sequence, hash, envelope FROM activity_archive) all_events)
             SELECT count(*) FILTER (WHERE hash IS NOT NULL) AS checked, count(*) FILTER (WHERE hash IS NULL) AS unhashed,
                    min(sequence) FILTER (WHERE hash IS NOT NULL AND (
                      hash <> encode(sha256(convert_to(coalesce(prev, '') || envelope::text, 'UTF8')), 'hex')
                      OR (prev_seq IS NOT NULL AND prev_seq <> sequence - 1))) AS first_break
               FROM chain`,
          )
        ).rows[0];
        const brk = r?.first_break ? Number(r.first_break) : null;
        return {
          body: {
            checked: Number(r?.checked ?? 0),
            unhashed: Number(r?.unhashed ?? 0),
            firstBreak: brk,
            intact: brk === null,
          },
        };
      }),
  });

  // ── webhooks ──
  const hookOut = s.object({
    id: s.string(),
    name: s.string(),
    url: s.string(),
    eventTypes: s.array(s.string()),
    query: s.string(),
    active: s.boolean(),
    failures: s.number({ integer: true }),
    cursor: s.number({ integer: true }),
    lastDelivery: s.nullable(
      s.object({
        status: s.string(),
        at: s.string(),
        error: s.string(),
        events: s.number({ integer: true }),
      }),
    ),
  });
  const hooksOf = async (c: PoolClient) =>
    (
      await c.query<{
        id: string;
        name: string;
        url: string;
        event_types: string[];
        query: string;
        active: boolean;
        failures: number;
        cursor: string;
        ls: string | null;
        la: Date | null;
        le: string | null;
        ln: number | null;
      }>(
        `SELECT w.id, w.name, w.url, w.event_types, w.query, w.active, w.failures, w.cursor, d.status AS ls, d.at AS la, d.error AS le, d.events AS ln
           FROM webhooks w LEFT JOIN LATERAL (SELECT status, at, error, events FROM webhook_deliveries x WHERE x.webhook_id = w.id ORDER BY at DESC LIMIT 1) d ON true
          ORDER BY w.created_at`,
      )
    ).rows.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      eventTypes: w.event_types,
      query: w.query,
      active: w.active,
      failures: w.failures,
      cursor: Number(w.cursor),
      lastDelivery:
        w.ls && w.la
          ? { status: w.ls, at: w.la.toISOString(), error: w.le ?? '', events: w.ln ?? 0 }
          : null,
    }));
  const hooks = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/webhooks',
    summary: 'The webhooks with their last delivery (admin)',
    tags: ['activity'],
    params: wsParams,
    response: s.array(hookOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({ body: await hooksOf(c) })),
  });
  const addHook = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/webhooks',
    summary:
      'A webhook for the events to come (not the past); its signing secret is shown once (admin)',
    tags: ['activity'],
    params: wsParams,
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      url: s.string({ min: 8, max: 500 }),
      eventTypes: s.optional(s.array(s.string({ pattern: /^[a-z_]{2,30}$/ }), { max: 20 })),
      query: s.optional(s.string({ max: 500 })),
    }),
    response: s.object({ id: s.string(), secret: s.string() }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        let url: URL;
        try {
          url = new URL(body.url.trim());
        } catch {
          throw new HttpError(400, 'invalid_request', 'Not an address', [
            { path: 'body.url', message: 'is not a URL' },
          ]);
        }
        if (url.protocol !== 'https:' || !(await isPublicUrl(url.toString())))
          throw new HttpError(400, 'invalid_request', 'A webhook goes to a public https address', [
            { path: 'body.url', message: 'is not a public https address' },
          ]);
        const q = parseActivityQuery(body.query ?? '');
        if (q.errors.length)
          throw new HttpError(400, 'invalid_request', q.errors.join('; '), [
            { path: 'body.query', message: q.errors[0] ?? '' },
          ]);
        const secret = 'whsec_' + randomBytes(24).toString('base64url');
        let sealed: string;
        try {
          sealed = seal(secret);
        } catch (e) {
          if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO webhooks (workspace_id, name, url, secret_ciphertext, event_types, query, cursor, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(max(sequence), 0) FROM activity_events WHERE workspace_id = $1), $7) RETURNING id`,
            [
              a.workspaceId,
              body.name.trim(),
              url.toString(),
              sealed,
              body.eventTypes ?? [],
              (body.query ?? '').trim(),
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('webhook insert returned nothing');
        return { status: 201, body: { id, secret } };
      }),
  });
  const changeHook = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/webhooks/:webhookId',
    summary: 'Switch a webhook on or off; on again, it continues where it stopped (admin)',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid, webhookId: uuid }),
    body: s.object({ active: s.boolean() }),
    response: s.array(hookOut),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const r = await c.query(
          'UPDATE webhooks SET active = $2, failures = CASE WHEN $2 THEN 0 ELSE failures END, next_attempt_at = now() WHERE id = $1',
          [params.webhookId, body.active],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Webhook not found');
        return { body: await hooksOf(c) };
      }),
  });
  const removeHook = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/webhooks/:webhookId',
    summary: 'Remove a webhook and its delivery log (admin)',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid, webhookId: uuid }),
    response: s.array(hookOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        await c.query('DELETE FROM webhooks WHERE id = $1', [params.webhookId]);
        return { body: await hooksOf(c) };
      }),
  });
  const deliveries = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/webhooks/:webhookId/deliveries',
    summary: 'The last deliveries of a webhook (admin)',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid, webhookId: uuid }),
    response: s.array(
      s.object({
        id: s.string(),
        status: s.string(),
        events: s.number({ integer: true }),
        fromSequence: s.number({ integer: true }),
        toSequence: s.number({ integer: true }),
        responseCode: s.nullable(s.number({ integer: true })),
        error: s.string(),
        durationMs: s.nullable(s.number({ integer: true })),
        at: s.string(),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: (
          await c.query<{
            id: string;
            status: string;
            events: number;
            from_sequence: string;
            to_sequence: string;
            response_code: number | null;
            error: string;
            duration_ms: number | null;
            at: Date;
          }>('SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY at DESC LIMIT 50', [
            params.webhookId,
          ])
        ).rows.map((d) => ({
          id: d.id,
          status: d.status,
          events: d.events,
          fromSequence: Number(d.from_sequence),
          toSequence: Number(d.to_sequence),
          responseCode: d.response_code,
          error: d.error,
          durationMs: d.duration_ms,
          at: d.at.toISOString(),
        })),
      })),
  });
  const sendNow = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/webhooks/:webhookId/send',
    summary: 'Send the waiting events now instead of at the next round (admin)',
    tags: ['activity'],
    params: s.object({ workspaceId: uuid, webhookId: uuid }),
    response: s.object({ sent: s.boolean() }),
    handler: async ({ params, req }) => {
      const hook = await asMember(
        pool,
        req,
        params.workspaceId,
        'admin',
        async (c) =>
          (
            await c.query<{
              id: string;
              workspace_id: string;
              url: string;
              secret_ciphertext: string;
              event_types: string[];
              query: string;
              cursor: string;
              failures: number;
            }>(
              'SELECT id, workspace_id, url, secret_ciphertext, event_types, query, cursor, failures FROM webhooks WHERE id = $1',
              [params.webhookId],
            )
          ).rows[0],
      );
      if (!hook) throw new HttpError(404, 'not_found', 'Webhook not found');
      return { body: { sent: await deliverOne(pool, hook) } };
    },
  });

  return [
    search,
    peak,
    story,
    one,
    views,
    saveView,
    removeView,
    exportRoute,
    getSettings,
    setSettings,
    archiveNow,
    verify,
    hooks,
    addHook,
    changeHook,
    removeHook,
    deliveries,
    sendNow,
  ];
}
