// ── [PCODE-336 | S15 | v0.1.0] T34.1a Portal home with health, milestone, release and budget; release deliverables and demos; client sign-off per release; files on acceptance results ──
// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
//    Why:  the portal's sections, read the way a client may see them. A client contact's own transaction
//          cannot see the team's tables (row-level security), so each section reads in system mode with an
//          explicit filter on that client's projects and returns only the fields meant for the client:
//          the roadmap and what moved against the baseline, acceptance rounds the team shared, the quotes
//          and designs that wait for a decision, release notes for clients, and shared documents. A team
//          member may open the same sections for a client ("view as client"), read only. The team decides
//          what is shared: a test run as an acceptance round, a page, a mockup for approval.
import { createHash } from 'node:crypto';
import { mayApproveChange, mayFileRequest } from '@orqiva/shared';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast, requireProject, type Access } from './access.js';
import { fileRequestFor } from './clientrequests.js';
import { computePlan } from './plan.js';
import { deliverablesOf, releaseSignOff, signOffOut } from './portalhome.js'; // [PCODE-336 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const DAY = 86_400_000;

export interface PortalCtx {
  access: Access;
  clientId: string;
  clientName: string;
  projects: { id: string; key: string; name: string }[];
  projectIds: string[];
  shares: Record<string, boolean>;
  roles: string[];
  /** a team member looking at the portal as the client sees it: reads only */
  asTeam: boolean;
}

/** The client a request speaks for: a contact's own, or the one a team member chose to view as. */
export async function portalScope<T>(
  pool: Pool,
  req: IncomingMessage,
  workspaceId: string,
  clientId: string | undefined,
  fn: (c: PoolClient, ctx: PortalCtx) => Promise<T>,
): Promise<T> {
  const found = await asMember(pool, req, workspaceId, 'guest', async (c, a) => {
    if (!a.clientId && !(atLeast(a.role, 'member') && clientId))
      throw new HttpError(403, 'forbidden', 'The portal is for client contacts');
    const id = a.clientId ?? clientId ?? '';
    const cl = (
      await c.query<{ name: string; shares: Record<string, boolean> }>(
        'SELECT name, shares FROM clients WHERE id = $1 AND archived_at IS NULL',
        [id],
      )
    ).rows[0];
    if (!cl) throw new HttpError(404, 'not_found', 'Client not found');
    const projects = (
      await c.query<{ id: string; key: string; name: string }>(
        'SELECT id, key, name FROM projects WHERE client_id = $1 AND archived_at IS NULL ORDER BY key',
        [id],
      )
    ).rows;
    const roles = a.clientId
      ? (
          await c.query<{ portal_role: string }>(
            'SELECT portal_role FROM client_contacts WHERE client_id = $1 AND user_id = $2',
            [id, a.user.id],
          )
        ).rows.map((r) => r.portal_role)
      : [];
    return {
      access: a,
      clientId: id,
      clientName: cl.name,
      projects,
      projectIds: projects.map((p) => p.id),
      shares: cl.shares,
      roles,
      asTeam: !a.clientId,
    };
  });
  return inSystem(pool, (c) => fn(c, found));
}

const shared = (ctx: PortalCtx, key: string): boolean => ctx.shares[key] !== false;

function needShare(ctx: PortalCtx, key: string, what: string): void {
  if (!shared(ctx, key))
    throw new HttpError(403, 'forbidden', what + ' is not shared with ' + ctx.clientName);
}

