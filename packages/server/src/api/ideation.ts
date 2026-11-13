// ── [PCODE-274 | S15 | v0.1.0] T28.3 Stories with Given/When/Then and personas; value/effort matrix, evidence library, compare ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-271 | S15 | v0.1.0] Project tabs fixes from the deep UX check: handover double page, service accounts, lifecycle name, extraction duplicates, AI cases picker, webhook events, overdue sprint, tab overflow ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
//    Why:  everything around an idea that turns it into something a team can build: its sources and
//          evidence, requirements that cite the passage they come from, open questions handed to a named
//          person with a date, risks by likelihood and impact, assumptions with how to check them, scores
//          from several people with the spread, coverage per area, the project's decisions and glossary.
//          The Analyst agent extracts from the sources; what it cannot cite exactly loses its citation
//          rather than inventing one. Ideation is the team's: reads need at least an auditor.
import type { IncomingMessage } from 'node:http';
import { jsonIn, scenariosOf, type Scenario } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_EXTRACT } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Schema } from '../http/schema.js';
import { asMember, isUniqueViolation, requireProject, requireUser, type Access } from './access.js';
import { textOf, visibleFile } from './files.js';
import type { BlobStore } from '../files/blobstore.js';
import { readLink, LinkReadError, type LinkReadDeps } from '../files/linkread.js'; // [PCODE-272 | S15 | v0.1.0]
import { queueRead } from '../files/reading.js';
import { ideaEvent, ideaJson, ideaOut, visibleIdea, type IdeaRow } from './ideas.js';
import {
  linkedRequestOut,
  linkedRequests,
  loadPersonas,
  personaNamed,
  personaOut,
  projectPersona,
} from './ideaviews.js'; // [PCODE-274 | S15 | v0.1.0]
import { AREAS, answeredAreas, coverage } from './ideacoverage.js'; // [PCODE-273 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const day = s.string({ min: 10, max: 10 });
const ideaParams = s.object({ workspaceId: uuid, ideaId: uuid });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

// [PCODE-273 | S15 | v0.1.0] the areas and their coverage are shared with the interview
export { AREAS, coverage };
export const REQ_KINDS = [
  'functional',
  'non_functional',
  'constraint',
  'story',
  'metric',
  'out_of_scope',
  'persona',
] as const;
export const METHODS = ['rice', 'ice', 'wsjf', 'moscow', 'value_effort'] as const;
type Method = (typeof METHODS)[number];

export const EXTRACT_PROMPT =
  MODE_EXTRACT +
  ' You are the Analyst. From the sources of an idea (each starts with ### and its label), take out: ' +
  'requirements (kind: functional, non_functional, constraint, story with Given/When/Then, metric, out_of_scope, persona; ' +
  'area: problem, users, scope, non_goals, non_functional, data, integrations, security; priority: must, should, could, wont), ' +
  'open questions with their area, assumptions with how to validate them, risks with likelihood and impact from 1 to 5 and a ' +
  'mitigation, and glossary terms. Every requirement names its source label and copies the exact passage it rests on, word ' +
  'for word. A story is written "As a <persona>, I want …, so that …", names its "persona" and carries "scenarios" ' +
  '[{"given", "when", "then"}]. The people the idea is for are "personas" with their role, goals, pains and a quote. ' +
  'Do not repeat what is already listed under EXISTING. Answer with one JSON object in a ```json block: ' +
  '{"requirements": [{"text", "kind", "area", "priority", "source", "passage", "persona", "scenarios"}], ' +
  '"personas": [{"name", "role", "goals", "pains", "quote", "source"}], "questions": [{"text", "area"}], ' +
  '"assumptions": [{"text", "validateHow"}], "risks": [{"text", "likelihood", "impact", "mitigation"}], "glossary": [{"term", "definition"}]}.';

