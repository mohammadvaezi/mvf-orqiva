// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-143 | S15 | v0.1.0] Map compliance controls for ISO 27001, SOC 2, GDPR and the EU CRA to live evidence ──
// ── [PCODE-145 | S15 | v0.1.0] Add the review stage and the Reviewer agent ──
//    Why:  each control's status is measured from what the project actually has, at the moment it is asked:
//          scans, test runs, gate sign-offs, signatures, the vault, deploys, roles, reviews, backups, the
//          activity log, plus evidence people add. Nothing is ticked once and forgotten: a failing run turns
//          a control back to missing. G3's "Compliance checks pass" follows the enabled frameworks.
import { sprintReviews } from './reviews.js';
import {
  controlStatus,
  FRAMEWORKS,
  frameworkOf,
  SOURCE_TEXT,
  type Actor,
  type ControlStatus,
  type EvidenceSource,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import { actorOf, asMember, requireProject } from './access.js';
import { requireFeature } from '../licence/licence.js'; // [PCODE-359 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const RECENT_DAYS = 30;

type SourceState = { status: 'met' | 'partial' | 'missing'; detail: string };

const days = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : 'never');

/** The state of every evidence source for one project, measured now. */
export async function measureSources(
  c: PoolClient,
  projectId: string,
): Promise<Record<EvidenceSource, SourceState>> {
  const one = async <T>(sql: string): Promise<T | undefined> =>
    (await c.query<T & Record<string, unknown>>(sql, [projectId])).rows[0];
  const scan = await one<{ at: Date | null; serious: string }>(
    `SELECT (SELECT max(created_at) FROM security_scans WHERE project_id = $1 AND full_scan AND tool <> 'pe-deps') AS at,
            (SELECT count(*) FROM findings WHERE project_id = $1 AND status = 'open' AND severity IN ('critical', 'high')) AS serious`,
  );
  const deps = await one<{ at: Date | null }>(
    "SELECT max(created_at) AS at FROM security_scans WHERE project_id = $1 AND tool = 'pe-deps'",
  );
  const run = await one<{ name: string; finished_at: Date; failed: string; passed: string }>(
    `SELECT t.name, t.finished_at,
            (SELECT count(*) FROM test_results r WHERE r.run_id = t.id AND r.status IN ('failed', 'blocked')) AS failed,
            (SELECT count(*) FROM test_results r WHERE r.run_id = t.id AND r.status = 'passed') AS passed
       FROM test_runs t WHERE t.project_id = $1 AND t.status = 'done' ORDER BY t.finished_at DESC LIMIT 1`,
  );
  const gates = (
    await c.query<{ gate_key: string; decision: string; at: Date; user_name: string }>(
      `SELECT DISTINCT ON (gate_key) gate_key, decision, at, user_name FROM gate_signoffs
        WHERE project_id = $1 ORDER BY gate_key, at DESC, id DESC`,
      [projectId],
    )
  ).rows;
  const signed = await one<{ n: string; at: Date | null }>(
    `SELECT count(*) AS n, max(s.signed_at) AS at FROM proposal_signatures s JOIN ideas i ON i.id = s.idea_id
      WHERE i.project_id = $1 AND s.decision = 'approved'`,
  );
  const vault = await one<{ envs: string; with_secrets: string; leaks: string }>(
    `SELECT (SELECT count(*) FROM environments WHERE project_id = $1) AS envs,
            (SELECT count(DISTINCT e.id) FROM environments e JOIN environment_secrets k ON k.environment_id = e.id WHERE e.project_id = $1) AS with_secrets,
            (SELECT count(*) FROM findings WHERE project_id = $1 AND status = 'open' AND rule LIKE 'secret/%') AS leaks`,
  );
  const health = await one<{ envs: string; healthy: string }>(
    `SELECT count(*) AS envs, count(*) FILTER (WHERE last.ok) AS healthy FROM environments e
       LEFT JOIN LATERAL (SELECT coalesce((SELECT st.status = 'ok' FROM deploy_steps st WHERE st.run_id = d.id AND st.name = 'Health check'), false) AS ok
                            FROM deploy_runs d WHERE d.environment_id = e.id AND d.status = 'succeeded'
                           ORDER BY d.finished_at DESC LIMIT 1) last ON true
      WHERE e.project_id = $1`,
  );
  const roles = await one<{ members: string; leads: string }>(
    `SELECT count(*) AS members, count(*) FILTER (WHERE role IN ('owner', 'admin')) AS leads
       FROM workspace_members WHERE workspace_id = (SELECT workspace_id FROM projects WHERE id = $1)`,
  );
  const backups = await one<{ met: boolean }>(
    "SELECT met FROM gate_criteria WHERE project_id = $1 AND gate_key = 'g2' AND criterion_key = 'backups'",
  );
  const activity = await one<{ n: string }>(
    "SELECT count(*) AS n FROM activity_events WHERE envelope->>'projectid' = $1::text AND time > now() - interval '30 days'",
  );
  const reviews = await reviewState(c, projectId);
  const recent = (d: Date | null | undefined): boolean =>
    Boolean(d && Date.now() - d.getTime() < RECENT_DAYS * 86_400_000);
  const gate = (key: string): SourceState => {
    const g = gates.find((x) => x.gate_key === key);
    return g?.decision === 'approve'
      ? { status: 'met', detail: 'Signed by ' + g.user_name + ' on ' + days(g.at) }
      : { status: 'missing', detail: g ? 'Last decision: ' + g.decision : 'Not signed' };
  };
  const serious = Number(scan?.serious ?? 0);
  return {
    scan_clean:
      recent(scan?.at) && serious === 0
        ? {
            status: 'met',
            detail: 'Full scan on ' + days(scan?.at) + ', nothing high or critical open',
          }
        : serious
          ? { status: 'missing', detail: String(serious) + ' open high or critical findings' }
          : {
              status: scan?.at ? 'partial' : 'missing',
              detail: scan?.at
                ? 'Last full scan ' + days(scan.at) + ', older than 30 days'
                : 'No scan yet',
            },
    deps_scanned: recent(deps?.at)
      ? { status: 'met', detail: 'Dependency audit on ' + days(deps?.at) }
      : {
          status: 'missing',
          detail: deps?.at ? 'Last audit ' + days(deps.at) : 'No dependency audit yet',
        },
    tests_passing: !run
      ? { status: 'missing', detail: 'No finished test run' }
      : Number(run.failed) === 0 && Number(run.passed) > 0
        ? { status: 'met', detail: 'Run "' + run.name + '" passed on ' + days(run.finished_at) }
        : { status: 'missing', detail: 'Run "' + run.name + '": ' + run.failed + ' failing' },
    gate_g1: gate('g1'),
    gate_g2: gate('g2'),
    gate_g3: gate('g3'),
    proposal_signed: Number(signed?.n ?? 0)
      ? {
          status: 'met',
          detail: String(signed?.n) + ' proposal(s) signed, last ' + days(signed?.at),
        }
      : { status: 'missing', detail: 'No signed proposal' },
    secrets_vault:
      Number(vault?.leaks ?? 0) > 0
        ? { status: 'missing', detail: String(vault?.leaks) + ' secrets found in the code' }
        : Number(vault?.envs ?? 0) === 0
          ? { status: 'missing', detail: 'No environments yet' }
          : vault?.with_secrets === vault?.envs
            ? { status: 'met', detail: 'Every environment keeps its secrets in the vault' }
            : {
                status: 'partial',
                detail:
                  String(vault?.with_secrets) +
                  ' of ' +
                  String(vault?.envs) +
                  ' environments have secrets in the vault',
              },
    deploy_health:
      Number(health?.envs ?? 0) === 0
        ? { status: 'missing', detail: 'No environments yet' }
        : health?.healthy === health?.envs
          ? { status: 'met', detail: 'Every environment passed its health check' }
          : {
              status: Number(health?.healthy ?? 0) ? 'partial' : 'missing',
              detail:
                String(health?.healthy) + ' of ' + String(health?.envs) + ' environments healthy',
            },
    roles:
      Number(roles?.leads ?? 0) > 0
        ? {
            status: 'met',
            detail:
              String(roles?.members) + ' members, ' + String(roles?.leads) + ' owners or admins',
          }
        : { status: 'missing', detail: 'No owner or admin' },
    reviews,
    backups: backups?.met
      ? { status: 'met', detail: 'G2: backups configured and a restore tried' }
      : { status: 'missing', detail: 'G2 backups criterion not met' },
    activity_log: Number(activity?.n ?? 0)
      ? { status: 'met', detail: String(activity?.n) + ' recorded events in the last 30 days' }
      : { status: 'missing', detail: 'No recorded activity in the last 30 days' },
    manual: { status: 'missing', detail: 'Needs evidence added by a person' },
  };
}

