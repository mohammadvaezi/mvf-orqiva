// ── [PCODE-323 | S15 | v0.1.0] T32.7b VEX statements and the security posture per version ──
//    Why:  each version answers for what it shipped. Its vulnerabilities are the open findings whose
//          package version is in its SBOM; a person says per vulnerability whether the version is affected;
//          the statements download as OpenVEX; and the posture per version counts what no statement set
//          aside, with a score like the project's.
import {
  VEX_JUSTIFICATIONS,
  VEX_STATUSES,
  openVex,
  purlOf,
  setAside,
  versionScore,
  type VexJustification,
  type VexStatus,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });

interface Vuln {
  finding_id: string;
  cve: string;
  package: string;
  version: string;
  purl: string;
  severity: string;
  risk_score: number;
  kev: boolean;
  epss: number | null;
  fixed_version: string;
  vex_status: VexStatus | null;
  justification: VexJustification | null;
  note: string | null;
  author: string | null;
  vex_at: Date | null;
}

/** A release's vulnerabilities: open findings on package versions its newest SBOM holds, with their VEX. */
async function vulnsOf(c: PoolClient, releaseId: string): Promise<Vuln[]> {
  return (
    await c.query<Vuln>(
      `WITH bom AS (
         SELECT b.project_id, b.components FROM sboms b WHERE b.release_id = $1 ORDER BY b.created_at DESC LIMIT 1),
       parts AS (
         SELECT bom.project_id, comp->>'name' AS name, comp->>'version' AS version, coalesce(comp->>'purl', '') AS purl
           FROM bom, jsonb_array_elements(bom.components) comp)
       SELECT DISTINCT ON (f.cve, parts.name) f.id AS finding_id, f.cve, parts.name AS package, parts.version, parts.purl,
              f.severity, f.risk_score, f.kev, f.epss, f.fixed_version,
              v.status AS vex_status, v.justification, v.note, u.name AS author, v.updated_at AS vex_at
         FROM parts JOIN findings f ON f.project_id = parts.project_id AND lower(f.package) = lower(parts.name)
              AND f.package_version = parts.version
         LEFT JOIN vex_statements v ON v.release_id = $1 AND v.cve = f.cve AND lower(v.package) = lower(parts.name)
         LEFT JOIN users u ON u.id = v.author_id
        WHERE f.status IN ('open', 'accepted') AND f.cve <> ''
        ORDER BY f.cve, parts.name, f.risk_score DESC`,
      [releaseId],
    )
  ).rows;
}