/** A score from the method's inputs; null when an input is missing or out of range. */
export function scoreOf(method: Method, inputs: Record<string, unknown>): number | null {
  const n = (k: string, lo: number, hi: number): number | null => {
    const v = inputs[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  const round = (v: number): number => Math.round(v * 100) / 100;
  switch (method) {
    case 'rice': {
      const [r, i, c, e] = [
        n('reach', 0, 1e9),
        n('impact', 0.25, 3),
        n('confidence', 0, 100),
        n('effort', 0.1, 1e6),
      ];
      return r === null || i === null || c === null || e === null
        ? null
        : round((r * i * (c / 100)) / e);
    }
    case 'ice': {
      const [i, c, e] = [n('impact', 1, 10), n('confidence', 1, 10), n('ease', 1, 10)];
      return i === null || c === null || e === null ? null : i * c * e;
    }
    case 'wsjf': {
      const [v, t, r, j] = [
        n('businessValue', 1, 100),
        n('timeCriticality', 1, 100),
        n('riskReduction', 1, 100),
        n('jobSize', 1, 100),
      ];
      return v === null || t === null || r === null || j === null ? null : round((v + t + r) / j);
    }
    case 'moscow': {
      const m = { must: 4, should: 3, could: 2, wont: 1 }[String(inputs['category'])];
      return m ?? null;
    }
    case 'value_effort': {
      const [v, e] = [n('value', 1, 10), n('effort', 1, 10)];
      return v === null || e === null ? null : round(v / e);
    }
  }
}

async function touch(c: PoolClient, ideaId: string): Promise<void> {
  await c.query('UPDATE ideas SET last_activity_at = now() WHERE id = $1', [ideaId]);
}

/** The idea for a team member; approved ideas stay as signed. */
async function writableIdea(c: PoolClient, a: Access, id: string): Promise<IdeaRow> {
  const idea = await visibleIdea(c, a, id);
  if (idea.status === 'approved')
    throw new HttpError(
      409,
      'conflict',
      'An approved idea is part of the plan; it stays as signed',
    );
  return idea;
}

async function checkUser(
  c: PoolClient,
  projectId: string,
  userId: string | null | undefined,
  field: string,
): Promise<void> {
  if (!userId) return;
  const ok = await c.query(
    "SELECT 1 FROM workspace_members m WHERE m.user_id = $1 AND (m.role <> 'guest' OR guest_sees_project($2, $1))",
    [userId, projectId],
  );
  if (!ok.rowCount)
    throw new HttpError(400, 'invalid_request', 'Only someone who can see the project', [
      { path: 'body.' + field, message: 'cannot see this project' },
    ]);
}

// ── the child records of an idea that share one shape: a table, columns that may be set, an output ──
interface Child {
  table: string;
  segment: string;
  noun: string;
  /** json field → column, with its schema */
  fields: Record<string, { column: string; schema: Schema<unknown>; user?: boolean }>;
  required: string[];
  select: string;
  json: (r: Record<string, unknown>) => Record<string, unknown>;
  out: Schema<unknown>;
  onUpdate?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const QUESTIONS: Child = {
  table: 'idea_questions',
  segment: 'questions',
  noun: 'Question',
  fields: {
    text: { column: 'text', schema: s.string({ min: 1, max: 2000 }) },
    area: { column: 'area', schema: s.enum(AREAS) },
    ownerId: { column: 'owner_id', schema: s.nullable(uuid), user: true },
    dueDate: { column: 'due_date', schema: s.nullable(day) },
    answer: { column: 'answer', schema: s.string({ max: 8000 }) },
    status: { column: 'status', schema: s.enum(['open', 'answered', 'dropped']) },
  },
  required: ['text'],
  select: `SELECT q.id, q.text, q.area, q.owner_id, u.name AS owner_name, q.due_date::text AS due_date, q.answer, q.status, q.created_at, q.answered_at
             FROM idea_questions q LEFT JOIN users u ON u.id = q.owner_id`,
  json: (r) => ({
    id: r['id'],
    text: r['text'],
    area: r['area'],
    ownerId: r['owner_id'] ?? null,
    ownerName: r['owner_name'] ?? null,
    dueDate: dateOrNull(r['due_date']),
    answer: str(r['answer']),
    status: r['status'],
    answeredAt: r['answered_at'] instanceof Date ? r['answered_at'].toISOString() : null,
  }),
  out: s.object({
    id: s.string(),
    text: s.string(),
    area: s.string(),
    ownerId: s.nullable(s.string()),
    ownerName: s.nullable(s.string()),
    dueDate: s.nullable(s.string()),
    answer: s.string(),
    status: s.string(),
    answeredAt: s.nullable(s.string()),
  }),
  // an answer closes the question
  onUpdate: `UPDATE idea_questions SET status = CASE WHEN answer <> '' AND status = 'open' THEN 'answered' ELSE status END,
                    answered_at = CASE WHEN answer <> '' AND answered_at IS NULL THEN now() ELSE answered_at END WHERE id = $1`,
};

const RISKS: Child = {
  table: 'idea_risks',
  segment: 'risks',
  noun: 'Risk',
  fields: {
    text: { column: 'text', schema: s.string({ min: 1, max: 2000 }) },
    likelihood: { column: 'likelihood', schema: s.number({ integer: true, min: 1, max: 5 }) },
    impact: { column: 'impact', schema: s.number({ integer: true, min: 1, max: 5 }) },
    mitigation: { column: 'mitigation', schema: s.string({ max: 2000 }) },
    ownerId: { column: 'owner_id', schema: s.nullable(uuid), user: true },
    status: { column: 'status', schema: s.enum(['open', 'mitigated', 'accepted', 'closed']) },
  },
  required: ['text'],
  select: `SELECT r.id, r.text, r.likelihood, r.impact, r.mitigation, r.owner_id, u.name AS owner_name, r.status
             FROM idea_risks r LEFT JOIN users u ON u.id = r.owner_id`,
  json: (r) => ({
    id: r['id'],
    text: r['text'],
    likelihood: r['likelihood'],
    impact: r['impact'],
    exposure: Number(r['likelihood']) * Number(r['impact']),
    mitigation: str(r['mitigation']),
    ownerId: r['owner_id'] ?? null,
    ownerName: r['owner_name'] ?? null,
    status: r['status'],
  }),
  out: s.object({
    id: s.string(),
    text: s.string(),
    likelihood: s.number({ integer: true }),
    impact: s.number({ integer: true }),
    exposure: s.number({ integer: true }),
    mitigation: s.string(),
    ownerId: s.nullable(s.string()),
    ownerName: s.nullable(s.string()),
    status: s.string(),
  }),
};

const ASSUMPTIONS: Child = {
  table: 'idea_assumptions',
  segment: 'assumptions',
  noun: 'Assumption',
  fields: {
    text: { column: 'text', schema: s.string({ min: 1, max: 2000 }) },
    validateHow: { column: 'validate_how', schema: s.string({ max: 2000 }) },
    ownerId: { column: 'owner_id', schema: s.nullable(uuid), user: true },
    status: { column: 'status', schema: s.enum(['open', 'validated', 'invalidated']) },
  },
  required: ['text'],
  select: `SELECT x.id, x.text, x.validate_how, x.owner_id, u.name AS owner_name, x.status
             FROM idea_assumptions x LEFT JOIN users u ON u.id = x.owner_id`,
  json: (r) => ({
    id: r['id'],
    text: r['text'],
    validateHow: str(r['validate_how']),
    ownerId: r['owner_id'] ?? null,
    ownerName: r['owner_name'] ?? null,
    status: r['status'],
  }),
  out: s.object({
    id: s.string(),
    text: s.string(),
    validateHow: s.string(),
    ownerId: s.nullable(s.string()),
    ownerName: s.nullable(s.string()),
    status: s.string(),
  }),
};

const alias = (child: Child): string => /FROM \w+ (\w)/.exec(child.select)?.[1] ?? 'x';

function childRoutes(pool: Pool, child: Child): Route[] {
  const optional: Record<string, Schema<unknown>> = {};
  const required: Record<string, Schema<unknown>> = {};
  for (const [k, f] of Object.entries(child.fields)) {
    optional[k] = s.optional(f.schema);
    required[k] = child.required.includes(k) ? f.schema : s.optional(f.schema);
  }
  const one = async (c: PoolClient, id: string): Promise<Record<string, unknown>> => {
    const row = (
      await c.query<Record<string, unknown>>(child.select + ' WHERE ' + alias(child) + '.id = $1', [
        id,
      ])
    ).rows[0];
    if (!row) throw new Error(child.noun + ' vanished');
    return child.json(row);
  };
  // [PCODE-273 | S15 | v0.1.0] handed to someone else: they hear of it (inbox, push, email) like a mention
  const handedOver = async (
    c: PoolClient,
    a: Access,
    idea: IdeaRow,
    out: Record<string, unknown>,
    before: string | null,
  ): Promise<void> => {
    const to = typeof out['ownerId'] === 'string' ? out['ownerId'] : null;
    if (!to || to === before || to === a.user.id) return;
    await ideaEvent(c, a, idea, 'assigned', {
      owner: { from: before, to },
      [child.noun.toLowerCase()]: {
        from: null,
        to: typeof out['text'] === 'string' ? out['text'] : '',
      },
    });
  };
  const owned = async (c: PoolClient, a: Access, id: string): Promise<IdeaRow> => {
    const r = (
      await c.query<{ idea_id: string }>('SELECT idea_id FROM ' + child.table + ' WHERE id = $1', [
        id,
      ])
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', child.noun + ' not found');
    return writableIdea(c, a, r.idea_id);
  };
  const write = async (
    c: PoolClient,
    projectId: string,
    body: Record<string, unknown>,
  ): Promise<[string[], unknown[]]> => {
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [k, f] of Object.entries(child.fields)) {
      const v = body[k];
      if (v === undefined) continue;
      if (f.user) await checkUser(c, projectId, v as string | null, k);
      if (
        f.column === 'due_date' &&
        v !== null &&
        !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
      )
        throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
          { path: 'body.' + k, message: 'is not a date' },
        ]);
      cols.push(f.column);
      vals.push(typeof v === 'string' ? v.trim() : v);
    }
    return [cols, vals];
  };
  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/' + child.segment,
    summary: 'Add a ' + child.noun.toLowerCase() + ' to the idea (member)',
    tags: ['ideation'],
    params: ideaParams,
    body: s.object(required),
    response: child.out,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await writableIdea(c, a, params.ideaId);
        const [cols, vals] = await write(c, idea.project_id, body);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO ' +
              child.table +
              ' (workspace_id, idea_id, created_by, ' +
              cols.join(', ') +
              ') VALUES ($1, $2, $3, ' +
              cols.map((_, i) => '$' + String(i + 4)).join(', ') +
              ') RETURNING id',
            [a.workspaceId, idea.id, a.user.id, ...vals],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('insert returned nothing');
        if (child.onUpdate) await c.query(child.onUpdate, [id]);
        await touch(c, idea.id);
        const out = await one(c, id);
        await handedOver(c, a, idea, out, null);
        return { status: 201, body: out };
      }),
  });
  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/idea-' + child.segment + '/:id',
    summary: 'Change a ' + child.noun.toLowerCase() + ' (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object(optional),
    response: child.out,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await owned(c, a, params.id);
        const before = (await one(c, params.id))['ownerId'];
        const [cols, vals] = await write(c, idea.project_id, body);
        if (cols.length)
          await c.query(
            'UPDATE ' +
              child.table +
              ' SET ' +
              cols.map((col, i) => col + ' = $' + String(i + 2)).join(', ') +
              ' WHERE id = $1',
            [params.id, ...vals],
          );
        if (child.onUpdate) await c.query(child.onUpdate, [params.id]);
        await touch(c, idea.id);
        const out = await one(c, params.id);
        await handedOver(c, a, idea, out, typeof before === 'string' ? before : null);
        return { body: out };
      }),
  });
  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/idea-' + child.segment + '/:id',
    summary: 'Remove a ' + child.noun.toLowerCase() + ' (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await owned(c, a, params.id);
        await c.query('DELETE FROM ' + child.table + ' WHERE id = $1', [params.id]);
        await touch(c, idea.id);
        return { body: { removed: true } };
      }),
  });
  return [create, update, remove];
}

