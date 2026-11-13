// ── [PCODE-436 | S15 | v0.1.0] T37 low: Untangle the three folder import cycles ──
// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
//    Why:  what the live shell needs from the server. The inbox is the person's own list of what waits for
//          them (filled by the dispatcher from events), with read, done, snooze and reopen. Notification
//          rules say which channels each kind reaches. Settings are stored per scope and read with the
//          scope they come from. The shell summary feeds the top bar: inbox count, agents at work, AI spend
//          today in euro (converted from the providers' dollars with the day's rate) and whether VS Code is
//          connected.
import { resolveSettings, settingDef, settingProblem, type SettingScope } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast, type Access, requireProjectAdmin } from './access.js';
import { FALLBACK_USD_EUR } from '../lib/money.js'; // [PCODE-436 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const wsParams = s.object({ workspaceId: uuid });

export const INBOX_KINDS = [
  'approval',
  'review',
  'mention',
  'question',
  'signoff',
  'request',
  'test',
  'incident',
  // [PCODE-249 | S15 | v0.1.0] budget and spend alerts, watched pages, reminders; messages filter too
  'message',
  'budget',
  'watch',
  'reminder',
  'security', // [PCODE-322 | S15 | v0.1.0] CVEs in shipped versions
] as const;
export const EVENT_KINDS = [
  'approvals',
  'gates',
  'deploys',
  'mentions',
  'requests',
  'incidents',
  'digest',
  // [PCODE-249 | S15 | v0.1.0]
  'budgets',
  'watching',
  'reminders',
  'security', // [PCODE-322 | S15 | v0.1.0]
] as const;
export const CHANNELS = ['in_app', 'email', 'push', 'slack', 'teams', 'ide'] as const;
const DEFAULT_CHANNELS = ['in_app', 'push'];
/** used when no rate of the day is stored yet */
// [PCODE-436 | S15 | v0.1.0] kept in lib/money, still exported here for those who import it from here
export { FALLBACK_USD_EUR };

const itemOut = s.object({
  id: s.string(),
  kind: s.string(),
  projectId: s.nullable(s.string()),
  projectKey: s.nullable(s.string()),
  objectType: s.string(),
  objectId: s.string(),
  title: s.string(),
  detail: s.string(),
  priority: s.string(),
  state: s.string(),
  snoozeUntil: s.nullable(s.string()),
  dueAt: s.nullable(s.string()),
  createdAt: s.string(),
  readAt: s.nullable(s.string()),
  url: s.string(),
});

interface ItemRow {
  id: string;
  kind: string;
  project_id: string | null;
  project_key: string | null;
  object_type: string;
  object_id: string;
  title: string;
  detail: string;
  priority: string;
  state: string;
  snooze_until: Date | null;
  due_at: Date | null;
  created_at: Date;
  read_at: Date | null;
  comment_item: string | null;
}

const ITEM_SELECT = `SELECT b.id, b.kind, b.project_id, p.key AS project_key, b.object_type, b.object_id, b.title, b.detail,
    b.priority, b.state, b.snooze_until, b.due_at, b.created_at, b.read_at, cm.item_id AS comment_item
  FROM inbox_items b
  LEFT JOIN projects p ON p.id = b.project_id
  LEFT JOIN comments cm ON b.object_type = 'comment' AND cm.id::text = b.object_id`;

/** The page an inbox entry opens. */
export function urlOf(
  r: Pick<ItemRow, 'object_type' | 'object_id' | 'project_id' | 'comment_item'> & { kind?: string },
): string {
  switch (r.object_type) {
    case 'agent_run':
      return '/runs/' + r.object_id;
    case 'gate':
      return '/projects/' + (r.project_id ?? r.object_id.split(':')[0] ?? '') + '/lifecycle';
    case 'deploy':
      return '/deploys/' + r.object_id;
    case 'comment':
      return r.comment_item ? '/items/' + r.comment_item : '/';
    case 'item':
      return '/items/' + r.object_id;
    // [PCODE-235 | S15 | v0.1.0] a mention or a direct message opens the conversation
    case 'channel':
      return '/messages/' + r.object_id;
    // [PCODE-249 | S15 | v0.1.0] alerts and reminders open where they can be acted on
    case 'budget':
    case 'spend':
      return '/tokens';
    case 'doc_page':
      // [PCODE-283 | S15 | v0.1.0] straight to the page
      return r.project_id ? '/projects/' + r.project_id + '/documents?page=' + r.object_id : '/';
    case 'feature_flag':
      return r.project_id ? '/projects/' + r.project_id + '/versions' : '/';
    case 'idea':
      // [PCODE-273 | S15 | v0.1.0] a question handed over opens the idea's questions in Ideation
      return r.kind === 'mention' && r.project_id
        ? '/projects/' + r.project_id + '/ideas?idea=' + r.object_id + '&sub=questions'
        : '/ideas/' + r.object_id;
    default:
      return '/';
  }
}

