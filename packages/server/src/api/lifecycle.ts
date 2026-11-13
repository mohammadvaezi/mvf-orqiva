// ── [PCODE-414 | S15 | v0.1.0] T37 high: Command center under 1 s at 100 projects ──
// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-117 | S15 | v0.1.0] Build the lifecycle engine: phases, stages, gates, criteria, sign-off, live ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
// ── [PCODE-143 | S15 | v0.1.0] Map compliance controls for ISO 27001, SOC 2, GDPR and the EU CRA to live evidence ──
// ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
//    Why:  the rules of the governed path, kept by the server so no screen or script can skip them. A phase
//          opens when every gate before it is approved. A gate can be approved only when every stage of
//          its phase is done or skipped and every criterion is met, and only by the gate's role. An
//          approved gate is final until an admin reopens it, and only while nothing after it has started.
//          Each change records who and when and is one activity event, so screens follow live.
import { syncReviewGate } from './reviews.js';
import { syncComplianceGate } from './compliance.js';
import { deployOnGate } from './infragate.js';
import {
  DEFAULT_LIFECYCLE,
  DEFAULT_LIFECYCLE_NAME,
  lifecycleProblems,
  type GateStatus,
  type LifecycleDef,
  type LifecycleState,
  type SignerRole,
  type StageStatus,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import {
  actorOf,
  asMember,
  atLeast,
  requireProject,
  type Access,
  requireProjectAdmin,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

interface StageRow {
  id: string;
  phase_key: string;
  stage_key: string;
  status: StageStatus;
  started_at: Date | null;
  finished_at: Date | null;
  note: string;
}
interface CriterionRow {
  id: string;
  gate_key: string;
  criterion_key: string;
  text: string;
  met: boolean;
  evidence: string;
  met_by_name: string | null;
  met_at: Date | null;
}
interface SignoffRow {
  gate_key: string;
  decision: 'approve' | 'reject' | 'reopen';
  note: string;
  user_name: string;
  at: Date;
}

/** May this role sign a gate that asks for `signer`? */
export const maySign = (role: string, signer: SignerRole): boolean =>
  signer === 'owner'
    ? role === 'owner'
    : atLeast(role as 'guest', signer === 'admin' ? 'admin' : 'member');

/** The whole lifecycle of a project, with every gate's status and what it still misses; null without one. */
export async function lifecycleState(
  c: PoolClient,
  projectId: string,
): Promise<LifecycleState | null> {
  return (await lifecycleStates(c, [projectId])).get(projectId) ?? null;
}

// [PCODE-414 | S15 | v0.1.0] many projects in four queries, not four per project (the command center reads all of them)
/** The lifecycles of many projects; a project without one is left out. */
export async function lifecycleStates(
  c: PoolClient,
  projectIds: string[],
): Promise<Map<string, LifecycleState>> {
  const out = new Map<string, LifecycleState>();
  if (!projectIds.length) return out;
  const group = <T extends { project_id: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.project_id, [...(m.get(r.project_id) ?? []), r]);
    return m;
  };
  const lives = (
    await c.query<{
      project_id: string;
      template_name: string;
      definition: LifecycleDef;
      started_at: Date;
    }>(
      'SELECT project_id, template_name, definition, started_at FROM project_lifecycles WHERE project_id = ANY($1::uuid[])',
      [projectIds],
    )
  ).rows;
  if (!lives.length) return out;
  const ids = lives.map((l) => l.project_id);
  const stages = group(
    (
      await c.query<StageRow & { project_id: string }>(
        'SELECT project_id, id, phase_key, stage_key, status, started_at, finished_at, note FROM lifecycle_stages WHERE project_id = ANY($1::uuid[]) ORDER BY position',
        [ids],
      )
    ).rows,
  );
  const criteria = group(
    (
      await c.query<CriterionRow & { project_id: string }>(
        `SELECT g.project_id, g.id, g.gate_key, g.criterion_key, g.text, g.met, g.evidence, u.name AS met_by_name, g.met_at
         FROM gate_criteria g LEFT JOIN users u ON u.id = g.met_by WHERE g.project_id = ANY($1::uuid[]) ORDER BY g.position`,
        [ids],
      )
    ).rows,
  );
  const signoffs = group(
    (
      await c.query<SignoffRow & { project_id: string }>(
        'SELECT project_id, gate_key, decision, note, user_name, at FROM gate_signoffs WHERE project_id = ANY($1::uuid[]) ORDER BY at, id',
        [ids],
      )
    ).rows,
  );
  for (const life of lives)
    out.set(
      life.project_id,
      buildLifecycle(
        life,
        stages.get(life.project_id) ?? [],
        criteria.get(life.project_id) ?? [],
        signoffs.get(life.project_id) ?? [],
      ),
    );
  return out;
}

/** A lifecycle from its rows: every gate's status and what it still misses. */
function buildLifecycle(
  life: { template_name: string; definition: LifecycleDef; started_at: Date },
  stages: StageRow[],
  criteria: CriterionRow[],
  signoffs: SignoffRow[],
): LifecycleState {
  let unlocked = true; // every gate so far is approved
  // a holder: the phase is found inside the map below
  const at: { current: string | null } = { current: null };
  const phases: LifecycleState['phases'] = life.definition.phases.map((p) => {
    const phaseOpen = unlocked;
    const waitFor = phaseOpen ? null : 'Waiting for the gate before this phase';
    const st = p.stages.map((d) => {
      const r = stages.find((x) => x.stage_key === d.key);
      return {
        id: r?.id ?? '',
        key: d.key,
        name: d.name,
        agent: d.agent,
        owner: d.owner,
        status: r?.status ?? 'not_started',
        startedAt: r?.started_at?.toISOString() ?? null,
        finishedAt: r?.finished_at?.toISOString() ?? null,
        note: r?.note ?? '',
        blockedBy: waitFor,
      };
    });
    let gate: LifecycleState['phases'][number]['gate'] = null;
    if (p.gate) {
      const g = p.gate;
      const cr = criteria
        .filter((x) => x.gate_key === g.key)
        .map((x) => ({
          id: x.id,
          key: x.criterion_key,
          text: x.text,
          met: x.met,
          evidence: x.evidence,
          metBy: x.met_by_name,
          metAt: x.met_at?.toISOString() ?? null,
        }));
      const so = signoffs
        .filter((x) => x.gate_key === g.key)
        .map((x) => ({
          decision: x.decision,
          note: x.note,
          by: x.user_name,
          at: x.at.toISOString(),
        }));
      const missing = [
        ...st
          .filter((x) => x.status !== 'done' && x.status !== 'skipped')
          .map((x) => 'Stage ' + x.name + ' is not finished'),
        ...cr.filter((x) => !x.met).map((x) => 'Not met: ' + x.text),
      ];
      const last = so[so.length - 1]?.decision;
      let status: GateStatus;
      if (!phaseOpen) status = 'locked';
      else if (last === 'approve') status = 'approved';
      else if (last === 'reject') status = 'rejected';
      else status = missing.length ? 'open' : 'ready';
      gate = {
        key: g.key,
        name: g.name,
        signer: g.signer,
        status,
        missing,
        criteria: cr,
        signoffs: so,
      };
      if (status !== 'approved') {
        at.current ??= p.key;
        unlocked = false;
      }
    }
    return { key: p.key, name: p.name, stages: st, gate };
  });
  return {
    templateName: life.template_name,
    startedAt: life.started_at.toISOString(),
    currentPhase:
      at.current ?? life.definition.phases[life.definition.phases.length - 1]?.key ?? '',
    phases,
  };
}

async function lifecycleOr404(c: PoolClient, projectId: string): Promise<LifecycleState> {
  const st = await lifecycleState(c, projectId);
  if (!st)
    throw new HttpError(404, 'not_found', 'This project has no lifecycle yet; start one first');
  return st;
}

async function event(
  c: PoolClient,
  a: Access,
  p: { id: string; key: string },
  object: { type: 'stage' | 'gate'; id: string; label: string },
  verb: 'started' | 'completed' | 'updated' | 'approved' | 'rejected' | 'created',
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object,
      parent: { type: 'project', id: p.id, label: p.key },
      changes,
    },
    { projectId: p.id },
  );
}

