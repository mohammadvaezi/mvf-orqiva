// ── [PCODE-466 | S15 | v0.1.0] Every task shows its work record: AI, model, tokens, price, time and version, in VS Code and the portal ──
// ── [PCODE-464 | S15 | v0.1.0] The active task follows its state: moved out of In Progress in the portal, it is no longer active in VS Code ──
// ── [PCODE-462 | S15 | v0.1.0] Tasks run in plan order, finish by themselves, and show the same state in VS Code and the portal ──
// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-102 | S15 | v0.1.0] Port the engine's loop to the server: sync, start, status, note, done ──
//    Why:  the development loop of v0.1.0, now kept by Orqiva itself instead of the Python engine and
//          Plane. The rules are the engine's: a task needs a real description before work starts; one
//          active task per person per client (machine and repository); start moves it to In Progress;
//          green tests move it to Test; done needs fingerprinted files (unless forced) and moves it to
//          Review, or Done when the project does not review. Every step writes the comment the engine
//          wrote (Started, Working, Commit, Tests, Done) and an activity event, so boards show it live.
// ── [PCODE-104 | S15 | v0.1.0] Move the fingerprint scanner and index into the server; every loop step emits an event ──
import type { ActivityData, Verb } from '@orqiva/shared';
import { addSessionUsage, endSessionRuns } from './workrecord.js'; // [PCODE-466 | S15 | v0.1.0]
import { startSprintWithTask, waitingFor, waitMessage } from './taskorder.js'; // [PCODE-462 | S15 | v0.1.0]
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { storeFingerprints } from './fingerprints.js';
import { kitRuleFor } from './kitcode.js'; // [PCODE-290 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const ref = s.string({ pattern: /^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,9}$/ });
const client = s.string({ min: 1, max: 300 });
const wsParams = s.object({ workspaceId: uuid });

export interface LoopRules {
  reviewBeforeDone: boolean;
  autoTestState: boolean;
  unguardedPaths: string[];
  agent?: { name: string; files: string[]; branches: string[] }; // [PCODE-247 | S15 | v0.1.0]
  kit?: string; // [PCODE-290 | S15 | v0.1.0] the UI kit rule, when the project has a kit
}
/** [PCODE-290 | S15 | v0.1.0] the kit rule for the coding tool, when the project has tokens or components */
async function kitOf(c: PoolClient, projectId: string): Promise<{ kit?: string }> {
  const rule = await kitRuleFor(c, projectId);
  return rule ? { kit: rule } : {};
}

export const MIN_DESCRIPTION = 40;

export type Intent = 'progress' | 'review' | 'test' | 'blocked' | 'todo' | 'backlog' | 'done';
const INTENT_STATE: Record<Intent, { name: string; group: string }> = {
  progress: { name: 'in progress', group: 'started' },
  review: { name: 'review', group: 'started' },
  test: { name: 'test', group: 'started' },
  blocked: { name: 'blocked', group: 'started' },
  todo: { name: 'todo', group: 'unstarted' },
  backlog: { name: 'backlog', group: 'backlog' },
  done: { name: 'done', group: 'completed' },
};
const INTENT_TITLE: Record<Intent, string> = {
  progress: 'In Progress',
  review: 'Review',
  test: 'Test',
  blocked: 'Blocked',
  todo: 'Todo',
  backlog: 'Backlog',
  done: 'Done',
};

interface LoopItem {
  id: string;
  ref: string;
  title: string;
  description: string;
  project_id: string;
  project_key: string;
  version: string;
  loop_rules: LoopRules;
  state_id: string;
  state_name: string;
  state_group: string;
  sprint_id: string | null;
  assignee_id: string | null;
  agent_name: string | null; // [PCODE-247 | S15 | v0.1.0]
  agent_scope: { files?: string[]; branches?: string[] } | null;
}