/** [PCODE-145 | S15 | v0.1.0] finished work of the current sprint, reviewed and approved */
export async function reviewState(c: PoolClient, projectId: string): Promise<SourceState> {
  const r = await sprintReviews(c, projectId);
  if (!r.sprint || !r.done)
    return {
      status: 'missing',
      detail: r.sprint ? 'Nothing finished in ' + r.sprint + ' yet' : 'No sprint yet',
    };
  if (!r.missing.length)
    return {
      status: 'met',
      detail: 'All ' + String(r.done) + ' finished tasks of ' + r.sprint + ' approved',
    };
  return {
    status: r.approved ? 'partial' : 'missing',
    detail:
      String(r.approved) + ' of ' + String(r.done) + ' finished tasks of ' + r.sprint + ' approved',
  };
}

const controlOut = s.object({
  id: s.string(),
  ref: s.string(),
  summary: s.string(),
  status: s.string(),
  sources: s.array(
    s.object({ source: s.string(), text: s.string(), status: s.string(), detail: s.string() }),
  ),
  evidence: s.array(
    s.object({
      id: s.string(),
      text: s.string(),
      url: s.string(),
      addedBy: s.nullable(s.string()),
      addedAt: s.string(),
    }),
  ),
  exemption: s.nullable(
    s.object({ reason: s.string(), by: s.nullable(s.string()), at: s.string() }),
  ),
});
const complianceOut = s.object({
  frameworks: s.array(
    s.object({
      key: s.string(),
      name: s.string(),
      note: s.string(),
      enabled: s.boolean(),
      met: s.number({ integer: true }),
      total: s.number({ integer: true }),
      controls: s.array(controlOut),
    }),
  ),
});
export type ComplianceJson = Infer<typeof complianceOut>;

