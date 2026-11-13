// ── [PCODE-263 | S15 | v0.1.0] T27.5 Plan files: MS Project XML and CSV export and import, iCal of the plan ──
//    Why:  the Canvas plan leaves for MS Project, Excel and calendars, and comes back in from MS Project and
//          Excel. Export reads the schedule as the Gantt shows it; import first shows what it would make
//          (and what it skips), then makes the tasks under their parents by outline level with their dates,
//          durations, constraints and people, and links them; a link that would close a loop is left out.
import {
  parseMsProjectXml,
  parsePlanCsv,
  planIcs,
  toMsProjectXml,
  toPlanCsv,
  wouldCycle,
  type ExportTask,
  type ImportPlan,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access } from './access.js';
import { createTask } from './newitem.js';
import { computePlan } from './plan.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

/** The project's schedule in the shape the files take. */
async function exportRows(
  c: PoolClient,
  a: Access,
  projectId: string,
): Promise<{
  plan: Awaited<ReturnType<typeof computePlan>>;
  tasks: ExportTask[];
}> {
  const plan = await computePlan(c, a, projectId);
  const row = new Map(plan.rows.map((r) => [r.id, r]));
  const names = new Map(
    (
      await c.query<{ id: string; name: string }>(
        'SELECT id, name FROM users WHERE id = ANY($1::uuid[])',
        [[...new Set(plan.rows.map((r) => r.assignee_id).filter((x): x is string => !!x))]],
      )
    ).rows.map((u) => [u.id, u.name]),
  );
  const tasks = plan.sched.tasks.flatMap((st) => {
    const r = row.get(st.id);
    if (!r) return [];
    return [
      {
        id: st.id,
        ref: r.ref,
        title: r.title,
        wbs: st.wbs,
        level: st.level + 1,
        kind: r.kind,
        start: st.start,
        finish: st.finish,
        durationDays: st.durationDays,
        percentDone: st.percentDone,
        summary: st.summary,
        milestone: st.milestone,
        manual: r.schedule_mode === 'manual',
        constraintType: r.constraint_type,
        constraintDate: r.constraint_date,
        resource: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
      },
    ];
  });
  return { plan, tasks };
}

