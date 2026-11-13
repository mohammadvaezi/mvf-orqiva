// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-273 | S15 | v0.1.0] T28.2 Interview steered by coverage; handed-over questions notify their owner ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
// ── [PCODE-123 | S15 | v0.1.0] Add the ideas inbox and the AI owner interview ──
// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
//    Why:  the front half's first two stages. An idea lands in a project's inbox; the Interviewer agent asks
//          the owner one question at a time until it has enough for a proposal, then says so with a summary.
//          The conversation is rebuilt from the stored messages for every question, so it survives restarts
//          and two people answering at once cannot interleave (the second is told to reload).
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_INTERVIEW, type ModelMessage } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { inWorkspace } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject, requireUser, type Access } from './access.js';
import { AREAS, answeredAreas, coverage, isArea, MAX_QUESTIONS, steering } from './ideacoverage.js'; // [PCODE-273 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });

export const INTERVIEW_PROMPT =
  MODE_INTERVIEW +
  ' You interview the owner of an idea so that a proposal can be written. Ask exactly one short question per ' +
  'turn about what is still missing. Start each question with the area it is about in square brackets, one of ' +
  AREAS.map((a) => '[' + a + ']').join(', ') +
  ' (e.g. "[users] Who runs into this most often?"). Before each turn a line starting [ORQIVA] COVERAGE ' +
  'tells you how well each area is known and which are weakest: ask about the weakest area that matters for ' +
  'this idea, and do not ask what is already answered. When that line says FINISH NOW, or you have enough, ' +
  'answer with "READY:" followed by a summary of the idea and the owner’s answers in a few sentences.';

/** The interviewer's answer: the next question with the area it is about, or READY with a summary. */
export function readInterview(text: string): { done: boolean; body: string; area: string | null } {
  const m = /^\s*READY:\s*([\s\S]*)$/i.exec(text);
  if (m) return { done: true, body: (m[1] ?? '').trim() || 'I have what I need.', area: null };
  // [PCODE-273 | S15 | v0.1.0] "[users] Who …": the area leaves the text, unknown tags stay as written
  const tag = /^\s*\[([a-z_ -]+)\]\s*/i.exec(text);
  const area = tag?.[1]?.trim().toLowerCase().replace(/[ -]/g, '_') ?? '';
  return isArea(area)
    ? { done: false, body: text.slice(tag?.[0].length ?? 0).trim(), area }
    : { done: false, body: text, area: null };
}

export const ideaOut = s.object({
  id: s.string(),
  projectId: s.string(),
  number: s.number({ integer: true }),
  ref: s.string(),
  title: s.string(),
  body: s.string(),
  status: s.string(),
  interviewDone: s.boolean(),
  summary: s.string(),
  createdBy: s.nullable(s.string()),
  createdAt: s.string(),
  updatedAt: s.string(),
  messageCount: s.number({ integer: true }),
  // [PCODE-168 | S15 | v0.1.0] its type, why it was set aside or into which idea it was merged, last activity
  kind: s.string(),
  rejectedReason: s.string(),
  mergedIntoId: s.nullable(s.string()),
  lastActivityAt: s.string(),
  promotedAt: s.nullable(s.string()), // [PCODE-277 | S15 | v0.1.0] promoted to an epic
  epicId: s.nullable(s.string()),
});

const messageOut = s.object({
  seq: s.number({ integer: true }),
  role: s.string(),
  body: s.string(),
  author: s.nullable(s.string()),
  runId: s.nullable(s.string()),
  at: s.string(),
  area: s.nullable(s.string()), // [PCODE-273 | S15 | v0.1.0] the area an interviewer question is about
});

export interface IdeaRow {
  id: string;
  project_id: string;
  project_key: string;
  number: number;
  title: string;
  body: string;
  status: string;
  interview_done: boolean;
  summary: string;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  message_count: string;
  kind: string;
  rejected_reason: string;
  merged_into_id: string | null;
  last_activity_at: Date;
  promoted_at: Date | null; // [PCODE-277 | S15 | v0.1.0]
  epic_id: string | null;
}

const IDEA_SELECT = `SELECT i.*, p.key AS project_key, u.name AS created_by_name,
                       (SELECT count(*) FROM idea_messages m WHERE m.idea_id = i.id) AS message_count
                     FROM ideas i JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = i.created_by`;