const LOOP_SELECT = `
  SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, i.description, i.project_id, p.key AS project_key, p.version,
         p.loop_rules, i.state_id, st.name AS state_name, st.grp AS state_group, i.sprint_id, i.assignee_id,
         ag.name AS agent_name, ag.scope AS agent_scope
  FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
  LEFT JOIN agents ag ON ag.id = i.agent_id`;

/** [PCODE-247 | S15 | v0.1.0] The project's rules, with the agent the task is assigned to and the files and branches it may touch. */
const rulesOf = (it: LoopItem): LoopRules => ({
  ...it.loop_rules,
  ...(it.agent_name
    ? {
        agent: {
          name: it.agent_name,
          files: it.agent_scope?.files ?? [],
          branches: it.agent_scope?.branches ?? [],
        },
      }
    : {}),
});

/** The item a reference (APP-12) names, if the caller may see its project. */
async function resolve(c: PoolClient, a: Access, reference: string): Promise<LoopItem> {
  const m = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(reference);
  const it = m
    ? (
        await c.query<LoopItem>(LOOP_SELECT + ' WHERE p.key = upper($1) AND i.sequence = $2', [
          m[1],
          Number(m[2]),
        ])
      ).rows[0]
    : undefined;
  if (!it)
    throw new HttpError(
      404,
      'not_found',
      'No task ' + reference.toUpperCase() + ' in this workspace',
    );
  try {
    await requireProject(c, a, it.project_id);
  } catch {
    throw new HttpError(
      404,
      'not_found',
      'No task ' + reference.toUpperCase() + ' in this workspace',
    );
  }
  return it;
}

async function stateFor(
  c: PoolClient,
  projectId: string,
  intent: Intent,
): Promise<{ id: string; name: string }> {
  const want = INTENT_STATE[intent];
  const rows = (
    await c.query<{ id: string; name: string; grp: string }>(
      'SELECT id, name, grp FROM project_states WHERE project_id = $1 ORDER BY position',
      [projectId],
    )
  ).rows;
  const st =
    rows.find((r) => r.name.toLowerCase() === want.name) ?? rows.find((r) => r.grp === want.group);
  if (!st)
    throw new HttpError(409, 'conflict', 'The project has no state for ' + INTENT_TITLE[intent]);
  return st;
}

/** The fingerprint's sprint code: the item's sprint, else the active one, else S00. */
async function sprintCode(c: PoolClient, it: LoopItem): Promise<string> {
  const n = (
    await c.query<{ number: number }>(
      it.sprint_id
        ? 'SELECT number FROM sprints WHERE id = $1'
        : "SELECT number FROM sprints WHERE project_id = $1 AND status = 'active'",
      [it.sprint_id ?? it.project_id],
    )
  ).rows[0]?.number;
  return 'S' + String(n ?? 0).padStart(2, '0');
}

async function comment(c: PoolClient, a: Access, it: LoopItem, body: string): Promise<void> {
  const id =
    (
      await c.query<{ id: string }>(
        'INSERT INTO comments (workspace_id, item_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id',
        [a.workspaceId, it.id, a.user.id, body],
      )
    ).rows[0]?.id ?? '';
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'commented',
      object: { type: 'comment', id },
      parent: { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
    },
    { projectId: it.project_id },
  );
}

async function event(
  c: PoolClient,
  a: Access,
  it: LoopItem,
  verb: Verb,
  changes?: ActivityData['changes'],
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'item', id: it.id, label: it.ref + ' ' + it.title },
      parent: { type: 'project', id: it.project_id, label: it.project_key },
      ...(changes ? { changes } : {}),
    },
    { projectId: it.project_id },
  );
}

/** Moves the item to the state for `intent`; returns the state's name, or null when it was there already. */
async function move(
  c: PoolClient,
  a: Access,
  it: LoopItem,
  intent: Intent,
  verb: Verb = 'moved',
): Promise<string | null> {
  const st = await stateFor(c, it.project_id, intent);
  if (st.id === it.state_id) return null;
  await c.query(
    'UPDATE items SET state_id = $2, version = version + 1, updated_at = now() WHERE id = $1',
    [it.id, st.id],
  );
  await event(c, a, it, verb, { state: { from: it.state_name, to: st.name } });
  it.state_id = st.id;
  it.state_name = st.name;
  return st.name;
}