const itemJson = (r: ItemRow) => ({
  id: r.id,
  kind: r.kind,
  projectId: r.project_id,
  projectKey: r.project_key,
  objectType: r.object_type,
  objectId: r.object_id,
  title: r.title,
  detail: r.detail,
  priority: r.priority,
  state: r.state,
  snoozeUntil: r.snooze_until?.toISOString() ?? null,
  dueAt: r.due_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  readAt: r.read_at?.toISOString() ?? null,
  url: urlOf(r),
});

/** Snoozed entries whose time has come are open again. */
async function wake(c: PoolClient, userId: string): Promise<void> {
  await c.query(
    "UPDATE inbox_items SET state = 'open', snooze_until = NULL WHERE user_id = $1 AND state = 'snoozed' AND snooze_until <= now()",
    [userId],
  );
}

async function inboxCounts(c: PoolClient, userId: string) {
  const rows = (
    await c.query<{ state: string; kind: string; n: string; unread: string }>(
      `SELECT state, kind, count(*) AS n, count(*) FILTER (WHERE read_at IS NULL) AS unread
       FROM inbox_items WHERE user_id = $1 GROUP BY state, kind`,
      [userId],
    )
  ).rows;
  const byKind: Record<string, number> = {};
  let open = 0;
  let unread = 0;
  let snoozed = 0;
  let done = 0;
  for (const r of rows) {
    const n = Number(r.n);
    if (r.state === 'open') {
      open += n;
      unread += Number(r.unread);
      byKind[r.kind] = (byKind[r.kind] ?? 0) + n;
    } else if (r.state === 'snoozed') snoozed += n;
    else done += n;
  }
  return { open, unread, snoozed, done, byKind };
}

