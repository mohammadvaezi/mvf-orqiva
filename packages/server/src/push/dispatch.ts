// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
// ── [PCODE-327 | S15 | v0.1.0] T33.1a Cache and reasoning tokens priced, the daily ECB rate, spend in euro by day ──
// ── [PCODE-322 | S15 | v0.1.0] T32.7a EPSS and known-exploited feeds, CVE alerts against shipped versions ──
// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-267 | S15 | v0.1.0] Push keys survive a changed server key: Notifications settings answered 500 ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-245 | S15 | v0.1.0] Incident page not delivered when the on-call person's own token raised the alert ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-204 | S15 | v0.1.0] T17.2 Promotions with approval, rollback per environment, backports, go/no-go meeting notes ──
// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-162 | S15 | v0.1.0] B1.1 Live shell server: inbox, notification rules, settings inheritance, shell summary ──
//    Why:  which events become a notification on someone's phone, and the worker that sends them. The
//          worker reads each workspace's events after its cursor (the row is locked with SKIP LOCKED, so of
//          several servers exactly one handles a batch), turns four kinds into notices (an agent waiting for
//          its requester's approval, a gate whose criteria are all met for its signers, a failed deploy for
//          its starter and the admins, a mention in a comment), keeps the ones each person wants, and sends
//          them after the cursor moved. A notification may be lost if the server stops mid-send; it is never
//          sent twice.
import { queueMail } from '../mail/outbox.js'; // [PCODE-237 | S15 | v0.1.0]
import { noticeMail } from '../mail/templates.js';
import { describe, mentionsIn, type ActivityEvent, type Mentionable } from '@orqiva/shared';
import { randomBytes } from 'node:crypto'; // [PCODE-348 | S15 | v0.1.0]
import type { Pool, PoolClient } from 'pg';
import type { FxDeps } from '../lib/fx.js'; // [PCODE-327 | S15 | v0.1.0]
import { open, seal } from '../agents/secrets.js';
import { lifecycleState, maySign } from '../api/lifecycle.js';
import { inSystem } from '../db/pool.js';
import { EVENTS_CHANNEL } from '../events/bus.js';
import { newVapidKeys, sendPush, type PushSubscription, type VapidKeys } from './webpush.js';
// [PCODE-162 | S15 | v0.1.0]
import { isQuiet, type QuietHours } from './quiet.js';
import { alertRound } from './alerts.js'; // [PCODE-249 | S15 | v0.1.0]

export type PushKind = 'approvals' | 'gates' | 'deploys' | 'mentions';
export const PUSH_KINDS: readonly PushKind[] = ['approvals', 'gates', 'deploys', 'mentions'];

export interface Notice {
  kind: PushKind;
  userIds: string[];
  title: string;
  body: string;
  /** the page it opens, inside the web app */
  url: string;
  /** a newer notice with the same tag replaces the older one on the device */
  tag: string;
  // [PCODE-162 | S15 | v0.1.0] what the inbox needs: the thing it is about and how pressing it is
  object: { type: string; id: string };
  priority: 'urgent' | 'high' | 'normal';
  // [PCODE-245 | S15 | v0.1.0] a page reaches the person on call even when their own token raised the alert
  evenToActor?: boolean;
}

/** [PCODE-162 | S15 | v0.1.0] Each notice kind as it shows in the inbox. */
export const INBOX_KIND: Record<PushKind, 'approval' | 'signoff' | 'incident' | 'mention'> = {
  approvals: 'approval',
  gates: 'signoff',
  deploys: 'incident',
  mentions: 'mention',
};

export interface PushDeps {
  /** [PCODE-237 | S15 | v0.1.0] whether this server sends mail, and where its links point */
  mail?: boolean;
  publicUrl?: string;
  fetch?: typeof fetch;
  /** whether the server may send to this address; by default the known push services over HTTPS */
  allowEndpoint?: (url: URL) => boolean;
  /** RFC 8292's contact: a mailto: or https: address */
  subject?: string;
}

/** RFC 8292's contact when none is set: ORQIVA_PUSH_CONTACT, else the public address. */
export const PUSH_SUBJECT =
  process.env['ORQIVA_PUSH_CONTACT'] ??
  (process.env['ORQIVA_PUBLIC_URL']?.startsWith('https://')
    ? process.env['ORQIVA_PUBLIC_URL']
    : 'mailto:admin@localhost');

