// ── [PCODE-350 | S15 | v0.1.0] T35.3a Templates library for projects, PRDs, sprints and agents ──
// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-276 | S15 | v0.1.0] T28.5 Idea estimates: size, confidence range from estimate vs actual, basis from similar past tasks ──
// ── [PCODE-275 | S15 | v0.1.0] T28.4 PRD: templates per idea kind, citations per statement, version diff, MD, PDF and Word export ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-124 | S15 | v0.1.0] Generate proposals with an estimate from the interview, with versions ──
//    Why:  the third stage. The Architect agent writes the proposal from the idea and the interview; the
//          server reads the JSON out of its answer, checks the shape and computes the estimate itself, and
//          stores nothing it cannot use. People then edit it, and every edit is a new version.
import {
  citationReport,
  estimateHours,
  estimateRange,
  estimateOf,
  offFromBasis,
  rangeText,
  similarity,
  suggestFrom,
  words,
  type SimilarTask,
  jsonIn,
  normalProposal,
  prdGherkin,
  prdMarkdown,
  proposalProblems,
  scenariosOf,
  type PrdDoc,
  type PrdRef,
  type ProposalContent,
  type TemplateSection,
} from '@orqiva/shared';
import { markdownDocx } from '../export/docxwrite.js'; // [PCODE-275 | S15 | v0.1.0]
import { unitOf } from './estimation.js'; // [PCODE-276 | S15 | v0.1.0]
import { numberSetting } from './settingvalue.js';
import type { Pool, PoolClient } from 'pg';
import { askAgent } from '../agents/oneshot.js';
import { MODE_PROPOSAL, type ModelMessage } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { inWorkspace } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { asMember, requireUser, type Access } from './access.js';
import { prdTemplateFor } from './templatelibrary.js'; // [PCODE-350 | S15 | v0.1.0]
import { ideaEvent, loadMessages, visibleIdea, type IdeaRow, type MessageRow } from './ideas.js';

const uuid = s.string({ format: 'uuid' });
const params = s.object({ workspaceId: uuid, ideaId: uuid });

export const PROPOSAL_PROMPT =
  MODE_PROPOSAL +
  ' Write the proposal the owner will approve or decline, from the idea and the interview. Answer with one ' +
  'JSON object in a ```json block and nothing else, with these fields: "summary" (two or three sentences), ' +
  '"problem" (who has it and why it matters), "goals", "scopeIn", "scopeOut", "risks" (lists of short lines) ' +
  'and "tasks": a list of {"title", "estimate", "description"} where each task is about one day of work and ' +
  '"estimate" is story points, one of 1, 2, 3, 5, 8 or 13. Stay within what the owner said; list open ' +
  'questions as risks. When the brief names extra SECTIONS for this kind of idea, add "sections": a list of ' +
  '{"key", "title", "body"} with exactly those keys and titles. When it lists REQUIREMENTS, end every statement ' +
  'that rests on one with its code in brackets, e.g. "Reminders go out the day before [R-3]." (several: [R-3, R-5]); ' +
  'never invent a code.';

export const proposalOut = s.object({
  id: s.string(),
  version: s.number({ integer: true }),
  content: s.anyObject(),
  estimate: s.object({ points: s.number({ integer: true }), days: s.number({ integer: true }) }),
  source: s.string(),
  author: s.nullable(s.string()),
  runId: s.nullable(s.string()),
  createdAt: s.string(),
});

export interface ProposalRow {
  id: string;
  idea_id: string;
  version: number;
  content: ProposalContent;
  estimate_points: number;
  estimate_days: number;
  source: string;
  author_name: string | null;
  run_id: string | null;
  created_at: Date;
}

export const PROPOSAL_SELECT = `SELECT pr.*, u.name AS author_name FROM proposals pr LEFT JOIN users u ON u.id = pr.author_id`;

export const proposalJson = (r: ProposalRow): Infer<typeof proposalOut> => ({
  id: r.id,
  version: r.version,
  content: r.content as unknown as Record<string, unknown>,
  estimate: { points: r.estimate_points, days: r.estimate_days },
  source: r.source,
  author: r.author_name,
  runId: r.run_id,
  createdAt: r.created_at.toISOString(),
});

