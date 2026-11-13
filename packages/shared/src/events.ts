// ── [PCODE-349 | S15 | v0.1.0] T35.2b Slack and Teams bridges, personal calendar feed, CI pipeline runs ──
// ── [PCODE-203 | S15 | v0.1.0] T17.1 Release trains on the server: releases of several projects, freeze, go/no-go, ship with deploys, rollback ──
// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-189 | S15 | v0.1.0] B7.5 Portal budget and invoices with PDF, quotes, meeting booking with agenda and calendar file ──
// ── [PCODE-188 | S15 | v0.1.0] B7.4 Incidents and on-call live: alerts, incidents with timeline and roles, suspect deploys and rollback, status updates, rotations and escalation, postmortems, SLOs ──
// ── [PCODE-187 | S15 | v0.1.0] B7.3 Time live: timer from the active task, weekly timesheets with approval and lock, rates, absences, reports per client ──
// ── [PCODE-185 | S15 | v0.1.0] B7.1 Client requests live: portal requests, threads with internal notes, response times, change requests with impact and signature, ratings ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-89 | S15 | v0.1.0] Define the activity event envelope and the transactional outbox ──
// ── [PCODE-117 | S15 | v0.1.0] Build the lifecycle engine: phases, stages, gates, criteria, sign-off, live ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
// ── [PCODE-131 | S15 | v0.1.0] Add environments and the secrets vault ──
//    Why:  every screen of Orqiva (web, VS Code, mobile) is drawn from one stream of these events: who
//          did what to which object, how far along it is, and when. The envelope keeps the field names of
//          CloudEvents 1.0 (an open specification), so other tools can read the stream as it is.

/** Who acted: a person, one of our AI agents, the platform itself, or a connected tool (Git host, CI). */
export type ActorKind = 'user' | 'agent' | 'system' | 'integration';

export interface Actor {
  kind: ActorKind;
  id: string;
  /** shown on screens; the id stays the reference */
  name?: string;
}

/** The kinds of things work happens to. New kinds are added here, so every client knows them. */
export type ObjectType =
  | 'workspace'
  | 'member'
  | 'project'
  | 'item'
  | 'comment'
  | 'sprint'
  | 'gate'
  // [PCODE-117 | S15 | v0.1.0] a stage of a project's lifecycle
  | 'stage'
  | 'test_run'
  | 'agent_run'
  // [PCODE-123 | S15 | v0.1.0] an idea in a project's inbox
  | 'idea'
  // [PCODE-131 | S15 | v0.1.0] a project's environment (staging, production)
  | 'environment'
  | 'deploy'
  | 'finding'
  | 'release'
  // [PCODE-163 | S15 | v0.1.0] a client of the workspace
  | 'client'
  // [PCODE-180 | S15 | v0.1.0] an agent's settings and rules
  | 'agent'
  // [PCODE-185 | S15 | v0.1.0] a client's request: bug, change, feature or question
  | 'client_request'
  // [PCODE-187 | S15 | v0.1.0] a person's week of time, and an absence
  | 'timesheet'
  | 'absence'
  // [PCODE-188 | S15 | v0.1.0] an incident
  | 'incident'
  // [PCODE-189 | S15 | v0.1.0] a meeting a client booked
  | 'meeting'
  // [PCODE-199 | S15 | v0.1.0] a handover pack sent to a client
  | 'handover'
  // [PCODE-203 | S15 | v0.1.0] a release train across projects
  | 'train'
  // [PCODE-349 | S15 | v0.1.0] a CI pipeline's run, reported by the pipeline
  | 'ci_run';

export interface ObjectRef {
  type: ObjectType;
  id: string;
  /** a human handle, e.g. "PCODE-12" or the item's title, for feeds that must not look it up */
  label?: string;
}

export type Verb =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'moved'
  | 'assigned'
  | 'commented'
  | 'started'
  | 'progressed'
  | 'completed'
  | 'failed'
  | 'approved'
  | 'rejected';

/** Measured progress: criteria ticked, tests passed, agent steps done; never an estimate typed by hand. */
export interface Progress {
  done: number;
  total: number;
  unit: 'criteria' | 'subtasks' | 'tests' | 'steps' | 'percent';
}

