// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-248 | S15 | v0.1.0] T25.3 Custom roles, role conditions and project roles enforced ──
// ── [PCODE-247 | S15 | v0.1.0] T25.2 Agent scopes enforced: files, branches, network, trace redaction ──
// ── [PCODE-246 | S15 | v0.1.0] T25.1 Agent triggers act: assignment, label, mention, CI failure, schedule, webhook ──
//    Why:  the triggers kept with an agent start its runs. The matcher reads each workspace's activity after
//          it is written, from its own cursor, so it never slows a write and never misses an event across a
//          restart: a task assigned to the agent, a label put on a task, a mention in a comment, a failed test
//          run or deploy. A schedule starts runs at the minutes its cron line names, in the workspace's time
//          zone. An outside system calls the agent's own webhook address, signed with its secret. Every run
//          says what started it; one cause (an event, a minute, a delivery) starts an agent once; an agent
//          never starts itself, and at most RUNS_PER_HOUR triggered runs an hour keep two agents that call each
//          other from running away. The switch, pause all, concurrency and budgets apply as to every run.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  cronMatches,
  mentionTriggered,
  parseCron,
  type ActivityEvent,
  type Trigger,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { answer, readBody } from '../git/webhook.js';
import { workspaceTimeZone } from '../api/timezone.js'; // [PCODE-248 | S15 | v0.1.0]
import { open } from './secrets.js';
import { AGENT_CHANNEL } from './worker.js';

export const RUNS_PER_HOUR = 30;
const BATCH = 200;
/** a schedule looks back a few minutes, so a busy or restarted server still starts a missed minute */
const LOOKBACK_MINUTES = 3;

interface AgentRow {
  id: string;
  key: string;
  name: string;
  model: string;
  triggers: Trigger[];
}

