// ── [PCODE-316 | S15 | v0.1.0] T32.3b Named run sign-off with a frozen snapshot, and a release gate on tests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
//    Why:  the Security center of the approved design on top of the scans and findings built before. Each
//          finding gets one risk score and an SLA, learns which task's code introduced it, and moves through
//          new, confirmed, fixing and verified; an accepted risk names its approver and expires. SBOMs per
//          release answer "which shipped versions contain this package"; policies (dry run first) decide
//          what blocks a release; campaigns clear one class of finding across projects; posture sums it up.
import {
  evaluatePolicy,
  parseSbom,
  riskScore,
  sbomDiff,
  SLA_DAYS,
  type PolicyFinding,
  type PolicyRule,
  type SbomComponent,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, atLeast, requireProject, type Access } from './access.js';
import { releaseTests } from './testsignoff.js'; // [PCODE-316 | S15 | v0.1.0]

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const findingParams = s.object({ workspaceId: uuid, findingId: uuid });

interface RiskRow {
  id: string;
  severity: string;
  cvss: number | null;
  epss: number | null;
  kev: boolean;
  reachable: boolean | null;
  exposed: boolean | null;
  risk_score: number;
  first_seen_at: Date;
  sla_due_at: Date | null;
  file: string;
  line: number | null;
  introduced_by_item: string | null;
  status: string;
  accepted_until: string | null;
}

/**
 * Brings a project's findings up to date: risk scores, SLA due dates, the task whose fingerprint marks
 * the finding's code (the nearest block above the line, else the file's header), and accepted risks
 * whose date has passed are open again.
 */
export async function refreshFindings(
  c: PoolClient,
  projectId: string,
): Promise<{ reopened: number }> {
  const rows = (
    await c.query<RiskRow>(
      `SELECT id, severity, cvss, epss, kev, reachable, exposed, risk_score, first_seen_at, sla_due_at, file, line, introduced_by_item, status,
              accepted_until::text AS accepted_until
         FROM findings WHERE project_id = $1`,
      [projectId],
    )
  ).rows;
  for (const f of rows) {
    const risk = riskScore({
      severity: f.severity,
      cvss: f.cvss,
      epss: f.epss,
      kev: f.kev,
      reachable: f.reachable,
      exposed: f.exposed,
    });
    const days = SLA_DAYS[f.severity] ?? null;
    const due = days === null ? null : new Date(f.first_seen_at.getTime() + days * 86_400_000);
    let introduced = f.introduced_by_item;
    if (!introduced && f.file) {
      introduced =
        (
          await c.query<{ item_id: string }>(
            `SELECT item_id FROM item_fingerprints WHERE project_id = $1 AND path = $2
              ORDER BY (kind = 'block' AND line <= coalesce($3, 0)) DESC, CASE WHEN kind = 'block' THEN line ELSE 0 END DESC LIMIT 1`,
            [projectId, f.file, f.line],
          )
        ).rows[0]?.item_id ?? null;
    }
    if (
      risk !== f.risk_score ||
      (due?.getTime() ?? null) !== (f.sla_due_at?.getTime() ?? null) ||
      introduced !== f.introduced_by_item
    )
      await c.query(
        'UPDATE findings SET risk_score = $2, sla_due_at = $3, introduced_by_item = $4 WHERE id = $1',
        [f.id, risk, due, introduced],
      );
  }
  // a fix the scans confirm is verified; a finding that comes back is confirmed again
  await c.query(
    "UPDATE findings SET workflow = 'verified' WHERE project_id = $1 AND status = 'fixed' AND workflow IN ('confirmed', 'fixing')",
    [projectId],
  );
  await c.query(
    "UPDATE findings SET workflow = 'confirmed' WHERE project_id = $1 AND status = 'open' AND workflow = 'verified'",
    [projectId],
  );
  const reopened = await c.query(
    `UPDATE findings SET status = 'open', reason = reason || ' (accepted until ' || accepted_until::text || '; that date has passed)', accepted_until = NULL
      WHERE project_id = $1 AND status = 'accepted' AND accepted_until IS NOT NULL AND accepted_until < (now() AT TIME ZONE 'Europe/Berlin')::date`,
    [projectId],
  );
  return { reopened: reopened.rowCount ?? 0 };
}