// [PCODE-199 | S15 | v0.1.0] the handover decision checks contacts the same way
export function contactWho(ctx: PortalCtx, may: (roles: string[]) => boolean, what: string): void {
  if (ctx.asTeam) throw new HttpError(403, 'forbidden', 'Viewing as the client is read only');
  if (!may(ctx.roles)) throw new HttpError(403, 'forbidden', what);
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const dateText = (d: Date | null): string | null =>
  d ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : null;

/** Where an epic or milestone stands for the client. */
export function roadmapStatus(
  group: string,
  start: string | null,
  today: string,
): 'done' | 'now' | 'next' | 'later' {
  if (group === 'completed') return 'done';
  if (group === 'started') return 'now';
  if (!start) return 'later';
  const days = (Date.parse(start) - Date.parse(today)) / DAY;
  return days <= 14 ? 'next' : 'later';
}

export function portalRoutes(pool: Pool): Route[] {
  const q = s.object({ clientId: s.optional(uuid) });
  const wsOnly = s.object({ workspaceId: uuid });

  const overview = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal',
    summary: 'The portal’s frame: the client, what it shares, the contact’s roles, what waits',
    tags: ['portal'],
    params: wsOnly,
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const waiting = (
          await c.query<{ quotes: string; designs: string; rounds: string }>(
            `SELECT
               (SELECT count(*) FROM client_requests WHERE client_id = $1 AND state = 'quoted') AS quotes,
               (SELECT count(*) FROM mockups WHERE project_id = ANY($2::uuid[]) AND client_visible AND status = 'in_review') AS designs,
               (SELECT count(*) FROM test_runs WHERE project_id = ANY($2::uuid[]) AND client_round AND status = 'running') AS rounds`,
            [ctx.clientId, ctx.projectIds],
          )
        ).rows[0];
        return {
          body: {
            client: { id: ctx.clientId, name: ctx.clientName },
            projects: ctx.projects,
            shares: ctx.shares,
            roles: ctx.roles,
            asTeam: ctx.asTeam,
            waiting: {
              approvals: Number(waiting?.quotes ?? 0) + Number(waiting?.designs ?? 0),
              acceptance: Number(waiting?.rounds ?? 0),
            },
          },
        };
      }),
  });

  // ── roadmap ──
  const roadmap = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/roadmap',
    summary: 'Epics and milestones of the client’s projects, and what moved against the baseline',
    tags: ['portal'],
    params: wsOnly,
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        needShare(ctx, 'roadmap', 'The roadmap');
        const today = new Date().toISOString().slice(0, 10);
        const rows = (
          await c.query<{
            id: string;
            project_id: string;
            title: string;
            kind: string;
            start_date: Date | null;
            due_date: Date | null;
            grp: string;
            percent_done: number | null;
            base_due: Date | null;
            base_name: string | null;
            base_at: Date | null;
          }>(
            `SELECT i.id, i.project_id, i.title, i.kind, i.start_date, i.due_date, s.grp, i.percent_done,
                bi.finish_date AS base_due, b.name AS base_name, b.created_at AS base_at
               FROM items i JOIN project_states s ON s.id = i.state_id
               LEFT JOIN LATERAL (
                 SELECT id, name, created_at FROM baselines WHERE project_id = i.project_id ORDER BY created_at DESC LIMIT 1
               ) b ON true
               LEFT JOIN baseline_items bi ON bi.baseline_id = b.id AND bi.item_id = i.id
              WHERE i.project_id = ANY($1::uuid[]) AND i.kind IN ('epic', 'milestone')
                AND (i.start_date IS NOT NULL OR i.due_date IS NOT NULL) AND s.grp <> 'cancelled'
              ORDER BY coalesce(i.start_date, i.due_date), i.title
              LIMIT 200`,
            [ctx.projectIds],
          )
        ).rows;
        const approved = (
          await c.query<{ number: number; title: string; at: Date }>(
            `SELECT r.number, r.title, x.created_at AS at FROM client_requests r
               JOIN approvals x ON x.object_type = 'change_request' AND x.object_id = r.id::text AND x.decision = 'approved'
              WHERE r.client_id = $1 ORDER BY x.created_at`,
            [ctx.clientId],
          )
        ).rows;
        // the dates the plan computes (working days, roll-ups), as the baseline kept them
        const planned = new Map<string, { start: string; finish: string }>();
        for (const pid of new Set(rows.map((r) => r.project_id))) {
          const plan = await computePlan(c, ctx.access, pid);
          for (const t of plan.sched.tasks) planned.set(t.id, { start: t.start, finish: t.finish });
        }
        const startOf = (r: (typeof rows)[number]): string | null =>
          planned.get(r.id)?.start ?? dateText(r.start_date);
        const finishOf = (r: (typeof rows)[number]): string | null =>
          planned.get(r.id)?.finish ?? dateText(r.due_date);
        const items = rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          title: r.title,
          kind: r.kind,
          start: startOf(r),
          due: finishOf(r),
          status: roadmapStatus(r.grp, startOf(r), today),
          percent: r.grp === 'completed' ? 100 : r.percent_done,
        }));
        const moved = rows
          .filter((r) => r.base_due && finishOf(r) && dateText(r.base_due) !== finishOf(r))
          .map((r) => {
            const to = finishOf(r) ?? '';
            const from = dateText(r.base_due) ?? '';
            const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY);
            const since = r.base_at ?? new Date(0);
            return {
              id: r.id,
              title: r.title,
              from,
              to,
              days,
              baseline: r.base_name,
              baselineAt: iso(r.base_at),
              // the change requests approved since the plan was fixed: the likely reason
              changes: approved
                .filter((x) => x.at > since)
                .map((x) => ({ ref: 'CR-' + String(x.number), title: x.title })),
            };
          });
        return { body: { today, projects: ctx.projects, items, moved } };
      }),
  });

  // ── acceptance tests ──
  interface CaseRow {
    id: string;
    title: string;
    steps: string;
    expected: string;
    step_list: { action: string; expected: string }[];
    status: string | null;
    message: string | null;
    at: Date | null;
    tester: string | null;
  }

  async function roundOf(c: PoolClient, ctx: PortalCtx, runId: string) {
    const run = (
      await c.query<{
        id: string;
        project_id: string;
        name: string;
        status: string;
        due_on: Date | null;
        planned_case_ids: string[];
        started_at: Date;
      }>(
        `SELECT id, project_id, name, status, due_on, planned_case_ids, started_at FROM test_runs
          WHERE id = $1 AND client_round AND project_id = ANY($2::uuid[])`,
        [runId, ctx.projectIds],
      )
    ).rows[0];
    if (!run) throw new HttpError(404, 'not_found', 'Acceptance round not found');
    const cases = (
      await c.query<CaseRow>(
        `SELECT tc.id, tc.title, tc.steps, tc.expected, tc.step_list, r.status, r.message, r.at, u.name AS tester
           FROM test_cases tc
           LEFT JOIN test_results r ON r.run_id = $1 AND r.case_id = tc.id
           LEFT JOIN users u ON u.id = r.assignee_id
          WHERE tc.id = ANY($2::uuid[]) OR tc.id IN (SELECT case_id FROM test_results WHERE run_id = $1)
          ORDER BY array_position($2::uuid[], tc.id), tc.title`,
        [run.id, run.planned_case_ids],
      )
    ).rows;
    const acceptance = (
      await c.query<{ decision: string; signed_name: string; created_at: Date; note: string }>(
        `SELECT decision, signed_name, created_at, note FROM approvals
          WHERE object_type = 'acceptance' AND object_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [run.id],
      )
    ).rows[0];
    const tested = cases.filter((x) => x.status === 'passed' || x.status === 'failed');
    // [PCODE-336 | S15 | v0.1.0] the files the client added to a case
    const files = (
      await c.query<{ case_id: string; file_id: string; name: string; mime: string; kind: string }>(
        `SELECT e.case_id, e.file_id, f.name, f.mime, e.kind FROM test_evidence e JOIN files f ON f.id = e.file_id
          WHERE e.run_id = $1 AND f.deleted_at IS NULL ORDER BY e.created_at`,
        [run.id],
      )
    ).rows;
    return {
      run,
      json: {
        id: run.id,
        projectId: run.project_id,
        name: run.name,
        open: run.status === 'running' && !acceptance,
        dueOn: dateText(run.due_on),
        startedAt: run.started_at.toISOString(),
        tested: tested.length,
        problems: tested.filter((x) => x.status === 'failed').length,
        accepted: acceptance
          ? {
              by: acceptance.signed_name,
              at: acceptance.created_at.toISOString(),
              note: acceptance.note,
            }
          : null,
        cases: cases.map((x) => ({
          id: x.id,
          title: x.title,
          steps: x.step_list.length
            ? x.step_list
            : x.steps
              ? [{ action: x.steps, expected: x.expected }]
              : [],
          expected: x.expected,
          result: x.status === 'passed' ? 'works' : x.status === 'failed' ? 'problem' : null,
          note: x.message ?? '',
          tester: x.tester,
          at: iso(x.at),
          files: files
            .filter((f) => f.case_id === x.id)
            .map((f) => ({ id: f.file_id, name: f.name, mime: f.mime, kind: f.kind })),
        })),
      },
    };
  }

  const acceptance = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/acceptance',
    summary: 'The acceptance rounds the team shared with the client, newest first',
    tags: ['portal'],
    params: wsOnly,
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        needShare(ctx, 'acceptance_tests', 'Acceptance testing');
        const ids = (
          await c.query<{ id: string }>(
            `SELECT id FROM test_runs WHERE client_round AND project_id = ANY($1::uuid[]) AND status <> 'cancelled'
              ORDER BY started_at DESC LIMIT 10`,
            [ctx.projectIds],
          )
        ).rows;
        const rounds = [];
        for (const r of ids) rounds.push((await roundOf(c, ctx, r.id)).json);
        return {
          body: {
            rounds,
            mayTest: !ctx.asTeam && mayFileRequest(ctx.roles),
            mayAccept: !ctx.asTeam && mayApproveChange(ctx.roles),
          },
        };
      }),
  });

  const result = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/acceptance/:runId/results',
    summary:
      'Mark one case of an acceptance round: works, or a problem (which files a bug request)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    body: s.object({
      caseId: uuid,
      result: s.enum(['works', 'problem']),
      note: s.optional(s.string({ max: 4000 })),
      // [PCODE-336 | S15 | v0.1.0] screenshots and recordings of what the contact saw
      fileIds: s.optional(s.array(uuid, { max: 10 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        needShare(ctx, 'acceptance_tests', 'Acceptance testing');
        contactWho(ctx, mayFileRequest, 'Viewers read the results only');
        const round = await roundOf(c, ctx, params.runId);
        if (!round.json.open) throw new HttpError(409, 'conflict', 'This round is closed');
        const tc = round.json.cases.find((x) => x.id === body.caseId);
        if (!tc) throw new HttpError(404, 'not_found', 'The case is not part of this round');
        const note = body.note?.trim() ?? '';
        if (body.result === 'problem' && !note)
          throw new HttpError(400, 'invalid_request', 'Say what went wrong', [
            { path: 'body.note', message: 'is required for a problem' },
          ]);
        let message = note;
        // a problem becomes a bug request the team answers, with the case for context
        if (body.result === 'problem' && tc.result !== 'problem') {
          const filed = await fileRequestFor(c, ctx.access, {
            clientId: ctx.clientId,
            projectId: round.run.project_id,
            kind: 'bug',
            title: 'Acceptance: ' + tc.title,
            body: note + '\n\nFound in ' + round.run.name + ', case “' + tc.title + '”.',
          });
          message = note + ' (' + filed.ref + ')';
        } else if (body.result === 'problem') message = note || tc.note;
        await c.query(
          `INSERT INTO test_results (workspace_id, run_id, case_id, status, message, assignee_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id, case_id) DO UPDATE SET status = EXCLUDED.status, message = EXCLUDED.message,
             assignee_id = EXCLUDED.assignee_id, at = now()`,
          [
            ctx.access.workspaceId,
            round.run.id,
            tc.id,
            body.result === 'works' ? 'passed' : 'failed',
            message.slice(0, 20000),
            ctx.access.user.id,
          ],
        );
        // [PCODE-336 | S15 | v0.1.0] each file the contact uploaded becomes evidence of the case
        if (body.fileIds?.length) {
          const mine = (
            await c.query<{ id: string; mime: string }>(
              `SELECT id, mime FROM files WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
                 AND (uploaded_by = $2 OR $3::boolean)`,
              [[...new Set(body.fileIds)], ctx.access.user.id, ctx.asTeam],
            )
          ).rows;
          if (mine.length !== new Set(body.fileIds).size)
            throw new HttpError(400, 'invalid_request', 'A file is missing', [
              { path: 'body.fileIds', message: 'must be files you uploaded' },
            ]);
          for (const f of mine)
            await c.query(
              `INSERT INTO test_evidence (workspace_id, run_id, case_id, file_id, kind, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                ctx.access.workspaceId,
                round.run.id,
                tc.id,
                f.id,
                f.mime.startsWith('image/')
                  ? 'screenshot'
                  : f.mime.startsWith('video/')
                    ? 'recording'
                    : 'document',
                ctx.access.user.id,
              ],
            );
        }
        await recordEvent(
          c,
          ctx.access.workspaceId,
          {
            actor: actorOf(ctx.access),
            verb: 'progressed',
            object: { type: 'test_run', id: round.run.id, label: round.run.name },
            changes: { [tc.title]: { from: tc.result, to: body.result } },
          },
          { projectId: round.run.project_id },
        );
        return { body: (await roundOf(c, ctx, params.runId)).json };
      }),
  });

  const accept = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/acceptance/:runId/accept',
    summary: 'Accept an acceptance round with a typed signature (sponsor, approver, product owner)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    body: s.object({
      signedName: s.string({ min: 3, max: 200 }),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        needShare(ctx, 'acceptance_tests', 'Acceptance testing');
        contactWho(ctx, mayApproveChange, 'A sponsor, approver or product owner accepts a round');
        const round = await roundOf(c, ctx, params.runId);
        if (!round.json.open) throw new HttpError(409, 'conflict', 'This round is closed');
        const untested = round.json.cases.filter((x) => !x.result).length;
        if (untested)
          throw new HttpError(
            409,
            'conflict',
            String(untested) + (untested === 1 ? ' case is' : ' cases are') + ' not tested yet',
          );
        const summary = round.json.cases.map((x) => x.id + ':' + String(x.result)).join('\n');
        const problems = round.json.problems;
        await c.query(
          `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, signed_name, note)
           VALUES ($1, $2, 'acceptance', $3, $4, $5, 'approved', $6, $7)`,
          [
            ctx.access.workspaceId,
            round.run.project_id,
            round.run.id,
            sha256(round.run.id + '\n' + summary),
            ctx.access.user.id,
            body.signedName.trim(),
            body.note?.trim() ||
              (problems
                ? 'Accepted with ' +
                  String(problems) +
                  (problems === 1 ? ' known issue' : ' known issues')
                : 'Accepted'),
          ],
        );
        await recordEvent(
          c,
          ctx.access.workspaceId,
          {
            actor: actorOf(ctx.access),
            verb: 'completed',
            object: { type: 'test_run', id: round.run.id, label: round.run.name },
            changes: { accepted: { from: null, to: body.signedName.trim() } },
          },
          { projectId: round.run.project_id },
        );
        return { body: (await roundOf(c, ctx, params.runId)).json };
      }),
  });

  // ── approvals ──
  const approvals = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/approvals',
    summary: 'Quotes and designs that wait for the client’s decision, and the recent decisions',
    tags: ['portal'],
    params: wsOnly,
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const quotes = (
          await c.query<{
            id: string;
            number: number;
            title: string;
            state: string;
            impact: { points: number; priceCents: number; days: number } | null;
            quoted_at: Date | null;
            decision: string | null;
            signed_name: string | null;
            decided_at: Date | null;
          }>(
            `SELECT r.id, r.number, r.title, r.state, r.impact, r.quoted_at, x.decision, x.signed_name, x.created_at AS decided_at
               FROM client_requests r
               LEFT JOIN LATERAL (SELECT decision, signed_name, created_at FROM approvals
                  WHERE object_type = 'change_request' AND object_id = r.id::text ORDER BY created_at DESC LIMIT 1) x ON true
              WHERE r.client_id = $1 AND r.impact IS NOT NULL AND (r.state = 'quoted' OR x.decision IS NOT NULL)
              ORDER BY (r.state = 'quoted') DESC, coalesce(x.created_at, r.quoted_at) DESC LIMIT 30`,
            [ctx.clientId],
          )
        ).rows;
        const designs = (
          await c.query<{
            id: string;
            project_id: string;
            title: string;
            status: string;
            version: number;
            file_id: string | null;
            note: string | null;
            decision: string | null;
            signed_name: string | null;
            decided_at: Date | null;
            decision_note: string | null;
          }>(
            `SELECT m.id, m.project_id, m.title, m.status, m.version, v.file_id, v.note,
                x.decision, x.signed_name, x.created_at AS decided_at, x.note AS decision_note
               FROM mockups m
               LEFT JOIN mockup_versions v ON v.mockup_id = m.id AND v.version = m.version
               LEFT JOIN LATERAL (SELECT decision, signed_name, created_at, note FROM approvals
                  WHERE object_type = 'design' AND object_id = m.id::text ORDER BY created_at DESC LIMIT 1) x ON true
              WHERE m.project_id = ANY($1::uuid[]) AND m.client_visible AND m.version > 0
              ORDER BY (m.status = 'in_review') DESC, m.updated_at DESC LIMIT 30`,
            [ctx.projectIds],
          )
        ).rows;
        // the image the client decides on must be theirs to open
        const files = designs.map((d) => d.file_id).filter((x): x is string => Boolean(x));
        if (files.length)
          await c.query(
            'UPDATE files SET client_visible = true WHERE id = ANY($1::uuid[]) AND NOT client_visible',
            [files],
          );
        return {
          body: {
            mayDecide: !ctx.asTeam && mayApproveChange(ctx.roles),
            items: [
              ...quotes.map((r) => ({
                kind: 'change',
                id: r.id,
                ref: 'CR-' + String(r.number),
                title: r.title,
                waiting: r.state === 'quoted',
                impact: r.impact,
                fileId: null,
                version: null,
                note: null,
                decision: r.decision
                  ? { decision: r.decision, by: r.signed_name, at: iso(r.decided_at), note: null }
                  : null,
              })),
              ...designs.map((d) => ({
                kind: 'design',
                id: d.id,
                ref: 'D-' + d.id.slice(0, 4),
                title: d.title,
                waiting: d.status === 'in_review',
                impact: null,
                fileId: d.file_id,
                version: d.version,
                note: d.note,
                decision: d.decision
                  ? {
                      decision: d.decision,
                      by: d.signed_name,
                      at: iso(d.decided_at),
                      note: d.decision_note,
                    }
                  : null,
              })),
            ],
          },
        };
      }),
  });

  const designDecision = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/designs/:mockupId/decision',
    summary: 'Approve a shared design with a typed signature, or ask for changes',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, mockupId: uuid }),
    body: s.object({
      decision: s.enum(['approved', 'declined']),
      signedName: s.optional(s.string({ max: 200 })),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        contactWho(
          ctx,
          mayApproveChange,
          'A sponsor, approver or product owner decides on designs',
        );
        const m = (
          await c.query<{
            id: string;
            project_id: string;
            title: string;
            status: string;
            sha: string | null;
          }>(
            `SELECT m.id, m.project_id, m.title, m.status, f.sha256 AS sha FROM mockups m
               LEFT JOIN mockup_versions v ON v.mockup_id = m.id AND v.version = m.version
               LEFT JOIN files f ON f.id = v.file_id
              WHERE m.id = $1 AND m.client_visible AND m.project_id = ANY($2::uuid[])`,
            [params.mockupId, ctx.projectIds],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Design not found');
        if (m.status !== 'in_review' || !m.sha)
          throw new HttpError(409, 'conflict', 'This design does not wait for a decision');
        const signed = body.signedName?.trim() ?? '';
        const note = body.note?.trim() ?? '';
        if (body.decision === 'approved' && signed.length < 3)
          throw new HttpError(400, 'invalid_request', 'Type your full name to sign', [
            { path: 'body.signedName', message: 'is required to approve' },
          ]);
        if (body.decision === 'declined' && !note)
          throw new HttpError(400, 'invalid_request', 'Say what should change', [
            { path: 'body.note', message: 'is required when asking for changes' },
          ]);
        await c.query(
          `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, signed_name, note)
           VALUES ($1, $2, 'design', $3, $4, $5, $6, $7, $8)`,
          [
            ctx.access.workspaceId,
            m.project_id,
            m.id,
            m.sha,
            ctx.access.user.id,
            body.decision,
            signed,
            note,
          ],
        );
        await c.query('UPDATE mockups SET status = $2, updated_at = now() WHERE id = $1', [
          m.id,
          body.decision === 'approved' ? 'approved' : 'changes_requested',
        ]);
        return {
          body: {
            id: m.id,
            status: body.decision === 'approved' ? 'approved' : 'changes_requested',
          },
        };
      }),
  });

  // [PCODE-294 | S15 | v0.1.0] a shared design to look at closely, and the pins of the client's side on it
  interface ClientPin {
    id: string;
    x: number;
    y: number;
    body: string;
    author: string | null;
    resolved: boolean;
    created_at: Date;
  }
  const sharedDesign = async (c: PoolClient, ctx: PortalCtx, id: string) => {
    const m = (
      await c.query<{
        id: string;
        project_id: string;
        item_id: string | null;
        title: string;
        status: string;
        version: number;
        file_id: string | null;
      }>(
        `SELECT m.id, m.project_id, m.item_id, m.title, m.status, m.version, v.file_id FROM mockups m
           LEFT JOIN mockup_versions v ON v.mockup_id = m.id AND v.version = m.version
          WHERE m.id = $1 AND m.client_visible AND m.version > 0 AND m.project_id = ANY($2::uuid[])`,
        [id, ctx.projectIds],
      )
    ).rows[0];
    if (!m?.file_id) throw new HttpError(404, 'not_found', 'Design not found');
    return { ...m, file_id: m.file_id };
  };
  const clientPins = async (c: PoolClient, mockupId: string, version: number) =>
    (
      await c.query<ClientPin>(
        `SELECT x.id, x.x, x.y, x.body, u.name AS author, x.resolved, x.created_at FROM mockup_pins x
           LEFT JOIN users u ON u.id = x.author_id
          WHERE x.mockup_id = $1 AND x.version = $2 AND x.from_client ORDER BY x.created_at`,
        [mockupId, version],
      )
    ).rows.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      body: p.body,
      author: p.author,
      resolved: p.resolved,
      createdAt: p.created_at.toISOString(),
    }));

  const design = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/designs/:mockupId',
    summary: 'A design shared with the client: its current image and the pins of the client’s side',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, mockupId: uuid }),
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const m = await sharedDesign(c, ctx, params.mockupId);
        // the image the client looks at must be theirs to open
        await c.query(
          'UPDATE files SET client_visible = true WHERE id = $1 AND NOT client_visible',
          [m.file_id],
        );
        return {
          body: {
            id: m.id,
            title: m.title,
            status: m.status,
            version: m.version,
            imageUrl: '/api/workspaces/' + params.workspaceId + '/files/' + m.file_id + '/content',
            pins: await clientPins(c, m.id, m.version),
            mayPin: !ctx.asTeam,
          },
        };
      }),
  });

  const designPin = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/designs/:mockupId/pins',
    summary: 'Pin a comment to a spot of a shared design (a client contact)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, mockupId: uuid }),
    body: s.object({
      x: s.number({ min: 0, max: 1 }),
      y: s.number({ min: 0, max: 1 }),
      body: s.string({ min: 1, max: 4000 }),
    }),
    response: s.anyObject(),
    status: 201,
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        if (ctx.asTeam) throw new HttpError(403, 'forbidden', 'Viewing as the client is read only');
        const m = await sharedDesign(c, ctx, params.mockupId);
        const text = body.body.trim();
        if (!text)
          throw new HttpError(400, 'invalid_request', 'Say what this spot is about', [
            { path: 'body.body', message: 'is empty' },
          ]);
        await c.query(
          'INSERT INTO mockup_pins (workspace_id, mockup_id, version, x, y, body, author_id, from_client) VALUES ($1, $2, $3, $4, $5, $6, $7, true)',
          [ctx.access.workspaceId, m.id, m.version, body.x, body.y, text, ctx.access.user.id],
        );
        await c.query('UPDATE mockups SET updated_at = now() WHERE id = $1', [m.id]);
        // the team on the design's task learns there is a word from the client
        if (m.item_id)
          await recordEvent(
            c,
            ctx.access.workspaceId,
            {
              actor: actorOf(ctx.access),
              verb: 'updated',
              object: { type: 'item', id: m.item_id, label: m.title },
              changes: {
                design: { from: null, to: ctx.clientName + ' pinned: ' + text.slice(0, 120) },
              },
            },
            { projectId: m.project_id },
          );
        return { status: 201, body: { pins: await clientPins(c, m.id, m.version) } };
      }),
  });

  // ── releases ──
  const releases = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/releases',
    summary:
      'Release notes for the client: candidates on their test environment and shipped releases',
    tags: ['portal'],
    params: wsOnly,
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        needShare(ctx, 'release_notes', 'Release notes');
        const rows = (
          await c.query<{
            id: string;
            project_id: string;
            version: string;
            name: string;
            state: string;
            target_date: Date | null;
            released_at: Date | null;
            notes_client: string;
            mine: number | null;
            avg: string | null;
            n: string;
          }>(
            `SELECT r.id, r.project_id, r.version, r.name, r.state, r.target_date, r.released_at, r.notes_client,
                (SELECT rating FROM csat_ratings WHERE object_type = 'release' AND object_id = r.id AND user_id = $2) AS mine,
                (SELECT round(avg(rating), 1) FROM csat_ratings WHERE object_type = 'release' AND object_id = r.id) AS avg,
                (SELECT count(*) FROM csat_ratings WHERE object_type = 'release' AND object_id = r.id) AS n
               FROM releases r
              WHERE r.project_id = ANY($1::uuid[]) AND r.notes_client <> '' AND r.state IN ('frozen', 'released')
              ORDER BY coalesce(r.released_at, r.freeze_at, r.created_at) DESC LIMIT 20`,
            [ctx.projectIds, ctx.access.user.id],
          )
        ).rows;
        const deliverables = new Map<string, Awaited<ReturnType<typeof deliverablesOf>>>();
        const signOffs = new Map<string, Awaited<ReturnType<typeof releaseSignOff>>>();
        for (const r of rows) {
          deliverables.set(r.id, await deliverablesOf(c, r.id));
          signOffs.set(r.id, await releaseSignOff(c, r.id));
        }
        return {
          body: {
            releases: rows.map((r) => ({
              id: r.id,
              projectId: r.project_id,
              projectKey: ctx.projects.find((p) => p.id === r.project_id)?.key ?? '',
              version: r.version,
              name: r.name,
              state: r.state === 'released' ? 'released' : 'candidate',
              targetDate: dateText(r.target_date),
              releasedAt: iso(r.released_at),
              notes: r.notes_client,
              myRating: r.mine,
              rating: r.avg === null ? null : Number(r.avg),
              ratings: Number(r.n),
              // [PCODE-336 | S15 | v0.1.0] what it delivers, and the client's sign-off
              deliverables: deliverables.get(r.id) ?? [],
              signOff: signOffs.get(r.id) ?? null,
            })),
            mayRate: !ctx.asTeam,
            maySignOff: !ctx.asTeam && mayApproveChange(ctx.roles),
          },
        };
      }),
  });

  // [PCODE-336 | S15 | v0.1.0] the client signs off a release, or declines it with a reason
  const signOffRelease = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/releases/:releaseId/sign-off',
    summary:
      'Sign off a release, or decline it, with a typed signature (sponsor, approver, product owner)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, releaseId: uuid }),
    body: s.object({
      decision: s.enum(['approved', 'declined']),
      signedName: s.string({ min: 3, max: 200 }),
      note: s.optional(s.string({ max: 4000 })),
    }),
    response: s.object({ signOff: signOffOut }),
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        needShare(ctx, 'release_notes', 'Release notes');
        contactWho(
          ctx,
          mayApproveChange,
          'A sponsor, approver or product owner signs off a release',
        );
        const r = (
          await c.query<{ id: string; project_id: string; version: string; notes_client: string }>(
            `SELECT id, project_id, version, notes_client FROM releases
              WHERE id = $1 AND project_id = ANY($2::uuid[]) AND notes_client <> '' AND state IN ('frozen', 'released')`,
            [params.releaseId, ctx.projectIds],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Release not found');
        const note = body.note?.trim() ?? '';
        if (body.decision === 'declined' && !note)
          throw new HttpError(400, 'invalid_request', 'Say why the release is declined', [
            { path: 'body.note', message: 'is required when declining' },
          ]);
        await c.query(
          `INSERT INTO approvals (workspace_id, project_id, object_type, object_id, version_hash, approver_id, decision, signed_name, note)
           VALUES ($1, $2, 'release', $3, $4, $5, $6, $7, $8)`,
          [
            ctx.access.workspaceId,
            r.project_id,
            r.id,
            sha256(r.id + '\n' + r.version + '\n' + r.notes_client),
            ctx.access.user.id,
            body.decision,
            body.signedName.trim(),
            note,
          ],
        );
        await recordEvent(
          c,
          ctx.access.workspaceId,
          {
            actor: actorOf(ctx.access),
            verb: body.decision === 'approved' ? 'completed' : 'updated',
            object: { type: 'release', id: r.id, label: r.version },
            changes: {
              clientSignOff: { from: null, to: body.decision + ' by ' + body.signedName.trim() },
            },
          },
          { projectId: r.project_id },
        );
        return { body: { signOff: await releaseSignOff(c, r.id) } };
      }),
  });

  const rateRelease = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/releases/:releaseId/rating',
    summary: 'Rate a release, 1 to 5 (client contact)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, releaseId: uuid }),
    body: s.object({
      rating: s.number({ integer: true, min: 1, max: 5 }),
      comment: s.optional(s.string({ max: 2000 })),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        needShare(ctx, 'release_notes', 'Release notes');
        contactWho(ctx, () => true, '');
        const r = (
          await c.query<{ id: string; project_id: string; version: string }>(
            `SELECT id, project_id, version FROM releases
              WHERE id = $1 AND project_id = ANY($2::uuid[]) AND notes_client <> '' AND state IN ('frozen', 'released')`,
            [params.releaseId, ctx.projectIds],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Release not found');
        await c.query(
          `INSERT INTO csat_ratings (workspace_id, client_id, user_id, object_type, object_id, rating, comment)
           VALUES ($1, $2, $3, 'release', $4, $5, $6)
           ON CONFLICT (object_type, object_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()`,
          [
            ctx.access.workspaceId,
            ctx.clientId,
            ctx.access.user.id,
            r.id,
            body.rating,
            body.comment ?? '',
          ],
        );
        await recordEvent(
          c,
          ctx.access.workspaceId,
          {
            actor: actorOf(ctx.access),
            verb: 'updated',
            object: { type: 'release', id: r.id, label: r.version },
            changes: { rating: { from: null, to: body.rating } },
          },
          { projectId: r.project_id },
        );
        return { body: { id: r.id, myRating: body.rating } };
      }),
  });

  // ── documents ──
  const documents = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/documents',
    summary: 'Pages and files the team shared with the client; new or read for this contact',
    tags: ['portal'],
    params: wsOnly,
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const pages = (
          await c.query<{
            id: string;
            project_id: string;
            title: string;
            template: string;
            version: number;
            updated_at: Date;
            read_version: number | null;
          }>(
            `SELECT p.id, p.project_id, p.title, p.template, p.version, p.updated_at, r.version AS read_version
               FROM doc_pages p
               LEFT JOIN portal_reads r ON r.user_id = $2 AND r.object_type = 'doc' AND r.object_id = p.id
              WHERE p.project_id = ANY($1::uuid[]) AND p.client_visible AND p.status = 'published'
                AND p.kind = 'page' AND p.deleted_at IS NULL
              ORDER BY p.updated_at DESC LIMIT 200`,
            [ctx.projectIds, ctx.access.user.id],
          )
        ).rows;
        // files shared on their own: not request attachments or design images
        const files = (
          await c.query<{
            id: string;
            project_id: string;
            name: string;
            mime: string;
            size_bytes: string;
            created_at: Date;
            read: boolean;
          }>(
            `SELECT f.id, f.project_id, f.name, f.mime, f.size_bytes, f.created_at,
                EXISTS (SELECT 1 FROM portal_reads r WHERE r.user_id = $2 AND r.object_type = 'file' AND r.object_id = f.id) AS read
               FROM files f
              WHERE f.project_id = ANY($1::uuid[]) AND f.client_visible AND f.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM mockup_versions v WHERE v.file_id = f.id)
                AND NOT EXISTS (SELECT 1 FROM client_request_messages m WHERE f.id = ANY(m.file_ids))
              ORDER BY f.created_at DESC LIMIT 200`,
            [ctx.projectIds, ctx.access.user.id],
          )
        ).rows;
        return {
          body: {
            documents: [
              ...pages.map((p) => ({
                kind: 'page',
                id: p.id,
                projectId: p.project_id,
                title: p.title,
                type: p.template || 'Page',
                updatedAt: p.updated_at.toISOString(),
                isNew: ctx.asTeam ? false : p.read_version === null || p.read_version < p.version,
                mime: null,
                size: null,
              })),
              ...files.map((f) => ({
                kind: 'file',
                id: f.id,
                projectId: f.project_id,
                title: f.name,
                type: 'File',
                updatedAt: f.created_at.toISOString(),
                isNew: ctx.asTeam ? false : !f.read,
                mime: f.mime,
                size: Number(f.size_bytes),
              })),
            ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
          },
        };
      }),
  });

  const document = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/documents/:pageId',
    summary: 'A shared page, as published; reading it marks it read for this contact',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, pageId: uuid }),
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        const p = (
          await c.query<{
            id: string;
            title: string;
            body: string;
            version: number;
            updated_at: Date;
          }>(
            `SELECT id, title, body, version, updated_at FROM doc_pages
              WHERE id = $1 AND project_id = ANY($2::uuid[]) AND client_visible AND status = 'published' AND deleted_at IS NULL`,
            [params.pageId, ctx.projectIds],
          )
        ).rows[0];
        if (!p) throw new HttpError(404, 'not_found', 'Document not found');
        if (!ctx.asTeam) await markRead(c, ctx, 'doc', p.id, p.version);
        return {
          body: {
            id: p.id,
            title: p.title,
            body: p.body,
            version: p.version,
            updatedAt: p.updated_at.toISOString(),
          },
        };
      }),
  });

  const fileRead = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/documents/files/:fileId/read',
    summary: 'Mark a shared file read (the portal calls it when the contact opens it)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, fileId: uuid }),
    body: s.object({}),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        const ok = (
          await c.query(
            'SELECT 1 FROM files WHERE id = $1 AND project_id = ANY($2::uuid[]) AND client_visible',
            [params.fileId, ctx.projectIds],
          )
        ).rowCount;
        if (!ok) throw new HttpError(404, 'not_found', 'File not found');
        if (!ctx.asTeam) await markRead(c, ctx, 'file', params.fileId, 0);
        return { body: { id: params.fileId, read: true } };
      }),
  });

  // ── what the team shares ──
  const shareRound = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/test-runs/:runId/client-round',
    summary:
      'Share a test run with the project’s client as an acceptance round, or stop sharing (member)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, runId: uuid }),
    body: s.object({
      shared: s.boolean(),
      dueOn: s.optional(s.nullable(s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ }))),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const run = (
          await c.query<{ id: string; project_id: string; client_id: string | null }>(
            'SELECT r.id, r.project_id, p.client_id FROM test_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = $1',
            [params.runId],
          )
        ).rows[0];
        if (!run) throw new HttpError(404, 'not_found', 'Test run not found');
        await requireProject(c, a, run.project_id);
        if (body.shared && !run.client_id)
          throw new HttpError(409, 'conflict', 'The project has no client to share it with');
        await c.query('UPDATE test_runs SET client_round = $2, due_on = $3 WHERE id = $1', [
          run.id,
          body.shared,
          body.dueOn ?? null,
        ]);
        return { body: { id: run.id, clientRound: body.shared, dueOn: body.dueOn ?? null } };
      }),
  });

  const sharePage = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/docs/:pageId/client',
    summary: 'Share a published page with the project’s client, or stop sharing (member)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, pageId: uuid }),
    body: s.object({ shared: s.boolean() }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = (
          await c.query<{ id: string; project_id: string; client_id: string | null }>(
            'SELECT d.id, d.project_id, pr.client_id FROM doc_pages d JOIN projects pr ON pr.id = d.project_id WHERE d.id = $1 AND d.deleted_at IS NULL',
            [params.pageId],
          )
        ).rows[0];
        if (!p) throw new HttpError(404, 'not_found', 'Page not found');
        await requireProject(c, a, p.project_id);
        if (body.shared && !p.client_id)
          throw new HttpError(409, 'conflict', 'The project has no client to share it with');
        await c.query('UPDATE doc_pages SET client_visible = $2 WHERE id = $1', [
          p.id,
          body.shared,
        ]);
        return { body: { id: p.id, clientVisible: body.shared } };
      }),
  });

  const shareMockup = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/mockups/:mockupId/client',
    summary: 'Share a mockup with the project’s client for approval, or stop sharing (member)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, mockupId: uuid }),
    body: s.object({ shared: s.boolean() }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const m = (
          await c.query<{
            id: string;
            project_id: string;
            client_id: string | null;
            status: string;
            version: number;
          }>(
            'SELECT m.id, m.project_id, pr.client_id, m.status, m.version FROM mockups m JOIN projects pr ON pr.id = m.project_id WHERE m.id = $1',
            [params.mockupId],
          )
        ).rows[0];
        if (!m) throw new HttpError(404, 'not_found', 'Mockup not found');
        await requireProject(c, a, m.project_id);
        if (body.shared && !m.client_id)
          throw new HttpError(409, 'conflict', 'The project has no client to share it with');
        if (body.shared && !m.version)
          throw new HttpError(409, 'conflict', 'The mockup has no image yet');
        // shared for approval: it waits for the client's decision
        await c.query(
          `UPDATE mockups SET client_visible = $2,
              status = CASE WHEN $2 AND status IN ('draft', 'changes_requested') THEN 'in_review' ELSE status END,
              updated_at = now()
            WHERE id = $1`,
          [m.id, body.shared],
        );
        return { body: { id: m.id, clientVisible: body.shared } };
      }),
  });

  return [
    design, // [PCODE-294 | S15 | v0.1.0]
    designPin,
    overview,
    roadmap,
    acceptance,
    result,
    accept,
    approvals,
    designDecision,
    releases,
    rateRelease,
    signOffRelease, // [PCODE-336 | S15 | v0.1.0]
    documents,
    document,
    fileRead,
    shareRound,
    sharePage,
    shareMockup,
  ];
}

async function markRead(
  c: PoolClient,
  ctx: PortalCtx,
  type: 'doc' | 'file' | 'release',
  id: string,
  version: number,
): Promise<void> {
  await c.query(
    `INSERT INTO portal_reads (workspace_id, user_id, object_type, object_id, version) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, object_type, object_id) DO UPDATE SET version = EXCLUDED.version, read_at = now()`,
    [ctx.access.workspaceId, ctx.access.user.id, type, id, version],
  );
}