export const ideaJson = (r: IdeaRow): Infer<typeof ideaOut> => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  ref: r.project_key + '-I' + String(r.number),
  title: r.title,
  body: r.body,
  status: r.status,
  interviewDone: r.interview_done,
  summary: r.summary,
  createdBy: r.created_by_name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  messageCount: Number(r.message_count),
  kind: r.kind,
  rejectedReason: r.rejected_reason,
  mergedIntoId: r.merged_into_id,
  lastActivityAt: r.last_activity_at.toISOString(),
  promotedAt: r.promoted_at ? r.promoted_at.toISOString() : null,
  epicId: r.epic_id,
});

/** The idea, if the caller may see its project (guests: invited projects only). */
export async function visibleIdea(c: PoolClient, a: Access, id: string): Promise<IdeaRow> {
  const r = (await c.query<IdeaRow>(IDEA_SELECT + ' WHERE i.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Idea not found');
  try {
    await requireProject(c, a, r.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Idea not found');
  }
  return r;
}

export async function ideaEvent(
  c: PoolClient,
  a: Access,
  r: Pick<IdeaRow, 'id' | 'title' | 'project_id' | 'project_key'>,
  verb: 'created' | 'updated' | 'approved' | 'rejected' | 'assigned', // [PCODE-273 | S15 | v0.1.0] assigned: a question handed over
  changes: Record<string, { from: unknown; to: unknown }> = {},
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'idea', id: r.id, label: r.title },
      parent: { type: 'project', id: r.project_id, label: r.project_key },
      changes,
    },
    { projectId: r.project_id },
  );
}

// [PCODE-124 | S15 | v0.1.0] the interview is read by the proposal writer too
export interface MessageRow {
  seq: number;
  role: 'agent' | 'owner';
  body: string;
  author_name: string | null;
  run_id: string | null;
  created_at: Date;
  area?: string | null; // [PCODE-273 | S15 | v0.1.0]
}

const messageJson = (m: MessageRow) => ({
  seq: m.seq,
  role: m.role,
  body: m.body,
  author: m.author_name,
  runId: m.run_id,
  at: m.created_at.toISOString(),
  area: m.area ?? null,
});

export const loadMessages = async (c: PoolClient, ideaId: string): Promise<MessageRow[]> =>
  (
    await c.query<MessageRow>(
      `SELECT m.seq, m.role, m.body, u.name AS author_name, m.run_id, m.created_at, m.area
         FROM idea_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.idea_id = $1 ORDER BY m.seq`,
      [ideaId],
    )
  ).rows;

/** The idea and its interview as the model sees it: the idea first, then questions and answers. */
export function interviewMessages(
  idea: Pick<IdeaRow, 'title' | 'body'>,
  messages: Pick<MessageRow, 'role' | 'body'>[],
  /** [PCODE-273 | S15 | v0.1.0] the coverage line, added to the owner's latest turn */
  steer?: string,
): ModelMessage[] {
  const out: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'The idea: ' +
            idea.title +
            (idea.body ? '\n\n' + idea.body : '') +
            '\n\nInterview me, its owner.',
        },
      ],
    },
  ];
  for (const m of messages) {
    const role = m.role === 'agent' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    // two answers in a row read as one
    if (last && last.role === role && last.content[0]?.type === 'text')
      last.content[0] = { type: 'text', text: last.content[0].text + '\n\n' + m.body };
    else out.push({ role, content: [{ type: 'text', text: m.body }] });
  }
  if (steer) {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && last.content[0]?.type === 'text')
      last.content[0] = { type: 'text', text: last.content[0].text + '\n\n' + steer };
    else out.push({ role: 'user', content: [{ type: 'text', text: steer }] });
  }
  return out;
}

/** [PCODE-273 | S15 | v0.1.0] What is known of an idea per area: requirements, questions and the interview so far. */
async function ideaCoverage(
  c: PoolClient,
  ideaId: string,
  messages: readonly Pick<MessageRow, 'role' | 'area'>[],
): Promise<Record<string, number>> {
  const reqs = (
    await c.query<{ area: string; status: string }>(
      'SELECT area, status FROM requirements WHERE idea_id = $1',
      [ideaId],
    )
  ).rows;
  const qs = (
    await c.query<{ area: string; status: string }>(
      'SELECT area, status FROM idea_questions WHERE idea_id = $1',
      [ideaId],
    )
  ).rows;
  return coverage(reqs, qs, answeredAreas(messages));
}