/** The push services of Chrome, Edge, Firefox and Safari; nothing else is ever called. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^(?:web\.push|[\w-]+\.push)\.apple\.com$/,
  /\.notify\.windows\.com$/,
];
const extraHosts = (): string[] =>
  (process.env['ORQIVA_PUSH_HOSTS'] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

export function allowedEndpoint(url: URL, deps: PushDeps = {}): boolean {
  if (deps.allowEndpoint) return deps.allowEndpoint(url);
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((r) => r.test(host)) || extraHosts().includes(host);
}

/** The server's VAPID keys, made on first use and kept sealed with the server's key. */
export async function vapidKeys(pool: Pool): Promise<VapidKeys> {
  return inSystem(pool, async (c) => {
    const fresh = newVapidKeys();
    await c.query(
      `INSERT INTO instance_keys (name, public_value, secret_ciphertext) VALUES ('vapid', $1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [fresh.publicKey, seal(fresh.privatePem)],
    );
    const row = (
      await c.query<{ public_value: string; secret_ciphertext: string }>(
        "SELECT public_value, secret_ciphertext FROM instance_keys WHERE name = 'vapid'",
      )
    ).rows[0];
    if (!row) throw new Error('vapid keys missing');
    try {
      return { publicKey: row.public_value, privatePem: open(row.secret_ciphertext) };
    } catch {
      // [PCODE-267 | S15 | v0.1.0] sealed under an earlier server key: new keys, and the subscriptions made for
      // the old ones go (no push service would take a message signed with the new key for them)
      await c.query(
        "UPDATE instance_keys SET public_value = $1, secret_ciphertext = $2 WHERE name = 'vapid'",
        [fresh.publicKey, seal(fresh.privatePem)],
      );
      const gone = await c.query('DELETE FROM push_subscriptions');
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'push keys could not be opened with the server key; made new ones',
          subscriptionsRemoved: gone.rowCount ?? 0,
        }),
      );
      return { publicKey: fresh.publicKey, privatePem: fresh.privatePem };
    }
  });
}

const clip = (t: string, n = 140): string => (t.length > n ? t.slice(0, n - 1) + '…' : t);

async function people(c: PoolClient, ws: string, projectId: string | undefined) {
  return (
    await c.query<Mentionable & { role: string }>(
      `SELECT u.id, u.name, u.email, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1
         AND (m.role <> 'guest' OR guest_sees_project($2, u.id))
       ORDER BY u.name`,
      [ws, projectId ?? null],
    )
  ).rows;
}

/** The notices one event causes; most cause none. */
export async function noticesFor(c: PoolClient, e: ActivityEvent): Promise<Notice[]> {
  const d = e.data;
  const ws = e.workspaceid;
  const ch = d.changes ?? {};
  // an agent stopped to ask before it acts
  if (d.object.type === 'agent_run' && d.verb === 'updated' && ch['status']?.to === 'waiting') {
    const r = (
      await c.query<{ requested_by: string | null; instruction: string; agent: string }>(
        `SELECT r.requested_by, r.instruction, a.name AS agent FROM agent_runs r JOIN agents a ON a.id = r.agent_id
         WHERE r.id = $1`,
        [d.object.id],
      )
    ).rows[0];
    if (!r?.requested_by) return [];
    return [
      {
        kind: 'approvals',
        userIds: [r.requested_by],
        title: r.agent + ' is waiting for your approval',
        body: clip(r.instruction),
        url: '/runs/' + d.object.id,
        tag: 'run-' + d.object.id,
        object: { type: 'agent_run', id: d.object.id },
        priority: 'urgent',
      },
    ];
  }
  // a criterion ticked or a stage finished may have made a gate ready to sign
  if ((d.object.type === 'gate' || d.object.type === 'stage') && e.projectid) {
    const st = await lifecycleState(c, e.projectid);
    if (!st) return [];
    const out: Notice[] = [];
    const all = await people(c, ws, e.projectid);
    const project = d.parent?.label ?? '';
    for (const ph of st.phases) {
      const g = ph.gate;
      if (g?.status !== 'ready') continue;
      // once per readiness: a reopened or rejected gate that becomes ready again is new
      const key = 'gate:' + e.projectid + ':' + g.key + ':' + String(g.signoffs.length);
      const fresh = await c.query(
        'INSERT INTO push_sent (dedupe_key) VALUES ($1) ON CONFLICT DO NOTHING',
        [key],
      );
      if (!fresh.rowCount) continue;
      out.push({
        kind: 'gates',
        userIds: all.filter((p) => maySign(p.role, g.signer)).map((p) => p.id),
        title: (project ? project + ' ' : '') + g.name + ' is ready to sign',
        body: 'Every criterion is met. Review it and sign.',
        url: '/projects/' + e.projectid + '/lifecycle',
        tag: 'gate-' + e.projectid + '-' + g.key,
        object: { type: 'gate', id: e.projectid + ':' + g.key },
        priority: 'high',
      });
    }
    return out;
  }
  // [PCODE-277 | S15 | v0.1.0] a PRD put in review, or reopened by a new version: its approvers are asked
  const review = ch['review']?.to;
  if (
    d.object.type === 'idea' &&
    d.verb === 'updated' &&
    (review === 'requested' || review === 'reopened')
  ) {
    const asked = ch['approvers']?.to;
    const rows = (
      await c.query<{ user_id: string; client: boolean }>(
        `SELECT a.user_id, EXISTS (SELECT 1 FROM client_contacts cc JOIN projects p ON p.client_id = cc.client_id
                                    WHERE p.id = i.project_id AND cc.user_id = a.user_id) AS client
           FROM idea_approvers a JOIN ideas i ON i.id = a.idea_id WHERE a.idea_id = $1`,
        [d.object.id],
      )
    ).rows.filter((r) => !Array.isArray(asked) || asked.includes(r.user_id));
    const title =
      (review === 'reopened' ? 'Changed, please review again: ' : 'Please review and sign: ') +
      (d.parent?.label ? d.parent.label + ' ' : '') +
      (d.object.label ?? 'a PRD');
    const notice = (ids: string[], url: string): Notice => ({
      kind: 'approvals',
      userIds: ids,
      title,
      body: (d.actor.name ?? 'Someone') + ' asks you to approve the PRD or ask for changes.',
      url,
      tag: 'prd-' + d.object.id,
      object: { type: 'idea', id: d.object.id },
      priority: 'high',
    });
    const team = rows.filter((r) => !r.client).map((r) => r.user_id);
    const clients = rows.filter((r) => r.client).map((r) => r.user_id);
    return [
      ...(team.length ? [notice(team, '/ideas/' + d.object.id)] : []),
      ...(clients.length ? [notice(clients, '/portal/approvals')] : []),
    ];
  }
  // [PCODE-273 | S15 | v0.1.0] a question, risk or assumption of an idea handed to someone
  if (d.object.type === 'idea' && d.verb === 'assigned') {
    const to = ch['owner']?.to;
    if (typeof to !== 'string' || !e.projectid) return [];
    const [what, said] =
      (['question', 'risk', 'assumption'] as const)
        .map((k) => [k, ch[k]?.to] as const)
        .find(([, v]) => typeof v === 'string') ?? (['question', ''] as const);
    const ref = d.parent?.label ? d.parent.label + ' ' : '';
    return [
      {
        kind: 'mentions',
        userIds: [to],
        title:
          (d.actor.name ?? 'Someone') +
          ' handed you ' +
          (what === 'assumption' ? 'an ' : 'a ') +
          what +
          ' on ' +
          ref +
          (d.object.label ?? 'an idea'),
        body: clip(String(said)),
        url:
          '/projects/' +
          e.projectid +
          '/ideas?idea=' +
          d.object.id +
          '&sub=' +
          (what === 'question' ? 'questions' : 'risks'),
        tag: 'idea-' + what + '-' + d.object.id + '-' + e.id,
        object: { type: 'idea', id: d.object.id },
        priority: 'normal',
      },
    ];
  }
  if (d.object.type === 'deploy' && d.verb === 'failed') {
    const r = (
      await c.query<{ requested_by: string | null; error: string }>(
        'SELECT requested_by, error FROM deploy_runs WHERE id = $1',
        [d.object.id],
      )
    ).rows[0];
    const admins = (await people(c, ws, undefined))
      .filter((p) => p.role === 'owner' || p.role === 'admin')
      .map((p) => p.id);
    return [
      {
        kind: 'deploys',
        userIds: [...new Set([...(r?.requested_by ? [r.requested_by] : []), ...admins])],
        title: describe(e),
        body: clip(r?.error || 'Open the deploy to see the step that failed.'),
        url: '/deploys/' + d.object.id,
        tag: 'deploy-' + d.object.id,
        object: { type: 'deploy', id: d.object.id },
        priority: 'high',
      },
    ];
  }
  if (d.object.type === 'comment' && (d.verb === 'commented' || d.verb === 'updated')) {
    const row = (
      await c.query<{ body: string; item_id: string }>(
        'SELECT body, item_id FROM comments WHERE id = $1',
        [d.object.id],
      )
    ).rows[0];
    if (!row) return [];
    const all = await people(c, ws, e.projectid);
    let named = mentionsIn(row.body, all);
    // an edit notifies only the people it newly mentions
    const before = ch['body']?.from;
    if (d.verb === 'updated' && typeof before === 'string') {
      const had = new Set(mentionsIn(before, all).map((p) => p.id));
      named = named.filter((p) => !had.has(p.id));
    }
    if (!named.length) return [];
    return [
      {
        kind: 'mentions',
        userIds: named.map((p) => p.id),
        title: (d.actor.name ?? 'Someone') + ' mentioned you on ' + (d.parent?.label ?? 'a task'),
        body: clip(row.body),
        url: '/items/' + row.item_id,
        tag: 'comment-' + d.object.id,
        object: { type: 'comment', id: d.object.id },
        priority: 'normal',
      },
    ];
  }
  // [PCODE-189 | S15 | v0.1.0] a client booked a meeting: its hosts hear of it
  if (d.object.type === 'meeting' && d.verb === 'created' && Array.isArray(ch['hosts']?.to)) {
    const ids = (ch['hosts'].to as unknown[]).filter((x): x is string => typeof x === 'string');
    const when = typeof ch['startsAt']?.to === 'string' ? new Date(ch['startsAt'].to) : null;
    if (!ids.length) return [];
    return [
      {
        kind: 'mentions',
        userIds: ids,
        title:
          (d.actor.name ?? 'A client') +
          ' booked ' +
          (d.object.label ?? 'a meeting') +
          (when
            ? ' on ' +
              when.toLocaleString('de-DE', {
                timeZone: 'Europe/Berlin',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''),
        body: 'The agenda is drafted from the client’s open items.',
        url: '/clients',
        tag: 'meeting-' + d.object.id,
        object: { type: 'meeting', id: d.object.id },
        priority: 'normal',
      },
    ];
  }
  // [PCODE-204 | S15 | v0.1.0] a waiting promotion reaches its approver; the decision reaches who asked
  if (d.object.type === 'deploy' && ch['promotion']) {
    const p = (
      await c.query<{
        requested_by: string | null;
        approver_id: string | null;
        project_id: string;
      }>(
        `SELECT p.requested_by, e.approver_id, p.project_id FROM release_promotions p
           JOIN environments e ON e.id = p.to_env_id WHERE p.id = $1`,
        [d.object.id],
      )
    ).rows[0];
    if (!p) return [];
    const url = '/projects/' + p.project_id + '/versions';
    const to = ch['status']?.to;
    if (to === 'requested' && p.approver_id)
      return [
        {
          kind: 'approvals',
          userIds: [p.approver_id],
          title: (d.actor.name ?? 'Someone') + ' asks to promote ' + (d.object.label ?? ''),
          body: 'Approve it to deploy, or decline with a note.',
          url,
          tag: 'promotion-' + d.object.id,
          object: { type: 'deploy', id: d.object.id },
          priority: 'high',
        },
      ];
    if (
      (to === 'approved' || to === 'declined') &&
      ch['status']?.from === 'requested' &&
      p.requested_by
    )
      return [
        {
          kind: 'mentions',
          userIds: [p.requested_by],
          title:
            (d.actor.name ?? 'The approver') +
            (to === 'approved' ? ' approved ' : ' declined ') +
            (d.object.label ?? ''),
          body:
            to === 'approved' ? 'It deploys with the runner.' : 'See the note on the promotion.',
          url,
          tag: 'promotion-' + d.object.id,
          object: { type: 'deploy', id: d.object.id },
          priority: 'normal',
        },
      ];
    return [];
  }
  // [PCODE-199 | S15 | v0.1.0] a sent pack reaches the client's approvers; their decision reaches the sender and the admins
  if (d.object.type === 'handover') {
    const k = (
      await c.query<{ project_id: string; sent_by: string | null; client_id: string | null }>(
        `SELECT k.project_id, k.sent_by, p.client_id FROM handover_packs k JOIN projects p ON p.id = k.project_id
          WHERE k.id = $1`,
        [d.object.id],
      )
    ).rows[0];
    if (!k) return [];
    const project = d.parent?.label ?? '';
    if (d.verb === 'created') {
      if (!k.client_id) return [];
      const approvers = (
        await c.query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM client_contacts
            WHERE client_id = $1 AND portal_role IN ('sponsor', 'approver', 'product_owner')`,
          [k.client_id],
        )
      ).rows.map((x) => x.user_id);
      if (!approvers.length) return [];
      return [
        {
          kind: 'approvals',
          userIds: approvers,
          title:
            (project ? project + ': ' : '') +
            (d.object.label ?? 'A handover pack') +
            ' is ready for you',
          body: 'Read what is handed over, then accept it or ask for changes.',
          url: '/portal/handover',
          tag: 'handover-' + d.object.id,
          object: { type: 'handover', id: d.object.id },
          priority: 'high',
        },
      ];
    }
    const accepted = d.verb === 'completed';
    if (!accepted && ch['status']?.to !== 'changes_requested') return [];
    const admins = (await people(c, ws, k.project_id))
      .filter((p) => p.role === 'owner' || p.role === 'admin')
      .map((p) => p.id);
    const to = [...new Set([...(k.sent_by ? [k.sent_by] : []), ...admins])];
    if (!to.length) return [];
    return [
      {
        kind: accepted ? 'gates' : 'mentions',
        userIds: to,
        title:
          (d.actor.name ?? 'The client') +
          (accepted ? ' accepted ' : ' asked for changes to ') +
          (project ? project + ' ' : '') +
          (d.object.label ?? 'the handover pack'),
        body: accepted
          ? 'The handover stage is done.'
          : 'See the note on the pack and send a new one.',
        url: '/projects/' + k.project_id + '/handover',
        tag: 'handover-' + d.object.id,
        object: { type: 'handover', id: d.object.id },
        priority: accepted ? 'normal' : 'high',
      },
    ];
  }
  // [PCODE-188 | S15 | v0.1.0] an incident pages people: whoever is on call, then the escalation steps
  if (d.object.type === 'incident' && Array.isArray(ch['paged']?.to)) {
    const ids = (ch['paged'].to as unknown[]).filter((x): x is string => typeof x === 'string');
    if (!ids.length) return [];
    return [
      {
        kind: 'deploys',
        userIds: ids,
        title: 'You are paged: ' + (d.object.label ?? 'an incident'),
        body: 'Acknowledge it to stop the escalation.',
        url: '/incidents?id=' + d.object.id,
        tag: 'incident-' + d.object.id,
        object: { type: 'incident', id: d.object.id },
        priority: 'urgent',
        evenToActor: true, // [PCODE-245 | S15 | v0.1.0]
      },
    ];
  }
  // [PCODE-187 | S15 | v0.1.0] a submitted week and a request for time off reach the person's manager (else the admins)
  if (
    (d.object.type === 'timesheet' && ch['state']?.to === 'submitted') ||
    (d.object.type === 'absence' && d.verb === 'created' && ch['state']?.to === 'requested')
  ) {
    const personId = d.actor.id;
    const manager = (
      await c.query<{ manager_id: string | null }>(
        'SELECT manager_id FROM member_profiles WHERE user_id = $1',
        [personId],
      )
    ).rows[0]?.manager_id;
    const to = manager
      ? [manager]
      : (await people(c, ws, undefined))
          .filter((p) => (p.role === 'owner' || p.role === 'admin') && p.id !== personId)
          .map((p) => p.id);
    if (!to.length) return [];
    const week = d.object.type === 'timesheet';
    return [
      {
        kind: 'approvals',
        userIds: to,
        title:
          (d.actor.name ?? 'Someone') +
          (week
            ? ' submitted ' + (d.object.label ?? 'a week').replace(/^.* · /, '')
            : ' asks for time off'),
        body: week ? 'Check the hours and approve or return the week.' : (d.object.label ?? ''),
        url: '/time?view=approve',
        tag: d.object.type + '-' + d.object.id,
        object: { type: d.object.type, id: d.object.id },
        priority: 'normal',
      },
    ];
  }
  // [PCODE-185 | S15 | v0.1.0] a client's new request or reply reaches the account owner; a quote reaches the client's approvers
  if (d.object.type === 'client_request') {
    const r = (
      await c.query<{ client_id: string; owner_id: string | null; title: string }>(
        `SELECT r.client_id, cl.owner_id, r.title FROM client_requests r JOIN clients cl ON cl.id = r.client_id
          WHERE r.id = $1`,
        [d.object.id],
      )
    ).rows[0];
    if (!r) return [];
    const url = '/requests/' + d.object.id;
    const fromClient =
      d.verb === 'created'
        ? (
            await c.query('SELECT 1 FROM client_contacts WHERE client_id = $1 AND user_id = $2', [
              r.client_id,
              d.actor.id,
            ])
          ).rowCount !== 0
        : ch['from']?.to === 'client';
    if ((d.verb === 'created' || d.verb === 'commented') && fromClient && r.owner_id)
      return [
        {
          kind: 'mentions',
          userIds: [r.owner_id],
          title:
            (d.verb === 'created' ? 'New request from ' : 'Reply from ') +
            (d.parent?.label ?? 'a client') +
            ': ' +
            (d.object.label ?? ''),
          body: clip(r.title),
          url,
          tag: 'request-' + d.object.id,
          object: { type: 'client_request', id: d.object.id },
          priority: d.verb === 'created' ? 'high' : 'normal',
        },
      ];
    if (d.verb === 'updated' && ch['state']?.to === 'quoted') {
      const approvers = (
        await c.query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM client_contacts
            WHERE client_id = $1 AND portal_role IN ('sponsor', 'approver', 'product_owner')`,
          [r.client_id],
        )
      ).rows.map((x) => x.user_id);
      if (!approvers.length) return [];
      return [
        {
          kind: 'approvals',
          userIds: approvers,
          title: 'A quote waits for your approval: ' + (d.object.label ?? ''),
          body: 'See the cost and schedule, then approve or decline.',
          url,
          tag: 'request-' + d.object.id,
          object: { type: 'client_request', id: d.object.id },
          priority: 'high',
        },
      ];
    }
    return [];
  }
  return [];
}

interface Delivery {
  sub: PushSubscription & { id: string };
  payload: Record<string, unknown>;
}

const BATCH = 200;

/**
 * Handles one workspace's new events: every notice becomes an inbox entry for each recipient (once per
 * event), finished things close their entries, and the notices each person wants on their phone are sent.
 * Answers how many push notifications were sent.
 */
// [PCODE-162 | S15 | v0.1.0] the inbox is filled here, for every workspace, not only those with phones
export async function pumpWorkspace(
  pool: Pool,
  ws: string,
  deps: PushDeps & { keys: () => Promise<VapidKeys>; subject: string; now?: () => Date },
): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const deliveries = await inSystem(pool, async (c) => {
    // a workspace seen for the first time starts at its beginning; only recent events become notices
    await c.query(
      'INSERT INTO push_cursors (workspace_id, last_sequence) VALUES ($1, 0) ON CONFLICT (workspace_id) DO NOTHING',
      [ws],
    );
    const cur = (
      await c.query<{ last_sequence: string }>(
        'SELECT last_sequence FROM push_cursors WHERE workspace_id = $1 FOR UPDATE SKIP LOCKED',
        [ws],
      )
    ).rows[0];
    // another server is on it
    if (!cur) return [];
    const events = (
      await c.query<{ envelope: ActivityEvent }>(
        'SELECT envelope FROM activity_events WHERE workspace_id = $1 AND sequence > $2 ORDER BY sequence LIMIT $3',
        [ws, cur.last_sequence, BATCH],
      )
    ).rows.map((r) => r.envelope);
    const last = events[events.length - 1];
    if (!last) return [];
    const recent = now().getTime() - RECENT_MS;
    const notices: Notice[] = [];
    for (const e of events) {
      await closeFinished(c, ws, e);
      if (Date.parse(e.time) < recent) continue;
      for (const n of await noticesFor(c, e)) {
        // nobody is told about what they did themselves
        const self = e.data.actor.kind === 'user' && !n.evenToActor ? e.data.actor.id : null;
        n.userIds = n.userIds.filter((u) => u !== self);
        if (!n.userIds.length) continue;
        notices.push(n);
        await mailNotices(c, ws, n.userIds, n.kind, n, deps); // [PCODE-237 | S15 | v0.1.0]
        for (const u of n.userIds)
          await c.query(
            `INSERT INTO inbox_items (workspace_id, user_id, kind, project_id, object_type, object_id, title, detail, priority, event_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (user_id, event_id) WHERE event_id IS NOT NULL DO NOTHING`,
            [
              ws,
              u,
              INBOX_KIND[n.kind],
              e.projectid ?? null,
              n.object.type,
              n.object.id,
              n.title.slice(0, 300),
              n.body.slice(0, 4000),
              n.priority,
              e.id,
            ],
          );
      }
    }
    await c.query('UPDATE push_cursors SET last_sequence = $2 WHERE workspace_id = $1', [
      ws,
      last.sequence,
    ]);
    const out: Delivery[] = [];
    for (const n of notices) {
      // a person's rule for this kind decides; without one, phones get it
      const subs = (
        await c.query<
          PushSubscription & { id: string; timezone: string | null; quiet: QuietHours | null }
        >(
          `SELECT s.id, s.endpoint, s.p256dh, s.auth, mp.timezone, mp.quiet_hours AS quiet
           FROM push_subscriptions s
           LEFT JOIN notification_rules r ON r.user_id = s.user_id AND r.workspace_id = $2 AND r.event_kind = $3
           LEFT JOIN member_profiles mp ON mp.user_id = s.user_id AND mp.workspace_id = $2
           WHERE s.user_id = ANY($1::uuid[]) AND (r.channels IS NULL OR 'push' = ANY (r.channels))`,
          [n.userIds, ws, n.kind],
        )
      ).rows;
      for (const sub of subs) {
        if (isQuiet(now(), sub.timezone ?? 'UTC', sub.quiet, INBOX_KIND[n.kind])) continue;
        out.push({
          sub: { id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload: { title: n.title, body: n.body, url: n.url, tag: n.tag, workspaceId: ws },
        });
      }
    }
    return out;
  });
  return deliver(pool, deliveries, deps);
}

/** [PCODE-249 | S15 | v0.1.0] The notification rule each kind of direct notice follows. */
const RULE_KIND: Record<
  'mention' | 'message' | 'budget' | 'watch' | 'reminder' | 'security',
  string
> = {
  mention: 'mentions',
  message: 'mentions',
  budget: 'budgets',
  watch: 'watching',
  reminder: 'reminders',
  security: 'security', // [PCODE-322 | S15 | v0.1.0]
};

/**
 * [PCODE-234 | S15 | v0.1.0] A notice straight to people, for what never enters the activity feed (a
 * mention in a conversation, a direct message): an inbox entry each, then the devices their rules and
 * quiet hours allow. Mentions follow the "mentions" rule; direct messages too.
 */
export async function noticeNow(
  pool: Pool,
  ws: string,
  notice: Omit<Notice, 'kind'> & {
    // [PCODE-249 | S15 | v0.1.0] alerts and reminders too, each with its own rule kind
    inboxKind: 'mention' | 'message' | 'budget' | 'watch' | 'reminder' | 'security';
    projectId?: string | null;
  },
  deps: PushDeps & { subject: string },
  now: () => Date = () => new Date(),
): Promise<number> {
  if (!notice.userIds.length) return 0;
  const ruleKind = RULE_KIND[notice.inboxKind];
  const list = await inSystem(pool, async (c) => {
    for (const u of notice.userIds)
      await c.query(
        `INSERT INTO inbox_items (workspace_id, user_id, kind, project_id, object_type, object_id, title, detail, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ws,
          u,
          notice.inboxKind,
          notice.projectId ?? null,
          notice.object.type,
          notice.object.id,
          notice.title.slice(0, 300),
          notice.body.slice(0, 4000),
          notice.priority,
        ],
      );
    await mailNotices(c, ws, notice.userIds, ruleKind, notice, deps); // [PCODE-237 | S15 | v0.1.0]
    const subs = (
      await c.query<
        PushSubscription & { id: string; timezone: string | null; quiet: QuietHours | null }
      >(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth, mp.timezone, mp.quiet_hours AS quiet
         FROM push_subscriptions s
         LEFT JOIN notification_rules r ON r.user_id = s.user_id AND r.workspace_id = $2 AND r.event_kind = $3
         LEFT JOIN member_profiles mp ON mp.user_id = s.user_id AND mp.workspace_id = $2
         WHERE s.user_id = ANY($1::uuid[]) AND (r.channels IS NULL OR 'push' = ANY (r.channels))`,
        [notice.userIds, ws, ruleKind],
      )
    ).rows;
    const out: Delivery[] = [];
    for (const sub of subs) {
      if (isQuiet(now(), sub.timezone ?? 'UTC', sub.quiet, notice.inboxKind)) continue;
      out.push({
        sub: { id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload: {
          title: notice.title,
          body: notice.body,
          url: notice.url,
          tag: notice.tag,
          workspaceId: ws,
        },
      });
    }
    return out;
  });
  return deliver(pool, list, { ...deps, keys: () => vapidKeys(pool) });
}

/**
 * [PCODE-237 | S15 | v0.1.0] Notices by mail, to people whose rule for this kind includes email (it is
 * off unless they chose it). Without a mail server nothing is queued.
 */
async function mailNotices(
  c: PoolClient,
  ws: string,
  userIds: readonly string[],
  ruleKind: string, // [PCODE-249 | S15 | v0.1.0] a push kind, or the rule kind of an alert
  n: { title: string; body: string; url: string; object?: { type: string; id: string } },
  deps: PushDeps,
): Promise<void> {
  if (!deps.mail || !userIds.length) return;
  // [PCODE-348 | S15 | v0.1.0] a notice about a conversation can be answered by mail when email-in is set up
  const inbound =
    n.object?.type === 'channel'
      ? (
          await c.query<{ domain: string }>(
            'SELECT domain FROM email_inbound WHERE workspace_id = $1',
            [ws],
          )
        ).rows[0]?.domain
      : undefined;
  const people = (
    await c.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM notification_rules r JOIN users u ON u.id = r.user_id
        WHERE r.workspace_id = $1 AND r.user_id = ANY($2::uuid[]) AND r.event_kind = $3 AND 'email' = ANY (r.channels)`,
      [ws, userIds, ruleKind],
    )
  ).rows;
  for (const p of people)
    await queueMail(c, {
      ...noticeMail({
        title: n.title,
        body: n.body,
        url: (deps.publicUrl ?? '').replace(/\/$/, '') + n.url,
      }),
      to: p.email,
      kind: 'notice',
      workspaceId: ws,
      ...(inbound && n.object
        ? {
            replyTo:
              'reply+' +
              (await replyToken(
                c,
                ws,
                p.id,
                n.object.id,
                /[?&]thread=([0-9a-f-]{36})/.exec(n.url)?.[1] ?? null,
              )) +
              '@' +
              inbound,
          }
        : {}),
    });
}

/** [PCODE-348 | S15 | v0.1.0] The token of a person's reply address for a conversation (or one of its threads). */
async function replyToken(
  c: PoolClient,
  ws: string,
  userId: string,
  channelId: string,
  parentId: string | null,
): Promise<string> {
  const have = (
    await c.query<{ token: string }>(
      `SELECT token FROM email_tokens WHERE kind = 'reply' AND user_id = $1 AND channel_id = $2
          AND parent_id IS NOT DISTINCT FROM $3`,
      [userId, channelId, parentId],
    )
  ).rows[0]?.token;
  if (have) return have;
  const token = randomBytes(16).toString('hex');
  await c.query(
    "INSERT INTO email_tokens (token, workspace_id, kind, user_id, channel_id, parent_id) VALUES ($1, $2, 'reply', $3, $4, $5)",
    [token, ws, userId, channelId, parentId],
  );
  return token;
}

/** [PCODE-162 | S15 | v0.1.0] Notices older than this when first seen are not sent or filed. */
const RECENT_MS = 24 * 3600 * 1000;

/** [PCODE-162 | S15 | v0.1.0] A decision or a signature closes what waited for it, in every inbox. */
async function closeFinished(c: PoolClient, ws: string, e: ActivityEvent): Promise<void> {
  const d = e.data;
  const ch = d.changes ?? {};
  let object: { type: string; id: string } | null = null;
  if (
    d.object.type === 'agent_run' &&
    (ch['decision'] || (ch['status'] && ch['status'].from === 'waiting'))
  )
    object = { type: 'agent_run', id: d.object.id };
  if (d.object.type === 'gate' && (d.verb === 'approved' || d.verb === 'rejected'))
    object = { type: 'gate', id: d.object.id };
  if (!object) return;
  await c.query(
    `UPDATE inbox_items SET state = 'done', done_at = now()
     WHERE workspace_id = $1 AND object_type = $2 AND object_id = $3 AND state <> 'done'`,
    [ws, object.type, object.id],
  );
}

/** Cursors start at "now" for every workspace of people with a subscribed device. */
export async function startCursors(
  c: PoolClient,
  ws: string | null,
  userId?: string,
): Promise<void> {
  await c.query(
    `INSERT INTO push_cursors (workspace_id, last_sequence)
     SELECT w.id, coalesce((SELECT max(sequence) FROM activity_events e WHERE e.workspace_id = w.id), 0)
     FROM workspaces w
     WHERE ($1::uuid IS NULL OR w.id = $1)
       AND EXISTS (
         SELECT 1 FROM workspace_members m JOIN push_subscriptions s ON s.user_id = m.user_id
         WHERE m.workspace_id = w.id AND ($2::uuid IS NULL OR m.user_id = $2))
     ON CONFLICT (workspace_id) DO NOTHING`,
    [ws, userId ?? null],
  );
}

/** Sends, and forgets the devices whose browser unsubscribed. */
export async function deliver(
  pool: Pool,
  list: Delivery[],
  deps: PushDeps & { keys: () => Promise<VapidKeys>; subject: string },
): Promise<number> {
  if (!list.length) return 0;
  const keys = await deps.keys();
  let sent = 0;
  for (const { sub, payload } of list) {
    if (!allowedEndpoint(new URL(sub.endpoint), deps)) continue;
    const r = await sendPush(sub, payload, keys, deps.subject, deps.fetch);
    if (r === 'ok') sent++;
    if (r === 'ok' || r === 'gone')
      await inSystem(pool, (c) =>
        r === 'gone'
          ? c.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id])
          : c.query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [sub.id]),
      );
  }
  return sent;
}