async function releaseOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<{ id: string; project_id: string; version: string; component: string; key: string }> {
  const r = (
    await c.query<{
      id: string;
      project_id: string;
      version: string;
      component: string;
      key: string;
    }>(
      'SELECT r.id, r.project_id, r.version, r.component, p.key FROM releases r JOIN projects p ON p.id = r.project_id WHERE r.id = $1',
      [id],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Release not found');
  await requireProject(c, a, r.project_id);
  return r;
}

const vulnOut = s.object({
  findingId: s.string(),
  cve: s.string(),
  package: s.string(),
  version: s.string(),
  purl: s.string(),
  severity: s.string(),
  riskScore: s.number({ integer: true }),
  kev: s.boolean(),
  epss: s.nullable(s.number()),
  fixedVersion: s.string(),
  vex: s.nullable(
    s.object({
      status: s.string(),
      justification: s.nullable(s.string()),
      note: s.string(),
      author: s.nullable(s.string()),
      at: s.string(),
    }),
  ),
});
const vulnJson = (v: Vuln) => ({
  findingId: v.finding_id,
  cve: v.cve,
  package: v.package,
  version: v.version,
  purl: purlOf(v.package, v.version, v.purl),
  severity: v.severity,
  riskScore: v.risk_score,
  kev: v.kev,
  epss: v.epss,
  fixedVersion: v.fixed_version,
  vex:
    v.vex_status && v.vex_at
      ? {
          status: v.vex_status,
          justification: v.justification,
          note: v.note ?? '',
          author: v.author,
          at: v.vex_at.toISOString(),
        }
      : null,
});

export function vexRoutes(pool: Pool): Route[] {
  const releaseParams = s.object({ workspaceId: uuid, releaseId: uuid });

  const versions = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/security/versions',
    summary:
      'The security posture per version: each recent release’s vulnerabilities by severity, those VEX set aside, and a score',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(
      s.object({
        releaseId: s.string(),
        version: s.string(),
        component: s.string(),
        state: s.string(),
        releasedAt: s.nullable(s.string()),
        hasSbom: s.boolean(),
        vulnerabilities: s.number({ integer: true }),
        open: s.object({
          critical: s.number({ integer: true }),
          high: s.number({ integer: true }),
          medium: s.number({ integer: true }),
          low: s.number({ integer: true }),
        }),
        exploited: s.number({ integer: true }),
        setAside: s.number({ integer: true }),
        undecided: s.number({ integer: true }),
        score: s.nullable(s.number({ integer: true })),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const releases = (
          await c.query<{
            id: string;
            version: string;
            component: string;
            state: string;
            released_at: Date | null;
            has_sbom: boolean;
          }>(
            `SELECT r.id, r.version, r.component, r.state, r.released_at,
                    EXISTS (SELECT 1 FROM sboms b WHERE b.release_id = r.id) AS has_sbom
               FROM releases r WHERE r.project_id = $1
              ORDER BY coalesce(r.released_at, r.created_at) DESC LIMIT 12`,
            [p.id],
          )
        ).rows;
        const out = [];
        for (const r of releases) {
          const vulns = r.has_sbom ? await vulnsOf(c, r.id) : [];
          const left = vulns.filter((v) => !setAside(v.vex_status));
          const sev = (k: string): number => left.filter((v) => v.severity === k).length;
          out.push({
            releaseId: r.id,
            version: r.version,
            component: r.component,
            state: r.state,
            releasedAt: r.released_at?.toISOString() ?? null,
            hasSbom: r.has_sbom,
            vulnerabilities: vulns.length,
            open: {
              critical: sev('critical'),
              high: sev('high'),
              medium: sev('medium'),
              low: sev('low'),
            },
            exploited: left.filter((v) => v.kev).length,
            setAside: vulns.length - left.length,
            undecided: vulns.filter((v) => !v.vex_status).length,
            score: r.has_sbom ? versionScore(left.map((v) => v.risk_score)) : null,
          });
        }
        return { body: out };
      }),
  });

  const vulnerabilities = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/vulnerabilities',
    summary:
      'A release’s vulnerabilities (open findings on package versions in its SBOM) with their VEX statements',
    tags: ['security'],
    params: releaseParams,
    response: s.array(vulnOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        return { body: (await vulnsOf(c, r.id)).map(vulnJson) };
      }),
  });

  const state = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/vex',
    summary:
      'Say whether the release is affected by a vulnerability of one of its packages (OpenVEX statuses and justifications) (member)',
    tags: ['security'],
    params: releaseParams,
    body: s.object({
      cve: s.string({ min: 1, max: 60 }),
      package: s.string({ min: 1, max: 200 }),
      status: s.enum(VEX_STATUSES),
      justification: s.optional(s.nullable(s.enum(VEX_JUSTIFICATIONS))),
      note: s.optional(s.string({ max: 2000 })),
    }),
    response: vulnOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        if (body.status === 'not_affected' && !body.justification)
          throw new HttpError(400, 'invalid_request', 'Say why it is not affected', [
            { path: 'body.justification', message: 'is required for not_affected' },
          ]);
        const vuln = (await vulnsOf(c, r.id)).find(
          (v) => v.cve === body.cve && v.package.toLowerCase() === body.package.toLowerCase(),
        );
        if (!vuln)
          throw new HttpError(
            404,
            'not_found',
            body.cve + ' in ' + body.package + ' is not a vulnerability of this version',
          );
        await c.query(
          `INSERT INTO vex_statements (workspace_id, project_id, release_id, cve, package, status, justification, note, author_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (release_id, cve, package) DO UPDATE SET status = $6, justification = $7, note = $8,
             author_id = $9, updated_at = now()`,
          [
            a.workspaceId,
            r.project_id,
            r.id,
            vuln.cve,
            vuln.package,
            body.status,
            body.status === 'not_affected' ? (body.justification ?? null) : null,
            body.note?.trim() ?? '',
            a.user.id,
          ],
        );
        const after = (await vulnsOf(c, r.id)).find(
          (v) => v.cve === vuln.cve && v.package === vuln.package,
        );
        if (!after) throw new Error('vulnerability vanished');
        return { body: vulnJson(after) };
      }),
  });

  const document = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/releases/:releaseId/vex',
    summary: 'The release’s VEX statements as an OpenVEX 0.2.0 document',
    tags: ['security'],
    params: releaseParams,
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await releaseOf(c, a, params.releaseId);
        const ws = (
          await c.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [
            a.workspaceId,
          ])
        ).rows[0];
        const said = (await vulnsOf(c, r.id)).filter((v) => v.vex_status && v.vex_at);
        const latest = said.reduce<Date | null>(
          (m, v) => (v.vex_at && (!m || v.vex_at > m) ? v.vex_at : m),
          null,
        );
        return {
          body: openVex({
            id: 'urn:orqiva:vex:' + r.id,
            author: ws?.name ?? 'Orqiva',
            product:
              'pkg:generic/' +
              encodeURIComponent((r.component ? r.component + '-' : '') + r.key.toLowerCase()) +
              '@' +
              encodeURIComponent(r.version),
            timestamp: (latest ?? new Date()).toISOString(),
            version: 1,
            statements: said.map((v) => ({
              cve: v.cve,
              package: v.package,
              version: v.version,
              purl: purlOf(v.package, v.version, v.purl),
              status: v.vex_status ?? 'under_investigation',
              justification: v.justification,
              note: v.note ?? '',
              at: (v.vex_at ?? new Date()).toISOString(),
            })),
          }),
          headers: {
            'content-disposition':
              'attachment; filename="' +
              r.key +
              '-' +
              r.version.replace(/[^\w.-]/g, '_') +
              '.openvex.json"',
          },
        };
      }),
  });

  return [versions, vulnerabilities, state, document];
}
