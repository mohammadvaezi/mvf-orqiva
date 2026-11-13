// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
//    Why:  what page embeds show, answered by the server: a task query with each task's state, kind and
//          person; the plan as bars; lines of a repository file as the last scan sent it. The scan asks
//          which files the pages' code embeds name, and sends those and the README files.
import { createHash } from 'node:crypto';
import { codePathsIn, matchesQuery, readTaskQuery } from '@orqiva/shared';
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { computePlan } from './plan.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

/** The most text one scan sends, and one file may hold. */
export const TEXTS_MAX_TOTAL = 3_000_000;
export const TEXT_MAX = 300_000;

export function embedRoutes(pool: Pool): Route[] {
  const wanted = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-texts/wanted',
    summary:
      'The repository files the pages’ code embeds name, for the scan to send with the README files',
    tags: ['documents'],
    params: projectParams,
    response: s.object({ paths: s.array(s.string()), readmes: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const bodies = (
          await c.query<{ body: string }>(
            "SELECT body FROM doc_pages WHERE project_id = $1 AND deleted_at IS NULL AND body LIKE '%```embed%'",
            [params.projectId],
          )
        ).rows.map((r) => r.body);
        return { body: { paths: codePathsIn(bodies), readmes: true } };
      }),
  });

  const put = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-texts',
    summary:
      'The text of repository files pages need, from orq docs scan; a full scan drops the rest (member)',
    tags: ['documents'],
    params: projectParams,
    body: s.object({
      texts: s.array(
        s.object({ path: s.string({ min: 1, max: 500 }), text: s.string({ max: TEXT_MAX }) }),
        { max: 500 },
      ),
      full: s.optional(s.boolean()),
    }),
    response: s.object({
      stored: s.number({ integer: true }),
      removed: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const total = body.texts.reduce((n, t) => n + t.text.length, 0);
        if (total > TEXTS_MAX_TOTAL)
          throw new HttpError(413, 'payload_too_large', 'At most 3 MB of text per scan');
        for (const t of body.texts) {
          const path = t.path.replace(/\\/g, '/').replace(/^\.?\//, '');
          await c.query(
            `INSERT INTO code_texts (workspace_id, project_id, path, text, sha256) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (project_id, path) DO UPDATE SET text = EXCLUDED.text, sha256 = EXCLUDED.sha256, scanned_at = now()`,
            [
              a.workspaceId,
              params.projectId,
              path,
              t.text.replace(/\u0000/g, ''),
              createHash('sha256').update(t.text).digest('hex'),
            ],
          );
        }
        const removed = body.full
          ? ((
              await c.query(
                'DELETE FROM code_texts WHERE project_id = $1 AND NOT (path = ANY($2::text[]))',
                [
                  params.projectId,
                  body.texts.map((t) => t.path.replace(/\\/g, '/').replace(/^\.?\//, '')),
                ],
              )
            ).rowCount ?? 0)
          : 0;
        return { body: { stored: body.texts.length, removed } };
      }),
  });

  const text = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/code-text',
    summary: 'Lines of a repository file as the last scan sent it',
    tags: ['documents'],
    params: projectParams,
    query: s.object({
      path: s.string({ min: 1, max: 500 }),
      from: s.optional(s.string({ pattern: /^\d{1,6}$/ })),
      to: s.optional(s.string({ pattern: /^\d{1,6}$/ })),
    }),
    response: s.object({
      path: s.string(),
      total: s.number({ integer: true }),
      from: s.number({ integer: true }),
      lines: s.array(s.string()),
      scannedAt: s.string(),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const r = (
          await c.query<{ text: string; scanned_at: Date }>(
            'SELECT text, scanned_at FROM code_texts WHERE project_id = $1 AND path = $2',
            [params.projectId, query.path.replace(/^\.?\//, '')],
          )
        ).rows[0];
        if (!r)
          throw new HttpError(
            404,
            'not_found',
            query.path + ' has not been sent yet: run orq docs scan in the repository',
          );
        const all = r.text.replace(/\r\n/g, '\n').split('\n');
        const from = Math.max(1, Number(query.from ?? 1));
        const to = Math.min(
          all.length,
          Number(query.to ?? Math.min(all.length, from + 199)),
          from + 499,
        );
        return {
          body: {
            path: query.path,
            total: all.length,
            from,
            lines: all.slice(from - 1, to),
            scannedAt: r.scanned_at.toISOString(),
          },
        };
      }),
  });

  const tasks = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/embed/tasks',
    summary: 'The tasks a page’s task list query asks for, with state, kind and person',
    tags: ['documents'],
    params: projectParams,
    query: s.object({ query: s.optional(s.string({ max: 500 })) }),
    response: s.object({
      total: s.number({ integer: true }),
      tasks: s.array(
        s.object({
          id: s.string(),
          ref: s.string(),
          title: s.string(),
          state: s.string(),
          stateGroup: s.string(),
          kind: s.string(),
          assignee: s.nullable(s.string()),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const q = readTaskQuery(query.query ?? '');
        const rows = (
          await c.query<{
            id: string;
            ref: string;
            title: string;
            state: string;
            grp: string;
            kind: string;
            assignee_id: string | null;
            assignee: string | null;
            labels: string[];
            current: boolean;
          }>(
            `SELECT i.id, p.key || '-' || i.sequence AS ref, i.title, st.name AS state, st.grp, i.kind,
                    i.assignee_id, u.name AS assignee,
                    coalesce((SELECT array_agg(l.name) FROM item_labels il JOIN labels l ON l.id = il.label_id
                               WHERE il.item_id = i.id), '{}') AS labels,
                    coalesce((SELECT s.status = 'active' FROM sprints s WHERE s.id = i.sprint_id), false) AS current
               FROM items i JOIN projects p ON p.id = i.project_id JOIN project_states st ON st.id = i.state_id
               LEFT JOIN users u ON u.id = i.assignee_id
              WHERE i.project_id = $1
              ORDER BY st.position, i.rank`,
            [params.projectId],
          )
        ).rows;
        const hits = rows.filter((r) =>
          matchesQuery(
            {
              title: r.title,
              ref: r.ref,
              state: r.state,
              stateGroup: r.grp,
              kind: r.kind,
              assignee: r.assignee,
              assigneeId: r.assignee_id,
              labels: r.labels,
              sprintCurrent: r.current,
            },
            q,
            a.user.id,
          ),
        );
        return {
          body: {
            total: hits.length,
            tasks: hits.slice(0, q.limit).map((r) => ({
              id: r.id,
              ref: r.ref,
              title: r.title,
              state: r.state,
              stateGroup: r.grp,
              kind: r.kind,
              assignee: r.assignee,
            })),
          },
        };
      }),
  });

  const plan = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/embed/plan',
    summary:
      'The project’s plan as bars for a page: every task, or one sprint’s (current or by name)',
    tags: ['documents'],
    params: projectParams,
    query: s.object({ sprint: s.optional(s.string({ max: 200 })) }),
    response: s.object({
      start: s.nullable(s.string()),
      finish: s.nullable(s.string()),
      today: s.string(),
      bars: s.array(
        s.object({
          id: s.string(),
          ref: s.string(),
          title: s.string(),
          start: s.string(),
          finish: s.string(),
          level: s.number({ integer: true }),
          summary: s.boolean(),
          milestone: s.boolean(),
          critical: s.boolean(),
          percentDone: s.number(),
        }),
      ),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const p = await computePlan(c, a, params.projectId);
        let only: Set<string> | null = null;
        const want = (query.sprint ?? '').trim();
        if (want) {
          const sprint = (
            await c.query<{ id: string }>(
              `SELECT id FROM sprints WHERE project_id = $1 AND ($2 = 'current' AND status = 'active' OR lower(name) = lower($2))
                ORDER BY start_date DESC NULLS LAST LIMIT 1`,
              [params.projectId, want],
            )
          ).rows[0];
          if (!sprint)
            throw new HttpError(404, 'not_found', 'No sprint ' + want + ' in this project');
          only = new Set(p.rows.filter((r) => r.sprint_id === sprint.id).map((r) => r.id));
        }
        const row = new Map(p.rows.map((r) => [r.id, r]));
        const bars = p.sched.tasks
          .filter((t) => !only || only.has(t.id))
          .slice(0, 80)
          .map((t) => ({
            id: t.id,
            ref: row.get(t.id)?.ref ?? '',
            title: row.get(t.id)?.title ?? '',
            start: t.start,
            finish: t.finish,
            level: t.level,
            summary: t.summary,
            milestone: t.milestone,
            critical: t.critical,
            percentDone: t.percentDone,
          }));
        return {
          body: {
            start: bars.length ? (bars.map((b) => b.start).sort()[0] ?? null) : null,
            finish: bars.length
              ? (bars
                  .map((b) => b.finish)
                  .sort()
                  .at(-1) ?? null)
              : null,
            today: p.today,
            bars,
          },
        };
      }),
  });

  return [wanted, put, text, tasks, plan];
}