/** Wakes on every committed event and polls now and then for what a lost wake-up missed. */
const ALERT_EVERY_MS = 5 * 60_000; // [PCODE-249 | S15 | v0.1.0]

export class PushWorker {
  private listener: PoolClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private keys: Promise<VapidKeys> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly deps: PushDeps & {
      subject: string;
      pollMs?: number;
      fx?: FxDeps; // [PCODE-327 | S15 | v0.1.0]
      log?: (msg: string, data?: Record<string, unknown>) => void;
    },
  ) {}

  async start(): Promise<void> {
    this.listener = await this.pool.connect();
    this.listener.on('notification', (msg) => {
      if (msg.channel === EVENTS_CHANNEL && msg.payload) void this.wake(msg.payload);
    });
    await this.listener.query('LISTEN ' + EVENTS_CHANNEL);
    this.timer = setInterval(() => {
      void this.pollAll();
    }, this.deps.pollMs ?? 30_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const l = this.listener;
    this.listener = null;
    if (l) {
      await l.query('UNLISTEN *').catch(() => undefined);
      l.release();
    }
    await this.chain;
  }

  /** One workspace at a time, in order. */
  wake(ws: string): Promise<unknown> {
    this.chain = this.chain
      .then(() =>
        pumpWorkspace(this.pool, ws, {
          ...this.deps,
          keys: () => (this.keys ??= vapidKeys(this.pool)),
        }),
      )
      .catch((e: unknown) => {
        this.deps.log?.('push delivery failed', {
          workspaceId: ws,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return this.chain;
  }

  // [PCODE-249 | S15 | v0.1.0] alerts and reminders, every few minutes on the poll
  private alertsAt = 0;
  private alerting = false;

  private async pollAll(): Promise<void> {
    if (!this.alerting && Date.now() - this.alertsAt >= ALERT_EVERY_MS) {
      this.alerting = true;
      this.alertsAt = Date.now();
      void alertRound(this.pool, this.deps)
        .catch((e: unknown) => {
          this.deps.log?.('alerts failed', { error: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => {
          this.alerting = false;
        });
    }
    const rows = await inSystem(this.pool, (c) =>
      c.query<{ workspace_id: string }>('SELECT workspace_id FROM push_cursors'),
    ).catch(() => null);
    for (const r of rows?.rows ?? []) void this.wake(r.workspace_id);
  }
}