export function planFileRoutes(pool: Pool): Route[] {
  const exportPlan = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/plan/export',
    summary: 'The plan as MS Project XML, CSV or an iCal file',
    tags: ['plan'],
    params: projectParams,
    query: s.object({ format: s.enum(['msproject', 'csv', 'ics']) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const { plan, tasks } = await exportRows(c, a, project.id);
        const deps = plan.deps.map((d) => ({
          predecessorId: d.predecessor_id,
          successorId: d.successor_id,
          kind: d.kind,
          lagDays: d.lag_days,
        }));
        const base = project.key.toLowerCase() + '-plan';
        if (query.format === 'msproject')
          return {
            body: {},
            file: {
              data: Buffer.from(
                toMsProjectXml({ name: project.name, start: plan.sched.start, tasks, deps }),
                'utf8',
              ),
              contentType: 'application/xml; charset=utf-8',
              name: base + '.xml',
            },
          };
        if (query.format === 'csv')
          return {
            body: {},
            file: {
              // a byte order mark, so Excel reads the umlauts
              data: Buffer.from('﻿' + toPlanCsv(tasks, deps), 'utf8'),
              contentType: 'text/csv; charset=utf-8',
              name: base + '.csv',
            },
          };
        const stamp = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d+Z$/, 'Z');
        return {
          body: {},
          file: {
            data: Buffer.from(
              planIcs({
                name: project.name,
                stamp,
                tasks: tasks.filter((t) => !t.summary),
              }),
              'utf8',
            ),
            contentType: 'text/calendar; charset=utf-8',
            name: base + '.ics',
          },
        };
      }),
  });

  const importPlan = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/plan/import',
    summary:
      'Read an MS Project XML or CSV plan: a preview of what it would make, or (apply) the tasks and links made (member)',
    tags: ['plan'],
    params: projectParams,
    body: s.object({
      format: s.enum(['msproject', 'csv']),
      text: s.string({ min: 1, max: 900_000 }),
      apply: s.optional(s.boolean()),
    }),
    response: s.object({
      tasks: s.array(
        s.object({
          title: s.string(),
          level: s.number({ integer: true }),
          parent: s.nullable(s.string()),
          kind: s.string(),
          start: s.nullable(s.string()),
          durationDays: s.nullable(s.number()),
          resource: s.nullable(s.string()),
          person: s.nullable(s.string()),
          links: s.number({ integer: true }),
        }),
      ),
      problems: s.array(s.string()),
      created: s.number({ integer: true }),
      linked: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const read: ImportPlan =
          body.format === 'msproject' ? parseMsProjectXml(body.text) : parsePlanCsv(body.text);
        if (read.tasks.length > 2000)
          throw new HttpError(400, 'invalid_request', 'A plan file may hold at most 2000 tasks', [
            { path: 'body.text', message: 'has too many tasks' },
          ]);
        const problems = [...read.problems];
        // people by name, among the workspace's members
        const members = (
          await c.query<{ id: string; name: string }>(
            "SELECT u.id, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.role <> 'guest'",
          )
        ).rows;
        const person = (name: string | null): { id: string; name: string } | null => {
          if (!name) return null;
          const low = name.toLowerCase();
          return (
            members.find((m) => m.name.toLowerCase() === low) ??
            members.find((m) => m.name.toLowerCase().startsWith(low)) ??
            null
          );
        };
        // the parent of each task: the last task above it one level up
        const parentOf: (number | null)[] = [];
        const stack: { level: number; i: number }[] = [];
        read.tasks.forEach((t, i) => {
          while (stack.length && (stack[stack.length - 1]?.level ?? 0) >= t.level) stack.pop();
          parentOf.push(stack.length ? (stack[stack.length - 1]?.i ?? null) : null);
          stack.push({ level: t.level, i });
        });
        const hasKids = new Set(parentOf.filter((p): p is number => p !== null));
        const kindOf = (i: number): string => {
          const t = read.tasks[i];
          if (t?.milestone && !hasKids.has(i)) return 'milestone';
          if (hasKids.has(i)) return parentOf[i] === null ? 'epic' : 'story';
          return 'task';
        };
        for (const [i, t] of read.tasks.entries())
          if (t.resource && !person(t.resource))
            problems.push(
              (t.title || 'row ' + String(i + 1)) +
                ': nobody called ' +
                t.resource +
                ', left unassigned',
            );
        const preview = read.tasks.map((t, i) => ({
          title: t.title,
          level: t.level,
          parent: parentOf[i] !== null ? (read.tasks[parentOf[i] ?? 0]?.title ?? null) : null,
          kind: kindOf(i),
          start: t.start,
          durationDays: t.durationDays,
          resource: t.resource,
          person: person(t.resource)?.name ?? null,
          links: t.preds.length,
        }));
        if (!body.apply) return { body: { tasks: preview, problems, created: 0, linked: 0 } };

        // make the tasks in order, so every parent exists before its children
        const ids: string[] = [];
        const byKey = new Map<string, string>();
        for (const [i, t] of read.tasks.entries()) {
          const made = await createTask(c, a.workspaceId, actorOf(a), {
            projectId: project.id,
            title: t.title,
            kind: kindOf(i),
            assigneeId: person(t.resource)?.id ?? null,
            createdBy: a.user.id,
          });
          ids.push(made.id);
          byKey.set(t.key, made.id);
          const leaf = !hasKids.has(i);
          const dur = t.durationDays === null ? null : Math.max(0, Math.round(t.durationDays));
          await c.query(
            `UPDATE items SET parent_id = $2, start_date = $3, duration_days = $4, percent_done = $5,
                              schedule_mode = $6, constraint_type = $7, constraint_date = $8
              WHERE id = $1`,
            [
              made.id,
              parentOf[i] !== null ? (ids[parentOf[i] ?? 0] ?? null) : null,
              leaf ? t.start : null,
              leaf ? (kindOf(i) === 'milestone' ? 0 : dur === 0 ? 1 : dur) : null,
              leaf && t.percentDone !== null ? Math.round(t.percentDone) : null,
              leaf && t.manual && t.start ? 'manual' : 'auto',
              leaf ? (t.constraintType ?? 'asap') : 'asap',
              leaf && t.constraintType ? t.constraintDate : null,
            ],
          );
        }
        // then the links, between tasks (not summaries), without loops
        const made: { predecessorId: string; successorId: string }[] = [];
        let linked = 0;
        for (const [i, t] of read.tasks.entries()) {
          const succ = ids[i];
          if (!succ) continue;
          for (const p of t.preds) {
            const pred = byKey.get(p.key);
            const pi = pred ? ids.indexOf(pred) : -1;
            if (!pred || pred === succ) {
              problems.push(t.title + ': no task ' + p.key + ' to wait for');
              continue;
            }
            if (hasKids.has(pi) || hasKids.has(i)) {
              problems.push(t.title + ': a link to a summary task is left out');
              continue;
            }
            if (wouldCycle(made, pred, succ)) {
              problems.push(t.title + ': the link to ' + p.key + ' would close a loop, left out');
              continue;
            }
            const ins = await c.query(
              `INSERT INTO item_dependencies (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days)
               VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
              [
                a.workspaceId,
                project.id,
                pred,
                succ,
                p.kind,
                Math.max(-365, Math.min(365, p.lagDays)),
              ],
            );
            if (ins.rowCount) {
              made.push({ predecessorId: pred, successorId: succ });
              linked++;
            }
          }
        }
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: project.id, label: project.key },
            changes: {
              planImported: {
                from: null,
                to: String(ids.length) + ' tasks, ' + String(linked) + ' links from ' + body.format,
              },
            },
          },
          { projectId: project.id },
        );
        return { body: { tasks: preview, problems, created: ids.length, linked } };
      }),
  });

  return [exportPlan, importPlan];
}