// ── sources and requirements ──
const sourceOut = s.object({
  id: s.string(),
  label: s.string(),
  kind: s.string(),
  fileId: s.nullable(s.string()),
  fileName: s.nullable(s.string()),
  url: s.string(),
  title: s.string(),
  body: s.string(),
  saidBy: s.string(),
  textLength: s.number({ integer: true }),
  createdAt: s.string(),
  // [PCODE-242 | S15 | v0.1.0] how the file's read goes, when it has one
  read: s.nullable(s.object({ status: s.string(), error: s.string() })),
  // [PCODE-272 | S15 | v0.1.0] how the link's read went: reading, read or failed
  link: s.nullable(
    s.object({ status: s.string(), error: s.string(), readAt: s.nullable(s.string()) }),
  ),
});
interface SourceRow {
  id: string;
  kind: string;
  file_id: string | null;
  file_name: string | null;
  url: string;
  title: string;
  body: string;
  said_by: string;
  text: string;
  created_at: Date;
  read_status: string | null; // [PCODE-242 | S15 | v0.1.0]
  read_error: string | null;
  link_status: string; // [PCODE-272 | S15 | v0.1.0]
  link_error: string;
  link_read_at: Date | null;
}
const SOURCE_SELECT = `SELECT x.id, x.kind, x.file_id, f.name AS file_name, x.url, x.title, x.body, x.said_by,
       CASE WHEN x.kind = 'file' OR x.file_id IS NOT NULL THEN coalesce(f.text_content, '')
            WHEN x.kind = 'link' THEN concat_ws(E'\n\n', nullif(x.body, ''), nullif(x.link_text, ''))
            ELSE x.body END AS text, x.created_at,
       fr.status AS read_status, fr.error AS read_error, x.link_status, x.link_error, x.link_read_at
  FROM idea_sources x LEFT JOIN files f ON f.id = x.file_id AND f.deleted_at IS NULL
  LEFT JOIN file_reads fr ON fr.file_id = f.id`;
const sourceJson = (r: SourceRow, i: number) => ({
  id: r.id,
  label: 'S' + String(i + 1),
  kind: r.kind,
  fileId: r.file_id,
  fileName: r.file_name,
  url: r.url,
  title: r.title,
  body: r.body.slice(0, 4000),
  saidBy: r.said_by,
  textLength: r.text.length,
  createdAt: r.created_at.toISOString(),
  read: r.read_status ? { status: r.read_status, error: r.read_error ?? '' } : null,
  link:
    r.kind === 'link' && r.link_status !== 'none'
      ? {
          status: r.link_status,
          error: r.link_error,
          readAt: r.link_read_at ? r.link_read_at.toISOString() : null,
        }
      : null,
});
const loadSources = async (c: PoolClient, ideaId: string): Promise<SourceRow[]> =>
  (
    await c.query<SourceRow>(SOURCE_SELECT + ' WHERE x.idea_id = $1 ORDER BY x.created_at, x.id', [
      ideaId,
    ])
  ).rows;

const reqOut = s.object({
  id: s.string(),
  code: s.string(),
  kind: s.string(),
  area: s.string(),
  text: s.string(),
  sourceId: s.nullable(s.string()),
  passage: s.string(),
  status: s.string(),
  priority: s.string(),
  // [PCODE-274 | S15 | v0.1.0] a story's persona and its Given/When/Then scenarios
  personaId: s.nullable(s.string()),
  personaName: s.nullable(s.string()),
  scenarios: s.array(s.object({ given: s.string(), when: s.string(), then: s.string() })),
});
interface ReqRow {
  id: string;
  number: number;
  kind: string;
  area: string;
  text: string;
  source_id: string | null;
  passage: string;
  status: string;
  priority: string;
  persona_id: string | null; // [PCODE-274 | S15 | v0.1.0]
  persona_name: string | null;
  scenarios: unknown;
}
const reqJson = (r: ReqRow) => ({
  id: r.id,
  code: 'R-' + String(r.number),
  kind: r.kind,
  area: r.area,
  text: r.text,
  sourceId: r.source_id,
  passage: r.passage,
  status: r.status,
  priority: r.priority,
  personaId: r.persona_id,
  personaName: r.persona_name,
  scenarios: scenariosOf(r.scenarios),
});
const REQ_SELECT =
  'SELECT id, number, kind, area, text, source_id, passage, status, priority, persona_id, scenarios, ' +
  '(SELECT p.name FROM personas p WHERE p.id = requirements.persona_id) AS persona_name FROM requirements';

/** A citation stands only when the passage is really in the source. */
export function citation(
  sources: readonly { id: string; text: string }[],
  sourceId: string | null | undefined,
  passage: string | undefined,
): { sourceId: string | null; passage: string } {
  const src = sources.find((x) => x.id === sourceId);
  const p = (passage ?? '').trim();
  if (!src || !p) return { sourceId: src ? src.id : null, passage: '' };
  const norm = (v: string): string => v.replace(/\s+/g, ' ').toLowerCase();
  return norm(src.text).includes(norm(p))
    ? { sourceId: src.id, passage: p.slice(0, 2000) }
    : { sourceId: src.id, passage: '' };
}

async function insertRequirement(
  c: PoolClient,
  a: Access,
  ideaId: string,
  r: {
    kind: string;
    area: string;
    text: string;
    sourceId: string | null;
    passage: string;
    priority: string;
    status?: string;
    personaId?: string | null; // [PCODE-274 | S15 | v0.1.0]
    scenarios?: Scenario[];
  },
): Promise<string> {
  await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [ideaId]);
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO requirements (workspace_id, idea_id, number, kind, area, text, source_id, passage, priority, status, created_by, persona_id, scenarios)
       VALUES ($1, $2, (SELECT coalesce(max(number), 0) + 1 FROM requirements WHERE idea_id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        a.workspaceId,
        ideaId,
        r.kind,
        r.area,
        r.text,
        r.sourceId,
        r.passage,
        r.priority,
        r.status ?? 'proposed',
        a.user.id,
        r.personaId ?? null,
        JSON.stringify(r.scenarios ?? []),
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('requirement insert returned nothing');
  return id;
}

const scoreSummaryOut = s.object({
  method: s.string(),
  count: s.number({ integer: true }),
  mean: s.number(),
  min: s.number(),
  max: s.number(),
  /** max − min, relative to the mean: how much the scorers disagree */
  spread: s.number(),
  mine: s.nullable(s.object({ inputs: s.anyObject(), score: s.number(), note: s.string() })),
  scorers: s.array(s.object({ name: s.string(), score: s.number() })),
});

// [PCODE-271 | S15 | v0.1.0]
/**
 * A statement from a model, as it is kept: without list markers or interview labels; null when it is a
 * line of the prompt (a section heading) rather than something said.
 */
export function cleanStatement(raw: string): string | null {
  let t = raw.trim();
  if (/^(#{1,6}\s|EXISTING requirements:|IDEA\s|INTERVIEW\s*$)/i.test(t)) return null;
  t = t
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/^(?:Q|A)\s*:\s*/i, '')
    .trim();
  return t.length >= 3 ? t : null;
}

/** Two statements are the same when they read the same, case, spaces and end marks aside. */
export const sameText = (t: string): string =>
  (cleanStatement(t) ?? t)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,\s]+$/, '');