/** Starts a lifecycle from a definition: its stages and criteria, all open. */
export async function startLifecycle(
  c: PoolClient,
  a: Access,
  projectId: string,
  name: string,
  def: LifecycleDef,
): Promise<void> {
  const problems = lifecycleProblems(def);
  if (problems.length) throw new HttpError(400, 'invalid_request', problems.join(' '));
  await c.query(
    'INSERT INTO project_lifecycles (project_id, workspace_id, template_name, definition, started_by) VALUES ($1, $2, $3, $4, $5)',
    [projectId, a.workspaceId, name, JSON.stringify(def), a.user.id],
  );
  let pos = 0;
  for (const p of def.phases) {
    for (const st of p.stages)
      await c.query(
        'INSERT INTO lifecycle_stages (workspace_id, project_id, phase_key, stage_key, position) VALUES ($1, $2, $3, $4, $5)',
        [a.workspaceId, projectId, p.key, st.key, pos++],
      );
    if (p.gate)
      for (const [i, cr] of p.gate.criteria.entries())
        await c.query(
          'INSERT INTO gate_criteria (workspace_id, project_id, gate_key, criterion_key, position, text) VALUES ($1, $2, $3, $4, $5, $6)',
          [a.workspaceId, projectId, p.gate.key, cr.key, i, cr.text],
        );
  }
}

