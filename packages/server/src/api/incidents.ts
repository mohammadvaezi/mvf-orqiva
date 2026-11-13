// ── [PCODE-340 | S15 | v0.1.0] T34.2a Automatic alerts from probes and failed deploys; Sentry and Alertmanager sources with signed webhooks ──
// ── [PCODE-237 | S15 | v0.1.0] T23.4 Email as a channel: own SMTP sender, password reset, invitations, digests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
//    Why:  from the first alert to the postmortem, in one place. Monitoring posts alerts (with an access
//          token); the same key while open is the same alert seen again, and a SEV-1/2 one opens an incident
//          and pages whoever is on call. An incident keeps a timeline, roles and updates (a client update
//          reaches their status page), names the deploys that may have caused it and rolls back to the last
//          good one. Nobody acknowledging escalates step by step. Afterwards the postmortem is drafted from
//          the timeline and its actions become tasks; reliability shows how fast the team reacts and how
//          much error budget is left.
// ── [PCODE-342 | S15 | v0.1.0] T34.2c AI postmortems and runbooks matched to incidents ──
import { queueMail } from '../mail/outbox.js'; // [PCODE-237 | S15 | v0.1.0]
import { statusUpdateMail } from '../mail/templates.js';
import {
  durationText,
  errorBudgetLeft,
  localDay,
  median,
  onCallAt,
  pagesBySeverity,
  severityText,
  type Actor,
  type IncidentSeverity,
  type Rotation,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { postmortemActions } from '@orqiva/shared'; // [PCODE-342 | S15 | v0.1.0]
import { askAgent } from '../agents/oneshot.js'; // [PCODE-342 | S15 | v0.1.0]
import { MODE_POSTMORTEM } from '../agents/provider.js'; // [PCODE-342 | S15 | v0.1.0]
import type { ProviderFor } from '../agents/runner.js'; // [PCODE-342 | S15 | v0.1.0]
import { noteRunbooks } from './runbooks.js'; // [PCODE-342 | S15 | v0.1.0]
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { queueDeploy } from './deploys.js';

const uuid = s.string({ format: 'uuid' });
const SEV = s.enum(['sev1', 'sev2', 'sev3', 'sev4']);
const STATE = s.enum(['investigating', 'identified', 'mitigated', 'resolved']);
const isAdmin = (a: Pick<Access, 'role'>): boolean => a.role === 'admin' || a.role === 'owner';
const DAY = 86_400_000;

interface Step {
  afterMinutes: number;
  target: 'primary' | 'backup' | 'admins' | 'user';
  userId?: string;
}

interface ScheduleRow {
  id: string;
  name: string;
  project_ids: string[];
  member_ids: string[];
  rotation_days: number;
  handoff_time: string;
  timezone: string;
  starts_on: string;
  escalation: Step[];
}

const SCHEDULE_SELECT = `SELECT id, name, project_ids, member_ids, rotation_days, to_char(handoff_time, 'HH24:MI') AS handoff_time,
    timezone, starts_on::text AS starts_on, escalation FROM oncall_schedules`;

const rotationOf = (r: ScheduleRow): Rotation => ({
  memberIds: r.member_ids,
  rotationDays: r.rotation_days,
  handoffTime: r.handoff_time,
  timezone: r.timezone,
  startsOn: r.starts_on,
});

/** Who is on call for a schedule at an instant: rotation, swaps and approved leave from Time. */
async function whoIsOn(c: PoolClient, sch: ScheduleRow, at: Date) {
  const swaps = (
    await c.query<{ user_id: string; starts_at: Date; ends_at: Date }>(
      "SELECT user_id, starts_at, ends_at FROM oncall_shifts WHERE schedule_id = $1 AND ends_at > $2::timestamptz - interval '1 day' AND starts_at < $2::timestamptz + interval '8 days'",
      [sch.id, at],
    )
  ).rows.map((x) => ({ userId: x.user_id, startsAt: x.starts_at, endsAt: x.ends_at }));
  const leave = (
    await c.query<{ user_id: string; starts_on: string; ends_on: string }>(
      `SELECT user_id, starts_on::text AS starts_on, ends_on::text AS ends_on FROM absences
        WHERE state = 'approved' AND NOT half_day AND user_id = ANY($1::uuid[])`,
      [sch.member_ids],
    )
  ).rows;
  const away = (id: string, d: string): boolean =>
    leave.some((x) => x.user_id === id && d >= x.starts_on && d <= x.ends_on);
  return onCallAt(rotationOf(sch), at, { swaps, away });
}

/** The rotation that covers a project (its own, else one for all projects). */
async function scheduleFor(
  c: PoolClient,
  projectId: string | null,
): Promise<ScheduleRow | undefined> {
  return (
    await c.query<ScheduleRow>(
      SCHEDULE_SELECT +
        ` WHERE cardinality(member_ids) > 0 AND ($1::uuid = ANY(project_ids) OR cardinality(project_ids) = 0)
          ORDER BY ($1::uuid = ANY(project_ids)) DESC, created_at LIMIT 1`,
      [projectId],
    )
  ).rows[0];
}

async function adminsOf(c: PoolClient): Promise<string[]> {
  return (
    await c.query<{ user_id: string }>(
      "SELECT user_id FROM workspace_members WHERE role IN ('admin', 'owner') AND suspended_at IS NULL",
    )
  ).rows.map((r) => r.user_id);
}

async function namesOf(c: PoolClient, ids: string[]): Promise<string> {
  if (!ids.length) return '';
  return (
    await c.query<{ name: string }>(
      'SELECT name FROM users WHERE id = ANY($1::uuid[]) ORDER BY name',
      [ids],
    )
  ).rows
    .map((r) => r.name)
    .join(', ');
}

type Actorish = Pick<Access, 'workspaceId' | 'role'> & { user: { id: string; name: string } };

const SYSTEM_ID = '00000000-0000-4000-8000-000000000000';
/** The person acting, or the system when escalation pages on its own. */
const actorFor = (a: Actorish): Actor =>
  a.user.id === SYSTEM_ID
    ? // [PCODE-340 | S15 | v0.1.0] monitoring raises alerts as the system too
      {
        kind: 'system',
        id: a.user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: a.user.name,
      }
    : actorOf(a as Access);

async function timeline(
  c: PoolClient,
  ws: string,
  incidentId: string,
  authorId: string | null,
  kind: string,
  text: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await c.query(
    // clock_timestamp: several lines written in one transaction keep their order
    'INSERT INTO incident_events (workspace_id, incident_id, author_id, kind, text, data, at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())',
    [ws, incidentId, authorId, kind, text.slice(0, 4000), JSON.stringify(data)],
  );
}

/** Pages people about an incident: the timeline says who, the inbox and phones tell them. */
async function page(
  c: PoolClient,
  a: Actorish,
  inc: { id: string; number: number; title: string; severity: string },
  userIds: string[],
  why: string,
): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  await timeline(
    c,
    a.workspaceId,
    inc.id,
    null,
    'escalated',
    'Paged ' + (await namesOf(c, ids)) + ' (' + why + ')',
    {
      userIds: ids,
    },
  );
  await recordEvent(c, a.workspaceId, {
    actor: actorFor(a),
    verb: 'updated',
    object: {
      type: 'incident',
      id: inc.id,
      label: 'INC-' + String(inc.number) + ' ' + severityText(inc.severity) + ' ' + inc.title,
    },
    changes: { paged: { from: null, to: ids } },
  });
}