/** Every framework, enabled or not, with each control's measured status. */
export async function complianceOf(c: PoolClient, projectId: string): Promise<ComplianceJson> {
  const sources = await measureSources(c, projectId);
  const enabled = new Set(
    (
      await c.query<{ framework_key: string }>(
        'SELECT framework_key FROM project_frameworks WHERE project_id = $1',
        [projectId],
      )
    ).rows.map((r) => r.framework_key),
  );
  const evidence = (
    await c.query<{
      id: string;
      framework_key: string;
      control_id: string;
      text: string;
      url: string;
      name: string | null;
      added_at: Date;
    }>(
      `SELECT e.id, e.framework_key, e.control_id, e.text, e.url, u.name, e.added_at FROM control_evidence e
         LEFT JOIN users u ON u.id = e.added_by WHERE e.project_id = $1 ORDER BY e.added_at`,
      [projectId],
    )
  ).rows;
  const exemptions = (
    await c.query<{
      framework_key: string;
      control_id: string;
      reason: string;
      name: string | null;
      decided_at: Date;
    }>(
      `SELECT x.framework_key, x.control_id, x.reason, u.name, x.decided_at FROM control_exemptions x
         LEFT JOIN users u ON u.id = x.decided_by WHERE x.project_id = $1`,
      [projectId],
    )
  ).rows;
  return {
    frameworks: FRAMEWORKS.map((f) => {
      const controls = f.controls.map((ctl) => {
        const mine = evidence.filter((e) => e.framework_key === f.key && e.control_id === ctl.id);
        const exempt = exemptions.find((x) => x.framework_key === f.key && x.control_id === ctl.id);
        const states = ctl.sources.map((src) => {
          const st: SourceState =
            src === 'manual'
              ? mine.length
                ? { status: 'met', detail: String(mine.length) + ' piece(s) of evidence added' }
                : sources.manual
              : sources[src];
          return { source: src, text: SOURCE_TEXT[src], status: st.status, detail: st.detail };
        });
        const status: ControlStatus = controlStatus(
          states.map((x) => x.status),
          Boolean(exempt),
        );
        return {
          id: ctl.id,
          ref: ctl.ref,
          summary: ctl.summary,
          status,
          sources: states,
          evidence: mine.map((e) => ({
            id: e.id,
            text: e.text,
            url: e.url,
            addedBy: e.name,
            addedAt: e.added_at.toISOString(),
          })),
          exemption: exempt
            ? { reason: exempt.reason, by: exempt.name, at: exempt.decided_at.toISOString() }
            : null,
        };
      });
      return {
        key: f.key,
        name: f.name,
        note: f.note,
        enabled: enabled.has(f.key),
        met: controls.filter((x) => x.status === 'met' || x.status === 'exempt').length,
        total: controls.length,
        controls,
      };
    }),
  };
}

/** G3's compliance criterion: met when every control of every enabled framework is met or exempt. */
export async function syncComplianceGate(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  projectId: string,
): Promise<void> {
  const cm = await complianceOf(c, projectId);
  const on = cm.frameworks.filter((f) => f.enabled);
  const open = on.flatMap((f) =>
    f.controls
      .filter((x) => x.status !== 'met' && x.status !== 'exempt')
      .map((x) => f.name + ' ' + x.ref),
  );
  const met = on.length > 0 && open.length === 0;
  const evidence = !on.length
    ? 'No compliance framework turned on'
    : met
      ? 'All controls met or not applicable: ' + on.map((f) => f.name).join(', ')
      : String(open.length) + ' controls not met yet, e.g. ' + open.slice(0, 3).join('; ');
  const r = await c.query(
    `UPDATE gate_criteria SET met = $3, met_by = NULL, met_at = CASE WHEN $3 THEN now() END, evidence = $2
      WHERE project_id = $1 AND gate_key = 'g3' AND criterion_key = 'compliance' AND (met <> $3 OR evidence <> $2)`,
    [projectId, evidence.slice(0, 2000), met],
  );
  if (!r.rowCount) return;
  const p = (await c.query<{ key: string }>('SELECT key FROM projects WHERE id = $1', [projectId]))
    .rows[0];
  await recordEvent(
    c,
    workspaceId,
    {
      actor,
      verb: 'updated',
      object: { type: 'gate', id: projectId + ':g3', label: (p?.key ?? '') + ' G3' },
      parent: { type: 'project', id: projectId, label: p?.key ?? '' },
      changes: { criterion: { from: met ? null : 'compliance', to: met ? 'compliance' : null } },
    },
    { projectId },
  );
}