interface SessionRow {
  id: string;
  item_id: string;
  sprint_code: string;
  version: string;
}

async function openSession(
  c: PoolClient,
  a: Access,
  clientKey: string,
): Promise<SessionRow | undefined> {
  // ── [PCODE-464 | S15 | v0.1.0] a session lasts while its task is in progress ──
  //    The task can leave In Progress without orq: dragged to Review or Done on the portal's board, parked
  //    by someone else. Then the session is over too, with the task's state as how it ended, so the
  //    developer's next start is not refused for a task nobody works on any more.
  const s = (
    await c.query<SessionRow & { state: string; grp: string }>(
      `SELECT w.id, w.item_id, w.sprint_code, w.version, ps.name AS state, ps.grp
         FROM work_sessions w JOIN items i ON i.id = w.item_id JOIN project_states ps ON ps.id = i.state_id
        WHERE w.user_id = $1 AND w.client = $2 AND w.ended_at IS NULL`,
      [a.user.id, clientKey],
    )
  ).rows[0];
  if (!s) return undefined;
  // Test and Blocked are still the developer's (the loop itself moves a task to Test when its tests pass);
  // Review is handed on, and Done, Cancelled, To do and Backlog are not being worked on
  const working = s.grp === 'started' && s.state.toLowerCase() !== 'review';
  if (working)
    return { id: s.id, item_id: s.item_id, sprint_code: s.sprint_code, version: s.version };
  await c.query('UPDATE work_sessions SET ended_at = now(), end_state = $2 WHERE id = $1', [
    s.id,
    s.state,
  ]);
  await endSessionRuns(c, [s.id]); // [PCODE-466 | S15 | v0.1.0]
  return undefined;
}

/** [PCODE-466 | S15 | v0.1.0] the session this client had last, ended in the last six hours */
async function lastSession(
  c: PoolClient,
  a: Access,
  clientKey: string,
): Promise<SessionRow | undefined> {
  return (
    await c.query<SessionRow>(
      `SELECT id, item_id, sprint_code, version FROM work_sessions
        WHERE user_id = $1 AND client = $2 AND ended_at > now() - interval '6 hours'
        ORDER BY ended_at DESC LIMIT 1`,
      [a.user.id, clientKey],
    )
  ).rows[0];
}

async function endSessions(
  c: PoolClient,
  a: Access,
  itemId: string,
  endState: string,
): Promise<void> {
  const ended = await c.query<{ id: string }>(
    'UPDATE work_sessions SET ended_at = now(), end_state = $3 WHERE user_id = $1 AND item_id = $2 AND ended_at IS NULL RETURNING id',
    [a.user.id, itemId, endState],
  );
  await endSessionRuns(
    c,
    ended.rows.map((r) => r.id),
  ); // [PCODE-466 | S15 | v0.1.0]
}

const files = (list: string[]): string =>
  list
    .slice(0, 20)
    .map((f) => '`' + f + '`')
    .join(', ') + (list.length > 20 ? ' and ' + String(list.length - 20) + ' more' : '');

const fingerprintOut = s.object({
  task: s.string(),
  sprint: s.string(),
  version: s.string(),
  title: s.string(),
  marker: s.string(),
});
const taskOut = s.object({
  id: s.string(),
  ref: s.string(),
  title: s.string(),
  description: s.string(),
  state: s.string(),
  projectId: s.string(),
  projectKey: s.string(),
});
const rulesOut = s.object({
  reviewBeforeDone: s.boolean(),
  autoTestState: s.boolean(),
  unguardedPaths: s.array(s.string()),
  agent: s.optional(
    s.object({ name: s.string(), files: s.array(s.string()), branches: s.array(s.string()) }),
  ),
  kit: s.optional(s.string()), // [PCODE-290 | S15 | v0.1.0]
});