/** Opens an incident and pages whoever is on call for its project. */
async function declare(
  c: PoolClient,
  a: Actorish,
  d: {
    title: string;
    severity: IncidentSeverity;
    projectId: string | null;
    environmentId: string | null;
    commanderId: string | null;
    why: string;
  },
): Promise<{ id: string; number: number }> {
  const no = (
    await c.query<{ no: number }>(
      'UPDATE workspaces SET next_incident_no = next_incident_no + 1 WHERE id = $1 RETURNING next_incident_no - 1 AS no',
      [a.workspaceId],
    )
  ).rows[0]?.no;
  if (!no) throw new Error('incident number missing');
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO incidents (workspace_id, number, project_id, environment_id, severity, title, commander_id, declared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        a.workspaceId,
        no,
        d.projectId,
        d.environmentId,
        d.severity,
        d.title,
        d.commanderId,
        a.user.id === SYSTEM_ID ? null : a.user.id, // [PCODE-340 | S15 | v0.1.0]
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('incident insert returned nothing');
  await timeline(
    c,
    a.workspaceId,
    id,
    a.user.id === SYSTEM_ID ? null : a.user.id,
    'declared',
    d.why,
  );
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorFor(a),
      verb: 'created',
      object: {
        type: 'incident',
        id,
        label: 'INC-' + String(no) + ' ' + severityText(d.severity) + ' ' + d.title,
      },
    },
    d.projectId ? { projectId: d.projectId } : {},
  );
  const sch = await scheduleFor(c, d.projectId);
  const inc = { id, number: no, title: d.title, severity: d.severity };
  if (sch) {
    const on = await whoIsOn(c, sch, new Date());
    if (on.primary) await page(c, a, inc, [on.primary], 'on call, ' + sch.name);
  } else await page(c, a, inc, await adminsOf(c), 'no on-call rotation: the admins');
  return { id, number: no };
}

/** Escalation: unacknowledged incidents page the next step when its minutes have passed. */
export async function escalateDue(pool: Pool, now = new Date()): Promise<number> {
  return inSystem(pool, async (c) => {
    const open = (
      await c.query<{
        id: string;
        workspace_id: string;
        number: number;
        title: string;
        severity: string;
        project_id: string | null;
        declared_at: Date;
        escalation_step: number;
      }>(
        `SELECT id, workspace_id, number, title, severity, project_id, declared_at, escalation_step FROM incidents
          WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND declared_at > now() - interval '2 days'`,
      )
    ).rows;
    let paged = 0;
    for (const inc of open) {
      await c.query("SELECT set_config('app.workspace_id', $1, true)", [inc.workspace_id]);
      const sch = await scheduleFor(c, inc.project_id);
      const steps = [
        ...(sch?.escalation ?? [{ afterMinutes: 15, target: 'admins' as const }]),
      ].sort((x, y) => x.afterMinutes - y.afterMinutes);
      const elapsed = (now.getTime() - inc.declared_at.getTime()) / 60_000;
      const due = steps.filter((x) => x.afterMinutes <= elapsed).length;
      if (due <= inc.escalation_step) continue;
      const on = sch ? await whoIsOn(c, sch, now) : { primary: null, backup: null };
      const a: Actorish = {
        workspaceId: inc.workspace_id,
        role: 'owner',
        user: { id: SYSTEM_ID, name: 'Escalation' },
      };
      for (const st of steps.slice(inc.escalation_step, due)) {
        const ids =
          st.target === 'primary'
            ? [on.primary ?? '']
            : st.target === 'backup'
              ? [on.backup ?? '']
              : st.target === 'user'
                ? [st.userId ?? '']
                : await adminsOf(c);
        await page(
          c,
          a,
          inc,
          ids.filter(Boolean),
          'not acknowledged after ' + durationText(st.afterMinutes),
        );
        paged += 1;
      }
      await c.query(
        'UPDATE incidents SET escalation_step = $2, escalated_at = now() WHERE id = $1',
        [inc.id, due],
      );
    }
    return paged;
  });
}

interface IncidentRow {
  id: string;
  number: number;
  project_id: string | null;
  project_key: string | null;
  client_name: string | null;
  environment_id: string | null;
  environment_name: string | null;
  severity: string;
  title: string;
  state: string;
  commander_id: string | null;
  commander: string | null;
  comms_id: string | null;
  comms: string | null;
  declared_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by_name: string | null;
  mitigated_at: Date | null;
  resolved_at: Date | null;
  cause_deploy_id: string | null;
  postmortem: string;
  postmortem_actions: { text: string; itemId?: string; itemRef?: string }[];
  postmortem_shared: boolean;
  alerts: string;
}

const INCIDENT_SELECT = `SELECT x.id, x.number, x.project_id, p.key AS project_key, cl.name AS client_name, x.environment_id,
    e.name AS environment_name, x.severity, x.title, x.state, x.commander_id, uc.name AS commander, x.comms_id, um.name AS comms,
    x.declared_at, x.acknowledged_at, ua.name AS acknowledged_by_name, x.mitigated_at, x.resolved_at, x.cause_deploy_id,
    x.postmortem, x.postmortem_actions, x.postmortem_shared,
    (SELECT coalesce(sum(count), 0) FROM alerts al WHERE al.incident_id = x.id) AS alerts
  FROM incidents x LEFT JOIN projects p ON p.id = x.project_id LEFT JOIN clients cl ON cl.id = p.client_id
  LEFT JOIN environments e ON e.id = x.environment_id LEFT JOIN users uc ON uc.id = x.commander_id
  LEFT JOIN users um ON um.id = x.comms_id LEFT JOIN users ua ON ua.id = x.acknowledged_by`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function incidentJson(r: IncidentRow, now = new Date()) {
  const end = r.resolved_at ?? now;
  return {
    id: r.id,
    ref: 'INC-' + String(r.number),
    number: r.number,
    projectId: r.project_id,
    projectKey: r.project_key,
    clientName: r.client_name,
    environmentId: r.environment_id,
    environmentName: r.environment_name,
    severity: r.severity,
    severityText: severityText(r.severity),
    title: r.title,
    state: r.state,
    commander: r.commander_id ? { id: r.commander_id, name: r.commander ?? '' } : null,
    comms: r.comms_id ? { id: r.comms_id, name: r.comms ?? '' } : null,
    declaredAt: r.declared_at.toISOString(),
    acknowledgedAt: iso(r.acknowledged_at),
    acknowledgedBy: r.acknowledged_by_name,
    mitigatedAt: iso(r.mitigated_at),
    resolvedAt: iso(r.resolved_at),
    openFor: durationText((end.getTime() - r.declared_at.getTime()) / 60_000),
    causeDeployId: r.cause_deploy_id,
    postmortem: r.postmortem,
    postmortemActions: r.postmortem_actions,
    postmortemShared: r.postmortem_shared,
    alerts: Number(r.alerts),
  };
}