export interface ActivityData {
  actor: Actor;
  verb: Verb;
  object: ObjectRef;
  /** the object this happened within, e.g. the item a comment belongs to */
  parent?: ObjectRef;
  progress?: Progress;
  /** field -> { from, to } for updates */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * One activity event. Field names follow CloudEvents 1.0: specversion, id, source, type, time, subject,
 * datacontenttype and data are the spec's; workspaceid and sequence are extension attributes (lowercase
 * letters and digits, as the spec requires).
 */
export interface ActivityEvent {
  specversion: '1.0';
  id: string;
  /** "/workspaces/{id}" */
  source: string;
  /** "orqiva.{object type}.{verb}", e.g. "orqiva.item.moved" */
  type: string;
  /** ISO 8601 with time zone */
  time: string;
  /** the object's id */
  subject: string;
  datacontenttype: 'application/json';
  workspaceid: string;
  /** 1, 2, 3 … per workspace, in commit order, without gaps: the replay cursor */
  sequence: number;
  /** [PCODE-95 | S15 | v0.1.0] the project it happened in, if any: decides who may see it */
  projectid?: string;
  data: ActivityData;
}

export function eventType(object: ObjectType, verb: Verb): string {
  return 'orqiva.' + object + '.' + verb;
}

/** [PCODE-192 | S15 | v0.1.0] Whether an event is about an object type, whatever its prefix: orqiva., or prodengine. from before the rename. */
export const isEventOf = (type: string, object: string): boolean => type.split('.')[1] === object;

const OBJECT_TYPES: ReadonlySet<string> = new Set<ObjectType>([
  'workspace',
  'member',
  'project',
  'item',
  'comment',
  'sprint',
  'gate',
  'stage',
  'test_run',
  'agent_run',
  'idea', // [PCODE-123 | S15 | v0.1.0]
  'environment', // [PCODE-131 | S15 | v0.1.0]
  'deploy',
  'finding',
  'release',
  'client',
  'agent', // [PCODE-180 | S15 | v0.1.0]
  'client_request', // [PCODE-185 | S15 | v0.1.0]
  'timesheet', // [PCODE-187 | S15 | v0.1.0]
  'absence',
  'incident', // [PCODE-188 | S15 | v0.1.0]
  'meeting', // [PCODE-189 | S15 | v0.1.0]
  'handover', // [PCODE-199 | S15 | v0.1.0]
  'train', // [PCODE-203 | S15 | v0.1.0]
]);
const VERBS: ReadonlySet<string> = new Set<Verb>([
  'created',
  'updated',
  'deleted',
  'moved',
  'assigned',
  'commented',
  'started',
  'progressed',
  'completed',
  'failed',
  'approved',
  'rejected',
]);

/** Checks an event received over the wire; returns the problems, empty when it is well formed. */
export function eventProblems(value: unknown): string[] {
  const p: string[] = [];
  if (typeof value !== 'object' || value === null) return ['not an object'];
  const e = value as Record<string, unknown>;
  if (e['specversion'] !== '1.0') p.push('specversion must be "1.0"');
  for (const k of ['id', 'source', 'type', 'time', 'subject', 'workspaceid'] as const) {
    if (typeof e[k] !== 'string' || e[k] === '') p.push(k + ' must be a non-empty string');
  }
  if (typeof e['sequence'] !== 'number' || !Number.isInteger(e['sequence']) || e['sequence'] < 1) {
    p.push('sequence must be a positive integer');
  }
  const raw = e['data'];
  if (typeof raw !== 'object' || raw === null) return [...p, 'data must be an object'];
  const d = raw as Record<string, unknown>;
  const actor = d['actor'] as Record<string, unknown> | undefined;
  if (
    !actor ||
    !['user', 'agent', 'system', 'integration'].includes(String(actor['kind'])) ||
    typeof actor['id'] !== 'string'
  ) {
    p.push('data.actor needs kind and id');
  }
  if (!VERBS.has(String(d['verb']))) p.push('data.verb is not a known verb');
  const obj = d['object'] as Record<string, unknown> | undefined;
  if (!obj || !OBJECT_TYPES.has(String(obj['type'])) || typeof obj['id'] !== 'string') {
    p.push('data.object needs a known type and an id');
  }
  const prog = d['progress'] as Record<string, unknown> | undefined;
  if (prog !== undefined) {
    const done = prog['done'];
    const total = prog['total'];
    if (
      typeof done !== 'number' ||
      typeof total !== 'number' ||
      done < 0 ||
      total < 0 ||
      done > total
    ) {
      p.push('data.progress needs 0 <= done <= total');
    }
  }
  return p;
}