export function complianceRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/compliance',
    summary: 'Every framework with each control measured from live evidence (member)',
    tags: ['compliance'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: complianceOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        await syncComplianceGate(c, a.workspaceId, actorOf(a), p.id);
        return { body: await complianceOf(c, p.id) };
      }),
  });

  const toggle = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/compliance/frameworks/:framework',
    summary: 'Turn a framework on or off for the project (admin)',
    tags: ['compliance'],
    params: s.object({
      workspaceId: uuid,
      projectId: uuid,
      framework: s.string({ pattern: /^[a-z0-9-]{1,40}$/ }),
    }),
    body: s.object({ enabled: s.boolean() }),
    response: complianceOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (!frameworkOf(params.framework))
          throw new HttpError(404, 'not_found', 'Unknown framework ' + params.framework);
        // [PCODE-359 | S15 | v0.1.0]
        if (body.enabled)
          await requireFeature(c, a.workspaceId, 'compliance-packs', 'Compliance packs');
        if (body.enabled)
          await c.query(
            'INSERT INTO project_frameworks (workspace_id, project_id, framework_key, enabled_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [a.workspaceId, p.id, params.framework, a.user.id],
          );
        else
          await c.query(
            'DELETE FROM project_frameworks WHERE project_id = $1 AND framework_key = $2',
            [p.id, params.framework],
          );
        await syncComplianceGate(c, a.workspaceId, actorOf(a), p.id);
        return { body: await complianceOf(c, p.id) };
      }),
  });

  const control = (body: { framework: string; control: string }): void => {
    if (!frameworkOf(body.framework)?.controls.some((x) => x.id === body.control))
      throw new HttpError(400, 'invalid_request', 'Unknown control', [
        { path: 'body.control', message: 'is not a control of ' + body.framework },
      ]);
  };

  const addEvidence = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/compliance/evidence',
    summary: 'Add evidence to a control: a note and perhaps a link (member)',
    tags: ['compliance'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      framework: s.string({ max: 40 }),
      control: s.string({ max: 40 }),
      text: s.string({ min: 1, max: 5000 }),
      url: s.optional(s.string({ max: 1000, pattern: /^(https?:\/\/\S+)?$/ })),
    }),
    response: complianceOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        control(body);
        await c.query(
          'INSERT INTO control_evidence (workspace_id, project_id, framework_key, control_id, text, url, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            a.workspaceId,
            p.id,
            body.framework,
            body.control,
            body.text.trim(),
            body.url ?? '',
            a.user.id,
          ],
        );
        await syncComplianceGate(c, a.workspaceId, actorOf(a), p.id);
        return { status: 201, body: await complianceOf(c, p.id) };
      }),
  });

  const exempt = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/compliance/exemptions',
    summary: 'Mark a control as not applicable, with the reason; or take that back (admin)',
    tags: ['compliance'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      framework: s.string({ max: 40 }),
      control: s.string({ max: 40 }),
      reason: s.optional(s.string({ max: 2000 })),
      remove: s.optional(s.boolean()),
    }),
    response: complianceOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        control(body);
        if (body.remove)
          await c.query(
            'DELETE FROM control_exemptions WHERE project_id = $1 AND framework_key = $2 AND control_id = $3',
            [p.id, body.framework, body.control],
          );
        else {
          const reason = body.reason?.trim() ?? '';
          if (reason.length < 10)
            throw new HttpError(
              400,
              'invalid_request',
              'Say why it does not apply, in a sentence',
              [{ path: 'body.reason', message: 'is required (at least 10 characters)' }],
            );
          await c.query(
            `INSERT INTO control_exemptions (workspace_id, project_id, framework_key, control_id, reason, decided_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (project_id, framework_key, control_id) DO UPDATE SET reason = $5, decided_by = $6, decided_at = now()`,
            [a.workspaceId, p.id, body.framework, body.control, reason, a.user.id],
          );
        }
        await syncComplianceGate(c, a.workspaceId, actorOf(a), p.id);
        return { body: await complianceOf(c, p.id) };
      }),
  });

  return [get, toggle, addEvidence, exempt];
}