async function loadIncident(c: PoolClient, id: string): Promise<IncidentRow> {
  const r = (await c.query<IncidentRow>(INCIDENT_SELECT + ' WHERE x.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Incident not found');
  return r;
}

function teamOnly(a: Access): void {
  if (a.clientId || a.role === 'guest')
    throw new HttpError(
      403,
      'forbidden',
      'Incidents are for the team; clients see their status page',
    );
}

/** Deploys of the incident's project in the day before it: the same environment shortly before first. */
async function suspects(c: PoolClient, inc: IncidentRow) {
  if (!inc.project_id) return [];
  const rows = (
    await c.query<{
      id: string;
      environment_id: string;
      environment: string;
      ref: string;
      status: string;
      trigger: string;
      requested_by: string | null;
      finished_at: Date | null;
      created_at: Date;
    }>(
      `SELECT d.id, d.environment_id, e.name AS environment, d.ref, d.status, d.trigger, u.name AS requested_by,
          d.finished_at, d.created_at
         FROM deploy_runs d JOIN environments e ON e.id = d.environment_id LEFT JOIN users u ON u.id = d.requested_by
        WHERE d.project_id = $1 AND d.created_at <= $2 AND d.created_at > $2::timestamptz - interval '24 hours'
        ORDER BY d.created_at DESC LIMIT 10`,
      [inc.project_id, inc.declared_at],
    )
  ).rows;
  return rows.map((d) => {
    const minutes = (inc.declared_at.getTime() - d.created_at.getTime()) / 60_000;
    const sameEnv = !inc.environment_id || d.environment_id === inc.environment_id;
    const likely =
      d.id === inc.cause_deploy_id || (sameEnv && d.status === 'succeeded' && minutes <= 120);
    return {
      id: d.id,
      environmentId: d.environment_id,
      environment: d.environment,
      ref: d.ref,
      status: d.status,
      trigger: d.trigger,
      by: d.requested_by,
      at: d.created_at.toISOString(),
      before: durationText(minutes),
      likelihood: d.id === inc.cause_deploy_id ? 'cause' : likely ? 'likely' : 'unlikely',
    };
  });
}

// [PCODE-342 | S15 | v0.1.0] what the DevOps agent is asked, and what it reads
export const POSTMORTEM_PROMPT =
  MODE_POSTMORTEM +
  ' Write a blameless postmortem of the incident below in Markdown, in plain words, with exactly these' +
  ' sections: "### What happened" (two or three sentences), "### Timeline (UTC)" (the important lines),' +
  ' "### Why" (the most likely cause and why it was not caught; say when you are not sure), "### Impact"' +
  ' (who noticed and for how long) and "### Actions" (a list of three to six concrete follow-ups, one' +
  ' line each). Use only what the incident says; do not invent facts.';

async function postmortemBrief(c: PoolClient, inc: IncidentRow): Promise<string> {
  const j = incidentJson(inc);
  const lines = (
    await c.query<{ at: Date; text: string }>(
      'SELECT at, text FROM incident_events WHERE incident_id = $1 ORDER BY at, id',
      [inc.id],
    )
  ).rows;
  const updates = (
    await c.query<{ created_at: Date; audience: string; body: string }>(
      'SELECT created_at, audience, body FROM incident_updates WHERE incident_id = $1 ORDER BY created_at',
      [inc.id],
    )
  ).rows;
  return [
    'Incident: ' + j.ref + ' ' + j.severityText + ' ' + inc.title,
    'Project: ' +
      (inc.project_key ?? '(none)') +
      (inc.environment_name ? ', ' + inc.environment_name : ''),
    'Declared: ' + inc.declared_at.toISOString() + ', open for ' + j.openFor,
    'Resolved: ' + (inc.resolved_at ? inc.resolved_at.toISOString() : 'not yet'),
    'Alerts: ' + inc.alerts,
    '',
    'Timeline:',
    ...lines.map((l) => '- ' + l.at.toISOString().slice(0, 16).replace('T', ' ') + ' ' + l.text),
    ...(updates.length
      ? [
          '',
          'Updates sent:',
          ...updates.map(
            (u) =>
              '- ' +
              u.created_at.toISOString().slice(0, 16).replace('T', ' ') +
              ' to ' +
              u.audience +
              ': ' +
              u.body,
          ),
        ]
      : []),
  ].join('\n');
}

/** A first postmortem from what the timeline knows; people fill in the why. */
export function draftPostmortem(
  actions: readonly string[],
  inc: {
    ref: string;
    severityText: string;
    title: string;
    projectKey: string | null;
    declaredAt: string;
    openFor: string;
  },
  lines: { at: string; text: string }[],
): string {
  const hm = (iso: string): string => iso.slice(11, 16);
  return [
    '### What happened',
    '',
    inc.severityText +
      ' ' +
      inc.title +
      (inc.projectKey ? ' (' + inc.projectKey + ')' : '') +
      ', declared ' +
      inc.declaredAt.slice(0, 10) +
      ' ' +
      hm(inc.declaredAt) +
      ' UTC, open for ' +
      inc.openFor +
      '.',
    '',
    '### Timeline (UTC)',
    '',
    ...lines.map((l) => '- ' + hm(l.at) + ' ' + l.text),
    '',
    '### Why',
    '',
    'What caused it, and why it was not caught before: to be written by the team.',
    '',
    '### What we change',
    '',
    ...(actions.length ? actions.map((x) => '- ' + x) : ['The actions below become tasks.']),
  ].join('\n');
}

/** On-call turns are for people of the workspace, not service accounts. */
async function peopleOnly(c: PoolClient, ids: readonly string[]): Promise<void> {
  const ok = (
    await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.user_id = ANY($1::uuid[]) AND NOT u.is_service AND m.role NOT IN ('guest', 'auditor', 'billing')`,
      [ids],
    )
  ).rows[0]?.n;
  if (Number(ok ?? 0) !== new Set(ids).size)
    throw new HttpError(400, 'invalid_request', 'Only people of the team take on-call turns', [
      {
        path: 'body.memberIds',
        message: 'names a service account, a guest or someone outside the team',
      },
    ]);
}

// [PCODE-340 | S15 | v0.1.0] one way in for every alert: the API, a probe, a deploy, Sentry, Alertmanager
export interface AlertIn {
  source: string;
  key: string;
  severity: IncidentSeverity;
  title: string;
  projectKey?: string | undefined;
  projectId?: string | null | undefined;
  environment?: string | undefined;
  environmentId?: string | null | undefined;
  details?: Record<string, unknown> | undefined;
  resolved?: boolean | undefined;
}

/** The system as the actor of an alert nobody sent by hand. */
export const systemActor = (workspaceId: string, name: string): Actorish => ({
  workspaceId,
  role: 'owner',
  user: { id: SYSTEM_ID, name },
});

/** Groups an alert with the open one of its key, clears it, or opens it (and an incident for SEV-1/2). */
export async function ingestAlert(
  c: PoolClient,
  a: Actorish,
  body: AlertIn,
): Promise<{
  alertId: string | null;
  incidentId: string | null;
  count?: number;
  resolved?: boolean;
}> {
  // [PCODE-340 | S15 | v0.1.0] a source or a probe names the project by id
  const project = body.projectId
    ? { id: body.projectId }
    : body.projectKey
      ? (
          await c.query<{ id: string }>('SELECT id FROM projects WHERE upper(key) = upper($1)', [
            body.projectKey,
          ])
        ).rows[0]
      : undefined;
  if (body.projectKey && !project)
    throw new HttpError(400, 'invalid_request', 'Unknown project', [
      { path: 'body.projectKey', message: 'is not a project of this workspace' },
    ]);
  const env = body.environmentId
    ? { id: body.environmentId }
    : project && body.environment
      ? (
          await c.query<{ id: string }>(
            'SELECT id FROM environments WHERE project_id = $1 AND (key = $2 OR lower(name) = lower($2))',
            [project.id, body.environment],
          )
        ).rows[0]
      : undefined;
  const open = (
    await c.query<{ id: string; incident_id: string | null; count: number }>(
      "SELECT id, incident_id, count FROM alerts WHERE dedupe_key = $1 AND status = 'open'",
      [body.key],
    )
  ).rows[0];
  if (body.resolved) {
    if (!open) return { alertId: null, incidentId: null, resolved: true };
    await c.query("UPDATE alerts SET status = 'resolved', last_at = now() WHERE id = $1", [
      open.id,
    ]);
    if (open.incident_id)
      await timeline(
        c,
        a.workspaceId,
        open.incident_id,
        null,
        'alert',
        'Alert cleared: ' + body.title,
      );
    return { alertId: open.id, incidentId: open.incident_id, resolved: true };
  }
  if (open) {
    await c.query(
      'UPDATE alerts SET count = count + 1, last_at = now(), details = $2 WHERE id = $1',
      [open.id, JSON.stringify(body.details ?? {})],
    );
    return { alertId: open.id, incidentId: open.incident_id, count: open.count + 1 };
  }
  const alertId = (
    await c.query<{ id: string }>(
      `INSERT INTO alerts (workspace_id, project_id, environment_id, source, dedupe_key, severity, title, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        a.workspaceId,
        project?.id ?? null,
        env?.id ?? null,
        body.source,
        body.key,
        body.severity,
        body.title,
        JSON.stringify(body.details ?? {}),
      ],
    )
  ).rows[0]?.id;
  let incidentId: string | null = null;
  if (pagesBySeverity(body.severity)) {
    // an open incident on the same project takes the alert; otherwise a new one opens
    const existing = (
      await c.query<{ id: string }>(
        `SELECT id FROM incidents WHERE resolved_at IS NULL AND project_id IS NOT DISTINCT FROM $1
            AND declared_at > now() - interval '6 hours' ORDER BY declared_at DESC LIMIT 1`,
        [project?.id ?? null],
      )
    ).rows[0];
    incidentId =
      existing?.id ??
      (
        await declare(c, a, {
          title: body.title,
          severity: body.severity,
          projectId: project?.id ?? null,
          environmentId: env?.id ?? null,
          commanderId: null,
          why: 'Opened by an alert from ' + body.source,
        })
      ).id;
    await c.query('UPDATE alerts SET incident_id = $2 WHERE id = $1', [alertId, incidentId]);
    await timeline(
      c,
      a.workspaceId,
      incidentId,
      null,
      'alert',
      'Alert from ' + body.source + ': ' + body.title,
      {
        alertId,
      },
    );
    // [PCODE-342 | S15 | v0.1.0] the runbooks its words match, once each
    await noteRunbooks(c, a.workspaceId, incidentId);
  }
  return { alertId: alertId ?? null, incidentId, count: 1 };
}