const taskJson = (
  it: LoopItem,
): {
  id: string;
  ref: string;
  title: string;
  description: string;
  state: string;
  projectId: string;
  projectKey: string;
} => ({
  id: it.id,
  ref: it.ref,
  title: it.title,
  description: it.description,
  state: it.state_name,
  projectId: it.project_id,
  projectKey: it.project_key,
});

export const markerText = (task: string, sprint: string, version: string, title: string): string =>
  '[' + task + ' | ' + sprint + ' | v' + version + '] ' + title;

export function loopRoutes(pool: Pool): Route[] {
  const show = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/loop/tasks/:ref',
    summary: 'A task by its reference, with the fingerprint it would carry now',
    tags: ['loop'],
    params: s.object({ workspaceId: uuid, ref }),
    response: s.object({ task: taskOut, fingerprint: fingerprintOut, rules: rulesOut }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const it = await resolve(c, a, params.ref);
        const sprint = await sprintCode(c, it);
        return {
          body: {
            task: taskJson(it),
            fingerprint: {
              task: it.ref,
              sprint,
              version: it.version,
              title: it.title,
              marker: markerText(it.ref, sprint, it.version, it.title),
            },
            rules: { ...rulesOf(it), ...(await kitOf(c, it.project_id)) },
          },
        };
      }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/loop/open',
    summary: 'Open tasks of a project, active sprint first, then planned sprints, then the backlog',
    tags: ['loop'],
    params: wsParams,
    query: s.object({ project: s.string({ pattern: /^[A-Za-z][A-Za-z0-9]{1,9}$/ }) }),
    response: s.array(
      s.object({
        ref: s.string(),
        title: s.string(),
        state: s.string(),
        sprint: s.nullable(s.string()),
        sprintStatus: s.nullable(s.string()),
      }),
    ),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = (
          await c.query<{ id: string }>('SELECT id FROM projects WHERE key = upper($1)', [
            query.project,
          ])
        ).rows[0];
        if (!p) throw new HttpError(404, 'not_found', 'No project ' + query.project.toUpperCase());
        await requireProject(c, a, p.id);
        const rows = (
          await c.query<{
            ref: string;
            title: string;
            state: string;
            sprint: string | null;
            status: string | null;
          }>(
            `SELECT pr.key || '-' || i.sequence AS ref, i.title, st.name AS state, sp.name AS sprint, sp.status
             FROM items i JOIN projects pr ON pr.id = i.project_id JOIN project_states st ON st.id = i.state_id
             LEFT JOIN sprints sp ON sp.id = i.sprint_id
             WHERE i.project_id = $1 AND st.grp IN ('backlog', 'unstarted', 'started')
             ORDER BY CASE sp.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, sp.number, i.rank, i.sequence`,
            [p.id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            ref: r.ref,
            title: r.title,
            state: r.state,
            sprint: r.sprint,
            sprintStatus: r.status,
          })),
        };
      }),
  });

  const start = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/loop/start',
    summary: 'Start working on a task from a client: In Progress, assigned, in the active sprint',
    tags: ['loop'],
    params: wsParams,
    body: s.object({ ref, client, clientSession: s.optional(s.string({ max: 200 })) }),
    response: s.object({
      sessionId: s.string(),
      task: taskOut,
      fingerprint: fingerprintOut,
      rules: rulesOut,
      resumed: s.boolean(),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await resolve(c, a, body.ref);
        const open = await openSession(c, a, body.client);
        if (open && open.item_id !== it.id) {
          const other =
            (
              await c.query<{ ref: string }>(
                "SELECT p.key || '-' || i.sequence AS ref FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1",
                [open.item_id],
              )
            ).rows[0]?.ref ?? 'Another task';
          throw new HttpError(
            409,
            'conflict',
            other +
              ' is still active. First: orq status ' +
              other +
              ' review|test|blocked|todo (or orq done ' +
              other +
              ')',
          );
        }
        if (it.state_group === 'completed')
          throw new HttpError(
            409,
            'conflict',
            it.ref + ' is Done. Create a new task for follow-up work.',
          );
        if (it.description.trim().length < MIN_DESCRIPTION) {
          throw new HttpError(
            409,
            'conflict',
            it.ref +
              ' has no usable description. Add what, why and how to check it (' +
              String(MIN_DESCRIPTION) +
              ' characters at least) before starting.',
          );
        }
        if (open) {
          // the same task again from the same client: a new session of the tool takes it over
          await c.query('UPDATE work_sessions SET client_session = $2 WHERE id = $1', [
            open.id,
            body.clientSession ?? '',
          ]);
          return {
            body: {
              sessionId: open.id,
              task: taskJson(it),
              fingerprint: {
                task: it.ref,
                sprint: open.sprint_code,
                version: open.version,
                title: it.title,
                marker: markerText(it.ref, open.sprint_code, open.version, it.title),
              },
              rules: { ...rulesOf(it), ...(await kitOf(c, it.project_id)) },
              resumed: true,
            },
          };
        }
        // [PCODE-462 | S15 | v0.1.0] in plan order: not before the tasks it waits for are finished
        const waits = await waitingFor(c, it.id);
        if (waits.length) throw new HttpError(409, 'conflict', waitMessage(it.ref, waits));
        if (!it.sprint_id) {
          const active = (
            await c.query<{ id: string }>(
              "SELECT id FROM sprints WHERE project_id = $1 AND status = 'active'",
              [it.project_id],
            )
          ).rows[0];
          if (active) {
            await c.query('UPDATE items SET sprint_id = $2 WHERE id = $1', [it.id, active.id]);
            it.sprint_id = active.id;
          }
        }
        if (!it.assignee_id)
          await c.query('UPDATE items SET assignee_id = $2 WHERE id = $1', [it.id, a.user.id]);
        // [PCODE-462 | S15 | v0.1.0] the first task of a planned sprint starts the sprint
        await startSprintWithTask(c, a, it.sprint_id);
        const sprint = await sprintCode(c, it);
        const sessionId = (
          await c.query<{ id: string }>(
            'INSERT INTO work_sessions (workspace_id, user_id, item_id, client, client_session, sprint_code, version) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [
              a.workspaceId,
              a.user.id,
              it.id,
              body.client,
              body.clientSession ?? '',
              sprint,
              it.version,
            ],
          )
        ).rows[0]?.id;
        if (!sessionId) throw new Error('session insert returned nothing');
        await move(c, a, it, 'progress', 'started');
        await comment(
          c,
          a,
          it,
          '**Started** by ' +
            a.user.name +
            ' on ' +
            body.client +
            (body.clientSession ? ' (session ' + body.clientSession.slice(0, 8) + ')' : '') +
            '. Version v' +
            it.version +
            ', ' +
            sprint +
            '.',
        );
        return {
          body: {
            sessionId,
            task: taskJson(it),
            fingerprint: {
              task: it.ref,
              sprint,
              version: it.version,
              title: it.title,
              marker: markerText(it.ref, sprint, it.version, it.title),
            },
            rules: { ...rulesOf(it), ...(await kitOf(c, it.project_id)) },
            resumed: false,
          },
        };
      }),
  });

  const active = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/loop/active',
    summary: 'The caller’s active task on a client, if any',
    tags: ['loop'],
    params: wsParams,
    query: s.object({ client }),
    response: s.object({
      active: s.nullable(
        s.object({
          sessionId: s.string(),
          task: taskOut,
          fingerprint: fingerprintOut,
          rules: rulesOut,
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const open = await openSession(c, a, query.client);
        if (!open) return { body: { active: null } };
        const it = (await c.query<LoopItem>(LOOP_SELECT + ' WHERE i.id = $1', [open.item_id]))
          .rows[0];
        if (!it) return { body: { active: null } };
        return {
          body: {
            active: {
              sessionId: open.id,
              task: taskJson(it),
              fingerprint: {
                task: it.ref,
                sprint: open.sprint_code,
                version: open.version,
                title: it.title,
                marker: markerText(it.ref, open.sprint_code, open.version, it.title),
              },
              rules: { ...rulesOf(it), ...(await kitOf(c, it.project_id)) },
            },
          },
        };
      }),
  });

  const progress = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/loop/progress',
    summary: 'Report work on the active task: files edited, a commit, a test run, a paused session',
    tags: ['loop'],
    params: wsParams,
    body: s.object({
      client,
      kind: s.enum(['edit', 'commit', 'tests', 'paused', 'usage']), // [PCODE-466 | S15 | v0.1.0] usage
      files: s.optional(s.array(s.string({ min: 1, max: 500 }), { max: 500 })),
      commit: s.optional(s.string({ pattern: /^[0-9a-f]{7,40}$/ })),
      command: s.optional(s.string({ max: 300 })),
      green: s.optional(s.boolean()),
      // [PCODE-466 | S15 | v0.1.0] the AI usage of the session, per model
      model: s.optional(s.string({ min: 1, max: 120 })),
      tokensIn: s.optional(s.number({ integer: true, min: 0, max: 1e12 })),
      tokensOut: s.optional(s.number({ integer: true, min: 0, max: 1e12 })),
      cacheRead: s.optional(s.number({ integer: true, min: 0, max: 1e12 })),
      cacheWrite: s.optional(s.number({ integer: true, min: 0, max: 1e12 })),
    }),
    response: s.object({ state: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-466 | S15 | v0.1.0] usage arrives after the turn, and Claude may have ended the session in it
        //    (orq done): then the tokens belong to the session this client had last
        const open =
          (await openSession(c, a, body.client)) ??
          (body.kind === 'usage' ? await lastSession(c, a, body.client) : undefined);
        if (!open)
          throw new HttpError(
            404,
            'not_found',
            'No active task on this client. Start one first: orq start <task>',
          );
        const it = (await c.query<LoopItem>(LOOP_SELECT + ' WHERE i.id = $1', [open.item_id]))
          .rows[0];
        if (!it) throw new HttpError(404, 'not_found', 'The active task no longer exists');
        const list = body.files ?? [];
        // [PCODE-466 | S15 | v0.1.0] the tokens onto the task's run of the developer agent, priced
        if (body.kind === 'usage') {
          await addSessionUsage(c, a, open, it, body.client, {
            model: body.model ?? 'claude-code',
            tokensIn: body.tokensIn ?? 0,
            tokensOut: body.tokensOut ?? 0,
            cacheRead: body.cacheRead ?? 0,
            cacheWrite: body.cacheWrite ?? 0,
          });
          return { body: { state: it.state_name } };
        }
        if (body.kind === 'edit') {
          if (list.length) {
            await comment(c, a, it, '**Working** — edited: ' + files(list));
            await event(c, a, it, 'progressed', { files: { from: null, to: list.slice(0, 50) } });
          }
        } else if (body.kind === 'paused') {
          if (list.length)
            await comment(
              c,
              a,
              it,
              '**Session paused** — ' +
                String(list.length) +
                ' file(s) touched so far: ' +
                files(list.slice(-10)),
            );
        } else if (body.kind === 'commit') {
          if (!body.commit)
            throw new HttpError(400, 'invalid_request', 'A commit report needs the commit hash', [
              { path: 'body.commit', message: 'is required' },
            ]);
          await comment(c, a, it, '**Commit** `' + body.commit + '` (' + it.ref + ')');
          await event(c, a, it, 'progressed', { commit: { from: null, to: body.commit } });
        } else {
          const green = body.green === true;
          await comment(
            c,
            a,
            it,
            '**Tests ' + (green ? 'green' : 'failed') + '** — `' + (body.command ?? 'tests') + '`',
          );
          await event(c, a, it, 'progressed', {
            tests: { from: null, to: green ? 'green' : 'failed' },
          });
          if (green && it.loop_rules.autoTestState) await move(c, a, it, 'test');
        }
        return { body: { state: it.state_name } };
      }),
  });

  const status = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/loop/status',
    summary:
      'Move a task to review, test, blocked, todo, backlog or progress, with a note; ends its session unless progress',
    tags: ['loop'],
    params: wsParams,
    body: s.object({
      ref,
      state: s.enum(['review', 'test', 'blocked', 'todo', 'backlog', 'progress']),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: s.object({ state: s.string(), ended: s.boolean() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await resolve(c, a, body.ref);
        await move(c, a, it, body.state);
        await comment(
          c,
          a,
          it,
          '**' +
            INTENT_TITLE[body.state] +
            '** — ' +
            (body.note?.trim() || 'moved by ' + a.user.name),
        );
        const ended = body.state !== 'progress';
        if (ended) await endSessions(c, a, it.id, it.state_name);
        return { body: { state: it.state_name, ended } };
      }),
  });

  const done = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/loop/done',
    summary:
      'Finish a task: needs fingerprinted files (unless forced); Review, or Done when the project does not review',
    tags: ['loop'],
    params: wsParams,
    body: s.object({
      ref,
      commit: s.optional(s.nullable(s.string({ pattern: /^[0-9a-f]{7,40}$/ }))),
      files: s.array(
        s.object({
          path: s.string({ min: 1, max: 500 }),
          line: s.number({ integer: true, min: 1 }),
          kind: s.enum(['header', 'block']),
        }),
        { max: 5000 },
      ),
      force: s.optional(s.boolean()),
    }),
    response: s.object({ state: s.string(), files: s.number({ integer: true }) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const it = await resolve(c, a, body.ref);
        if (it.state_group === 'completed')
          throw new HttpError(409, 'conflict', it.ref + ' is already Done');
        const paths = [...new Set(body.files.map((f) => f.path))].sort();
        if (!paths.length && !body.force) {
          throw new HttpError(
            409,
            'conflict',
            'No file carries the fingerprint [' +
              it.ref +
              ' | ...]. Add the marker to the code written for this task, or force done for a task with no code (e.g. a check).',
          );
        }
        // [PCODE-104 | S15 | v0.1.0] the markers are kept under the session's sprint and version
        const open = (
          await c.query<{ sprint_code: string; version: string }>(
            'SELECT sprint_code, version FROM work_sessions WHERE user_id = $1 AND item_id = $2 AND ended_at IS NULL',
            [a.user.id, it.id],
          )
        ).rows[0];
        await storeFingerprints(c, a, it, body.files, {
          commit: body.commit ?? null,
          sprint: open?.sprint_code ?? (await sprintCode(c, it)),
          version: open?.version ?? it.version,
        });
        const final: Intent = it.loop_rules.reviewBeforeDone ? 'review' : 'done';
        const moved = await move(c, a, it, final, 'completed');
        // finished again from Review: no state change, but the board still hears of it
        if (!moved)
          await event(c, a, it, 'completed', {
            fingerprints: { from: null, to: paths.length },
          });
        await comment(
          c,
          a,
          it,
          [
            '**' +
              INTENT_TITLE[final] +
              '** by ' +
              a.user.name +
              ' — v' +
              it.version +
              (body.commit ? ', commit `' + body.commit + '`' : ''),
            '',
            paths.length
              ? 'Files fingerprinted for ' + it.ref + ':'
              : 'No code: finished without fingerprinted files.',
            ...paths.map((p) => '- `' + p + '`'),
          ].join('\n'),
        );
        await endSessions(c, a, it.id, it.state_name);
        return { body: { state: it.state_name, files: paths.length } };
      }),
  });

  return [show, list, start, active, progress, status, done];
}