// [PCODE-272 | S15 | v0.1.0] what reading links needs: where fetched files are kept, and how the network is reached
export interface IntakeDeps {
  store?: BlobStore;
  link?: LinkReadDeps;
}

export function ideationRoutes(pool: Pool, models: ProviderFor, intake: IntakeDeps = {}): Route[] {
  // [PCODE-272 | S15 | v0.1.0]
  /** Reads a link source outside any transaction and keeps what came: text, or a file read like uploads. */
  const readLinkSource = async (req: IncomingMessage, workspaceId: string, sourceId: string) => {
    const src = await asMember(pool, req, workspaceId, 'member', async (c, a) => {
      const r = (
        await c.query<{ idea_id: string; url: string; kind: string }>(
          'SELECT idea_id, url, kind FROM idea_sources WHERE id = $1',
          [sourceId],
        )
      ).rows[0];
      if (!r) throw new HttpError(404, 'not_found', 'Source not found');
      await writableIdea(c, a, r.idea_id);
      if (r.kind !== 'link')
        throw new HttpError(409, 'conflict', 'Only a link source is read from the web');
      await c.query(
        "UPDATE idea_sources SET link_status = 'reading', link_error = '' WHERE id = $1",
        [sourceId],
      );
      return r;
    });
    let got: Awaited<ReturnType<typeof readLink>> | null = null;
    let error = '';
    try {
      got = await readLink(src.url, intake.link ?? {});
      if (got.kind === 'file' && !intake.store) throw new LinkReadError('Files are not kept here');
    } catch (e) {
      error = e instanceof LinkReadError ? e.message : 'The link could not be read';
      got = null;
    }
    await asMember(pool, req, workspaceId, 'member', async (c, a) => {
      if (!got) {
        await c.query(
          "UPDATE idea_sources SET link_status = 'failed', link_error = $2, link_read_at = now() WHERE id = $1",
          [sourceId, error.slice(0, 500)],
        );
        return;
      }
      if (got.kind === 'text') {
        await c.query(
          `UPDATE idea_sources SET link_status = 'read', link_error = '', link_read_at = now(), link_text = $2,
                  title = CASE WHEN title = '' THEN $3 ELSE title END, file_id = NULL
            WHERE id = $1`,
          [sourceId, got.text, got.title || new URL(got.url).hostname],
        );
        return;
      }
      const idea = await writableIdea(c, a, src.idea_id);
      const { sha256, key } = await (intake.store as BlobStore).put(got.data);
      const text = textOf(got.name, got.mime, got.data);
      const fileId = (
        await c.query<{ id: string }>(
          `INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, text_content, text_kind, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            a.workspaceId,
            idea.project_id,
            got.name,
            got.mime,
            got.data.length,
            sha256,
            key,
            text ?? '',
            text === null ? 'none' : 'extracted',
            a.user.id,
          ],
        )
      ).rows[0]?.id;
      if (fileId && text === null)
        await queueRead(c, {
          id: fileId,
          workspaceId: a.workspaceId,
          name: got.name,
          mime: got.mime,
          userId: a.user.id,
        });
      await c.query(
        `UPDATE idea_sources SET link_status = 'read', link_error = '', link_read_at = now(), link_text = '',
                file_id = $2, title = CASE WHEN title = '' THEN $3 ELSE title END
          WHERE id = $1`,
        [sourceId, fileId, got.name],
      );
    });
  };
  const sourceAt = (req: IncomingMessage, workspaceId: string, sourceId: string) =>
    asMember(pool, req, workspaceId, 'member', async (c) => {
      const r = (
        await c.query<{ idea_id: string }>('SELECT idea_id FROM idea_sources WHERE id = $1', [
          sourceId,
        ])
      ).rows[0];
      if (!r) throw new HttpError(404, 'not_found', 'Source not found');
      const all = await loadSources(c, r.idea_id);
      const i = all.findIndex((x) => x.id === sourceId);
      const row = all[i];
      if (!row) throw new Error('source vanished');
      return sourceJson(row, i);
    });

  const workspace = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/workspace',
    summary:
      'Everything around an idea in one read: sources, requirements, questions, risks, assumptions, scores, coverage, decisions',
    tags: ['ideation'],
    params: ideaParams,
    response: s.object({
      idea: ideaOut,
      sources: s.array(sourceOut),
      requirements: s.array(reqOut),
      questions: s.array(QUESTIONS.out),
      risks: s.array(RISKS.out),
      assumptions: s.array(ASSUMPTIONS.out),
      scores: s.array(scoreSummaryOut),
      coverage: s.anyObject(),
      decisions: s.array(
        s.object({ id: s.string(), code: s.string(), title: s.string(), status: s.string() }),
      ),
      personas: s.array(personaOut), // [PCODE-274 | S15 | v0.1.0] the project's
      requests: s.array(linkedRequestOut),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const idea = await visibleIdea(c, a, params.ideaId);
        const sources = await loadSources(c, idea.id);
        const reqs = (
          await c.query<ReqRow>(REQ_SELECT + ' WHERE idea_id = $1 ORDER BY number', [idea.id])
        ).rows;
        const talk = (
          await c.query<{ role: string; area: string | null }>(
            'SELECT role, area FROM idea_messages WHERE idea_id = $1 ORDER BY seq',
            [idea.id],
          )
        ).rows;
        const questions = (
          await c.query<Record<string, unknown>>(
            QUESTIONS.select + ' WHERE q.idea_id = $1 ORDER BY q.status, q.created_at',
            [idea.id],
          )
        ).rows;
        const risks = (
          await c.query<Record<string, unknown>>(
            RISKS.select +
              ' WHERE r.idea_id = $1 ORDER BY r.likelihood * r.impact DESC, r.created_at',
            [idea.id],
          )
        ).rows;
        const assumptions = (
          await c.query<Record<string, unknown>>(
            ASSUMPTIONS.select + ' WHERE x.idea_id = $1 ORDER BY x.created_at',
            [idea.id],
          )
        ).rows;
        const scores = (
          await c.query<{
            method: string;
            scorer_id: string;
            name: string;
            inputs: Record<string, unknown>;
            score: number;
            note: string;
          }>(
            'SELECT x.method, x.scorer_id, u.name, x.inputs, x.score, x.note FROM idea_scores x JOIN users u ON u.id = x.scorer_id WHERE x.idea_id = $1 ORDER BY x.method, u.name',
            [idea.id],
          )
        ).rows;
        const decisions = (
          await c.query<{ id: string; number: number; title: string; status: string }>(
            'SELECT id, number, title, status FROM decisions WHERE idea_id = $1 ORDER BY number',
            [idea.id],
          )
        ).rows;
        const qJson = questions.map(QUESTIONS.json);
        return {
          body: {
            idea: ideaJson(idea),
            sources: sources.map(sourceJson),
            requirements: reqs.map(reqJson),
            questions: qJson,
            risks: risks.map(RISKS.json),
            assumptions: assumptions.map(ASSUMPTIONS.json),
            scores: METHODS.filter((m) => scores.some((x) => x.method === m)).map((m) => {
              const list = scores.filter((x) => x.method === m);
              const vals = list.map((x) => x.score);
              const mean = vals.reduce((n, v) => n + v, 0) / vals.length;
              const mine = list.find((x) => x.scorer_id === a.user.id);
              return {
                method: m,
                count: list.length,
                mean: Math.round(mean * 100) / 100,
                min: Math.min(...vals),
                max: Math.max(...vals),
                spread: mean
                  ? Math.round(((Math.max(...vals) - Math.min(...vals)) / Math.abs(mean)) * 100) /
                    100
                  : 0,
                mine: mine ? { inputs: mine.inputs, score: mine.score, note: mine.note } : null,
                scorers: list.map((x) => ({ name: x.name, score: x.score })),
              };
            }),
            coverage: coverage(
              reqs,
              qJson.map((q) => ({ area: String(q['area']), status: String(q['status']) })),
              answeredAreas(talk), // [PCODE-273 | S15 | v0.1.0] interview answers count too
            ),
            decisions: decisions.map((d) => ({
              id: d.id,
              code: 'ADR-' + String(d.number),
              title: d.title,
              status: d.status,
            })),
            personas: await loadPersonas(c, idea.project_id),
            requests: await linkedRequests(c, idea.id),
          },
        };
      }),
  });

  const addSource = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/sources',
    summary:
      'Add a source to the idea: an uploaded file, a link, pasted text or a customer quote (member)',
    tags: ['ideation'],
    params: ideaParams,
    body: s.object({
      kind: s.enum(['file', 'link', 'text', 'quote']),
      fileId: s.optional(uuid),
      url: s.optional(s.string({ max: 2000 })),
      title: s.optional(s.string({ max: 300 })),
      body: s.optional(s.string({ max: 200_000 })),
      saidBy: s.optional(s.string({ max: 200 })),
    }),
    response: sourceOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await writableIdea(c, a, params.ideaId);
        const bad = (path: string, message: string): never => {
          throw new HttpError(400, 'invalid_request', 'The source is not complete', [
            { path, message },
          ]);
        };
        let title = body.title?.trim() ?? '';
        if (body.kind === 'file') {
          if (!body.fileId) bad('body.fileId', 'is required for a file');
          const f = await visibleFile(c, a, body.fileId ?? '');
          if (f.project_id && f.project_id !== idea.project_id)
            bad('body.fileId', 'belongs to another project');
          title ||= f.name;
        }
        if (body.kind === 'link' && !/^https?:\/\/\S+$/i.test(body.url ?? ''))
          bad('body.url', 'must be an http or https address');
        if ((body.kind === 'text' || body.kind === 'quote') && !body.body?.trim())
          bad('body.body', 'is required');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO idea_sources (workspace_id, idea_id, kind, file_id, url, title, body, said_by, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              a.workspaceId,
              idea.id,
              body.kind,
              body.kind === 'file' ? body.fileId : null,
              body.url?.trim() ?? '',
              title,
              body.body?.trim() ?? '',
              body.saidBy?.trim() ?? '',
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        await touch(c, idea.id);
        return id ?? '';
      }).then(async (id) => {
        // [PCODE-272 | S15 | v0.1.0] a link is read now, outside the transaction that keeps it
        if (body.kind === 'link') await readLinkSource(req, params.workspaceId, id);
        return { status: 201, body: await sourceAt(req, params.workspaceId, id) };
      }),
  });

  // [PCODE-272 | S15 | v0.1.0]
  const readAgain = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/idea-sources/:id/read',
    summary:
      'Read a link source again from the web, for a changed page or after a failure (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: sourceOut,
    handler: async ({ params, req }) => {
      await readLinkSource(req, params.workspaceId, params.id);
      return { body: await sourceAt(req, params.workspaceId, params.id) };
    },
  });

  const removeSource = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/idea-sources/:id',
    summary:
      'Remove a source; requirements citing it keep their text but lose the citation (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<{ idea_id: string }>('SELECT idea_id FROM idea_sources WHERE id = $1', [
            params.id,
          ])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Source not found');
        await writableIdea(c, a, r.idea_id);
        await c.query("UPDATE requirements SET passage = '' WHERE source_id = $1", [params.id]);
        await c.query('DELETE FROM idea_sources WHERE id = $1', [params.id]);
        await touch(c, r.idea_id);
        return { body: { removed: true } };
      }),
  });

  const reqFields = {
    kind: s.enum(REQ_KINDS),
    area: s.enum(AREAS),
    text: s.string({ min: 1, max: 4000 }),
    priority: s.enum(['must', 'should', 'could', 'wont']),
    status: s.enum(['proposed', 'accepted', 'rejected']),
  };
  const addReq = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/requirements',
    summary: 'Add a requirement; it gets the next R-number of the idea (member)',
    tags: ['ideation'],
    params: ideaParams,
    body: s.object({
      text: reqFields.text,
      kind: s.optional(reqFields.kind),
      area: s.optional(reqFields.area),
      priority: s.optional(reqFields.priority),
      sourceId: s.optional(s.nullable(uuid)),
      passage: s.optional(s.string({ max: 2000 })),
      personaId: s.optional(s.nullable(uuid)), // [PCODE-274 | S15 | v0.1.0]
      scenarios: s.optional(s.array(s.json(), { max: 20 })),
    }),
    response: reqOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await writableIdea(c, a, params.ideaId);
        const sources = await loadSources(c, idea.id);
        if (body.sourceId && !sources.some((x) => x.id === body.sourceId))
          throw new HttpError(400, 'invalid_request', 'The source belongs to another idea', [
            { path: 'body.sourceId', message: 'is not a source of this idea' },
          ]);
        const cite = citation(sources, body.sourceId, body.passage);
        if (body.passage?.trim() && !cite.passage)
          throw new HttpError(400, 'invalid_request', 'The passage is not in the source', [
            { path: 'body.passage', message: 'is not found in the source' },
          ]);
        if (body.personaId) await projectPersona(c, idea.project_id, body.personaId);
        const id = await insertRequirement(c, a, idea.id, {
          kind: body.kind ?? 'functional',
          area: body.area ?? 'scope',
          text: body.text.trim(),
          priority: body.priority ?? 'should',
          status: 'accepted',
          ...cite,
          personaId: body.personaId ?? null,
          scenarios: scenariosOf(body.scenarios),
        });
        await touch(c, idea.id);
        const row = (await c.query<ReqRow>(REQ_SELECT + ' WHERE id = $1', [id])).rows[0];
        if (!row) throw new Error('requirement vanished');
        return { status: 201, body: reqJson(row) };
      }),
  });

  const changeReq = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/requirements/:id',
    summary: 'Change a requirement, or accept or reject a proposed one (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object({
      kind: s.optional(reqFields.kind),
      area: s.optional(reqFields.area),
      text: s.optional(reqFields.text),
      priority: s.optional(reqFields.priority),
      status: s.optional(reqFields.status),
      personaId: s.optional(s.nullable(uuid)), // [PCODE-274 | S15 | v0.1.0]
      scenarios: s.optional(s.array(s.json(), { max: 20 })),
    }),
    response: reqOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<{ idea_id: string }>('SELECT idea_id FROM requirements WHERE id = $1', [
            params.id,
          ])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Requirement not found');
        const idea = await writableIdea(c, a, r.idea_id);
        // [PCODE-274 | S15 | v0.1.0] null clears the persona; scenarios replace the list
        if (body.personaId) await projectPersona(c, idea.project_id, body.personaId);
        if (body.personaId !== undefined)
          await c.query('UPDATE requirements SET persona_id = $2 WHERE id = $1', [
            params.id,
            body.personaId,
          ]);
        if (body.scenarios !== undefined)
          await c.query('UPDATE requirements SET scenarios = $2 WHERE id = $1', [
            params.id,
            JSON.stringify(scenariosOf(body.scenarios)),
          ]);
        await c.query(
          `UPDATE requirements SET kind = coalesce($2, kind), area = coalesce($3, area), text = coalesce($4, text),
                  priority = coalesce($5, priority), status = coalesce($6, status) WHERE id = $1`,
          [
            params.id,
            body.kind ?? null,
            body.area ?? null,
            body.text?.trim() ?? null,
            body.priority ?? null,
            body.status ?? null,
          ],
        );
        await touch(c, r.idea_id);
        const row = (await c.query<ReqRow>(REQ_SELECT + ' WHERE id = $1', [params.id])).rows[0];
        if (!row) throw new Error('requirement vanished');
        return { body: reqJson(row) };
      }),
  });

  const removeReq = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/requirements/:id',
    summary: 'Remove a requirement; its number is not reused (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<{ idea_id: string }>('SELECT idea_id FROM requirements WHERE id = $1', [
            params.id,
          ])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Requirement not found');
        await writableIdea(c, a, r.idea_id);
        await c.query('DELETE FROM requirements WHERE id = $1', [params.id]);
        await touch(c, r.idea_id);
        return { body: { removed: true } };
      }),
  });

  // ── scores ──
  const score = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/scores/:method',
    summary:
      'Your score of the idea with one method (RICE, ICE, WSJF, MoSCoW, value/effort) (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, ideaId: uuid, method: s.enum(METHODS) }),
    body: s.object({ inputs: s.anyObject(), note: s.optional(s.string({ max: 1000 })) }),
    response: s.object({ method: s.string(), score: s.number() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, params.ideaId);
        const value = scoreOf(params.method, body.inputs);
        if (value === null)
          throw new HttpError(400, 'invalid_request', 'Some inputs are missing or out of range', [
            { path: 'body.inputs', message: 'do not fit ' + params.method },
          ]);
        await c.query(
          `INSERT INTO idea_scores (workspace_id, idea_id, scorer_id, method, inputs, score, note) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (idea_id, scorer_id, method) DO UPDATE SET inputs = $5, score = $6, note = $7, updated_at = now()`,
          [
            a.workspaceId,
            idea.id,
            a.user.id,
            params.method,
            JSON.stringify(body.inputs),
            value,
            body.note?.trim() ?? '',
          ],
        );
        await touch(c, idea.id);
        return { body: { method: params.method, score: value } };
      }),
  });

  // ── extraction by the Analyst ──
  const extract = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/extract',
    summary:
      'The Analyst agent takes requirements, questions, assumptions, risks and terms from the sources; all arrive proposed (member)',
    tags: ['ideation'],
    params: ideaParams,
    response: s.object({
      requirements: s.number({ integer: true }),
      cited: s.number({ integer: true }),
      questions: s.number({ integer: true }),
      assumptions: s.number({ integer: true }),
      risks: s.number({ integer: true }),
      glossary: s.number({ integer: true }),
      personas: s.number({ integer: true }), // [PCODE-274 | S15 | v0.1.0] new ones
      runId: s.string(),
      // [PCODE-272 | S15 | v0.1.0] sources with no text yet (a file or link still being read, or failed)
      unread: s.array(s.string()),
    }),
    handler: async ({ params, req }) => {
      const before = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await writableIdea(c, a, params.ideaId);
        const sources = await loadSources(c, idea.id);
        const messages = (
          await c.query<{ role: string; body: string }>(
            'SELECT role, body FROM idea_messages WHERE idea_id = $1 ORDER BY seq',
            [idea.id],
          )
        ).rows;
        const existing = (
          await c.query<{ text: string }>(
            "SELECT text FROM requirements WHERE idea_id = $1 AND status <> 'rejected'",
            [idea.id],
          )
        ).rows.map((r) => r.text);
        return { idea, sources, messages, existing };
      });
      const { idea, sources } = before;
      const blocks = [
        '### IDEA ' + idea.title + '\n' + idea.body,
        ...sources.map(
          (x, i) =>
            '### S' +
            String(i + 1) +
            ' ' +
            (x.title || x.kind) +
            (x.said_by ? ' (said by ' + x.said_by + ')' : '') +
            '\n' +
            x.text.slice(0, 30_000),
        ),
        ...(before.messages.length
          ? [
              '### INTERVIEW\n' +
                before.messages
                  .map((m) => (m.role === 'agent' ? 'Q: ' : 'A: ') + m.body)
                  .join('\n'),
            ]
          : []),
      ];
      const brief =
        blocks.join('\n\n') +
        (before.existing.length
          ? '\n\nEXISTING requirements:\n' + before.existing.map((t) => '- ' + t).join('\n')
          : '');
      const user = await requireUser(pool, req);
      const asked = await askAgent(pool, models, {
        workspaceId: params.workspaceId,
        projectId: idea.project_id,
        agentKey: 'analyst',
        requestedBy: user.id,
        instruction: 'Extract requirements from ' + idea.title,
        system: EXTRACT_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: brief }] }],
      });
      const parsed = jsonIn(asked.text);
      if (typeof parsed !== 'object' || parsed === null)
        throw new HttpError(
          502,
          'bad_gateway',
          'The Analyst’s answer could not be read. Try again.',
        );
      const o = parsed as Record<string, unknown>;
      const list = (k: string): Record<string, unknown>[] =>
        (Array.isArray(o[k]) ? (o[k] as unknown[]) : [])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 60);
      const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
        allowed.includes(v as T) ? (v as T) : d;
      const txt = (v: unknown, max: number): string =>
        typeof v === 'string' ? v.trim().slice(0, max) : '';
      const lvl = (v: unknown): number =>
        typeof v === 'number' ? Math.max(1, Math.min(5, Math.round(v))) : 3;
      const counts = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await writableIdea(c, a, idea.id);
        const srcText = sources.map((x, i) => ({
          id: x.id,
          label: 'S' + String(i + 1),
          text: x.text,
        }));
        // [PCODE-274 | S15 | v0.1.0] personas first, so stories can name them
        let personas = 0;
        for (const p of list('personas')) {
          const name = txt(p['name'], 120);
          if (!name) continue;
          const label = txt(p['source'], 20).toUpperCase();
          const made = await personaNamed(c, a, idea.project_id, {
            name,
            role: txt(p['role'], 200),
            goals: txt(p['goals'], 4000),
            pains: txt(p['pains'], 4000),
            quote: txt(p['quote'], 1000),
            sourceId: srcText.find((x) => x.label === label)?.id ?? null,
          });
          if (made.created) personas++;
        }
        // [PCODE-271 | S15 | v0.1.0] cleaned before it is kept, compared after normalising
        const seen = new Set(before.existing.map(sameText));
        let requirements = 0;
        let cited = 0;
        for (const r of list('requirements')) {
          const text = cleanStatement(txt(r['text'], 4000));
          if (!text || seen.has(sameText(text))) continue;
          seen.add(sameText(text));
          const label = txt(r['source'], 20).toUpperCase();
          const cite = citation(
            srcText,
            srcText.find((x) => x.label === label)?.id,
            txt(r['passage'], 2000),
          );
          const persona = txt(r['persona'], 120);
          await insertRequirement(c, a, idea.id, {
            kind: pick(r['kind'], REQ_KINDS, 'functional'),
            area: pick(r['area'], AREAS, 'scope'),
            text,
            priority: pick(r['priority'], ['must', 'should', 'could', 'wont'] as const, 'should'),
            ...cite,
            personaId: persona
              ? (await personaNamed(c, a, idea.project_id, { name: persona })).id
              : null,
            scenarios: scenariosOf(r['scenarios']),
          });
          requirements++;
          if (cite.passage) cited++;
        }
        let questions = 0;
        const asked = new Set<string>();
        for (const q of list('questions')) {
          const text = cleanStatement(txt(q['text'], 2000));
          if (!text || asked.has(sameText(text))) continue;
          asked.add(sameText(text));
          await c.query(
            'INSERT INTO idea_questions (workspace_id, idea_id, text, area, created_by) VALUES ($1, $2, $3, $4, $5)',
            [a.workspaceId, idea.id, text, pick(q['area'], AREAS, 'scope'), a.user.id],
          );
          questions++;
        }
        let assumptions = 0;
        for (const x of list('assumptions')) {
          const text = txt(x['text'], 2000);
          if (!text) continue;
          await c.query(
            'INSERT INTO idea_assumptions (workspace_id, idea_id, text, validate_how, created_by) VALUES ($1, $2, $3, $4, $5)',
            [a.workspaceId, idea.id, text, txt(x['validateHow'], 2000), a.user.id],
          );
          assumptions++;
        }
        let risks = 0;
        for (const x of list('risks')) {
          const text = txt(x['text'], 2000);
          if (!text) continue;
          await c.query(
            'INSERT INTO idea_risks (workspace_id, idea_id, text, likelihood, impact, mitigation, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [
              a.workspaceId,
              idea.id,
              text,
              lvl(x['likelihood']),
              lvl(x['impact']),
              txt(x['mitigation'], 2000),
              a.user.id,
            ],
          );
          risks++;
        }
        let glossary = 0;
        for (const g of list('glossary')) {
          const term = txt(g['term'], 120);
          const definition = txt(g['definition'], 4000);
          if (!term || !definition) continue;
          const r = await c.query(
            'INSERT INTO glossary_terms (workspace_id, project_id, term, definition, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id, lower(term)) DO NOTHING',
            [a.workspaceId, idea.project_id, term, definition, a.user.id],
          );
          glossary += r.rowCount ?? 0;
        }
        await touch(c, idea.id);
        await ideaEvent(c, a, idea, 'updated', {
          extracted: {
            from: null,
            to: String(requirements) + ' requirements, ' + String(questions) + ' questions',
          },
        });
        return { requirements, cited, questions, assumptions, risks, glossary, personas };
      });
      const unread = sources
        .map((x, i) => ({ label: 'S' + String(i + 1), empty: !x.text.trim() }))
        .filter((x) => x.empty)
        .map((x) => x.label);
      return { body: { ...counts, runId: asked.runId, unread } };
    },
  });

  // ── merge a duplicate ──
  const merge = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/merge',
    summary:
      'Merge this idea into another of the project: its sources, requirements, questions, risks, assumptions and scores move (member)',
    tags: ['ideation'],
    params: ideaParams,
    body: s.object({ intoId: uuid }),
    response: ideaOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const from = await writableIdea(c, a, params.ideaId);
        const into = await writableIdea(c, a, body.intoId);
        if (from.id === into.id || from.project_id !== into.project_id)
          throw new HttpError(
            400,
            'invalid_request',
            'Merge into another idea of the same project',
            [{ path: 'body.intoId', message: 'is not another idea of this project' }],
          );
        for (const t of ['idea_sources', 'idea_questions', 'idea_risks', 'idea_assumptions'])
          await c.query('UPDATE ' + t + ' SET idea_id = $2 WHERE idea_id = $1', [from.id, into.id]);
        await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [into.id]);
        await c.query(
          `UPDATE requirements r SET idea_id = $2, number = n.next FROM (
             SELECT id, (SELECT coalesce(max(number), 0) FROM requirements WHERE idea_id = $2) + row_number() OVER (ORDER BY number) AS next
               FROM requirements WHERE idea_id = $1) n
            WHERE r.id = n.id`,
          [from.id, into.id],
        );
        await c.query(
          'UPDATE idea_scores x SET idea_id = $2 WHERE idea_id = $1 AND NOT EXISTS (SELECT 1 FROM idea_scores y WHERE y.idea_id = $2 AND y.scorer_id = x.scorer_id AND y.method = x.method)',
          [from.id, into.id],
        );
        await c.query('DELETE FROM idea_scores WHERE idea_id = $1', [from.id]);
        const ref = into.project_key + '-I' + String(into.number);
        await c.query(
          "UPDATE ideas SET status = 'declined', merged_into_id = $2, rejected_reason = $3, updated_at = now(), last_activity_at = now() WHERE id = $1",
          [from.id, into.id, 'Merged into ' + ref],
        );
        await touch(c, into.id);
        const after = await visibleIdea(c, a, from.id);
        await ideaEvent(c, a, after, 'updated', { mergedInto: { from: null, to: ref } });
        return { body: ideaJson(after) };
      }),
  });

  // ── decisions (ADR) and the glossary, per project ──
  const decisionOut = s.object({
    id: s.string(),
    code: s.string(),
    title: s.string(),
    context: s.string(),
    decision: s.string(),
    consequences: s.string(),
    status: s.string(),
    ideaId: s.nullable(s.string()),
    supersededBy: s.nullable(s.string()),
    decidedBy: s.nullable(s.string()),
    decidedAt: s.nullable(s.string()),
    createdAt: s.string(),
  });
  interface DecisionRow {
    id: string;
    number: number;
    title: string;
    context: string;
    decision: string;
    consequences: string;
    status: string;
    idea_id: string | null;
    superseded_by: string | null;
    decider: string | null;
    decided_at: Date | null;
    created_at: Date;
    project_id: string;
  }
  const DEC_SELECT =
    'SELECT d.*, u.name AS decider FROM decisions d LEFT JOIN users u ON u.id = d.decided_by';
  const decJson = (d: DecisionRow) => ({
    id: d.id,
    code: 'ADR-' + String(d.number),
    title: d.title,
    context: d.context,
    decision: d.decision,
    consequences: d.consequences,
    status: d.status,
    ideaId: d.idea_id,
    supersededBy: d.superseded_by,
    decidedBy: d.decider,
    decidedAt: d.decided_at?.toISOString() ?? null,
    createdAt: d.created_at.toISOString(),
  });
  const decisions = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/decisions',
    summary: 'The project’s decision log, newest first',
    tags: ['ideation'],
    params: projectParams,
    response: s.array(decisionOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<DecisionRow>(
              DEC_SELECT + ' WHERE d.project_id = $1 ORDER BY d.number DESC',
              [params.projectId],
            )
          ).rows.map(decJson),
        };
      }),
  });
  const decFields = {
    title: s.string({ min: 1, max: 200 }),
    context: s.string({ max: 20_000 }),
    decision: s.string({ max: 20_000 }),
    consequences: s.string({ max: 20_000 }),
    status: s.enum(['proposed', 'accepted', 'superseded', 'rejected']),
  };
  const addDecision = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/decisions',
    summary: 'Record a decision (ADR); it gets the project’s next number (member)',
    tags: ['ideation'],
    params: projectParams,
    body: s.object({
      title: decFields.title,
      context: s.optional(decFields.context),
      decision: s.optional(decFields.decision),
      consequences: s.optional(decFields.consequences),
      status: s.optional(decFields.status),
      ideaId: s.optional(s.nullable(uuid)),
    }),
    response: decisionOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (body.ideaId) {
          const idea = await visibleIdea(c, a, body.ideaId);
          if (idea.project_id !== p.id)
            throw new HttpError(400, 'invalid_request', 'The idea belongs to another project', [
              { path: 'body.ideaId', message: 'is not an idea of this project' },
            ]);
        }
        await c.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [p.id]);
        const accepted = body.status === 'accepted';
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO decisions (workspace_id, project_id, idea_id, number, title, context, decision, consequences, status, decided_by, decided_at, created_by)
             VALUES ($1, $2, $3, (SELECT coalesce(max(number), 0) + 1 FROM decisions WHERE project_id = $2), $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              a.workspaceId,
              p.id,
              body.ideaId ?? null,
              body.title.trim(),
              body.context ?? '',
              body.decision ?? '',
              body.consequences ?? '',
              body.status ?? 'proposed',
              accepted ? a.user.id : null,
              accepted ? new Date() : null,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<DecisionRow>(DEC_SELECT + ' WHERE d.id = $1', [id])).rows[0];
        if (!row) throw new Error('decision vanished');
        return { status: 201, body: decJson(row) };
      }),
  });
  const changeDecision = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/decisions/:id',
    summary:
      'Change a decision; accepting it records who and when; superseding names its successor (member)',
    tags: ['ideation'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object({
      title: s.optional(decFields.title),
      context: s.optional(decFields.context),
      decision: s.optional(decFields.decision),
      consequences: s.optional(decFields.consequences),
      status: s.optional(decFields.status),
      supersededBy: s.optional(s.nullable(uuid)),
    }),
    response: decisionOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const d = (await c.query<DecisionRow>(DEC_SELECT + ' WHERE d.id = $1', [params.id]))
          .rows[0];
        if (!d) throw new HttpError(404, 'not_found', 'Decision not found');
        await requireProject(c, a, d.project_id);
        if (body.supersededBy) {
          const next = (
            await c.query<{ project_id: string }>(
              'SELECT project_id FROM decisions WHERE id = $1',
              [body.supersededBy],
            )
          ).rows[0];
          if (!next || next.project_id !== d.project_id || body.supersededBy === d.id)
            throw new HttpError(400, 'invalid_request', 'Name another decision of this project', [
              { path: 'body.supersededBy', message: 'is not another decision of this project' },
            ]);
        }
        const status = body.supersededBy ? 'superseded' : (body.status ?? null);
        await c.query(
          `UPDATE decisions SET title = coalesce($2, title), context = coalesce($3, context), decision = coalesce($4, decision),
                  consequences = coalesce($5, consequences), status = coalesce($6, status),
                  superseded_by = CASE WHEN $7::uuid IS NOT NULL THEN $7::uuid ELSE superseded_by END,
                  decided_by = CASE WHEN $6 = 'accepted' AND status <> 'accepted' THEN $8::uuid ELSE decided_by END,
                  decided_at = CASE WHEN $6 = 'accepted' AND status <> 'accepted' THEN now() ELSE decided_at END
            WHERE id = $1`,
          [
            d.id,
            body.title?.trim() ?? null,
            body.context ?? null,
            body.decision ?? null,
            body.consequences ?? null,
            status,
            body.supersededBy ?? null,
            a.user.id,
          ],
        );
        const row = (await c.query<DecisionRow>(DEC_SELECT + ' WHERE d.id = $1', [d.id])).rows[0];
        if (!row) throw new Error('decision vanished');
        return { body: decJson(row) };
      }),
  });

  const termOut = s.object({
    id: s.string(),
    term: s.string(),
    definition: s.string(),
    updatedAt: s.string(),
  });
  interface TermRow {
    id: string;
    term: string;
    definition: string;
    updated_at: Date;
    project_id: string;
  }
  const termJson = (t: TermRow) => ({
    id: t.id,
    term: t.term,
    definition: t.definition,
    updatedAt: t.updated_at.toISOString(),
  });
  const glossary = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/glossary',
    summary: 'The project’s glossary, the words its people and agents use',
    tags: ['ideation'],
    params: projectParams,
    response: s.array(termOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<TermRow>(
              'SELECT * FROM glossary_terms WHERE project_id = $1 ORDER BY lower(term)',
              [params.projectId],
            )
          ).rows.map(termJson),
        };
      }),
  });
  const addTerm = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/glossary',
    summary: 'Add a term to the glossary (member)',
    tags: ['ideation'],
    params: projectParams,
    body: s.object({
      term: s.string({ min: 1, max: 120 }),
      definition: s.string({ min: 1, max: 4000 }),
    }),
    response: termOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        try {
          const row = (
            await c.query<TermRow>(
              'INSERT INTO glossary_terms (workspace_id, project_id, term, definition, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
              [a.workspaceId, p.id, body.term.trim(), body.definition.trim(), a.user.id],
            )
          ).rows[0];
          if (!row) throw new Error('term vanished');
          return { status: 201, body: termJson(row) };
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'The glossary already has this term');
          throw e;
        }
      }),
  });
  const termParams = s.object({ workspaceId: uuid, id: uuid });
  const termOf = async (c: PoolClient, a: Access, id: string): Promise<TermRow> => {
    const t = (await c.query<TermRow>('SELECT * FROM glossary_terms WHERE id = $1', [id])).rows[0];
    if (!t) throw new HttpError(404, 'not_found', 'Term not found');
    await requireProject(c, a, t.project_id);
    return t;
  };
  const changeTerm = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/glossary/:id',
    summary: 'Change a term or its definition (member)',
    tags: ['ideation'],
    params: termParams,
    body: s.object({
      term: s.optional(s.string({ min: 1, max: 120 })),
      definition: s.optional(s.string({ min: 1, max: 4000 })),
    }),
    response: termOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await termOf(c, a, params.id);
        try {
          const row = (
            await c.query<TermRow>(
              'UPDATE glossary_terms SET term = coalesce($2, term), definition = coalesce($3, definition), updated_at = now() WHERE id = $1 RETURNING *',
              [t.id, body.term?.trim() ?? null, body.definition?.trim() ?? null],
            )
          ).rows[0];
          if (!row) throw new Error('term vanished');
          return { body: termJson(row) };
        } catch (e) {
          if (isUniqueViolation(e))
            throw new HttpError(409, 'conflict', 'The glossary already has this term');
          throw e;
        }
      }),
  });
  const removeTerm = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/glossary/:id',
    summary: 'Remove a term (member)',
    tags: ['ideation'],
    params: termParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const t = await termOf(c, a, params.id);
        await c.query('DELETE FROM glossary_terms WHERE id = $1', [t.id]);
        return { body: { removed: true } };
      }),
  });

  return [
    workspace,
    addSource,
    readAgain,
    removeSource,
    addReq,
    changeReq,
    removeReq,
    ...childRoutes(pool, QUESTIONS),
    ...childRoutes(pool, RISKS),
    ...childRoutes(pool, ASSUMPTIONS),
    score,
    extract,
    merge,
    decisions,
    addDecision,
    changeDecision,
    glossary,
    addTerm,
    changeTerm,
    removeTerm,
  ];
}