export interface Start {
  agent: AgentRow;
  kind: Trigger['kind'];
  projectId: string;
  itemId: string | null;
  instruction: string;
  note: string;
  /** what started it, once */
  key: string | null;
  requestedBy: string | null;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const withAsk = (context: string, t: Trigger): string =>
  t.instruction ? context + '\n\n' + t.instruction : context;

/** Queues one triggered run; null when this cause already started the agent or it hit its hourly limit. */
export async function startTriggered(c: PoolClient, ws: string, s: Start): Promise<string | null> {
  const recent = Number(
    (
      await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM agent_runs WHERE agent_id = $1 AND trigger_kind IS NOT NULL AND created_at > now() - interval '1 hour'",
        [s.agent.id],
      )
    ).rows[0]?.n ?? 0,
  );
  if (recent >= RUNS_PER_HOUR) return null;
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO agent_runs (workspace_id, project_id, item_id, agent_id, requested_by, instruction, model, prompt_version,
                               trigger_kind, trigger_note, trigger_key)
       VALUES ($1, $2, $3, $4,
               -- [PCODE-247 | S15 | v0.1.0] a run nobody asked for acts as the agent's accountable person, else the owner
               coalesce($5::uuid, (SELECT owner_id FROM agents WHERE id = $4),
                        (SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1)),
               $6, $7, (SELECT prompt_version FROM agents WHERE id = $4), $8, $9, $10)
       ON CONFLICT (agent_id, trigger_key) WHERE trigger_key IS NOT NULL DO NOTHING RETURNING id`,
      [
        ws,
        s.projectId,
        s.itemId,
        s.agent.id,
        s.requestedBy,
        clip(s.instruction, 20_000),
        s.agent.model,
        s.kind,
        clip(s.note, 300),
        s.key,
      ],
    )
  ).rows[0]?.id;
  if (!id) return null;
  const ref = s.itemId
    ? (
        await c.query<{ ref: string }>(
          "SELECT p.key || '-' || i.sequence AS ref FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1",
          [s.itemId],
        )
      ).rows[0]?.ref
    : undefined;
  await recordEvent(
    c,
    ws,
    {
      actor: { kind: 'system', id: 'triggers', name: 'Trigger' },
      verb: 'created',
      object: { type: 'agent_run', id, label: s.agent.name + (ref ? ' on ' + ref : '') },
      ...(s.itemId && ref ? { parent: { type: 'item' as const, id: s.itemId, label: ref } } : {}),
      changes: {
        status: { from: null, to: 'queued' },
        trigger: { from: null, to: s.note },
      },
    },
    { projectId: s.projectId },
  );
  await c.query('SELECT pg_notify($1, $2)', [AGENT_CHANNEL, id]);
  return id;
}

interface ItemInfo {
  ref: string;
  title: string;
}

async function itemInfo(c: PoolClient, id: string): Promise<ItemInfo | undefined> {
  return (
    await c.query<ItemInfo>(
      "SELECT p.key || '-' || i.sequence AS ref, i.title FROM items i JOIN projects p ON p.id = i.project_id WHERE i.id = $1",
      [id],
    )
  ).rows[0];
}

/** The runs one activity event starts. */
export async function startsFor(
  c: PoolClient,
  e: ActivityEvent,
  agents: AgentRow[],
): Promise<Start[]> {
  const d = e.data;
  const projectId = e.projectid;
  if (!projectId) return [];
  const ch = d.changes ?? {};
  const out: Start[] = [];
  const by = d.actor.kind === 'user' ? d.actor.id : null;
  const actorName = d.actor.name ?? 'Someone';
  const add = (
    agent: AgentRow,
    t: Trigger,
    itemId: string | null,
    context: string,
    note: string,
  ): void => {
    out.push({
      agent,
      kind: t.kind,
      projectId,
      itemId,
      instruction: withAsk(context, t),
      note,
      key: 'event:' + e.id + ':' + t.kind,
      requestedBy: by,
    });
  };
  // an agent never starts itself
  const others = agents.filter((a) => !(d.actor.kind === 'agent' && d.actor.id === a.id));

  if (d.object.type === 'item' && (d.verb === 'created' || d.verb === 'updated')) {
    const assigned = ch['agentId']?.to;
    const before = ch['labelIds']?.from;
    const after = ch['labelIds']?.to;
    const added =
      Array.isArray(after) && Array.isArray(before)
        ? (after as string[]).filter((l) => !(before as string[]).includes(l))
        : [];
    if (!assigned && !added.length) return [];
    const item = await itemInfo(c, d.object.id);
    if (!item) return [];
    const names = added.length
      ? (
          await c.query<{ name: string }>('SELECT name FROM labels WHERE id = ANY($1::uuid[])', [
            added,
          ])
        ).rows.map((r) => r.name.toLowerCase())
      : [];
    for (const a of others)
      for (const t of a.triggers) {
        if (t.kind === 'assigned' && assigned === a.id)
          add(
            a,
            t,
            d.object.id,
            actorName + ' assigned ' + item.ref + ' "' + item.title + '" to you. Work on it.',
            'assigned ' + item.ref,
          );
        if (t.kind === 'label' && names.includes(t.value.toLowerCase()))
          add(
            a,
            t,
            d.object.id,
            actorName +
              ' put the label "' +
              t.value +
              '" on ' +
              item.ref +
              ' "' +
              item.title +
              '". Work on it.',
            'label ' + t.value + ' on ' + item.ref,
          );
      }
    return out;
  }

  if (d.object.type === 'comment' && (d.verb === 'commented' || d.verb === 'updated')) {
    if (!others.some((a) => a.triggers.some((t) => t.kind === 'mention'))) return [];
    const row = (
      await c.query<{ body: string; item_id: string }>(
        'SELECT body, item_id FROM comments WHERE id = $1',
        [d.object.id],
      )
    ).rows[0];
    if (!row) return [];
    const item = await itemInfo(c, row.item_id);
    if (!item) return [];
    const was = ch['body']?.from;
    for (const a of others)
      for (const t of a.triggers) {
        if (t.kind !== 'mention' || !mentionTriggered(row.body, t.value)) continue;
        // an edit starts the agent only when it newly names it
        if (d.verb === 'updated' && typeof was === 'string' && mentionTriggered(was, t.value))
          continue;
        add(
          a,
          t,
          row.item_id,
          actorName +
            ' mentioned you (' +
            t.value +
            ') in a comment on ' +
            item.ref +
            ' "' +
            item.title +
            '":\n\n' +
            clip(row.body, 4000),
          'mention ' + t.value + ' on ' + item.ref,
        );
      }
    return out;
  }

  // [PCODE-349 | S15 | v0.1.0] a CI pipeline's run too
  if (
    (d.object.type === 'test_run' || d.object.type === 'deploy' || d.object.type === 'ci_run') &&
    d.verb === 'failed'
  ) {
    const what =
      d.object.type === 'test_run'
        ? 'The test run'
        : d.object.type === 'ci_run'
          ? 'The CI run'
          : 'The deploy';
    for (const a of others)
      for (const t of a.triggers)
        if (t.kind === 'ci_failure')
          add(
            a,
            t,
            null,
            what +
              ' ' +
              (d.object.label ?? '') +
              ' failed. Find out why, and say what to change to fix it.',
            (d.object.type === 'test_run'
              ? 'tests failed: '
              : d.object.type === 'ci_run'
                ? 'CI failed: '
                : 'deploy failed: ') + (d.object.label ?? ''),
          );
  }
  return out;
}

const AGENT_SELECT =
  "SELECT id, key, name, model, triggers FROM agents WHERE workspace_id = $1 AND enabled AND jsonb_array_length(triggers) > 0 AND key <> 'reader'";

/** One workspace's new events against its agents' triggers; answers how many runs started. */
export async function matchEvents(
  pool: Pool,
  ws: string,
  onSkip?: (e: ActivityEvent, err: unknown) => void,
): Promise<number> {
  return inSystem(pool, async (c) => {
    // a workspace seen for the first time starts now: old events start nothing
    await c.query(
      `INSERT INTO agent_trigger_cursors (workspace_id, last_sequence)
       VALUES ($1, (SELECT coalesce(max(sequence), 0) FROM activity_events WHERE workspace_id = $1))
       ON CONFLICT (workspace_id) DO NOTHING`,
      [ws],
    );
    const cur = (
      await c.query<{ last_sequence: string }>(
        'SELECT last_sequence FROM agent_trigger_cursors WHERE workspace_id = $1 FOR UPDATE SKIP LOCKED',
        [ws],
      )
    ).rows[0];
    if (!cur) return 0;
    const events = (
      await c.query<{ envelope: ActivityEvent }>(
        'SELECT envelope FROM activity_events WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence LIMIT $3',
        [ws, cur.last_sequence, BATCH],
      )
    ).rows.map((r) => r.envelope);
    const last = events[events.length - 1];
    if (!last) return 0;
    const agents = (await c.query<AgentRow>(AGENT_SELECT, [ws])).rows.filter((a) =>
      a.triggers.some((t) => t.kind !== 'schedule' && t.kind !== 'webhook'),
    );
    let n = 0;
    // one event that cannot be matched is passed over; it never holds up the ones after it
    if (agents.length)
      for (const e of events) {
        await c.query('SAVEPOINT trigger_event');
        try {
          for (const s of await startsFor(c, e, agents)) if (await startTriggered(c, ws, s)) n++;
          await c.query('RELEASE SAVEPOINT trigger_event');
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT trigger_event');
          onSkip?.(e, err);
        }
      }
    await c.query('UPDATE agent_trigger_cursors SET last_sequence = $2 WHERE workspace_id = $1', [
      ws,
      last.sequence,
    ]);
    return n;
  });
}

/** The schedules of one workspace at the minutes up to `now`; answers how many runs started. */
export async function scheduleRuns(pool: Pool, ws: string, now: Date): Promise<number> {
  return inSystem(pool, async (c) => {
    const agents = (await c.query<AgentRow>(AGENT_SELECT, [ws])).rows.filter((a) =>
      a.triggers.some((t) => t.kind === 'schedule'),
    );
    if (!agents.length) return 0;
    const zone = await workspaceTimeZone(c, ws);
    const minute = Math.floor(now.getTime() / 60_000) * 60_000;
    let n = 0;
    for (const a of agents)
      for (const [i, t] of a.triggers.entries()) {
        if (t.kind !== 'schedule' || !t.project) continue;
        const cron = parseCron(t.value);
        if (!cron) continue;
        const project = (
          await c.query<{ id: string }>(
            'SELECT id FROM projects WHERE key = $1 AND archived_at IS NULL',
            [t.project],
          )
        ).rows[0];
        if (!project) continue;
        for (let k = LOOKBACK_MINUTES; k >= 0; k--) {
          const at = new Date(minute - k * 60_000);
          if (!cronMatches(cron, at, zone)) continue;
          const started = await startTriggered(c, ws, {
            agent: a,
            kind: 'schedule',
            projectId: project.id,
            itemId: null,
            instruction:
              t.instruction ??
              'Your scheduled run (' + t.value + '): look at ' + t.project + ' and do your work.',
            note: 'schedule ' + t.value,
            key: 'schedule:' + String(i) + ':' + t.value + ':' + at.toISOString(),
            requestedBy: null,
          });
          if (started) n++;
        }
      }
    return n;
  });
}

/** Every workspace with triggers: new events, then schedules. */
export async function triggerRound(
  pool: Pool,
  now: Date = new Date(),
  log?: (msg: string, data?: Record<string, unknown>) => void,
): Promise<number> {
  const spaces = await inSystem(pool, async (c) =>
    (
      await c.query<{ workspace_id: string }>(
        'SELECT DISTINCT workspace_id FROM agents WHERE enabled AND jsonb_array_length(triggers) > 0',
      )
    ).rows.map((r) => r.workspace_id),
  );
  let n = 0;
  for (const ws of spaces) {
    n += await matchEvents(pool, ws, (e, err) => {
      log?.('agent trigger skipped an event', {
        event: e.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    n += await scheduleRuns(pool, ws, now);
  }
  return n;
}

// ── the webhook ──

/** A new public id and secret for an agent's webhook. */
export function newWebhook(): { id: string; secret: string } {
  return {
    id: randomBytes(18).toString('base64url'),
    secret: 'whs_' + randomBytes(24).toString('base64url'),
  };
}

const HOOK_PATH = /^\/hooks\/agents\/([A-Za-z0-9_-]{20,64})$/;

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Signed with the secret (X-Orqiva-Signature: sha256=…, or GitHub's header) or carrying it as a bearer. */
export function webhookAllowed(req: IncomingMessage, secret: string, body: Buffer): boolean {
  const sig = header(req, 'x-orqiva-signature') || header(req, 'x-hub-signature-256');
  if (sig) return same(sig, 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'));
  const auth = header(req, 'authorization');
  return auth.startsWith('Bearer ') && same(auth.slice(7), secret);
}

/** POST /hooks/agents/<id>: an outside system starts the agent; outside the JSON router for the raw bytes. */
export function agentWebhooks(
  pool: Pool,
  log: (msg: string, data?: Record<string, unknown>) => void = () => undefined,
) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const m = HOOK_PATH.exec(path);
    if (!m) return false;
    if (req.method !== 'POST') {
      answer(res, 405, { error: { code: 'method_not_allowed', message: 'Use POST' } });
      return true;
    }
    void (async () => {
      const body = await readBody(req);
      if (!body) {
        answer(res, 413, { error: { code: 'too_large', message: 'The call is too large' } });
        return;
      }
      const agent = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<
              AgentRow & { workspace_id: string; webhook_secret: string | null; enabled: boolean }
            >(
              'SELECT id, key, name, model, triggers, workspace_id, webhook_secret, enabled FROM agents WHERE webhook_id = $1',
              [m[1]],
            )
          ).rows[0],
      );
      const trigger = agent?.triggers.find((t) => t.kind === 'webhook');
      if (!agent?.webhook_secret || !trigger) {
        answer(res, 404, { error: { code: 'not_found', message: 'No such webhook' } });
        return;
      }
      if (!webhookAllowed(req, open(agent.webhook_secret), body)) {
        answer(res, 401, {
          error: { code: 'unauthorized', message: 'The signature or secret does not match' },
        });
        return;
      }
      if (!agent.enabled) {
        answer(res, 409, { error: { code: 'conflict', message: agent.name + ' is switched off' } });
        return;
      }
      const text = body.toString('utf8');
      let named = '';
      try {
        const j = JSON.parse(text) as unknown;
        if (j && typeof j === 'object' && typeof (j as { project?: unknown }).project === 'string')
          named = (j as { project: string }).project.toUpperCase();
      } catch {
        // not JSON: the text itself is what was sent
      }
      const key = trigger.project ?? named;
      const delivery =
        header(req, 'x-orqiva-delivery') ||
        header(req, 'x-github-delivery') ||
        header(req, 'x-request-id');
      const out = await inSystem(pool, async (c) => {
        const project = key
          ? (
              await c.query<{ id: string }>(
                'SELECT id FROM projects WHERE workspace_id = $1 AND key = $2 AND archived_at IS NULL',
                [agent.workspace_id, key],
              )
            ).rows[0]
          : undefined;
        if (!project) return { status: 400, message: 'Name the project ("project": "KEY")' };
        const id = await startTriggered(c, agent.workspace_id, {
          agent,
          kind: 'webhook',
          projectId: project.id,
          itemId: null,
          instruction:
            (trigger.instruction ?? 'An outside system called your webhook. Do what it asks.') +
            '\n\nWhat it sent:\n' +
            clip(text, 8000),
          note: 'webhook' + (delivery ? ' ' + clip(delivery, 60) : ''),
          key: delivery ? 'webhook:' + clip(delivery, 180) : null,
          requestedBy: null,
        });
        return id
          ? { status: 202, runId: id }
          : {
              status: 200,
              message: 'Already started for this delivery, or the hourly limit is reached',
            };
      });
      if ('runId' in out) answer(res, 202, { runId: out.runId });
      else if (out.status === 200)
        answer(res, 200, { ok: true, started: false, message: out.message });
      else answer(res, 400, { error: { code: 'invalid_request', message: out.message } });
    })().catch((e: unknown) => {
      log('agent webhook failed', { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent)
        answer(res, 500, { error: { code: 'internal', message: 'The call could not be taken' } });
    });
    return true;
  };
}