export function ideaRoutes(pool: Pool, models: ProviderFor): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/ideas',
    summary: 'The project’s ideas inbox, newest first',
    tags: ['ideas'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(ideaOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<IdeaRow>(IDEA_SELECT + ' WHERE i.project_id = $1 ORDER BY i.number DESC', [
            p.id,
          ])
        ).rows;
        return { body: rows.map(ideaJson) };
      }),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/ideas',
    summary: 'File an idea in the project’s inbox (member)',
    tags: ['ideas'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      title: s.string({ min: 1, max: 200 }),
      body: s.optional(s.string({ max: 20_000 })),
    }),
    response: ideaOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (p.archived_at)
          throw new HttpError(409, 'conflict', 'The project is archived; restore it first');
        const number = (
          await c.query<{ n: number }>(
            'UPDATE projects SET next_idea_seq = next_idea_seq + 1 WHERE id = $1 RETURNING next_idea_seq - 1 AS n',
            [p.id],
          )
        ).rows[0]?.n;
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO ideas (workspace_id, project_id, number, title, body, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [a.workspaceId, p.id, number, body.title.trim(), body.body?.trim() ?? '', a.user.id],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('idea insert returned nothing');
        const idea = await visibleIdea(c, a, id);
        await ideaEvent(c, a, idea, 'created');
        return { status: 201, body: ideaJson(idea) };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId',
    summary: 'One idea with its interview',
    tags: ['ideas'],
    params: s.object({ workspaceId: uuid, ideaId: uuid }),
    response: s.object({ idea: ideaOut, messages: s.array(messageOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, params.ideaId);
        const messages = await loadMessages(c, idea.id);
        return { body: { idea: ideaJson(idea), messages: messages.map(messageJson) } };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId',
    summary: 'Change an idea’s title or text, set it aside (declined) or take it back up (member)',
    tags: ['ideas'],
    params: s.object({ workspaceId: uuid, ideaId: uuid }),
    body: s.object({
      title: s.optional(s.string({ min: 1, max: 200 })),
      body: s.optional(s.string({ max: 20_000 })),
      status: s.optional(s.enum(['new', 'declined'])),
      // [PCODE-168 | S15 | v0.1.0]
      kind: s.optional(s.enum(['feature', 'improvement', 'bug', 'research', 'change_request'])),
      rejectedReason: s.optional(s.string({ max: 2000 })),
    }),
    response: ideaOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, params.ideaId);
        if (idea.status === 'approved')
          throw new HttpError(
            409,
            'conflict',
            'An approved idea is part of the plan; it stays as signed',
          );
        // [PCODE-168 | S15 | v0.1.0] taking an idea back up clears its reason
        await c.query(
          `UPDATE ideas SET title = coalesce($2, title), body = coalesce($3, body),
                  status = coalesce($4, status), kind = coalesce($5, kind),
                  rejected_reason = CASE WHEN $4 = 'new' THEN '' ELSE coalesce($6, rejected_reason) END,
                  updated_at = now(), last_activity_at = now() WHERE id = $1`,
          [
            idea.id,
            body.title?.trim() ?? null,
            body.body?.trim() ?? null,
            body.status ?? null,
            body.kind ?? null,
            body.rejectedReason?.trim() ?? null,
          ],
        );
        const after = await visibleIdea(c, a, idea.id);
        if (after.status !== idea.status)
          await ideaEvent(c, a, after, 'updated', {
            status: { from: idea.status, to: after.status },
          });
        return { body: ideaJson(after) };
      }),
  });

  const interview = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/interview',
    summary:
      'Answer the interviewer’s last question (or start the interview); the Interviewer agent asks the next one or sums up (member)',
    tags: ['ideas'],
    params: s.object({ workspaceId: uuid, ideaId: uuid }),
    body: s.object({
      answer: s.optional(s.string({ max: 20_000 })),
      // [PCODE-273 | S15 | v0.1.0] the owner has said enough: the interviewer sums up now
      enough: s.optional(s.boolean()),
    }),
    response: s.object({
      idea: ideaOut,
      messages: s.array(messageOut),
      coverage: s.anyObject(), // [PCODE-273 | S15 | v0.1.0]
      maxQuestions: s.number({ integer: true }),
    }),
    handler: async ({ params, body, req }) => {
      const answer = body.answer?.trim() ?? '';
      const enough = body.enough === true;
      // 1. the answer is kept at once, and the conversation so far is read
      const before = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, params.ideaId);
        await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [idea.id]);
        if (idea.status === 'approved' || idea.status === 'declined')
          throw new HttpError(
            409,
            'conflict',
            'This idea is ' + idea.status + '; the interview is closed',
          );
        const messages = await loadMessages(c, idea.id);
        const lastRole = messages[messages.length - 1]?.role;
        if (!answer && lastRole === 'agent' && !enough)
          throw new HttpError(400, 'invalid_request', 'Answer the question first', [
            { path: 'body.answer', message: 'is required while a question is open' },
          ]);
        if (answer) {
          await c.query(
            'INSERT INTO idea_messages (workspace_id, idea_id, seq, role, body, author_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [a.workspaceId, idea.id, messages.length + 1, 'owner', answer, a.user.id],
          );
          messages.push({
            seq: messages.length + 1,
            role: 'owner',
            body: answer,
            author_name: a.user.name,
            run_id: null,
            created_at: new Date(),
          });
        }
        if (idea.status === 'new') {
          await c.query(
            "UPDATE ideas SET status = 'interviewing', updated_at = now() WHERE id = $1",
            [idea.id],
          );
          await ideaEvent(c, a, idea, 'updated', { status: { from: 'new', to: 'interviewing' } });
        }
        const cov = await ideaCoverage(c, idea.id, messages);
        return { idea, messages, workspaceId: a.workspaceId, cov };
      });
      const user = await requireUser(pool, req);
      // [PCODE-273 | S15 | v0.1.0] the interviewer is told the coverage, and to finish when it is time
      const asked = before.messages.filter((m) => m.role === 'agent').length;
      const steer = steering(before.cov, asked, enough);

      // 2. the interviewer thinks, outside any transaction
      const reply0 = await askAgent(pool, models, {
        workspaceId: before.workspaceId,
        projectId: before.idea.project_id,
        agentKey: 'interviewer',
        requestedBy: user.id,
        instruction:
          'Interview the owner about ' +
          before.idea.project_key +
          '-I' +
          String(before.idea.number) +
          ': ' +
          before.idea.title,
        system: INTERVIEW_PROMPT,
        messages: interviewMessages(before.idea, before.messages, steer.text),
      });
      const reply = readInterview(reply0.text);

      // 3. its question (or summary) joins the conversation, unless someone answered meanwhile
      return inWorkspace(pool, before.workspaceId, async (c) => {
        await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [before.idea.id]);
        const n = Number(
          (
            await c.query<{ n: string }>(
              'SELECT count(*) AS n FROM idea_messages WHERE idea_id = $1',
              [before.idea.id],
            )
          ).rows[0]?.n ?? 0,
        );
        if (n !== before.messages.length)
          throw new HttpError(
            409,
            'conflict',
            'Someone else answered meanwhile; reload the interview',
          );
        await c.query(
          'INSERT INTO idea_messages (workspace_id, idea_id, seq, role, body, run_id, area) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            before.workspaceId,
            before.idea.id,
            n + 1,
            'agent',
            reply.body,
            reply0.runId,
            reply.area,
          ],
        );
        await c.query(
          `UPDATE ideas SET interview_done = $2, summary = CASE WHEN $2 THEN $3 ELSE summary END, updated_at = now()
            WHERE id = $1`,
          [before.idea.id, reply.done, reply.body],
        );
        const access: Access = {
          user,
          workspaceId: before.workspaceId,
          role: 'member',
        };
        const idea = await visibleIdea(c, { ...access, role: 'owner' }, before.idea.id);
        if (reply.done && !before.idea.interview_done)
          await ideaEvent(c, access, idea, 'updated', { interview: { from: 'open', to: 'done' } });
        const messages = await loadMessages(c, idea.id);
        return {
          body: {
            idea: ideaJson(idea),
            messages: messages.map(messageJson),
            coverage: await ideaCoverage(c, idea.id, messages),
            maxQuestions: MAX_QUESTIONS,
          },
        };
      });
    },
  });

  return [list, create, get, update, interview];
}