async function findingOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<{ id: string; project_id: string; status: string; workflow: string; title: string }> {
  const f = (
    await c.query<{
      id: string;
      project_id: string;
      status: string;
      workflow: string;
      title: string;
    }>('SELECT id, project_id, status, workflow, title FROM findings WHERE id = $1', [id])
  ).rows[0];
  if (!f) throw new HttpError(404, 'not_found', 'Finding not found');
  try {
    await requireProject(c, a, f.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Finding not found');
  }
  return f;
}

const riskOut = s.object({
  id: s.string(),
  riskScore: s.number({ integer: true }),
  workflow: s.string(),
  status: s.string(),
  cve: s.string(),
  package: s.string(),
  packageVersion: s.string(),
  fixedVersion: s.string(),
  cvss: s.nullable(s.number()),
  epss: s.nullable(s.number()),
  kev: s.boolean(),
  reachable: s.nullable(s.boolean()),
  exposed: s.nullable(s.boolean()),
  slaDueAt: s.nullable(s.string()),
  slaBreached: s.boolean(),
  acceptedUntil: s.nullable(s.string()),
  introducedBy: s.nullable(s.object({ id: s.string(), ref: s.string(), title: s.string() })),
});
async function riskJson(c: PoolClient, id: string) {
  const r = (
    await c.query<{
      id: string;
      risk_score: number;
      workflow: string;
      status: string;
      cve: string;
      package: string;
      package_version: string;
      fixed_version: string;
      cvss: number | null;
      epss: number | null;
      kev: boolean;
      reachable: boolean | null;
      exposed: boolean | null;
      sla_due_at: Date | null;
      accepted_until: string | null;
      intro_id: string | null;
      intro_ref: string | null;
      intro_title: string | null;
    }>(
      `SELECT f.id, f.risk_score, f.workflow, f.status, f.cve, f.package, f.package_version, f.fixed_version, f.cvss, f.epss, f.kev, f.reachable, f.exposed,
              f.sla_due_at, f.accepted_until::text AS accepted_until, i.id AS intro_id, p.key || '-' || i.sequence AS intro_ref, i.title AS intro_title
         FROM findings f LEFT JOIN items i ON i.id = f.introduced_by_item LEFT JOIN projects p ON p.id = i.project_id WHERE f.id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) throw new Error('finding vanished');
  return {
    id: r.id,
    riskScore: r.risk_score,
    workflow: r.workflow,
    status: r.status,
    cve: r.cve,
    package: r.package,
    packageVersion: r.package_version,
    fixedVersion: r.fixed_version,
    cvss: r.cvss,
    epss: r.epss,
    kev: r.kev,
    reachable: r.reachable,
    exposed: r.exposed,
    slaDueAt: r.sla_due_at?.toISOString() ?? null,
    slaBreached:
      r.status === 'open' && r.sla_due_at !== null && r.sla_due_at.getTime() < Date.now(),
    acceptedUntil: r.accepted_until,
    introducedBy: r.intro_id
      ? { id: r.intro_id, ref: r.intro_ref ?? '', title: r.intro_title ?? '' }
      : null,
  };
}

interface PolicyRow {
  id: string;
  project_id: string | null;
  name: string;
  applies_to: string;
  rule: PolicyRule;
  enabled: boolean;
}

/** Runs the enabled policies of one kind for a project; the components are the release's SBOM, or the newest. */
export async function checkPolicies(
  c: PoolClient,
  projectId: string,
  appliesTo: 'merge' | 'release',
  releaseId: string | null,
): Promise<{ policy: string; violations: string[] }[]> {
  const policies = (
    await c.query<PolicyRow>(
      'SELECT id, project_id, name, applies_to, rule, enabled FROM policies WHERE enabled AND applies_to = $2 AND (project_id IS NULL OR project_id = $1) ORDER BY name',
      [projectId, appliesTo],
    )
  ).rows;
  if (!policies.length) return [];
  const findings: PolicyFinding[] = (
    await c.query<{
      title: string;
      severity: string;
      risk_score: number;
      rule: string;
      status: string;
      days: number;
    }>(
      "SELECT title, severity, risk_score, rule, status, extract(day FROM now() - first_seen_at)::int AS days FROM findings WHERE project_id = $1 AND status IN ('open', 'accepted')",
      [projectId],
    )
  ).rows.map((f) => ({
    title: f.title,
    severity: f.severity,
    risk: f.risk_score,
    rule: f.rule,
    open: f.status === 'open',
    firstSeenDaysAgo: f.days,
  }));
  const sbom = (
    await c.query<{ components: SbomComponent[] }>(
      'SELECT components FROM sboms WHERE project_id = $1 AND ($2::uuid IS NULL OR release_id = $2) ORDER BY ($2::uuid IS NOT NULL AND release_id = $2) DESC, created_at DESC LIMIT 1',
      [projectId, releaseId],
    )
  ).rows[0];
  // [PCODE-316 | S15 | v0.1.0] a release's tests, read when a policy asks about them
  const tests =
    releaseId && policies.some((p) => p.rule.testsPass || p.rule.testsSigned)
      ? await releaseTests(c, releaseId)
      : null;
  return policies.map((p) => ({
    policy: p.name,
    violations: evaluatePolicy(p.rule, findings, sbom?.components ?? [], tests),
  }));
}

const RULE_SEVERITY = ['critical', 'high', 'medium', 'low'] as const;
const ruleSchema = s.object({
  maxSeverity: s.optional(s.enum(RULE_SEVERITY)),
  minRisk: s.optional(s.number({ integer: true, min: 0, max: 100 })),
  bannedLicences: s.optional(s.array(s.string({ min: 1, max: 80 }), { max: 50 })),
  liveSecrets: s.optional(s.boolean()),
  newOnly: s.optional(s.boolean()),
  // [PCODE-316 | S15 | v0.1.0] release gates on tests
  testsPass: s.optional(s.boolean()),
  testsSigned: s.optional(s.boolean()),
});

export function postureRoutes(pool: Pool): Route[] {
  const getRisk = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/findings/:findingId/risk',
    summary:
      'A finding’s risk: score and what makes it, workflow, SLA, accepted-until and the task that introduced it',
    tags: ['security'],
    params: findingParams,
    response: riskOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const f = await findingOf(c, a, params.findingId);
        await refreshFindings(c, f.project_id);
        return { body: await riskJson(c, f.id) };
      }),
  });

  const enrich = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/findings/:findingId/risk',
    summary:
      'Tell what a finding concerns (CVE, package, versions) and how exposed it is (CVSS, EPSS, known exploited, reachable, exposed); the score follows (member)',
    tags: ['security'],
    params: findingParams,
    body: s.object({
      cve: s.optional(s.string({ max: 60 })),
      package: s.optional(s.string({ max: 200 })),
      packageVersion: s.optional(s.string({ max: 80 })),
      fixedVersion: s.optional(s.string({ max: 80 })),
      cvss: s.optional(s.nullable(s.number({ min: 0, max: 10 }))),
      epss: s.optional(s.nullable(s.number({ min: 0, max: 1 }))),
      kev: s.optional(s.boolean()),
      reachable: s.optional(s.nullable(s.boolean())),
      exposed: s.optional(s.nullable(s.boolean())),
    }),
    response: riskOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = await findingOf(c, a, params.findingId);
        if (body.cve && !/^(CVE|GHSA)-[0-9A-Za-z-]{4,40}$/.test(body.cve))
          throw new HttpError(400, 'invalid_request', 'A CVE or GHSA id, e.g. CVE-2024-12345', [
            { path: 'body.cve', message: 'is not a CVE or GHSA id' },
          ]);
        await c.query(
          `UPDATE findings SET cve = coalesce($2, cve), package = coalesce($3, package), package_version = coalesce($4, package_version),
                  fixed_version = coalesce($5, fixed_version),
                  cvss = CASE WHEN $6 THEN $7::real ELSE cvss END, epss = CASE WHEN $8 THEN $9::real ELSE epss END, kev = coalesce($10, kev),
                  reachable = CASE WHEN $11 THEN $12::boolean ELSE reachable END, exposed = CASE WHEN $13 THEN $14::boolean ELSE exposed END
            WHERE id = $1`,
          [
            f.id,
            body.cve ?? null,
            body.package?.trim() ?? null,
            body.packageVersion?.trim() ?? null,
            body.fixedVersion?.trim() ?? null,
            body.cvss !== undefined,
            body.cvss ?? null,
            body.epss !== undefined,
            body.epss ?? null,
            body.kev ?? null,
            body.reachable !== undefined,
            body.reachable ?? null,
            body.exposed !== undefined,
            body.exposed ?? null,
          ],
        );
        await refreshFindings(c, f.project_id);
        return { body: await riskJson(c, f.id) };
      }),
  });

  const workflow = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/findings/:findingId/workflow',
    summary:
      'Move a finding: confirmed, fixing, or verified once a scan no longer sees it (member)',
    tags: ['security'],
    params: findingParams,
    body: s.object({ to: s.enum(['new', 'confirmed', 'fixing', 'verified']) }),
    response: riskOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = await findingOf(c, a, params.findingId);
        if (body.to === 'verified' && f.status !== 'fixed')
          throw new HttpError(
            409,
            'conflict',
            'A finding is verified once a scan no longer finds it',
          );
        await c.query('UPDATE findings SET workflow = $2 WHERE id = $1', [f.id, body.to]);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'finding', id: f.id, label: f.title },
            changes: { workflow: { from: f.workflow, to: body.to } },
          },
          { projectId: f.project_id },
        );
        return { body: await riskJson(c, f.id) };
      }),
  });

  const accept = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/findings/:findingId/accept',
    summary:
      'Accept a risk until a date, with the reason; after the date the finding is open again (admin)',
    tags: ['security'],
    params: findingParams,
    body: s.object({
      reason: s.string({ min: 10, max: 2000 }),
      until: s.string({ min: 10, max: 10 }),
    }),
    response: riskOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const f = await findingOf(c, a, params.findingId);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(body.until) ||
          body.until <= new Date().toISOString().slice(0, 10)
        )
          throw new HttpError(
            400,
            'invalid_request',
            'An acceptance ends on a date in the future',
            [{ path: 'body.until', message: 'is not a future date' }],
          );
        await c.query(
          "UPDATE findings SET status = 'accepted', reason = $2, accepted_until = $3, decided_by = $4, decided_at = now() WHERE id = $1",
          [f.id, body.reason.trim(), body.until, a.user.id],
        );
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'approved',
            object: { type: 'finding', id: f.id, label: f.title },
            changes: { status: { from: f.status, to: 'accepted until ' + body.until } },
          },
          { projectId: f.project_id },
        );
        return { body: await riskJson(c, f.id) };
      }),
  });

  const posture = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/security/posture',
    summary:
      'The project’s security posture: a score, open findings by severity, SLA breaches, time to fix, the trend of scans, the riskiest findings',
    tags: ['security'],
    params: projectParams,
    response: s.object({
      score: s.number({ integer: true }),
      open: s.object({
        critical: s.number({ integer: true }),
        high: s.number({ integer: true }),
        medium: s.number({ integer: true }),
        low: s.number({ integer: true }),
        info: s.number({ integer: true }),
      }),
      slaBreaches: s.number({ integer: true }),
      accepted: s.number({ integer: true }),
      medianDaysToFix: s.nullable(s.number()),
      trend: s.array(
        s.object({
          at: s.string(),
          tool: s.string(),
          found: s.number({ integer: true }),
          newCount: s.number({ integer: true }),
          fixedCount: s.number({ integer: true }),
        }),
      ),
      top: s.array(
        s.object({
          id: s.string(),
          title: s.string(),
          severity: s.string(),
          riskScore: s.number({ integer: true }),
          workflow: s.string(),
          slaBreached: s.boolean(),
          introducedByRef: s.nullable(s.string()),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        await refreshFindings(c, params.projectId);
        const open = (
          await c.query<{ severity: string; n: string }>(
            "SELECT severity, count(*) AS n FROM findings WHERE project_id = $1 AND status = 'open' GROUP BY severity",
            [params.projectId],
          )
        ).rows;
        const n = (k: string): number => Number(open.find((o) => o.severity === k)?.n ?? 0);
        const stats = (
          await c.query<{ breaches: string; accepted: string; fix: string | null; risk: string }>(
            `SELECT count(*) FILTER (WHERE status = 'open' AND sla_due_at < now()) AS breaches,
                    count(*) FILTER (WHERE status = 'accepted') AS accepted,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (last_seen_at - first_seen_at)) / 86400) FILTER (WHERE status = 'fixed') AS fix,
                    coalesce(sum(risk_score) FILTER (WHERE status = 'open'), 0) AS risk
               FROM findings WHERE project_id = $1`,
            [params.projectId],
          )
        ).rows[0];
        const trend = (
          await c.query<{
            created_at: Date;
            tool: string;
            found: number;
            new_count: number;
            fixed_count: number;
          }>(
            'SELECT created_at, tool, found, new_count, fixed_count FROM security_scans WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20',
            [params.projectId],
          )
        ).rows.reverse();
        const top = (
          await c.query<{
            id: string;
            title: string;
            severity: string;
            risk_score: number;
            workflow: string;
            sla_due_at: Date | null;
            intro: string | null;
          }>(
            `SELECT f.id, f.title, f.severity, f.risk_score, f.workflow, f.sla_due_at, p.key || '-' || i.sequence AS intro
               FROM findings f LEFT JOIN items i ON i.id = f.introduced_by_item LEFT JOIN projects p ON p.id = i.project_id
              WHERE f.project_id = $1 AND f.status = 'open' ORDER BY f.risk_score DESC, f.first_seen_at LIMIT 10`,
            [params.projectId],
          )
        ).rows;
        // 100 with nothing open; every open finding's risk and every breached SLA take points
        const score = Math.max(
          0,
          Math.round(100 - Number(stats?.risk ?? 0) / 10 - Number(stats?.breaches ?? 0) * 5),
        );
        return {
          body: {
            score,
            open: {
              critical: n('critical'),
              high: n('high'),
              medium: n('medium'),
              low: n('low'),
              info: n('info'),
            },
            slaBreaches: Number(stats?.breaches ?? 0),
            accepted: Number(stats?.accepted ?? 0),
            medianDaysToFix:
              stats?.fix === null || stats?.fix === undefined
                ? null
                : Math.round(Number(stats.fix) * 10) / 10,
            trend: trend.map((t) => ({
              at: t.created_at.toISOString(),
              tool: t.tool,
              found: t.found,
              newCount: t.new_count,
              fixedCount: t.fixed_count,
            })),
            top: top.map((t) => ({
              id: t.id,
              title: t.title,
              severity: t.severity,
              riskScore: t.risk_score,
              workflow: t.workflow,
              slaBreached: t.sla_due_at !== null && t.sla_due_at.getTime() < Date.now(),
              introducedByRef: t.intro,
            })),
          },
        };
      }),
  });

  // ── SBOMs ──
  const sbomOut = s.object({
    id: s.string(),
    format: s.string(),
    releaseId: s.nullable(s.string()),
    releaseVersion: s.nullable(s.string()),
    components: s.number({ integer: true }),
    licences: s.array(s.string()),
    createdAt: s.string(),
  });
  interface SbomRow {
    id: string;
    format: string;
    release_id: string | null;
    version: string | null;
    components: SbomComponent[];
    created_at: Date;
  }
  const sbomJson = (r: SbomRow) => ({
    id: r.id,
    format: r.format,
    releaseId: r.release_id,
    releaseVersion: r.version,
    components: r.components.length,
    licences: [...new Set(r.components.flatMap((x) => x.licences))].sort(),
    createdAt: r.created_at.toISOString(),
  });
  const SBOM_SELECT =
    'SELECT b.id, b.format, b.release_id, r.version, b.components, b.created_at, b.project_id FROM sboms b LEFT JOIN releases r ON r.id = b.release_id';
  const addSbom = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/sboms',
    summary: 'Store an SBOM (CycloneDX or SPDX JSON), for a release if named (member)',
    tags: ['security'],
    params: projectParams,
    body: s.object({ document: s.anyObject(), releaseId: s.optional(uuid) }),
    response: sbomOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const parsed = parseSbom(body.document);
        if (!parsed)
          throw new HttpError(400, 'invalid_request', 'Send a CycloneDX or SPDX document in JSON', [
            { path: 'body.document', message: 'is neither CycloneDX nor SPDX' },
          ]);
        if (parsed.components.length > 20_000)
          throw new HttpError(400, 'invalid_request', 'At most 20000 components', [
            { path: 'body.document', message: 'is too large' },
          ]);
        if (body.releaseId) {
          const r = (
            await c.query<{ project_id: string }>('SELECT project_id FROM releases WHERE id = $1', [
              body.releaseId,
            ])
          ).rows[0];
          if (r?.project_id !== p.id)
            throw new HttpError(400, 'invalid_request', 'The release belongs to another project', [
              { path: 'body.releaseId', message: 'is not a release of this project' },
            ]);
        }
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO sboms (workspace_id, project_id, release_id, format, components, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [
              a.workspaceId,
              p.id,
              body.releaseId ?? null,
              parsed.format,
              JSON.stringify(parsed.components),
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const row = (await c.query<SbomRow>(SBOM_SELECT + ' WHERE b.id = $1', [id])).rows[0];
        if (!row) throw new Error('sbom vanished');
        return { status: 201, body: sbomJson(row) };
      }),
  });
  const sboms = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/sboms',
    summary: 'The project’s SBOMs, newest first',
    tags: ['security'],
    params: projectParams,
    response: s.array(sbomOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return {
          body: (
            await c.query<SbomRow>(
              SBOM_SELECT + ' WHERE b.project_id = $1 ORDER BY b.created_at DESC LIMIT 100',
              [params.projectId],
            )
          ).rows.map(sbomJson),
        };
      }),
  });
  const sbomOf = async (c: PoolClient, a: Access, id: string): Promise<SbomRow> => {
    const r = (
      await c.query<SbomRow & { project_id: string }>(SBOM_SELECT + ' WHERE b.id = $1', [id])
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'SBOM not found');
    await requireProject(c, a, r.project_id);
    return r;
  };
  const component = s.object({
    name: s.string(),
    version: s.string(),
    purl: s.string(),
    licences: s.array(s.string()),
  });
  const sbom = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sboms/:sbomId',
    summary: 'One SBOM with its components',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, sbomId: uuid }),
    response: s.object({ sbom: sbomOut, components: s.array(component) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const r = await sbomOf(c, a, params.sbomId);
        return {
          body: {
            sbom: sbomJson(r),
            components: [...r.components].sort((x, y) => x.name.localeCompare(y.name)),
          },
        };
      }),
  });
  const diff = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/sbom-diff',
    summary: 'What changed between two SBOMs: added, removed and changed components',
    tags: ['security'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ a: uuid, b: uuid }),
    response: s.object({
      added: s.array(component),
      removed: s.array(component),
      changed: s.array(s.object({ name: s.string(), from: s.string(), to: s.string() })),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        const [x, y] = [await sbomOf(c, a, query.a), await sbomOf(c, a, query.b)];
        return { body: sbomDiff(x.components, y.components) };
      }),
  });
  const affected = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/package-exposure',
    summary:
      'Which shipped releases, in every project, contain a package (at a version, if given): the answer when a new CVE lands',
    tags: ['security'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({
      name: s.string({ min: 1, max: 200 }),
      version: s.optional(s.string({ max: 80 })),
    }),
    response: s.array(
      s.object({
        projectId: s.string(),
        projectKey: s.string(),
        releaseId: s.string(),
        version: s.string(),
        releasedAt: s.nullable(s.string()),
        componentVersion: s.string(),
      }),
    ),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const rows = (
          await c.query<{
            project_id: string;
            key: string;
            release_id: string;
            version: string;
            released_at: Date | null;
            cv: string;
          }>(
            `SELECT DISTINCT p.id AS project_id, p.key, r.id AS release_id, r.version, r.released_at, comp->>'version' AS cv
               FROM sboms b JOIN releases r ON r.id = b.release_id JOIN projects p ON p.id = b.project_id,
                    jsonb_array_elements(b.components) comp
              WHERE r.state = 'released' AND lower(comp->>'name') = lower($1) AND ($2::text IS NULL OR comp->>'version' = $2)
              ORDER BY p.key, r.released_at DESC`,
            [query.name, query.version ?? null],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            projectId: r.project_id,
            projectKey: r.key,
            releaseId: r.release_id,
            version: r.version,
            releasedAt: r.released_at?.toISOString() ?? null,
            componentVersion: r.cv,
          })),
        };
      }),
  });

  // ── policies ──
  const policyOut = s.object({
    id: s.string(),
    projectId: s.nullable(s.string()),
    name: s.string(),
    appliesTo: s.string(),
    rule: s.anyObject(),
    enabled: s.boolean(),
  });
  const policyJson = (p: PolicyRow) => ({
    id: p.id,
    projectId: p.project_id,
    name: p.name,
    appliesTo: p.applies_to,
    rule: p.rule as Record<string, unknown>,
    enabled: p.enabled,
  });
  const policies = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/policies',
    summary: 'The workspace’s policies: what blocks a merge or a release',
    tags: ['security'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(policyOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: (
          await c.query<PolicyRow>(
            'SELECT id, project_id, name, applies_to, rule, enabled FROM policies ORDER BY applies_to, name',
          )
        ).rows.map(policyJson),
      })),
  });
  const addPolicy = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/policies',
    summary: 'Add a policy for the workspace or one project; try it with a dry run first (admin)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      name: s.string({ min: 1, max: 120 }),
      appliesTo: s.enum(['merge', 'release']),
      rule: ruleSchema,
      projectId: s.optional(s.nullable(uuid)),
      enabled: s.optional(s.boolean()),
    }),
    response: policyOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (body.projectId) await requireProject(c, a, body.projectId);
        if (!Object.keys(body.rule).length)
          throw new HttpError(400, 'invalid_request', 'A policy needs at least one rule', [
            { path: 'body.rule', message: 'is empty' },
          ]);
        const row = (
          await c.query<PolicyRow>(
            'INSERT INTO policies (workspace_id, project_id, name, applies_to, rule, enabled, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, project_id, name, applies_to, rule, enabled',
            [
              a.workspaceId,
              body.projectId ?? null,
              body.name.trim(),
              body.appliesTo,
              JSON.stringify(body.rule),
              body.enabled ?? true,
              a.user.id,
            ],
          )
        ).rows[0];
        if (!row) throw new Error('policy vanished');
        return { status: 201, body: policyJson(row) };
      }),
  });
  const changePolicy = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/policies/:policyId',
    summary: 'Change, switch on or off a policy (admin)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, policyId: uuid }),
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 120 })),
      rule: s.optional(ruleSchema),
      enabled: s.optional(s.boolean()),
    }),
    response: policyOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const row = (
          await c.query<PolicyRow>(
            'UPDATE policies SET name = coalesce($2, name), rule = coalesce($3::jsonb, rule), enabled = coalesce($4, enabled) WHERE id = $1 RETURNING id, project_id, name, applies_to, rule, enabled',
            [
              params.policyId,
              body.name?.trim() ?? null,
              body.rule ? JSON.stringify(body.rule) : null,
              body.enabled ?? null,
            ],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Policy not found');
        return { body: policyJson(row) };
      }),
  });
  const dryRun = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/policies/check',
    summary: 'Dry run: what the enabled policies would block now, for a merge or a release',
    tags: ['security'],
    params: projectParams,
    body: s.object({ appliesTo: s.enum(['merge', 'release']), releaseId: s.optional(uuid) }),
    response: s.object({
      passes: s.boolean(),
      results: s.array(s.object({ policy: s.string(), violations: s.array(s.string()) })),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        await refreshFindings(c, params.projectId);
        const results = await checkPolicies(
          c,
          params.projectId,
          body.appliesTo,
          body.releaseId ?? null,
        );
        return { body: { passes: results.every((r) => !r.violations.length), results } };
      }),
  });

  // ── campaigns ──
  const campaignOut = s.object({
    id: s.string(),
    title: s.string(),
    rule: s.string(),
    package: s.string(),
    cve: s.string(),
    dueDate: s.nullable(s.string()),
    status: s.string(),
    open: s.number({ integer: true }),
    fixed: s.number({ integer: true }),
    projects: s.array(
      s.object({
        projectId: s.string(),
        key: s.string(),
        open: s.number({ integer: true }),
        fixed: s.number({ integer: true }),
      }),
    ),
  });
  interface CampaignRow {
    id: string;
    title: string;
    rule: string;
    package: string;
    cve: string;
    due_date: string | null;
    status: string;
  }
  const campaignJson = async (c: PoolClient, x: CampaignRow) => {
    const per = (
      await c.query<{ project_id: string; key: string; open: string; fixed: string }>(
        `SELECT f.project_id, p.key, count(*) FILTER (WHERE f.status IN ('open', 'accepted')) AS open, count(*) FILTER (WHERE f.status = 'fixed') AS fixed
           FROM findings f JOIN projects p ON p.id = f.project_id
          WHERE ($1 <> '' AND f.rule = $1) OR ($2 <> '' AND lower(f.package) = lower($2)) OR ($3 <> '' AND f.cve = $3)
          GROUP BY f.project_id, p.key ORDER BY p.key`,
        [x.rule, x.package, x.cve],
      )
    ).rows;
    return {
      id: x.id,
      title: x.title,
      rule: x.rule,
      package: x.package,
      cve: x.cve,
      dueDate: x.due_date,
      status: x.status,
      open: per.reduce((n, p) => n + Number(p.open), 0),
      fixed: per.reduce((n, p) => n + Number(p.fixed), 0),
      projects: per.map((p) => ({
        projectId: p.project_id,
        key: p.key,
        open: Number(p.open),
        fixed: Number(p.fixed),
      })),
    };
  };
  const CAMPAIGN_SELECT =
    'SELECT id, title, rule, package, cve, due_date::text AS due_date, status FROM campaigns';
  const campaigns = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/campaigns',
    summary: 'Security campaigns: one class of finding removed across every project, with progress',
    tags: ['security'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(campaignOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const rows = (
          await c.query<CampaignRow>(
            CAMPAIGN_SELECT + " ORDER BY status = 'active' DESC, created_at DESC",
          )
        ).rows;
        const out = [];
        for (const r of rows) out.push(await campaignJson(c, r));
        return { body: out };
      }),
  });
  const addCampaign = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/campaigns',
    summary: 'Start a campaign against one rule, package or CVE (admin)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      title: s.string({ min: 1, max: 200 }),
      rule: s.optional(s.string({ max: 200 })),
      package: s.optional(s.string({ max: 200 })),
      cve: s.optional(s.string({ max: 60 })),
      dueDate: s.optional(s.string({ min: 10, max: 10 })),
    }),
    response: campaignOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const set = [body.rule, body.package, body.cve].filter((x) => x?.trim()).length;
        if (set !== 1)
          throw new HttpError(
            400,
            'invalid_request',
            'A campaign targets one rule, one package or one CVE',
            [{ path: 'body', message: 'names ' + String(set) + ' targets' }],
          );
        const row = (
          await c.query<CampaignRow>(
            'INSERT INTO campaigns (workspace_id, title, rule, package, cve, due_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title, rule, package, cve, due_date::text AS due_date, status',
            [
              a.workspaceId,
              body.title.trim(),
              body.rule?.trim() ?? '',
              body.package?.trim() ?? '',
              body.cve?.trim() ?? '',
              body.dueDate ?? null,
              a.user.id,
            ],
          )
        ).rows[0];
        if (!row) throw new Error('campaign vanished');
        return { status: 201, body: await campaignJson(c, row) };
      }),
  });
  const changeCampaign = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/campaigns/:campaignId',
    summary: 'Close or cancel a campaign, or move its date (admin)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, campaignId: uuid }),
    body: s.object({
      status: s.optional(s.enum(['active', 'done', 'cancelled'])),
      dueDate: s.optional(s.nullable(s.string({ min: 10, max: 10 }))),
    }),
    response: campaignOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const row = (
          await c.query<CampaignRow>(
            'UPDATE campaigns SET status = coalesce($2, status), due_date = CASE WHEN $3 THEN $4::date ELSE due_date END WHERE id = $1 RETURNING id, title, rule, package, cve, due_date::text AS due_date, status',
            [
              params.campaignId,
              body.status ?? null,
              body.dueDate !== undefined,
              body.dueDate ?? null,
            ],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Campaign not found');
        return { body: await campaignJson(c, row) };
      }),
  });

  return [
    getRisk,
    enrich,
    workflow,
    accept,
    posture,
    addSbom,
    sboms,
    sbom,
    diff,
    affected,
    policies,
    addPolicy,
    changePolicy,
    dryRun,
    campaigns,
    addCampaign,
    changeCampaign,
  ];
}

/** For the release gate: an admin may ship despite violations, with a reason. */
export const mayOverride = (a: Access): boolean => atLeast(a.role, 'admin');