/** The idea and its interview, written out for the proposal writer. */
export function proposalBrief(
  idea: Pick<IdeaRow, 'title' | 'body' | 'summary'>,
  messages: Pick<MessageRow, 'role' | 'body'>[],
  // [PCODE-275 | S15 | v0.1.0] the sections of its kind, and the requirements it may cite
  extra: {
    kind?: string;
    template?: readonly TemplateSection[];
    requirements?: readonly { code: string; text: string }[];
  } = {},
): ModelMessage[] {
  const lines = ['The idea: ' + idea.title];
  if (idea.body) lines.push('', idea.body);
  if (idea.summary) lines.push('', 'Interview summary: ' + idea.summary);
  if (messages.length) {
    lines.push('', 'The interview:');
    for (const m of messages) lines.push((m.role === 'agent' ? 'Q: ' : 'A: ') + m.body);
  }
  if (extra.template?.length) {
    lines.push('', 'SECTIONS for a ' + (extra.kind ?? 'feature').replace(/_/g, ' ') + ':');
    for (const s of extra.template) lines.push('- ' + s.key + ': ' + s.title + ' (' + s.hint + ')');
  }
  if (extra.requirements?.length) {
    lines.push('', 'REQUIREMENTS:');
    for (const r of extra.requirements) lines.push(r.code + ': ' + r.text);
  }
  return [{ role: 'user', content: [{ type: 'text', text: lines.join('\n') }] }];
}

// [PCODE-276 | S15 | v0.1.0] how the project's finished tasks came out, and the ones that read like a title
interface DoneTask {
  ref: string;
  title: string;
  description: string;
  estimate: number | null;
  hours: number;
}
async function projectHistory(
  c: PoolClient,
  projectId: string,
): Promise<{ done: DoneTask[]; ratios: number[]; unit: string; hpp: number }> {
  const unit = await unitOf(c, projectId);
  const hpp = await numberSetting(c, 'planning.hours_per_point', projectId);
  const done = (
    await c.query<{
      ref: string;
      title: string;
      description: string;
      estimate: number | null;
      minutes: string;
    }>(
      `SELECT p.key || '-' || i.sequence AS ref, i.title, left(i.description, 2000) AS description, i.estimate,
              (SELECT coalesce(sum(t.minutes), 0) FROM time_entries t WHERE t.item_id = i.id) AS minutes
         FROM items i JOIN projects p ON p.id = i.project_id
        WHERE i.project_id = $1 AND i.completed_at IS NOT NULL AND i.completed_at >= now() - interval '180 days'
        ORDER BY i.completed_at DESC LIMIT 500`,
      [projectId],
    )
  ).rows.map((d) => ({
    ref: d.ref,
    title: d.title,
    description: d.description,
    estimate: d.estimate,
    hours: Math.round((Number(d.minutes) / 60) * 10) / 10,
  }));
  const ratios = done
    .filter((d) => d.estimate !== null && d.estimate > 0 && d.hours > 0)
    .map((d) => d.hours / estimateHours(d.estimate ?? 1, unit, hpp));
  return { done, ratios, unit, hpp };
}

/** The finished tasks that read most like a proposal task. */
export function lookAlikes(
  title: string,
  description: string,
  done: readonly DoneTask[],
): SimilarTask[] {
  const mine = words(title + ' ' + title + ' ' + description);
  return done
    .map((d) => ({
      ref: d.ref,
      title: d.title,
      estimate: d.estimate,
      hours: d.hours,
      score:
        Math.round(similarity(mine, words(d.title + ' ' + d.title + ' ' + d.description)) * 100) /
        100,
    }))
    .filter((d) => d.score >= 0.15 && (d.estimate !== null || d.hours > 0))
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
}

// [PCODE-275 | S15 | v0.1.0] what a PRD rests on: requirements with their passages, sources by label, stories
interface PrdBasis {
  refs: PrdRef[];
  stories: PrdDoc['stories'];
}
export async function prdBasis(c: PoolClient, ideaId: string): Promise<PrdBasis> {
  const sources = (
    await c.query<{ id: string; title: string; kind: string }>(
      'SELECT id, title, kind FROM idea_sources WHERE idea_id = $1 ORDER BY created_at, id',
      [ideaId],
    )
  ).rows.map((x, i) => ({ ...x, label: 'S' + String(i + 1) }));
  const reqs = (
    await c.query<{
      number: number;
      kind: string;
      text: string;
      source_id: string | null;
      passage: string;
      persona: string | null;
      scenarios: unknown;
    }>(
      `SELECT r.number, r.kind, r.text, r.source_id, r.passage, p.name AS persona, r.scenarios
         FROM requirements r LEFT JOIN personas p ON p.id = r.persona_id
        WHERE r.idea_id = $1 AND r.status <> 'rejected' ORDER BY r.number`,
      [ideaId],
    )
  ).rows;
  const sourceName = (id: string | null): string => {
    const x = sources.find((s) => s.id === id);
    return x ? x.label + (x.title ? ' ' + x.title : '') : '';
  };
  return {
    refs: [
      ...reqs.map((r) => ({
        code: 'R-' + String(r.number),
        text: r.text,
        source: sourceName(r.source_id),
        passage: r.passage,
      })),
      ...sources.map((x) => ({ code: x.label, text: x.title || x.kind, source: '', passage: '' })),
    ],
    stories: reqs
      .filter((r) => r.kind === 'story')
      .map((r) => ({
        code: 'R-' + String(r.number),
        text: r.text,
        persona: r.persona ?? '',
        scenarios: scenariosOf(r.scenarios),
      })),
  };
}

