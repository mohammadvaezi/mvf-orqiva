// ── [PCODE-250 | S15 | v0.1.0] T25.5 Profiles, GDPR export and erasure, version check on task edits ──
//    Why:  a person's profile in a workspace (title, skills, capacity, focus factor, time zone, working and
//          quiet hours) is theirs to keep up; the manager and the cost rate are the admins', and colleagues
//          see the profile without the cost rate. Under the GDPR a person gets everything Orqiva keeps about
//          them, and a person who left can be erased. The export finds every table that names a person
//          (user_id, author_id, created_by, assignee_id, requested_by), so a table added later is in it
//          without anyone remembering to; secrets (password and token hashes, push keys, second-factor
//          seeds) never leave. Erasure keeps the work, which belongs to the team, under "Erased person", and
//          removes the rest: the account itself only when the person belongs to no other workspace.
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { zip, type ZipEntry } from '../export/zip.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast, requireUser } from './access.js';

const uuid = s.string({ format: 'uuid' });
const memberParams = s.object({ workspaceId: uuid, userId: uuid });

// ── profiles ──

const time = s.string({ pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
const profileOut = s.object({
  userId: s.string(),
  name: s.string(),
  title: s.string(),
  skills: s.array(s.string()),
  capacityHoursWeek: s.number(),
  focusFactor: s.number(),
  timezone: s.string(),
  workingHours: s.anyObject(),
  quietHours: s.anyObject(),
  managerId: s.nullable(s.string()),
  managerName: s.nullable(s.string()),
  // only for admins and the person themselves
  costRateCents: s.optional(s.nullable(s.number({ integer: true }))),
  updatedAt: s.nullable(s.string()),
});

interface ProfileRow {
  user_id: string;
  name: string;
  title: string | null;
  skills: string[] | null;
  capacity_hours_week: string | null;
  focus_factor: string | null;
  timezone: string | null;
  working_hours: Record<string, unknown> | null;
  quiet_hours: Record<string, unknown> | null;
  manager_id: string | null;
  manager_name: string | null;
  cost_rate_cents: string | null;
  updated_at: Date | null;
}

const DEFAULT_QUIET = { from: '20:00', to: '07:30', except: ['incident'] };

async function profileOf(c: PoolClient, userId: string, withCost: boolean) {
  const r = (
    await c.query<ProfileRow>(
      `SELECT m.user_id, u.name, p.title, p.skills, p.capacity_hours_week, p.focus_factor, p.timezone,
              p.working_hours, p.quiet_hours, p.manager_id, mu.name AS manager_name, p.cost_rate_cents, p.updated_at
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN member_profiles p ON p.user_id = m.user_id
         LEFT JOIN users mu ON mu.id = p.manager_id
        WHERE m.user_id = $1`,
      [userId],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Member not found');
  return {
    userId: r.user_id,
    name: r.name,
    title: r.title ?? '',
    skills: r.skills ?? [],
    capacityHoursWeek: Number(r.capacity_hours_week ?? 40),
    focusFactor: Number(r.focus_factor ?? 0.75),
    timezone: r.timezone ?? 'Europe/Berlin',
    workingHours: r.working_hours ?? {},
    quietHours: r.quiet_hours ?? DEFAULT_QUIET,
    managerId: r.manager_id,
    managerName: r.manager_name,
    ...(withCost
      ? { costRateCents: r.cost_rate_cents === null ? null : Number(r.cost_rate_cents) }
      : {}),
    updatedAt: r.updated_at?.toISOString() ?? null,
  };
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function checkHours(v: Record<string, unknown>, path: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const [day, span] of Object.entries(v)) {
    const ok =
      DAYS.includes(day) &&
      Array.isArray(span) &&
      span.length === 2 &&
      span.every((x) => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x)) &&
      (span[0] as string) < (span[1] as string);
    if (!ok)
      throw new HttpError(
        400,
        'invalid_request',
        'Working hours are a day and two times, e.g. "mon": ["08:00", "17:00"]',
        [{ path: path + '.' + day, message: 'is not a span of the day' }],
      );
    out[day] = span as [string, string];
  }
  return out;
}

function validZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

// ── the export ──

/** Tables kept out of every export: secrets, or bookkeeping that says nothing about the person. */
const SKIP_TABLES = new Set([
  'user_totp',
  'user_recovery_codes',
  'password_resets',
  'oidc_login_states',
  'saml_requests',
  'push_sent',
  'instance_keys',
  'schema_migrations',
]);
/** Columns never exported, wherever they are. */
const SECRET_COLUMNS = [
  'password_hash',
  'token_hash',
  'code_hash',
  'secret',
  'secret_ciphertext',
  'key_ciphertext',
  'p256dh',
  'auth',
  'webhook_secret',
];
const PERSON_COLUMNS = [
  'user_id',
  'author_id',
  'created_by',
  'assignee_id',
  'requested_by',
  'owner_id',
];
const MAX_ROWS = 10_000;

/** Every row that names the person, table by table; one workspace, or all of theirs. */
export async function personalExport(
  c: PoolClient,
  userId: string,
  workspaceId: string | null,
): Promise<ZipEntry[]> {
  const cols = (
    await c.query<{ table_name: string; column_name: string; has_ws: boolean }>(
      `SELECT k.table_name, k.column_name,
              EXISTS (SELECT 1 FROM information_schema.columns w WHERE w.table_schema = 'public'
                       AND w.table_name = k.table_name AND w.column_name = 'workspace_id') AS has_ws
         FROM information_schema.columns k JOIN information_schema.tables t
           ON t.table_schema = k.table_schema AND t.table_name = k.table_name AND t.table_type = 'BASE TABLE'
        WHERE k.table_schema = 'public' AND k.column_name = ANY($1::text[]) AND k.data_type = 'uuid'
        ORDER BY k.table_name, k.column_name`,
      [PERSON_COLUMNS],
    )
  ).rows.filter((r) => !SKIP_TABLES.has(r.table_name) && r.table_name !== 'users');
  const out: ZipEntry[] = [];
  const json = (v: unknown): Buffer => Buffer.from(JSON.stringify(v, null, 2) + '\n', 'utf8');
  const account = (
    await c.query<{ id: string; email: string; name: string; created_at: Date }>(
      'SELECT id, email, name, created_at FROM users WHERE id = $1',
      [userId],
    )
  ).rows[0];
  if (!account) throw new HttpError(404, 'not_found', 'Person not found');
  out.push({ name: 'account.json', data: json(account) });
  const files: { file: string; rows: number }[] = [];
  const tables = new Map<string, { columns: string[]; hasWs: boolean }>();
  for (const r of cols) {
    const t = tables.get(r.table_name) ?? { columns: [], hasWs: r.has_ws };
    t.columns.push(r.column_name);
    tables.set(r.table_name, t);
  }
  for (const [table, t] of tables) {
    // a table without a workspace column belongs to the account (sessions, devices): only in the full export
    if (workspaceId && !t.hasWs) continue;
    const who = t.columns.map((col) => 'x.' + col + ' = $1').join(' OR ');
    const rows = (
      await c.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(x) - $2::text[] AS row FROM ${table} x WHERE (${who})` +
          (workspaceId ? ' AND x.workspace_id = $3' : '') +
          ' LIMIT ' +
          String(MAX_ROWS),
        workspaceId ? [userId, SECRET_COLUMNS, workspaceId] : [userId, SECRET_COLUMNS],
      )
    ).rows.map((r) => r.row);
    if (!rows.length) continue;
    out.push({ name: table + '.json', data: json(rows) });
    files.push({ file: table + '.json', rows: rows.length });
  }
  const acts = (
    await c.query<{ row: Record<string, unknown> }>(
      `SELECT jsonb_build_object('time', time, 'type', type, 'object', envelope->'data'->'object', 'changes', envelope->'data'->'changes') AS row
         FROM activity_events WHERE actor_id = $1::text` +
        (workspaceId ? ' AND workspace_id = $2' : '') +
        ' ORDER BY time DESC LIMIT ' +
        String(MAX_ROWS),
      workspaceId ? [userId, workspaceId] : [userId],
    )
  ).rows.map((r) => r.row);
  if (acts.length) {
    out.push({ name: 'activity.json', data: json(acts) });
    files.push({ file: 'activity.json', rows: acts.length });
  }
  out.unshift({
    name: 'README.txt',
    data: Buffer.from(
      [
        'Everything Orqiva keeps about ' + account.name + ' <' + account.email + '>',
        workspaceId
          ? 'in one workspace, exported by an admin.'
          : 'in every workspace, exported by them.',
        'Exported ' + new Date().toISOString() + '. One JSON file per kind of record:',
        '',
        'account.json: the account',
        ...files.map(
          (f) =>
            f.file +
            ': ' +
            String(f.rows) +
            ' rows' +
            (f.rows >= MAX_ROWS ? ' (the newest ' + String(MAX_ROWS) + ')' : ''),
        ),
        '',
        'Passwords, token hashes, second-factor seeds and device keys are never exported.',
        '',
      ].join('\n'),
      'utf8',
    ),
  });
  return out;
}

const zipName = (name: string): string =>
  'orqiva-personal-data-' +
  (name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'person') +
  '-' +
  new Date().toISOString().slice(0, 10) +
  '.zip';

// ── erasure ──

export const ERASED_NAME = 'Erased person';

/** Removes a person's personal data from the workspace, and the account when nothing else holds it. */
async function erase(
  c: PoolClient,
  workspaceId: string,
  userId: string,
): Promise<{ accountErased: boolean; otherWorkspaces: number }> {
  const others = Number(
    (
      await c.query<{ n: string }>(
        'SELECT count(*) AS n FROM workspace_members WHERE user_id = $1 AND workspace_id <> $2',
        [userId, workspaceId],
      )
    ).rows[0]?.n ?? 0,
  );
  const inWs = [
    'member_profiles',
    'notification_rules',
    'inbox_items',
    'project_members',
    'team_members',
    'doc_watchers',
    'doc_watch_pending',
    'channel_members',
    'client_contacts',
    'project_guests',
  ];
  for (const t of inWs)
    await c.query(`DELETE FROM ${t} WHERE user_id = $1 AND workspace_id = $2`, [
      userId,
      workspaceId,
    ]);
  await c.query(
    "DELETE FROM settings WHERE workspace_id = $2 AND scope_type = 'user' AND scope_id = $1",
    [userId, workspaceId],
  );
  // private conversations: what they wrote in direct messages goes
  await c.query(
    `DELETE FROM messages m USING channels ch
      WHERE ch.id = m.channel_id AND ch.kind = 'direct' AND m.author_id = $1 AND m.workspace_id = $2`,
    [userId, workspaceId],
  );
  await c.query('DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [
    userId,
    workspaceId,
  ]);
  if (others > 0) return { accountErased: false, otherWorkspaces: others };
  for (const t of [
    'sessions',
    'api_tokens',
    'user_totp',
    'user_recovery_codes',
    'push_subscriptions',
    'push_preferences',
    'oidc_identities',
    'saml_identities',
    'device_pairings',
    'password_resets',
    'work_sessions',
  ])
    await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId]);
  await c.query('UPDATE users SET name = $2, email = $3, password_hash = NULL WHERE id = $1', [
    userId,
    ERASED_NAME,
    'erased-' + userId + '@erased.invalid',
  ]);
  return { accountErased: true, otherWorkspaces: 0 };
}

export function privacyRoutes(pool: Pool): Route[] {
  const getProfile = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/members/:userId/profile',
    summary: "A member's profile; the cost rate only for admins and the person (member)",
    tags: ['people'],
    params: memberParams,
    response: profileOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => ({
        body: await profileOf(
          c,
          params.userId,
          atLeast(a.role, 'admin') || a.user.id === params.userId,
        ),
      })),
  });

  const setProfile = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/members/:userId/profile',
    summary:
      'Change a profile: your own, or anyone’s as an admin; manager and cost rate only by admins',
    tags: ['people'],
    params: memberParams,
    body: s.object({
      title: s.optional(s.string({ max: 120 })),
      skills: s.optional(s.array(s.string({ min: 1, max: 40 }), { max: 30 })),
      capacityHoursWeek: s.optional(s.number({ min: 0, max: 80 })),
      focusFactor: s.optional(s.number({ min: 0, max: 1 })),
      timezone: s.optional(s.string({ min: 1, max: 64 })),
      workingHours: s.optional(s.anyObject()),
      quietHours: s.optional(
        s.object({
          from: s.optional(time),
          to: s.optional(time),
          except: s.optional(s.array(s.string({ max: 20 }), { max: 20 })),
        }),
      ),
      managerId: s.optional(s.nullable(uuid)),
      costRateCents: s.optional(s.nullable(s.number({ integer: true, min: 0, max: 10_000_000 }))),
    }),
    response: profileOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const admin = atLeast(a.role, 'admin');
        if (!admin && a.user.id !== params.userId)
          throw new HttpError(403, 'forbidden', 'Only an admin changes someone else’s profile');
        if (!admin && (body.managerId !== undefined || body.costRateCents !== undefined))
          throw new HttpError(
            403,
            'forbidden',
            'The manager and the cost rate are set by an admin',
          );
        if (body.timezone && !validZone(body.timezone))
          throw new HttpError(400, 'invalid_request', 'Not a time zone: ' + body.timezone, [
            { path: 'body.timezone', message: 'is not an IANA time zone such as Europe/Berlin' },
          ]);
        const hours = body.workingHours ? checkHours(body.workingHours, 'body.workingHours') : null;
        if (body.managerId === params.userId)
          throw new HttpError(400, 'invalid_request', 'Nobody is their own manager', [
            { path: 'body.managerId', message: 'is the person' },
          ]);
        if (
          body.managerId &&
          !(await c.query('SELECT 1 FROM workspace_members WHERE user_id = $1', [body.managerId]))
            .rowCount
        )
          throw new HttpError(400, 'invalid_request', 'The manager is not a member', [
            { path: 'body.managerId', message: 'is not a member of the workspace' },
          ]);
        const before = await profileOf(c, params.userId, true);
        await c.query(
          `INSERT INTO member_profiles (workspace_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [a.workspaceId, params.userId],
        );
        await c.query(
          `UPDATE member_profiles SET
             title = coalesce($2, title), skills = coalesce($3, skills),
             capacity_hours_week = coalesce($4, capacity_hours_week), focus_factor = coalesce($5, focus_factor),
             timezone = coalesce($6, timezone), working_hours = coalesce($7, working_hours),
             quiet_hours = coalesce($8, quiet_hours),
             manager_id = CASE WHEN $9 THEN $10::uuid ELSE manager_id END,
             cost_rate_cents = CASE WHEN $11 THEN $12::bigint ELSE cost_rate_cents END,
             updated_at = now()
           WHERE user_id = $1`,
          [
            params.userId,
            body.title?.trim() ?? null,
            body.skills ? [...new Set(body.skills.map((x) => x.trim()).filter(Boolean))] : null,
            body.capacityHoursWeek ?? null,
            body.focusFactor ?? null,
            body.timezone ?? null,
            hours ? JSON.stringify(hours) : null,
            body.quietHours ? JSON.stringify({ ...before.quietHours, ...body.quietHours }) : null,
            body.managerId !== undefined,
            body.managerId ?? null,
            body.costRateCents !== undefined,
            body.costRateCents ?? null,
          ],
        );
        const after = await profileOf(c, params.userId, true);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const k of [
          'title',
          'skills',
          'capacityHoursWeek',
          'focusFactor',
          'timezone',
          'managerName',
        ] as const)
          if (JSON.stringify(before[k]) !== JSON.stringify(after[k]))
            changes[k] = { from: before[k], to: after[k] };
        // the rate itself stays out of the history every member reads
        if (before.costRateCents !== after.costRateCents)
          changes['costRate'] = { from: null, to: 'changed' };
        if (Object.keys(changes).length)
          await recordEvent(c, a.workspaceId, {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'member', id: params.userId, label: after.name },
            changes,
          });
        return { body: after };
      }),
  });

  const exportMine = route({
    method: 'GET',
    path: '/auth/me/export',
    summary: 'Everything Orqiva keeps about you, in every workspace: a ZIP of JSON files',
    tags: ['auth'],
    response: s.anyObject(),
    handler: async ({ req }) => {
      const me = await requireUser(pool, req);
      const entries = await inSystem(pool, (c) => personalExport(c, me.id, null));
      return {
        body: {},
        file: { data: zip(entries), contentType: 'application/zip', name: zipName(me.name) },
      };
    },
  });

  const exportMember = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/members/:userId/export',
    summary: 'Everything this workspace keeps about a member, for a request under the GDPR (admin)',
    tags: ['people'],
    params: memberParams,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const m = (
          await c.query<{ name: string }>(
            'SELECT u.name FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
            [params.userId],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'member', id: params.userId, label: m.name },
          changes: { personalData: { from: null, to: 'exported' } },
        });
        const entries = await inSystem(pool, (sc) =>
          personalExport(sc, params.userId, params.workspaceId),
        );
        return {
          body: {},
          file: { data: zip(entries), contentType: 'application/zip', name: zipName(m.name) },
        };
      }),
  });

  const eraseMember = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/members/:userId/erase',
    summary:
      'Erase a person who left: their personal data goes, their work stays under "Erased person" (owner)',
    tags: ['people'],
    params: memberParams,
    body: s.object({ confirm: s.string({ min: 1, max: 200 }) }),
    response: s.object({
      accountErased: s.boolean(),
      otherWorkspaces: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'owner', async (c, a) => {
        const m = (
          await c.query<{ name: string; suspended_at: Date | null; role: string }>(
            'SELECT u.name, m.suspended_at, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1',
            [params.userId],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Member not found');
        if (!m.suspended_at)
          throw new HttpError(
            409,
            'conflict',
            'Offboard ' + m.name + ' first: their work is handed over before their data goes',
          );
        if (body.confirm.trim() !== m.name)
          throw new HttpError(400, 'invalid_request', 'Type the person’s name to confirm', [
            { path: 'body.confirm', message: 'is not ' + m.name },
          ]);
        const out = await inSystem(pool, (sc) => erase(sc, params.workspaceId, params.userId));
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'deleted',
          object: { type: 'member', id: params.userId, label: ERASED_NAME },
          changes: {
            personalData: {
              from: null,
              to: out.accountErased ? 'erased with the account' : 'erased in this workspace',
            },
          },
        });
        return { body: out };
      }),
  });

  return [getProfile, setProfile, exportMine, exportMember, eraseMember];
}