export function shellRoutes(pool: Pool): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/inbox',
    summary: 'What waits for the caller: open, snoozed or done entries, with counts',
    tags: ['inbox'],
    params: wsParams,
    query: s.object({
      state: s.optional(s.enum(['open', 'snoozed', 'done'])),
      kind: s.optional(s.enum(INBOX_KINDS)),
      projectId: s.optional(uuid),
    }),
    response: s.object({
      items: s.array(itemOut),
      counts: s.object({
        open: s.number({ integer: true }),
        unread: s.number({ integer: true }),
        snoozed: s.number({ integer: true }),
        done: s.number({ integer: true }),
        byKind: s.anyObject(),
      }),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await wake(c, a.user.id);
        const rows = (
          await c.query<ItemRow>(
            ITEM_SELECT +
              ` WHERE b.user_id = $1 AND b.state = $2 AND ($3::text IS NULL OR b.kind = $3) AND ($4::uuid IS NULL OR b.project_id = $4)
                ORDER BY CASE b.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, b.created_at DESC LIMIT 200`,
            [a.user.id, query.state ?? 'open', query.kind ?? null, query.projectId ?? null],
          )
        ).rows;
        return { body: { items: rows.map(itemJson), counts: await inboxCounts(c, a.user.id) } };
      }),
  });

  const act = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/inbox/:itemId',
    summary: 'Mark an entry read, done, snoozed until a time, or open again',
    tags: ['inbox'],
    params: s.object({ workspaceId: uuid, itemId: uuid }),
    body: s.object({
      action: s.enum(['read', 'done', 'snooze', 'reopen']),
      until: s.optional(s.string({ format: 'date-time' })),
    }),
    response: itemOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        if (body.action === 'snooze' && (!body.until || Date.parse(body.until) <= Date.now()))
          throw new HttpError(400, 'invalid_request', 'Snooze needs a time in the future', [
            { path: 'body.until', message: 'must be in the future' },
          ]);
        const set: Record<typeof body.action, string> = {
          read: 'read_at = coalesce(read_at, now())',
          done: "state = 'done', done_at = now(), read_at = coalesce(read_at, now()), snooze_until = NULL",
          snooze: "state = 'snoozed', snooze_until = $3, read_at = coalesce(read_at, now())",
          reopen: "state = 'open', done_at = NULL, snooze_until = NULL",
        };
        const r = await c.query(
          'UPDATE inbox_items SET ' + set[body.action] + ' WHERE id = $1 AND user_id = $2',
          body.action === 'snooze'
            ? [params.itemId, a.user.id, body.until]
            : [params.itemId, a.user.id],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Inbox entry not found');
        const row = (await c.query<ItemRow>(ITEM_SELECT + ' WHERE b.id = $1', [params.itemId]))
          .rows[0];
        if (!row) throw new Error('inbox entry vanished');
        return { body: itemJson(row) };
      }),
  });

  const readAll = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/inbox/read-all',
    summary: 'Mark every open entry as read',
    tags: ['inbox'],
    params: wsParams,
    response: s.object({ updated: s.number({ integer: true }) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const r = await c.query(
          "UPDATE inbox_items SET read_at = now() WHERE user_id = $1 AND state = 'open' AND read_at IS NULL",
          [a.user.id],
        );
        return { body: { updated: r.rowCount ?? 0 } };
      }),
  });

  const ruleOut = s.object({ eventKind: s.string(), channels: s.array(s.string()) });

  const rules = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/notification-rules',
    summary: 'Which channels each kind of notification reaches, for the caller',
    tags: ['notifications'],
    params: wsParams,
    response: s.object({ channels: s.array(s.string()), rules: s.array(ruleOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const stored = (
          await c.query<{ event_kind: string; channels: string[] }>(
            'SELECT event_kind, channels FROM notification_rules WHERE user_id = $1',
            [a.user.id],
          )
        ).rows;
        return {
          body: {
            channels: [...CHANNELS],
            rules: EVENT_KINDS.map((k) => ({
              eventKind: k,
              channels:
                stored.find((r) => r.event_kind === k)?.channels ??
                (k === 'digest' ? ['email'] : DEFAULT_CHANNELS),
            })),
          },
        };
      }),
  });

  const setRule = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/notification-rules/:eventKind',
    summary: 'Choose the channels for one kind of notification',
    tags: ['notifications'],
    params: s.object({ workspaceId: uuid, eventKind: s.enum(EVENT_KINDS) }),
    body: s.object({ channels: s.array(s.enum(CHANNELS), { max: CHANNELS.length }) }),
    response: ruleOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const channels = [...new Set(body.channels)];
        await c.query(
          `INSERT INTO notification_rules (workspace_id, user_id, event_kind, channels) VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, user_id, event_kind) DO UPDATE SET channels = $4`,
          [a.workspaceId, a.user.id, params.eventKind, channels],
        );
        return { body: { eventKind: params.eventKind, channels } };
      }),
  });

  const settingOut = s.object({
    key: s.string(),
    label: s.string(),
    kind: s.string(),
    value: s.json(),
    source: s.string(),
    scopes: s.array(s.string()),
  });

  /** The ids of the scopes a request reads: the workspace, maybe a team and a project, and the caller. */
  const scopeIds = (
    a: Access,
    teamId?: string,
    projectId?: string,
  ): Record<SettingScope, string | null> => ({
    workspace: a.workspaceId,
    team: teamId ?? null,
    project: projectId ?? null,
    user: a.user.id,
  });

  const getSettings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/settings',
    summary: 'Every setting with its effective value and where that value comes from',
    tags: ['settings'],
    params: wsParams,
    query: s.object({ teamId: s.optional(uuid), projectId: s.optional(uuid) }),
    response: s.array(settingOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const ids = scopeIds(a, query.teamId, query.projectId);
        const stored = (
          await c.query<{ scope_type: SettingScope; key: string; value: unknown }>(
            `SELECT scope_type, key, value FROM settings
             WHERE (scope_type = 'workspace' AND scope_id = $1) OR (scope_type = 'team' AND scope_id = $2)
                OR (scope_type = 'project' AND scope_id = $3) OR (scope_type = 'user' AND scope_id = $4)`,
            [ids.workspace, ids.team, ids.project, ids.user],
          )
        ).rows;
        const eff = resolveSettings(
          stored.map((r) => ({ scope: r.scope_type, key: r.key, value: r.value })),
        );
        return {
          body: eff.map((e) => {
            const def = settingDef(e.key);
            return {
              key: e.key,
              label: def?.label ?? e.key,
              kind: def?.kind ?? 'string',
              value: e.value,
              source: e.source,
              scopes: [...(def?.scopes ?? [])],
            };
          }),
        };
      }),
  });

  /**
   * Who may set a value at a scope: admins for shared scopes, everyone for themselves; and ([PCODE-351 | S15 | v0.1.0])
   * a project's lead for the project, a team's lead for the team.
   */
  const mayWrite = async (
    c: PoolClient,
    a: Access,
    scope: SettingScope,
    scopeId: string,
  ): Promise<void> => {
    if (scope === 'user') {
      if (scopeId !== a.user.id)
        throw new HttpError(403, 'forbidden', 'You set only your own personal settings');
      return;
    }
    if (atLeast(a.role, 'admin')) return;
    if (scope === 'project') {
      await requireProjectAdmin(c, a, scopeId);
      return;
    }
    if (
      scope === 'team' &&
      (
        await c.query(
          'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 AND is_lead',
          [scopeId, a.user.id],
        )
      ).rowCount
    )
      return;
    throw new HttpError(403, 'forbidden', 'Only admins change shared settings');
  };

  const target = s.object({
    scope: s.enum(['workspace', 'team', 'project', 'user']),
    scopeId: s.optional(uuid),
  });

  const setSetting = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/settings/:key',
    summary: 'Set a value at one scope (workspace, team, project or yourself)',
    tags: ['settings'],
    params: s.object({ workspaceId: uuid, key: s.string({ max: 80 }) }),
    body: s.object({
      scope: s.enum(['workspace', 'team', 'project', 'user']),
      scopeId: s.optional(uuid),
      value: s.json(),
    }),
    response: s.object({
      key: s.string(),
      scope: s.string(),
      scopeId: s.string(),
      value: s.json(),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const def = settingDef(params.key);
        if (!def) throw new HttpError(404, 'not_found', 'No such setting');
        if (!def.scopes.includes(body.scope))
          throw new HttpError(
            400,
            'invalid_request',
            def.label + ' can be set only for: ' + def.scopes.join(', '),
          );
        const problem = settingProblem(def, body.value);
        if (problem)
          throw new HttpError(400, 'invalid_request', def.label + ' ' + problem, [
            { path: 'body.value', message: problem },
          ]);
        const scopeId =
          body.scope === 'workspace'
            ? a.workspaceId
            : body.scope === 'user'
              ? (body.scopeId ?? a.user.id)
              : body.scopeId;
        if (!scopeId)
          throw new HttpError(400, 'invalid_request', 'Name the ' + body.scope, [
            { path: 'body.scopeId', message: 'is required' },
          ]);
        await mayWrite(c, a, body.scope, scopeId);
        const before = (
          await c.query<{ value: unknown }>(
            'SELECT value FROM settings WHERE scope_type = $1 AND scope_id = $2 AND key = $3',
            [body.scope, scopeId, def.key],
          )
        ).rows[0]?.value;
        await c.query(
          `INSERT INTO settings (workspace_id, scope_type, scope_id, key, value, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, scope_type, scope_id, key) DO UPDATE SET value = $5, updated_by = $6, updated_at = now()`,
          [a.workspaceId, body.scope, scopeId, def.key, JSON.stringify(body.value), a.user.id],
        );
        if (body.scope !== 'user')
          await recordEvent(c, a.workspaceId, {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'workspace', id: a.workspaceId, label: def.label },
            changes: {
              ['setting:' + def.key + '@' + body.scope]: { from: before ?? null, to: body.value },
            },
          });
        return { body: { key: def.key, scope: body.scope, scopeId, value: body.value } };
      }),
  });

  const clearSetting = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/settings/:key',
    summary: 'Remove the value set at one scope, so the next scope up applies again',
    tags: ['settings'],
    params: s.object({ workspaceId: uuid, key: s.string({ max: 80 }) }),
    query: target,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const scopeId =
          query.scope === 'workspace'
            ? a.workspaceId
            : query.scope === 'user'
              ? (query.scopeId ?? a.user.id)
              : query.scopeId;
        if (!scopeId) throw new HttpError(400, 'invalid_request', 'Name the ' + query.scope);
        await mayWrite(c, a, query.scope, scopeId);
        const r = await c.query(
          'DELETE FROM settings WHERE scope_type = $1 AND scope_id = $2 AND key = $3',
          [query.scope, scopeId, params.key],
        );
        return { body: { removed: Boolean(r.rowCount) } };
      }),
  });

  const summary = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/shell',
    summary: 'The top bar: inbox count, agents at work, AI spend today in euro, VS Code connection',
    tags: ['shell'],
    params: wsParams,
    response: s.object({
      role: s.string(),
      inbox: s.object({ open: s.number({ integer: true }), unread: s.number({ integer: true }) }),
      agents: s.object({
        running: s.number({ integer: true }),
        waiting: s.number({ integer: true }),
        queued: s.number({ integer: true }),
      }),
      spend: s.object({
        todayCents: s.number({ integer: true }),
        monthCents: s.number({ integer: true }),
        usdEur: s.number(),
        rateDate: s.nullable(s.string()),
        rateSource: s.string(),
      }),
      ide: s.object({ connected: s.boolean(), lastSeen: s.nullable(s.string()) }),
    }),
    handler: async ({ params, req }) => {
      const base = await asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await wake(c, a.user.id);
        const counts = await inboxCounts(c, a.user.id);
        const runs = (
          await c.query<{ status: string; n: string }>(
            "SELECT status, count(*) AS n FROM agent_runs WHERE status IN ('running', 'waiting', 'queued') GROUP BY status",
          )
        ).rows;
        const n = (st: string): number => Number(runs.find((r) => r.status === st)?.n ?? 0);
        // a guest (and later a client) sees no agent spend
        const spend = atLeast(a.role, 'member')
          ? (
              await c.query<{ today: string | null; month: string | null }>(
                `SELECT sum(cost_micros) FILTER (WHERE created_at >= date_trunc('day', now())) AS today,
                        sum(cost_micros) FILTER (WHERE created_at >= date_trunc('month', now())) AS month
                 FROM agent_runs`,
              )
            ).rows[0]
          : undefined;
        return {
          role: a.role,
          userId: a.user.id,
          inbox: { open: counts.open, unread: counts.unread },
          agents: atLeast(a.role, 'member')
            ? { running: n('running'), waiting: n('waiting'), queued: n('queued') }
            : { running: 0, waiting: 0, queued: 0 },
          todayMicros: Number(spend?.today ?? 0),
          monthMicros: Number(spend?.month ?? 0),
        };
      });
      const { rate, ide } = await inSystem(pool, async (c) => {
        const fx = (
          await c.query<{ day: Date; usd_eur: string; source: string }>(
            'SELECT day, usd_eur, source FROM fx_rates WHERE day <= current_date ORDER BY day DESC LIMIT 1',
          )
        ).rows[0];
        const used = (
          await c.query<{ last: Date | null }>(
            'SELECT max(last_used_at) AS last FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL',
            [base.userId],
          )
        ).rows[0]?.last;
        return { rate: fx, ide: used ?? null };
      });
      const usdEur = rate ? Number(rate.usd_eur) : FALLBACK_USD_EUR;
      // agent costs are kept in millionths of a US dollar; the top bar shows euro cents
      const cents = (micros: number): number => Math.round((micros / 10_000) * usdEur);
      return {
        body: {
          role: base.role,
          inbox: base.inbox,
          agents: base.agents,
          spend: {
            todayCents: cents(base.todayMicros),
            monthCents: cents(base.monthMicros),
            usdEur,
            rateDate: rate ? rate.day.toISOString().slice(0, 10) : null,
            rateSource: rate ? rate.source : 'default rate, no daily rate stored',
          },
          ide: {
            connected: Boolean(ide && Date.now() - ide.getTime() < 10 * 60_000),
            lastSeen: ide?.toISOString() ?? null,
          },
        },
      };
    },
  });

  return [list, readAll, act, rules, setRule, getSettings, setSetting, clearSetting, summary];
}