/**
 * [PCODE-277 | S15 | v0.1.0] A proposal takes new versions until the idea is declined or promoted; an edit after
 * approval reopens it.
 */
function editable(idea: IdeaRow): void {
  if (idea.status === 'declined')
    throw new HttpError(409, 'conflict', 'This idea is declined; its proposal is closed');
  if (idea.promoted_at)
    throw new HttpError(409, 'conflict', 'This idea is promoted to an epic; its PRD is frozen');
}

async function store(
  c: PoolClient,
  a: Access,
  idea: IdeaRow,
  content: ProposalContent,
  source: 'agent' | 'person',
  runId: string | null,
): Promise<ProposalRow> {
  await c.query('SELECT 1 FROM ideas WHERE id = $1 FOR UPDATE', [idea.id]);
  const version =
    (
      await c.query<{ v: number }>(
        'SELECT coalesce(max(version), 0) + 1 AS v FROM proposals WHERE idea_id = $1',
        [idea.id],
      )
    ).rows[0]?.v ?? 1;
  const est = estimateOf(content.tasks);
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO proposals (workspace_id, idea_id, version, content, estimate_points, estimate_days, source, author_id, run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        a.workspaceId,
        idea.id,
        version,
        JSON.stringify(content),
        est.points,
        est.days,
        source,
        source === 'person' ? a.user.id : null,
        runId,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('proposal insert returned nothing');
  // [PCODE-277 | S15 | v0.1.0] a new version voids earlier decisions: with named approvers the review starts again
  const named = Number(
    (
      await c.query<{ n: string }>('SELECT count(*) AS n FROM idea_approvers WHERE idea_id = $1', [
        idea.id,
      ])
    ).rows[0]?.n ?? 0,
  );
  const reopen = named > 0 && (idea.status === 'in_review' || idea.status === 'approved');
  const next = reopen ? 'in_review' : 'proposed';
  await c.query('UPDATE ideas SET status = $2, updated_at = now() WHERE id = $1', [idea.id, next]);
  await ideaEvent(c, a, idea, 'updated', {
    proposal: { from: version - 1 || null, to: version },
    ...(idea.status !== next ? { status: { from: idea.status, to: next } } : {}),
    ...(reopen ? { review: { from: version - 1, to: 'reopened' } } : {}),
  });
  const row = (await c.query<ProposalRow>(PROPOSAL_SELECT + ' WHERE pr.id = $1', [id])).rows[0];
  if (!row) throw new Error('proposal vanished');
  return row;
}

export function proposalRoutes(pool: Pool, models: ProviderFor): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/proposals',
    summary: 'Every version of the idea’s proposal, newest first',
    tags: ['ideas'],
    params,
    response: s.array(proposalOut),
    handler: ({ params: p, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        const rows = (
          await c.query<ProposalRow>(
            PROPOSAL_SELECT + ' WHERE pr.idea_id = $1 ORDER BY pr.version DESC',
            [idea.id],
          )
        ).rows;
        return { body: rows.map(proposalJson) };
      }),
  });

  const draft = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/proposals/draft',
    summary:
      'The Architect agent drafts a new proposal version from the idea and its interview (member)',
    tags: ['ideas'],
    params,
    response: proposalOut,
    status: 201,
    handler: async ({ params: p, req }) => {
      const before = await asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        editable(idea);
        if (!idea.interview_done)
          throw new HttpError(
            409,
            'conflict',
            'Finish the interview first: the proposal is written from it',
          );
        return {
          idea,
          messages: await loadMessages(c, idea.id),
          access: a,
          basis: await prdBasis(c, idea.id), // [PCODE-275 | S15 | v0.1.0]
          template: await prdTemplateFor(c, idea.kind), // [PCODE-350 | S15 | v0.1.0]
        };
      });
      const user = await requireUser(pool, req);
      const asked = await askAgent(pool, models, {
        workspaceId: p.workspaceId,
        projectId: before.idea.project_id,
        agentKey: 'architect',
        requestedBy: user.id,
        instruction:
          'Draft the proposal for ' +
          before.idea.project_key +
          '-I' +
          String(before.idea.number) +
          ': ' +
          before.idea.title,
        system: PROPOSAL_PROMPT,
        messages: proposalBrief(before.idea, before.messages, {
          kind: before.idea.kind,
          template: before.template, // [PCODE-350 | S15 | v0.1.0]
          requirements: before.basis.refs.filter((r) => r.code.startsWith('R-')),
        }),
      });
      const parsed = jsonIn(asked.text);
      const problems = proposalProblems(parsed);
      if (problems.length)
        throw new HttpError(
          502,
          'bad_gateway',
          'The Architect agent’s draft could not be used: ' +
            problems.slice(0, 3).join('; ') +
            '. Try again.',
        );
      const row = await inWorkspace(pool, p.workspaceId, async (c) => {
        const idea = await visibleIdea(c, before.access, p.ideaId);
        editable(idea);
        return store(c, before.access, idea, normalProposal(parsed), 'agent', asked.runId);
      });
      return { status: 201, body: proposalJson(row) };
    },
  });

  const write = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/proposals',
    summary: 'Save an edited proposal as a new version (member)',
    tags: ['ideas'],
    params,
    body: s.object({ content: s.anyObject() }),
    response: proposalOut,
    status: 201,
    handler: ({ params: p, body, req }) =>
      asMember(pool, req, p.workspaceId, 'member', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        editable(idea);
        const problems = proposalProblems(body.content);
        if (problems.length)
          throw new HttpError(
            400,
            'invalid_request',
            'The proposal is not complete',
            problems.map((message) => ({ path: 'body.content', message })),
          );
        const row = await store(c, a, idea, normalProposal(body.content), 'person', null);
        return { status: 201, body: proposalJson(row) };
      }),
  });

  // [PCODE-275 | S15 | v0.1.0] one version with what its statements rest on
  const versionOf = async (
    c: PoolClient,
    ideaId: string,
    version?: number,
  ): Promise<ProposalRow> => {
    const row = (
      await c.query<ProposalRow>(
        PROPOSAL_SELECT +
          ' WHERE pr.idea_id = $1 AND ($2::int IS NULL OR pr.version = $2) ORDER BY pr.version DESC LIMIT 1',
        [ideaId, version ?? null],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'not_found', 'There is no such version of the proposal');
    return row;
  };
  const prdQuery = s.object({ version: s.optional(s.string({ pattern: /^[0-9]{1,4}$/ })) });

  const prd = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/prd',
    summary:
      'A version of the PRD (the latest by default) with its template, the requirements and sources it cites, the citation count and the stories',
    tags: ['ideas'],
    params,
    query: prdQuery,
    response: s.object({
      version: s.number({ integer: true }),
      kind: s.string(),
      template: s.array(s.object({ key: s.string(), title: s.string(), hint: s.string() })),
      refs: s.array(
        s.object({ code: s.string(), text: s.string(), source: s.string(), passage: s.string() }),
      ),
      report: s.object({
        total: s.number({ integer: true }),
        cited: s.number({ integer: true }),
        uncited: s.array(s.object({ path: s.string(), part: s.string(), text: s.string() })),
      }),
      stories: s.array(
        s.object({
          code: s.string(),
          text: s.string(),
          persona: s.string(),
          scenarios: s.array(s.object({ given: s.string(), when: s.string(), then: s.string() })),
        }),
      ),
    }),
    handler: ({ params: p, query, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        const row = await versionOf(c, idea.id, query.version ? Number(query.version) : undefined);
        const basis = await prdBasis(c, idea.id);
        return {
          body: {
            version: row.version,
            kind: idea.kind,
            template: [...(await prdTemplateFor(c, idea.kind))], // [PCODE-350 | S15 | v0.1.0]
            refs: basis.refs,
            report: citationReport(normalProposal(row.content)),
            stories: basis.stories.map((x) => ({ ...x, scenarios: [...x.scenarios] })),
          },
        };
      }),
  });

  const exportPrd = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/prd/export',
    summary:
      'A version of the PRD as a file: Markdown, Word (.docx) or the stories as Gherkin (.feature)',
    tags: ['ideas'],
    params,
    query: s.object({
      version: s.optional(s.string({ pattern: /^[0-9]{1,4}$/ })),
      format: s.enum(['md', 'docx', 'feature']),
    }),
    response: s.object({}),
    handler: ({ params: p, query, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        const row = await versionOf(c, idea.id, query.version ? Number(query.version) : undefined);
        const basis = await prdBasis(c, idea.id);
        const history = await projectHistory(c, idea.project_id); // [PCODE-276 | S15 | v0.1.0]
        const ref = idea.project_key + '-I' + String(idea.number);
        const doc: PrdDoc = {
          ref,
          title: idea.title,
          kind: idea.kind,
          version: row.version,
          status: idea.status,
          author:
            row.source === 'agent'
              ? 'written by the Architect agent'
              : 'edited by ' + (row.author_name ?? 'someone'),
          date: row.created_at.toISOString().slice(0, 10),
          content: normalProposal(row.content),
          estimate: { points: row.estimate_points, days: row.estimate_days },
          range: rangeText(estimateRange(row.estimate_points, history.ratios)),
          refs: basis.refs,
          stories: basis.stories,
        };
        const name = ref.toLowerCase() + '-prd-v' + String(row.version);
        if (query.format === 'feature')
          return {
            body: {},
            file: {
              data: Buffer.from(prdGherkin(doc), 'utf8'),
              contentType: 'text/plain; charset=utf-8',
              name: ref.toLowerCase() + '.feature',
            },
          };
        const text = prdMarkdown(doc);
        if (query.format === 'md')
          return {
            body: {},
            file: {
              data: Buffer.from(text, 'utf8'),
              contentType: 'text/markdown; charset=utf-8',
              name: name + '.md',
            },
          };
        return {
          body: {},
          file: {
            data: markdownDocx(text, ref + ' ' + idea.title, row.created_at),
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            name: name + '.docx',
          },
        };
      }),
  });

  // [PCODE-276 | S15 | v0.1.0] the estimate of a version: size, range, confidence, and the basis of each task
  const similarOut = s.object({
    ref: s.string(),
    title: s.string(),
    estimate: s.nullable(s.number()),
    hours: s.number(),
    score: s.number(),
  });
  const estimate = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/ideas/:ideaId/estimate',
    summary:
      'The estimate of a PRD version: size, a range from how finished tasks came out, and similar finished tasks per proposal task',
    tags: ['ideas'],
    params,
    query: prdQuery,
    response: s.object({
      version: s.number({ integer: true }),
      range: s.object({
        points: s.number(),
        size: s.string(),
        low: s.number(),
        likely: s.number(),
        high: s.number(),
        lowDays: s.number({ integer: true }),
        likelyDays: s.number({ integer: true }),
        highDays: s.number({ integer: true }),
        confidence: s.string(),
        basis: s.string(),
        history: s.number({ integer: true }),
      }),
      text: s.string(),
      unit: s.string(),
      tasks: s.array(
        s.object({
          title: s.string(),
          estimate: s.number(),
          suggested: s.nullable(s.number()),
          basis: s.string(),
          off: s.boolean(),
          similar: s.array(similarOut),
        }),
      ),
    }),
    handler: ({ params: p, query, req }) =>
      asMember(pool, req, p.workspaceId, 'guest', async (c, a) => {
        const idea = await visibleIdea(c, a, p.ideaId);
        const row = await versionOf(c, idea.id, query.version ? Number(query.version) : undefined);
        const history = await projectHistory(c, idea.project_id);
        const range = estimateRange(row.estimate_points, history.ratios);
        const content = normalProposal(row.content);
        return {
          body: {
            version: row.version,
            range,
            text: rangeText(range),
            unit: history.unit,
            tasks: content.tasks.map((t) => {
              const similar = lookAlikes(t.title, t.description, history.done);
              // the proposal's tasks are in points; the look-alikes are read in points too
              const sug = suggestFrom(similar, 'points', history.hpp);
              return {
                title: t.title,
                estimate: t.estimate,
                suggested: sug.value,
                basis: sug.basis,
                off: offFromBasis(t.estimate, sug.value),
                similar,
              };
            }),
          },
        };
      }),
  });

  return [list, draft, write, prd, exportPrd, estimate];
}