export function incidentRoutes(
  pool: Pool,
  // [PCODE-237 | S15 | v0.1.0] with a mail server, a client update is mailed to the client's contacts
  // [PCODE-342 | S15 | v0.1.0] with models, the DevOps agent drafts a postmortem
  deps: { mail?: boolean; publicUrl?: string; models?: ProviderFor } = {},
): Route[] {
  // ── alerts ──
  const alert = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/alerts',
    summary:
      'An alert from monitoring (use an access token): grouped by key; SEV-1/2 opens an incident',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      source: s.string({ min: 1, max: 60 }),
      key: s.string({ min: 1, max: 200 }),
      severity: SEV,
      title: s.string({ min: 1, max: 200 }),
      projectKey: s.optional(s.string({ max: 20 })),
      environment: s.optional(s.string({ max: 60 })),
      details: s.optional(s.anyObject()),
      resolved: s.optional(s.boolean()),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        return { status: 201, body: await ingestAlert(c, a, body) };
      }),
  });

  // ── incidents ──
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/incidents',
    summary: 'Incidents, open first; with who is on call now',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ all: s.optional(s.enum(['1', '0'])) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        teamOnly(a);
        const rows = (
          await c.query<IncidentRow>(
            INCIDENT_SELECT +
              ` WHERE ($1 OR x.resolved_at IS NULL OR x.resolved_at > now() - interval '30 days')
                ORDER BY (x.resolved_at IS NULL) DESC, x.declared_at DESC LIMIT 100`,
            [query.all === '1'],
          )
        ).rows;
        const sch = await scheduleFor(c, null);
        const on = sch ? await whoIsOn(c, sch, new Date()) : null;
        const alerts = (
          await c.query<{
            id: string;
            title: string;
            severity: string;
            count: number;
            source: string;
            last_at: Date;
          }>(
            "SELECT id, title, severity, count, source, last_at FROM alerts WHERE status = 'open' AND incident_id IS NULL ORDER BY last_at DESC LIMIT 20",
          )
        ).rows;
        return {
          body: {
            incidents: rows.map((r) => incidentJson(r)),
            onCall: on
              ? {
                  schedule: sch?.name ?? '',
                  primary: on.primary
                    ? { id: on.primary, name: await namesOf(c, [on.primary]) }
                    : null,
                  backup: on.backup ? { id: on.backup, name: await namesOf(c, [on.backup]) } : null,
                }
              : null,
            alerts: alerts.map((x) => ({
              id: x.id,
              title: x.title,
              severity: x.severity,
              count: x.count,
              source: x.source,
              lastAt: x.last_at.toISOString(),
            })),
          },
        };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/incidents',
    summary: 'Declare an incident; the declarer leads it and whoever is on call is paged',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      title: s.string({ min: 1, max: 200 }),
      severity: SEV,
      projectId: s.optional(uuid),
      environmentId: s.optional(uuid),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        if (body.projectId) await requireProject(c, a, body.projectId);
        const made = await declare(c, a, {
          title: body.title.trim(),
          severity: body.severity,
          projectId: body.projectId ?? null,
          environmentId: body.environmentId ?? null,
          commanderId: a.user.id,
          why: 'Declared by ' + a.user.name,
        });
        return { status: 201, body: incidentJson(await loadIncident(c, made.id)) };
      }),
  });

  const detail = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId',
    summary: 'An incident with its timeline, updates, suspect deploys and who is on call',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        const events = (
          await c.query<{
            id: string;
            at: Date;
            kind: string;
            text: string;
            author: string | null;
            author_id: string | null;
          }>(
            `SELECT ev.id, ev.at, ev.kind, ev.text, u.name AS author, ev.author_id FROM incident_events ev
               LEFT JOIN users u ON u.id = ev.author_id WHERE ev.incident_id = $1 ORDER BY ev.at, ev.id`,
            [inc.id],
          )
        ).rows;
        const updates = (
          await c.query<{
            id: string;
            audience: string;
            body: string;
            next_update_at: Date | null;
            author: string | null;
            created_at: Date;
          }>(
            `SELECT x.id, x.audience, x.body, x.next_update_at, u.name AS author, x.created_at FROM incident_updates x
               LEFT JOIN users u ON u.id = x.author_id WHERE x.incident_id = $1 ORDER BY x.created_at DESC`,
            [inc.id],
          )
        ).rows;
        const sch = await scheduleFor(c, inc.project_id);
        const on = sch ? await whoIsOn(c, sch, new Date()) : null;
        return {
          body: {
            incident: incidentJson(inc),
            timeline: events.map((e) => ({
              id: e.id,
              at: e.at.toISOString(),
              kind: e.kind,
              text: e.text,
              author: e.author_id ? { id: e.author_id, name: e.author ?? '' } : null,
            })),
            updates: updates.map((u) => ({
              id: u.id,
              audience: u.audience,
              body: u.body,
              nextUpdateAt: iso(u.next_update_at),
              author: u.author,
              at: u.created_at.toISOString(),
            })),
            suspects: await suspects(c, inc),
            onCall: on
              ? {
                  schedule: sch?.name ?? '',
                  primary: on.primary ? await namesOf(c, [on.primary]) : null,
                  backup: on.backup ? await namesOf(c, [on.backup]) : null,
                }
              : null,
          },
        };
      }),
  });

  const ack = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/ack',
    summary: 'Acknowledge: escalation stops; the first to acknowledge leads if nobody does',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({}),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        if (inc.acknowledged_at)
          throw new HttpError(
            409,
            'conflict',
            'Already acknowledged by ' + (inc.acknowledged_by_name ?? 'someone'),
          );
        await c.query(
          'UPDATE incidents SET acknowledged_at = now(), acknowledged_by = $2, commander_id = coalesce(commander_id, $2) WHERE id = $1',
          [inc.id, a.user.id],
        );
        await timeline(c, a.workspaceId, inc.id, a.user.id, 'ack', 'Acknowledged');
        return { body: incidentJson(await loadIncident(c, inc.id)) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId',
    summary: 'Change state, severity, roles, title or the deploy found to be the cause',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({
      state: s.optional(STATE),
      severity: s.optional(SEV),
      title: s.optional(s.string({ min: 1, max: 200 })),
      commanderId: s.optional(s.nullable(uuid)),
      commsId: s.optional(s.nullable(uuid)),
      causeDeployId: s.optional(s.nullable(uuid)),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        const notes: string[] = [];
        if (body.state && body.state !== inc.state) {
          await c.query(
            `UPDATE incidents SET state = $2,
                mitigated_at = CASE WHEN $2 IN ('mitigated', 'resolved') THEN coalesce(mitigated_at, now()) ELSE mitigated_at END,
                resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END,
                acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, $3)
              WHERE id = $1`,
            [inc.id, body.state, a.user.id],
          );
          if (body.state === 'resolved')
            await c.query(
              "UPDATE alerts SET status = 'resolved' WHERE incident_id = $1 AND status = 'open'",
              [inc.id],
            );
          notes.push('State: ' + body.state);
        }
        if (body.severity && body.severity !== inc.severity) {
          await c.query('UPDATE incidents SET severity = $2 WHERE id = $1', [
            inc.id,
            body.severity,
          ]);
          notes.push('Severity: ' + severityText(body.severity));
        }
        if (body.title && body.title.trim() !== inc.title) {
          await c.query('UPDATE incidents SET title = $2 WHERE id = $1', [
            inc.id,
            body.title.trim(),
          ]);
          notes.push('Title: ' + body.title.trim());
        }
        for (const [key, col, label] of [
          ['commanderId', 'commander_id', 'Commander'],
          ['commsId', 'comms_id', 'Communication'],
        ] as const) {
          const v = body[key];
          if (v === undefined) continue;
          await c.query(`UPDATE incidents SET ${col} = $2 WHERE id = $1`, [inc.id, v]);
          notes.push(label + ': ' + (v ? await namesOf(c, [v]) : 'nobody'));
        }
        if (body.causeDeployId !== undefined) {
          await c.query('UPDATE incidents SET cause_deploy_id = $2 WHERE id = $1', [
            inc.id,
            body.causeDeployId,
          ]);
          notes.push(
            body.causeDeployId ? 'Marked a deploy as the cause' : 'No deploy is the cause',
          );
        }
        for (const n of notes)
          await timeline(
            c,
            a.workspaceId,
            inc.id,
            a.user.id,
            n.startsWith('State')
              ? 'state'
              : n.startsWith('Commander') || n.startsWith('Communication')
                ? 'role'
                : 'note',
            n,
          );
        if (body.state === 'resolved')
          await recordEvent(c, a.workspaceId, {
            actor: actorOf(a),
            verb: 'completed',
            object: {
              type: 'incident',
              id: inc.id,
              label: 'INC-' + String(inc.number) + ' ' + inc.title,
            },
          });
        return { body: incidentJson(await loadIncident(c, inc.id)) };
      }),
  });

  const note = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/notes',
    summary: 'Add to the timeline',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({ text: s.string({ min: 1, max: 4000 }) }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        await timeline(c, a.workspaceId, inc.id, a.user.id, 'note', body.text.trim());
        return { status: 201, body: { ok: true } };
      }),
  });

  const statusUpdate = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/updates',
    summary: 'Post a status update for the team or for the client (their status page shows it)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({
      body: s.string({ min: 1, max: 4000 }),
      audience: s.enum(['team', 'client']),
      nextUpdateMinutes: s.optional(s.number({ integer: true, min: 5, max: 1440 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: async ({ params, body, req }) => {
      const done = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        if (body.audience === 'client' && !inc.client_name)
          throw new HttpError(409, 'conflict', 'The incident’s project has no client');
        await c.query(
          `INSERT INTO incident_updates (workspace_id, incident_id, audience, body, next_update_at, author_id)
           VALUES ($1, $2, $3, $4, CASE WHEN $5::integer IS NULL THEN NULL ELSE now() + make_interval(mins => $5::integer) END, $6)`,
          [
            a.workspaceId,
            inc.id,
            body.audience,
            body.body.trim(),
            body.nextUpdateMinutes ?? null,
            a.user.id,
          ],
        );
        await timeline(
          c,
          a.workspaceId,
          inc.id,
          a.user.id,
          'update',
          (body.audience === 'client'
            ? 'Status update to ' + (inc.client_name ?? 'the client')
            : 'Team update') +
            ': “' +
            body.body.trim() +
            '”',
        );
        const ws =
          (await c.query<{ name: string }>('SELECT name FROM workspaces')).rows[0]?.name ?? '';
        return { ws, client: inc.client_name ?? '', id: inc.id };
      });
      // [PCODE-237 | S15 | v0.1.0] the client's contacts hear it by mail too
      if (body.audience === 'client' && deps.mail)
        await inSystem(pool, async (c) => {
          const rows = (
            await c.query<{ email: string; title: string }>(
              `SELECT DISTINCT u.email, i.title FROM incidents i
                 JOIN projects p ON p.id = i.project_id
                 JOIN client_contacts cc ON cc.client_id = p.client_id
                 JOIN users u ON u.id = cc.user_id
                WHERE i.id = $1`,
              [done.id],
            )
          ).rows;
          for (const r of rows)
            await queueMail(c, {
              ...statusUpdateMail({
                client: done.client,
                workspace: done.ws,
                title: r.title,
                body: body.body.trim(),
                url: (deps.publicUrl ?? '').replace(/\/$/, '') + '/portal/status',
              }),
              to: r.email,
              kind: 'status',
              workspaceId: params.workspaceId,
            });
        });
      return { status: 201, body: { ok: true } };
    },
  });

  const rollback = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/rollback',
    summary:
      'Roll the environment of a suspect deploy back to its last good deploy (queues a deploy)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({ deployId: uuid }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        const bad = (
          await c.query<{
            id: string;
            environment_id: string;
            project_id: string;
            ref: string;
            created_at: Date;
          }>(
            'SELECT id, environment_id, project_id, ref, created_at FROM deploy_runs WHERE id = $1',
            [body.deployId],
          )
        ).rows[0];
        if (!bad || bad.project_id !== inc.project_id)
          throw new HttpError(404, 'not_found', 'Deploy not found');
        await requireProject(c, a, bad.project_id);
        const good = (
          await c.query<{ id: string; ref: string }>(
            `SELECT id, ref FROM deploy_runs WHERE environment_id = $1 AND status = 'succeeded' AND created_at < $2
               AND ref <> $3 ORDER BY created_at DESC LIMIT 1`,
            [bad.environment_id, bad.created_at, bad.ref],
          )
        ).rows[0];
        if (!good)
          throw new HttpError(409, 'conflict', 'There is no earlier good deploy to go back to');
        const run = await queueDeploy(c, a, bad.environment_id, good.ref, 'rollback');
        await c.query('UPDATE incidents SET cause_deploy_id = $2 WHERE id = $1', [inc.id, bad.id]);
        await timeline(
          c,
          a.workspaceId,
          inc.id,
          a.user.id,
          'rollback',
          'Rolling back to ' + (good.ref || 'the last good deploy') + ' (deploy queued)',
          { deployId: run.id, from: bad.ref, to: good.ref },
        );
        return { status: 201, body: { deployId: run.id, ref: good.ref } };
      }),
  });

  // ── postmortem ──
  const postmortem = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/postmortem',
    summary: 'Write the postmortem and its actions; share it with the client or not',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({
      text: s.optional(s.string({ max: 100_000 })),
      actions: s.optional(s.array(s.string({ min: 1, max: 300 }), { max: 30 })),
      shared: s.optional(s.boolean()),
      draft: s.optional(s.boolean()),
      ai: s.optional(s.boolean()), // [PCODE-342 | S15 | v0.1.0]
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        let text = body.text ?? inc.postmortem;
        if (body.draft) {
          const lines = (
            await c.query<{ at: Date; text: string }>(
              'SELECT at, text FROM incident_events WHERE incident_id = $1 ORDER BY at, id',
              [inc.id],
            )
          ).rows.map((l) => ({ at: l.at.toISOString(), text: l.text }));
          text = draftPostmortem(
            body.actions ?? inc.postmortem_actions.map((x) => x.text),
            incidentJson(inc),
            lines,
          );
        }
        // [PCODE-342 | S15 | v0.1.0] the DevOps agent drafts it from the incident, its timeline and updates
        let drafted: string[] = [];
        if (body.ai) {
          if (!deps.models) throw new HttpError(409, 'conflict', 'No AI provider is set up');
          if (!inc.project_id)
            throw new HttpError(
              409,
              'conflict',
              'The incident has no project for the agent to work in',
            );
          const asked = await askAgent(pool, deps.models, {
            workspaceId: a.workspaceId,
            projectId: inc.project_id,
            agentKey: 'devops',
            requestedBy: a.user.id,
            instruction: 'Draft the postmortem of INC-' + String(inc.number) + ' ' + inc.title,
            system: POSTMORTEM_PROMPT,
            messages: [
              { role: 'user', content: [{ type: 'text', text: await postmortemBrief(c, inc) }] },
            ],
          });
          text = asked.text.trim();
          drafted = postmortemActions(text);
        }
        const kept = inc.postmortem_actions;
        const wanted = drafted.length ? drafted : (body.actions ?? null);
        const actions = wanted
          ? wanted.map((t) => kept.find((k) => k.text === t) ?? { text: t })
          : kept;
        if (body.shared && !inc.client_name)
          throw new HttpError(409, 'conflict', 'The incident’s project has no client');
        await c.query(
          'UPDATE incidents SET postmortem = $2, postmortem_actions = $3, postmortem_shared = coalesce($4, postmortem_shared) WHERE id = $1',
          [inc.id, text, JSON.stringify(actions), body.shared ?? null],
        );
        return { body: incidentJson(await loadIncident(c, inc.id)) };
      }),
  });

  const actionTasks = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/incidents/:incidentId/postmortem/tasks',
    summary: 'Turn the postmortem’s actions into tasks in the incident’s project',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, incidentId: uuid }),
    body: s.object({}),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const inc = await loadIncident(c, params.incidentId);
        if (!inc.project_id)
          throw new HttpError(409, 'conflict', 'The incident has no project for the tasks');
        const p = await requireProject(c, a, inc.project_id);
        const stateId = (
          await c.query<{ id: string }>(
            "SELECT id FROM project_states WHERE project_id = $1 ORDER BY (grp = 'unstarted') DESC, position LIMIT 1",
            [p.id],
          )
        ).rows[0]?.id;
        const actions = [...inc.postmortem_actions];
        let made = 0;
        for (const act of actions) {
          if (act.itemId) continue;
          const seq = (
            await c.query<{ seq: number }>(
              'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
              [p.id],
            )
          ).rows[0]?.seq;
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, rank, kind)
               VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(min(rank), 0) - 1 FROM items WHERE project_id = $2), 'task')
               RETURNING id`,
              [
                a.workspaceId,
                p.id,
                seq,
                act.text.slice(0, 255),
                'From the postmortem of INC-' + String(inc.number) + ' ' + inc.title + '.',
                stateId,
                a.user.id,
              ],
            )
          ).rows[0]?.id;
          if (!id) continue;
          act.itemId = id;
          act.itemRef = p.key + '-' + String(seq);
          made += 1;
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'created',
              object: { type: 'item', id, label: p.key + '-' + String(seq) + ' ' + act.text },
              parent: { type: 'project', id: p.id, label: p.key },
            },
            { projectId: p.id },
          );
        }
        await c.query('UPDATE incidents SET postmortem_actions = $2 WHERE id = $1', [
          inc.id,
          JSON.stringify(actions),
        ]);
        return {
          status: 201,
          body: { created: made, incident: incidentJson(await loadIncident(c, inc.id)) },
        };
      }),
  });

  // ── on-call ──
  const scheduleIn = s.object({
    name: s.string({ min: 1, max: 80 }),
    memberIds: s.array(uuid, { max: 50 }),
    rotationDays: s.optional(s.number({ integer: true, min: 1, max: 28 })),
    handoffTime: s.optional(s.string({ pattern: /^([01]\d|2[0-3]):[0-5]\d$/ })),
    projectIds: s.optional(s.array(uuid, { max: 100 })),
    startsOn: s.optional(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ })),
    escalation: s.optional(
      s.array(
        s.object({
          afterMinutes: s.number({ integer: true, min: 1, max: 1440 }),
          target: s.enum(['primary', 'backup', 'admins', 'user']),
          userId: s.optional(uuid),
        }),
        { max: 6 },
      ),
    ),
  });

  const oncall = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/oncall',
    summary: 'Rotations with who is on call now and over the next seven days, swaps and escalation',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        teamOnly(a);
        const rows = (await c.query<ScheduleRow>(SCHEDULE_SELECT + ' ORDER BY name')).rows;
        const users = new Map(
          (
            await c.query<{ id: string; name: string }>(
              'SELECT u.id, u.name FROM users u JOIN workspace_members m ON m.user_id = u.id',
            )
          ).rows.map((u) => [u.id, u.name]),
        );
        const out = [];
        const now = new Date();
        for (const sch of rows) {
          const [hh, mm] = sch.handoff_time.split(':').map(Number);
          const days = [];
          for (let i = 0; i < 7; i++) {
            // noon of each day: clear of the handoff
            const d = new Date(now.getTime() + i * DAY);
            const day = localDay(d, sch.timezone);
            const at = new Date(day + 'T12:00:00Z');
            const on = await whoIsOn(c, sch, at);
            days.push({
              day,
              primary: on.primary ? { id: on.primary, name: users.get(on.primary) ?? '' } : null,
              backup: on.backup ? { id: on.backup, name: users.get(on.backup) ?? '' } : null,
              swapped: on.swapped,
            });
          }
          const nowOn = await whoIsOn(c, sch, now);
          const shifts = (
            await c.query<{
              id: string;
              user_id: string;
              starts_at: Date;
              ends_at: Date;
              reason: string;
            }>(
              'SELECT id, user_id, starts_at, ends_at, reason FROM oncall_shifts WHERE schedule_id = $1 AND ends_at > now() ORDER BY starts_at',
              [sch.id],
            )
          ).rows;
          out.push({
            id: sch.id,
            name: sch.name,
            projectIds: sch.project_ids,
            members: sch.member_ids.map((id) => ({ id, name: users.get(id) ?? '' })),
            rotationDays: sch.rotation_days,
            handoffTime: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'),
            timezone: sch.timezone,
            startsOn: sch.starts_on,
            escalation: sch.escalation.map((st) => ({
              ...st,
              userName: st.userId ? (users.get(st.userId) ?? '') : null,
            })),
            now: {
              primary: nowOn.primary
                ? { id: nowOn.primary, name: users.get(nowOn.primary) ?? '' }
                : null,
              backup: nowOn.backup
                ? { id: nowOn.backup, name: users.get(nowOn.backup) ?? '' }
                : null,
            },
            days,
            shifts: shifts.map((x) => ({
              id: x.id,
              userId: x.user_id,
              name: users.get(x.user_id) ?? '',
              startsAt: x.starts_at.toISOString(),
              endsAt: x.ends_at.toISOString(),
              reason: x.reason,
            })),
          });
        }
        return { body: { schedules: out, mayEdit: isAdmin(a) } };
      }),
  });

  const createSchedule = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/oncall',
    summary: 'Create a rotation (admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    body: scheduleIn,
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await peopleOnly(c, body.memberIds);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO oncall_schedules (workspace_id, name, member_ids, rotation_days, handoff_time, project_ids, starts_on, escalation)
             VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::date, current_date), coalesce($8::jsonb, '[{"afterMinutes": 10, "target": "backup"}, {"afterMinutes": 20, "target": "admins"}]'::jsonb))
             RETURNING id`,
            [
              a.workspaceId,
              body.name.trim(),
              body.memberIds,
              body.rotationDays ?? 7,
              body.handoffTime ?? '09:00',
              body.projectIds ?? [],
              body.startsOn ?? null,
              body.escalation ? JSON.stringify(body.escalation) : null,
            ],
          )
        ).rows[0]?.id;
        return { status: 201, body: { id } };
      }),
  });

  const editSchedule = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/oncall/:scheduleId',
    summary: 'Change a rotation (admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, scheduleId: uuid }),
    body: scheduleIn,
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        await peopleOnly(c, body.memberIds);
        const n = (
          await c.query(
            `UPDATE oncall_schedules SET name = $2, member_ids = $3, rotation_days = $4, handoff_time = $5, project_ids = $6,
                starts_on = coalesce($7::date, starts_on), escalation = coalesce($8::jsonb, escalation)
              WHERE id = $1`,
            [
              params.scheduleId,
              body.name.trim(),
              body.memberIds,
              body.rotationDays ?? 7,
              body.handoffTime ?? '09:00',
              body.projectIds ?? [],
              body.startsOn ?? null,
              body.escalation ? JSON.stringify(body.escalation) : null,
            ],
          )
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Rotation not found');
        return { body: { id: params.scheduleId } };
      }),
  });

  const swap = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/oncall/:scheduleId/shifts',
    summary: 'Swap a shift: someone takes over a span (oneself, or anyone for an admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, scheduleId: uuid }),
    body: s.object({
      userId: uuid,
      startsAt: s.string({ format: 'date-time' }),
      endsAt: s.string({ format: 'date-time' }),
      reason: s.optional(s.string({ max: 200 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        if (body.userId !== a.user.id && !isAdmin(a))
          throw new HttpError(
            403,
            'forbidden',
            'You can take over a shift yourself; admins assign others',
          );
        if (Date.parse(body.endsAt) <= Date.parse(body.startsAt))
          throw new HttpError(400, 'invalid_request', 'The swap ends before it starts', [
            { path: 'body.endsAt', message: 'is before startsAt' },
          ]);
        const ok = (
          await c.query('SELECT 1 FROM oncall_schedules WHERE id = $1', [params.scheduleId])
        ).rowCount;
        if (!ok) throw new HttpError(404, 'not_found', 'Rotation not found');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO oncall_shifts (workspace_id, schedule_id, user_id, starts_at, ends_at, reason, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              a.workspaceId,
              params.scheduleId,
              body.userId,
              body.startsAt,
              body.endsAt,
              body.reason ?? '',
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        return { status: 201, body: { id } };
      }),
  });

  const unswap = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/oncall/shifts/:shiftId',
    summary: 'Undo a swap (who made it, who takes over, or an admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, shiftId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const n = (
          await c.query(
            'DELETE FROM oncall_shifts WHERE id = $1 AND ($2 OR user_id = $3 OR created_by = $3)',
            [params.shiftId, isAdmin(a), a.user.id],
          )
        ).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Swap not found');
        return { body: { removed: n } };
      }),
  });

  // ── reliability ──
  const reliability = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/reliability',
    summary:
      'The last 30 days: time to acknowledge and restore, incidents by severity, deploy causes, SLOs',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        teamOnly(a);
        const rows = (
          await c.query<{
            severity: string;
            declared_at: Date;
            acknowledged_at: Date | null;
            mitigated_at: Date | null;
            resolved_at: Date | null;
            cause_deploy_id: string | null;
          }>(
            "SELECT severity, declared_at, acknowledged_at, mitigated_at, resolved_at, cause_deploy_id FROM incidents WHERE declared_at > now() - interval '30 days'",
          )
        ).rows;
        const mins = (a1: Date, b1: Date): number => (b1.getTime() - a1.getTime()) / 60_000;
        const ackM = median(
          rows
            .filter((r) => r.acknowledged_at)
            .map((r) => mins(r.declared_at, r.acknowledged_at ?? r.declared_at)),
        );
        const restoreM = median(
          rows
            .filter((r) => r.mitigated_at ?? r.resolved_at)
            .map((r) => mins(r.declared_at, r.mitigated_at ?? r.resolved_at ?? r.declared_at)),
        );
        const slos = (
          await c.query<{
            id: string;
            project_id: string;
            project_key: string;
            name: string;
            indicator: string;
            objective_pct: string;
            window_days: number;
          }>(
            'SELECT s.id, s.project_id, p.key AS project_key, s.name, s.indicator, s.objective_pct, s.window_days FROM slos s JOIN projects p ON p.id = s.project_id ORDER BY p.key, s.name',
          )
        ).rows;
        const out = [];
        for (const slo of slos) {
          const windowMin = slo.window_days * 1440;
          let good = 1;
          let burn = 1;
          if (slo.indicator === 'availability') {
            // minutes with a SEV-1/2 incident on the project count as unavailable
            const down = (
              await c.query<{ m: string; today: string }>(
                `SELECT coalesce(sum(extract(epoch FROM (least(coalesce(resolved_at, now()), now()) - greatest(declared_at, now() - make_interval(days => $2)))) / 60), 0) AS m,
                        coalesce(sum(extract(epoch FROM (least(coalesce(resolved_at, now()), now()) - greatest(declared_at, now() - interval '1 day'))) / 60)
                          FILTER (WHERE coalesce(resolved_at, now()) > now() - interval '1 day'), 0) AS today
                   FROM incidents WHERE project_id = $1 AND severity IN ('sev1', 'sev2')
                    AND coalesce(resolved_at, now()) > now() - make_interval(days => $2)`,
                [slo.project_id, slo.window_days],
              )
            ).rows[0];
            good = 1 - Number(down?.m ?? 0) / windowMin;
            const allowedPerDay = (1 - Number(slo.objective_pct) / 100) * 1440;
            burn = allowedPerDay > 0 ? Number(down?.today ?? 0) / allowedPerDay : 0;
          } else {
            const d = (
              await c.query<{ ok: string; n: string }>(
                `SELECT count(*) FILTER (WHERE status = 'succeeded') AS ok, count(*) FILTER (WHERE status IN ('succeeded', 'failed')) AS n
                   FROM deploy_runs WHERE project_id = $1 AND created_at > now() - make_interval(days => $2)`,
                [slo.project_id, slo.window_days],
              )
            ).rows[0];
            good = Number(d?.n ?? 0) ? Number(d?.ok ?? 0) / Number(d?.n ?? 1) : 1;
            burn = 0;
          }
          out.push({
            id: slo.id,
            projectKey: slo.project_key,
            name: slo.name,
            indicator: slo.indicator,
            objectivePct: Number(slo.objective_pct),
            windowDays: slo.window_days,
            actualPct: Math.round(good * 100_000) / 1000,
            budgetLeft: errorBudgetLeft(Number(slo.objective_pct), good),
            burn: Math.round(burn * 10) / 10,
          });
        }
        return {
          body: {
            ackMinutes: ackM,
            restoreMinutes: restoreM,
            ackText: ackM === null ? null : durationText(ackM),
            restoreText: restoreM === null ? null : durationText(restoreM),
            total: rows.length,
            bySeverity: ['sev1', 'sev2', 'sev3', 'sev4'].map((sv) => ({
              severity: sv,
              text: severityText(sv),
              count: rows.filter((r) => r.severity === sv).length,
            })),
            causedByDeploy: rows.filter((r) => r.cause_deploy_id).length,
            slos: out,
            mayEdit: isAdmin(a),
          },
        };
      }),
  });

  const addSlo = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/slos',
    summary: 'Add a service level objective for a project (admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      projectId: uuid,
      name: s.string({ min: 1, max: 160 }),
      indicator: s.enum(['availability', 'deploys']),
      objectivePct: s.number({ min: 50, max: 99.999 }),
      windowDays: s.optional(s.number({ integer: true, min: 1, max: 365 })),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await requireProject(c, a, body.projectId);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO slos (workspace_id, project_id, name, indicator, objective_pct, window_days) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [
              a.workspaceId,
              body.projectId,
              body.name.trim(),
              body.indicator,
              body.objectivePct,
              body.windowDays ?? 30,
            ],
          )
        ).rows[0]?.id;
        return { status: 201, body: { id } };
      }),
  });

  const removeSlo = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/slos/:sloId',
    summary: 'Remove a service level objective (admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, sloId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const n = (await c.query('DELETE FROM slos WHERE id = $1', [params.sloId])).rowCount;
        if (!n) throw new HttpError(404, 'not_found', 'Objective not found');
        return { body: { removed: n } };
      }),
  });

  return [
    alert,
    list,
    create,
    detail,
    ack,
    update,
    note,
    statusUpdate,
    rollback,
    postmortem,
    actionTasks,
    oncall,
    createSchedule,
    editSchedule,
    swap,
    unswap,
    reliability,
    addSlo,
    removeSlo,
  ];
}