const stateOut = s.anyObject();

export function lifecycleRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/lifecycle',
    summary: 'The project’s lifecycle: phases, stages, gates with their criteria and sign-offs',
    tags: ['lifecycle'],
    params: projectParams,
    response: s.object({ lifecycle: s.nullable(stateOut) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        return {
          body: {
            lifecycle: (await lifecycleState(c, p.id)) as unknown as Record<string, unknown> | null,
          },
        };
      }),
  });

  const start = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/lifecycle',
    summary:
      'Start the project’s lifecycle from a template: the default, or one of the workspace (admin)',
    tags: ['lifecycle'],
    params: projectParams,
    body: s.object({ templateId: s.optional(uuid) }),
    response: s.object({ lifecycle: stateOut }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        if (
          (await c.query('SELECT 1 FROM project_lifecycles WHERE project_id = $1', [p.id])).rowCount
        )
          throw new HttpError(409, 'conflict', p.key + ' already has a lifecycle');
        let name = DEFAULT_LIFECYCLE_NAME;
        let def = DEFAULT_LIFECYCLE;
        if (body.templateId) {
          const t = (
            await c.query<{ name: string; definition: LifecycleDef }>(
              'SELECT name, definition FROM lifecycle_templates WHERE id = $1',
              [body.templateId],
            )
          ).rows[0];
          if (!t) throw new HttpError(404, 'not_found', 'Template not found');
          name = t.name;
          def = t.definition;
        }
        await startLifecycle(c, a, p.id, name, def);
        await event(c, a, p, { type: 'gate', id: p.id, label: p.key + ' lifecycle' }, 'created', {
          lifecycle: { from: null, to: name },
        });
        return {
          status: 201,
          body: {
            lifecycle: (await lifecycleOr404(c, p.id)) as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const stage = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/lifecycle/stages/:stageId',
    summary:
      'Start, finish, skip or reset a stage (member); a stage after a closed gate cannot move',
    tags: ['lifecycle'],
    params: s.object({ workspaceId: uuid, projectId: uuid, stageId: uuid }),
    body: s.object({
      status: s.enum(['not_started', 'active', 'done', 'skipped']),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: s.object({ lifecycle: stateOut }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const life = await lifecycleOr404(c, p.id);
        const phase = life.phases.find((ph) => ph.stages.some((x) => x.id === params.stageId));
        const st = phase?.stages.find((x) => x.id === params.stageId);
        if (!phase || !st) throw new HttpError(404, 'not_found', 'Stage not found');
        if (st.blockedBy)
          throw new HttpError(
            409,
            'conflict',
            st.name + ' cannot move yet: the gate before ' + phase.name + ' is not approved',
          );
        if (phase.gate?.status === 'approved')
          throw new HttpError(
            409,
            'conflict',
            phase.gate.name + ' is approved; an admin reopens it before ' + st.name + ' can change',
          );
        if (st.status === body.status && body.note === undefined)
          return { body: { lifecycle: life as unknown as Record<string, unknown> } };
        await c.query(
          `UPDATE lifecycle_stages SET status = $2,
             started_at = CASE WHEN $2 = 'not_started' THEN NULL WHEN $2 = 'active' THEN coalesce(started_at, now()) ELSE started_at END,
             finished_at = CASE WHEN $2 IN ('done', 'skipped') THEN now() ELSE NULL END,
             note = coalesce($3, note), changed_by = $4
           WHERE id = $1`,
          [st.id, body.status, body.note ?? null, a.user.id],
        );
        const verb =
          body.status === 'active' ? 'started' : body.status === 'done' ? 'completed' : 'updated';
        await event(c, a, p, { type: 'stage', id: st.id, label: p.key + ' ' + st.name }, verb, {
          status: { from: st.status, to: body.status },
        });
        return {
          body: {
            lifecycle: (await lifecycleOr404(c, p.id)) as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const criterion = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/lifecycle/criteria/:criterionId',
    summary: 'Mark a gate criterion met or not, with evidence (member)',
    tags: ['lifecycle'],
    params: s.object({ workspaceId: uuid, projectId: uuid, criterionId: uuid }),
    body: s.object({ met: s.boolean(), evidence: s.optional(s.string({ max: 2000 })) }),
    response: s.object({ lifecycle: stateOut }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const life = await lifecycleOr404(c, p.id);
        const gate = life.phases
          .map((ph) => ph.gate)
          .find((g) => g?.criteria.some((x) => x.id === params.criterionId));
        const cr = gate?.criteria.find((x) => x.id === params.criterionId);
        if (!gate || !cr) throw new HttpError(404, 'not_found', 'Criterion not found');
        if (gate.status === 'approved')
          throw new HttpError(
            409,
            'conflict',
            gate.name + ' is approved; an admin reopens it first',
          );
        if (gate.status === 'locked')
          throw new HttpError(409, 'conflict', gate.name + ' waits for the gate before it');
        await c.query(
          `UPDATE gate_criteria SET met = $2, evidence = coalesce($3, evidence),
             met_by = CASE WHEN $2 THEN $4::uuid ELSE NULL END, met_at = CASE WHEN $2 THEN now() ELSE NULL END
           WHERE id = $1`,
          [cr.id, body.met, body.evidence ?? null, a.user.id],
        );
        await event(
          c,
          a,
          p,
          { type: 'gate', id: cr.id, label: p.key + ' ' + gate.name },
          'updated',
          {
            criterion: { from: cr.met, to: { text: cr.text, met: body.met } },
          },
        );
        return {
          body: {
            lifecycle: (await lifecycleOr404(c, p.id)) as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const signoff = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/lifecycle/gates/:gateKey',
    summary: 'Approve or reject a gate (its signer role), or reopen an approved one (admin)',
    tags: ['lifecycle'],
    params: s.object({
      workspaceId: uuid,
      projectId: uuid,
      gateKey: s.string({ pattern: /^[a-z][a-z0-9-]{0,39}$/ }),
    }),
    body: s.object({
      decision: s.enum(['approve', 'reject', 'reopen']),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: s.object({ lifecycle: stateOut }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        // [PCODE-143 | S15 | v0.1.0] the quality gate reads compliance as it stands now
        if (params.gateKey === 'g3') await syncComplianceGate(c, a.workspaceId, actorOf(a), p.id);
        // [PCODE-145 | S15 | v0.1.0] and reviews as they stand now
        if (params.gateKey === 'g3') await syncReviewGate(c, a.workspaceId, actorOf(a), p.id);
        const life = await lifecycleOr404(c, p.id);
        const at = life.phases.findIndex((ph) => ph.gate?.key === params.gateKey);
        const gate = life.phases[at]?.gate;
        if (!gate) throw new HttpError(404, 'not_found', 'Gate not found');
        if (gate.status === 'locked')
          throw new HttpError(409, 'conflict', gate.name + ' waits for the gate before it');
        if (body.decision === 'reopen') {
          if (!atLeast(a.role, 'admin'))
            throw new HttpError(403, 'forbidden', 'Only an admin reopens a gate');
          if (gate.status !== 'approved')
            throw new HttpError(409, 'conflict', gate.name + ' is not approved');
          const later = life.phases
            .slice(at + 1)
            .flatMap((ph) => ph.stages)
            .some((x) => x.status !== 'not_started');
          if (later)
            throw new HttpError(
              409,
              'conflict',
              'Work after ' + gate.name + ' has started; it cannot be reopened',
            );
        } else {
          if (!maySign(a.role, gate.signer))
            throw new HttpError(
              403,
              'forbidden',
              gate.name +
                ' is signed by ' +
                (gate.signer === 'owner' ? 'an owner' : 'an ' + gate.signer),
            );
          if (gate.status === 'approved')
            throw new HttpError(409, 'conflict', gate.name + ' is already approved');
          if (body.decision === 'approve' && gate.missing.length)
            throw new HttpError(
              409,
              'conflict',
              gate.name + ' cannot be approved yet: ' + gate.missing.join('; '),
            );
        }
        await c.query(
          'INSERT INTO gate_signoffs (workspace_id, project_id, gate_key, decision, note, user_id, user_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [a.workspaceId, p.id, gate.key, body.decision, body.note ?? '', a.user.id, a.user.name],
        );
        const verb =
          body.decision === 'approve'
            ? 'approved'
            : body.decision === 'reject'
              ? 'rejected'
              : 'updated';
        await event(
          c,
          a,
          p,
          { type: 'gate', id: p.id + ':' + gate.key, label: p.key + ' ' + gate.name },
          verb,
          {
            decision: { from: gate.status, to: body.decision },
          },
        );
        // [PCODE-133 | S15 | v0.1.0] environments that wait for this gate deploy now
        if (body.decision === 'approve') await deployOnGate(c, a, p.id, gate.key);
        return {
          body: {
            lifecycle: (await lifecycleOr404(c, p.id)) as unknown as Record<string, unknown>,
          },
        };
      }),
  });

  const overview = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/lifecycle',
    summary:
      'Where every project stands in its lifecycle: the current phase and each gate’s status',
    tags: ['lifecycle'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(
      s.object({
        projectId: s.string(),
        key: s.string(),
        name: s.string(),
        phase: s.string(),
        phaseName: s.string(),
        gates: s.array(s.object({ key: s.string(), name: s.string(), status: s.string() })),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const projects = (
          await c.query<{ id: string; key: string; name: string }>(
            `SELECT p.id, p.key, p.name FROM projects p JOIN project_lifecycles l ON l.project_id = p.id
             WHERE p.archived_at IS NULL
               AND ($1 <> 'guest' OR guest_sees_project(p.id, $2))
             ORDER BY p.name`,
            [a.role, a.user.id],
          )
        ).rows;
        const out = [];
        for (const p of projects) {
          const st = await lifecycleState(c, p.id);
          if (!st) continue;
          out.push({
            projectId: p.id,
            key: p.key,
            name: p.name,
            phase: st.currentPhase,
            phaseName: st.phases.find((ph) => ph.key === st.currentPhase)?.name ?? '',
            gates: st.phases.flatMap((ph) =>
              ph.gate ? [{ key: ph.gate.key, name: ph.gate.name, status: ph.gate.status }] : [],
            ),
          });
        }
        return { body: out };
      }),
  });

  return [get, start, stage, criterion, signoff, overview];
}
