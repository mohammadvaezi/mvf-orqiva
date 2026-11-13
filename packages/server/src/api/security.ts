// ── [PCODE-324 | S15 | v0.1.0] T32.8a Fix pull requests for findings: dependency upgrades and AI fixes ──
// ── [PCODE-321 | S15 | v0.1.0] T32.6 Secrets in the Git history, SARIF upload in the web app, dependency facts on findings ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-179 | S15 | v0.1.0] B4.5 Security and Code map live in the web app: posture, findings by risk, SBOM, policies, campaigns, treemap, hotspots, APIs, hygiene ──
// ── [PCODE-176 | S15 | v0.1.0] B4.2 Security and Code map on the server: risk score, workflow, SBOM, policies, campaigns, posture, code files, hotspots, API inventory ──
// ── [PCODE-139 | S15 | v0.1.0] Add security findings with SARIF import, tasks for findings and the security gate ──
// ── [PCODE-142 | S15 | v0.1.0] Show security findings in the web app with Security agent triage ──
//    Why:  scans in, findings kept. A scan (SARIF from any tool, or our own shape) upserts findings by their
//          fingerprint; a full scan marks what it no longer sees as fixed. Open high and critical findings
//          get a task each (label "security"), and G3's security criterion follows the findings: unticked
//          while any is open, ticked when none is left. That is what blocks the quality gate, and the
//          release behind it, while a serious finding is open.
import {
  blocksGate,
  readSarif,
  SEVERITIES,
  type Actor,
  type FindingIn,
  type Severity,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import {
  actorOf,
  asMember,
  requireProject,
  requireUser,
  type Access,
  type ProjectRow,
} from './access.js';
// [PCODE-142 | S15 | v0.1.0]
import { askAgent } from '../agents/oneshot.js';
import { MODE_TRIAGE } from '../agents/provider.js';
import type { ProviderFor } from '../agents/runner.js';
import { inWorkspace } from '../db/pool.js';
import { refreshFindings } from './posture.js';

const uuid = s.string({ format: 'uuid' });

export const findingOut = s.object({
  id: s.string(),
  projectId: s.string(),
  tool: s.string(),
  rule: s.string(),
  severity: s.string(),
  title: s.string(),
  message: s.string(),
  file: s.string(),
  line: s.nullable(s.number({ integer: true })),
  status: s.string(),
  reason: s.string(),
  decidedBy: s.nullable(s.string()),
  itemId: s.nullable(s.string()),
  itemRef: s.nullable(s.string()),
  firstSeenAt: s.string(),
  lastSeenAt: s.string(),
  // [PCODE-142 | S15 | v0.1.0] the Security agent's note
  triage: s.string(),
  triageRunId: s.nullable(s.string()),
  triagedAt: s.nullable(s.string()),
  // [PCODE-179 | S15 | v0.1.0] the list is ordered by risk and shows its signals
  riskScore: s.number({ integer: true }),
  workflow: s.string(),
  cve: s.string(),
  package: s.string(),
  kev: s.boolean(),
  reachable: s.nullable(s.boolean()),
  exposed: s.nullable(s.boolean()),
  slaDueAt: s.nullable(s.string()),
  acceptedUntil: s.nullable(s.string()),
  fixPrUrl: s.string(), // [PCODE-324 | S15 | v0.1.0]
});

export interface FindingRow {
  fix_pr_url?: string; // [PCODE-324 | S15 | v0.1.0]
  id: string;
  project_id: string;
  tool: string;
  rule: string;
  severity: Severity;
  title: string;
  message: string;
  file: string;
  line: number | null;
  status: string;
  reason: string;
  decided_by_name: string | null;
  item_id: string | null;
  item_ref: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  triage: string;
  triage_run_id: string | null;
  triaged_at: Date | null;
  risk_score: number;
  workflow: string;
  cve: string;
  package: string;
  kev: boolean;
  reachable: boolean | null;
  exposed: boolean | null;
  sla_due_at: Date | null;
  accepted_until_text: string | null;
}

export const FINDING_SELECT = `SELECT f.*, u.name AS decided_by_name, f.accepted_until::text AS accepted_until_text,
         CASE WHEN i.id IS NULL THEN NULL ELSE p.key || '-' || i.sequence END AS item_ref
    FROM findings f JOIN projects p ON p.id = f.project_id
    LEFT JOIN users u ON u.id = f.decided_by LEFT JOIN items i ON i.id = f.item_id`;

const SEVERITY_ORDER = `CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

export const findingJson = (r: FindingRow): Infer<typeof findingOut> => ({
  fixPrUrl: r.fix_pr_url ?? '', // [PCODE-324 | S15 | v0.1.0]
  id: r.id,
  projectId: r.project_id,
  tool: r.tool,
  rule: r.rule,
  severity: r.severity,
  title: r.title,
  message: r.message,
  file: r.file,
  line: r.line,
  status: r.status,
  reason: r.reason,
  decidedBy: r.decided_by_name,
  itemId: r.item_id,
  itemRef: r.item_ref,
  firstSeenAt: r.first_seen_at.toISOString(),
  lastSeenAt: r.last_seen_at.toISOString(),
  triage: r.triage,
  triageRunId: r.triage_run_id,
  triagedAt: r.triaged_at?.toISOString() ?? null,
  riskScore: r.risk_score,
  workflow: r.workflow,
  cve: r.cve,
  package: r.package,
  kev: r.kev,
  reachable: r.reachable,
  exposed: r.exposed,
  slaDueAt: r.sla_due_at?.toISOString() ?? null,
  acceptedUntil: r.accepted_until_text,
});

async function labelId(
  c: PoolClient,
  workspaceId: string,
  projectId: string,
  name: string,
): Promise<string> {
  const found = (
    await c.query<{ id: string }>(
      'SELECT id FROM labels WHERE project_id = $1 AND lower(name) = lower($2)',
      [projectId, name],
    )
  ).rows[0]?.id;
  if (found) return found;
  const id = (
    await c.query<{ id: string }>(
      'INSERT INTO labels (workspace_id, project_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id',
      [workspaceId, projectId, name, '#b42318'],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('label insert returned nothing');
  return id;
}

/** A task for a serious finding, in the project's first state, labelled security. */
async function taskFor(
  c: PoolClient,
  a: Access,
  p: ProjectRow,
  f: FindingIn & { id: string; tool: string },
): Promise<string> {
  const state = (
    await c.query<{ id: string }>(
      'SELECT id FROM project_states WHERE project_id = $1 ORDER BY position LIMIT 1',
      [p.id],
    )
  ).rows[0]?.id;
  const seq = (
    await c.query<{ seq: number }>(
      'UPDATE projects SET next_item_seq = next_item_seq + 1 WHERE id = $1 RETURNING next_item_seq - 1 AS seq',
      [p.id],
    )
  ).rows[0]?.seq;
  const title = ('Security (' + f.severity + '): ' + f.title).slice(0, 255);
  const description = [
    f.message,
    '',
    'Rule ' +
      f.rule +
      ' of ' +
      f.tool +
      (f.file ? ', in ' + f.file + (f.line ? ':' + String(f.line) : '') : '') +
      '.',
    'This task was made from a security finding; fixing the code closes the finding at the next full scan.',
  ].join('\n');
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO items (workspace_id, project_id, sequence, title, description, state_id, created_by, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(min(rank), 0) - 1 FROM items WHERE project_id = $2)) RETURNING id`,
      [a.workspaceId, p.id, seq, title, description, state, a.user.id],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('item insert returned nothing');
  await c.query('INSERT INTO item_labels (workspace_id, item_id, label_id) VALUES ($1, $2, $3)', [
    a.workspaceId,
    id,
    await labelId(c, a.workspaceId, p.id, 'security'),
  ]);
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb: 'created',
      object: { type: 'item', id, label: p.key + '-' + String(seq) + ' ' + title },
      parent: { type: 'project', id: p.id, label: p.key },
    },
    { projectId: p.id },
  );
  return id;
}

/** G3's security criterion follows the open serious findings, whoever ticked it. */
export async function syncSecurityGate(
  c: PoolClient,
  workspaceId: string,
  actor: Actor,
  projectId: string,
): Promise<void> {
  const open = Number(
    (
      await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM findings WHERE project_id = $1 AND status = 'open' AND severity IN ('critical', 'high')",
        [projectId],
      )
    ).rows[0]?.n ?? 0,
  );
  const r = open
    ? await c.query(
        `UPDATE gate_criteria SET met = false, met_at = NULL, met_by = NULL, evidence = $2
          WHERE project_id = $1 AND gate_key = 'g3' AND criterion_key = 'security' AND (met OR evidence <> $2)`,
        [
          projectId,
          String(open) + ' open high or critical security finding' + (open === 1 ? '' : 's'),
        ],
      )
    : await c.query(
        `UPDATE gate_criteria SET met = true, met_at = now(), met_by = NULL, evidence = $2
          WHERE project_id = $1 AND gate_key = 'g3' AND criterion_key = 'security' AND NOT met`,
        [
          projectId,
          'No open high or critical security finding (' +
            new Date().toISOString().slice(0, 16).replace('T', ' ') +
            ')',
        ],
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
      changes: { criterion: { from: open ? 'security' : null, to: open ? null : 'security' } },
    },
    { projectId },
  );
}

const findingIn = s.object({
  rule: s.string({ min: 1, max: 200 }),
  severity: s.enum([...SEVERITIES]),
  title: s.string({ min: 1, max: 300 }),
  message: s.optional(s.string({ max: 10_000 })),
  file: s.optional(s.string({ max: 500 })),
  line: s.optional(s.nullable(s.number({ integer: true, min: 1 }))),
  fingerprint: s.string({ min: 1, max: 200 }),
});

export const scanOut = s.object({
  id: s.string(),
  tool: s.string(),
  fullScan: s.boolean(),
  found: s.number({ integer: true }),
  newCount: s.number({ integer: true }),
  fixedCount: s.number({ integer: true }),
  startedBy: s.nullable(s.string()),
  createdAt: s.string(),
});

// [PCODE-142 | S15 | v0.1.0]
export const TRIAGE_PROMPT =
  MODE_TRIAGE +
  ' Triage this security finding for the team. In a few short sentences: is the severity right, how likely ' +
  'is it to be exploited here, is it perhaps a false positive (and why), and what exactly should be done to ' +
  'fix it. Do not repeat the finding back; be concrete.';

export function securityRoutes(pool: Pool, models: ProviderFor): Route[] {
  const upload = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/scans',
    summary:
      'Upload a scan: SARIF (any tool) or findings of one tool; a full scan closes what it no longer finds (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    body: s.object({
      tool: s.optional(s.string({ min: 1, max: 80 })),
      full: s.optional(s.boolean()),
      findings: s.optional(s.array(findingIn, { max: 5000 })),
      sarif: s.optional(s.anyObject()),
    }),
    response: s.array(scanOut),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const batches: { tool: string; findings: FindingIn[] }[] = body.sarif
          ? readSarif(body.sarif)
          : body.tool && body.findings
            ? [
                {
                  tool: body.tool,
                  findings: body.findings.map((f) => ({
                    ...f,
                    message: f.message ?? '',
                    file: f.file ?? '',
                    line: f.line ?? null,
                  })),
                },
              ]
            : [];
        if (!batches.length)
          throw new HttpError(400, 'invalid_request', 'Send sarif, or tool with findings', [
            { path: 'body', message: 'needs sarif or tool and findings' },
          ]);
        const scans: Infer<typeof scanOut>[] = [];
        for (const batch of batches) {
          const scanId = (
            await c.query<{ id: string }>(
              'INSERT INTO security_scans (workspace_id, project_id, tool, full_scan, found, started_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [
                a.workspaceId,
                p.id,
                batch.tool,
                body.full ?? true,
                batch.findings.length,
                a.user.id,
              ],
            )
          ).rows[0]?.id;
          if (!scanId) throw new Error('scan insert returned nothing');
          let fresh = 0;
          const seen: string[] = [];
          for (const f of batch.findings) {
            seen.push(f.fingerprint);
            const r = (
              await c.query<{ id: string; item_id: string | null; inserted: boolean }>(
                `INSERT INTO findings (workspace_id, project_id, tool, rule, severity, title, message, file, line, fingerprint, last_scan_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 ON CONFLICT (project_id, tool, fingerprint) DO UPDATE SET
                   rule = EXCLUDED.rule, severity = EXCLUDED.severity, title = EXCLUDED.title, message = EXCLUDED.message,
                   file = EXCLUDED.file, line = EXCLUDED.line, last_seen_at = now(), last_scan_id = EXCLUDED.last_scan_id,
                   status = CASE WHEN findings.status = 'fixed' THEN 'open' ELSE findings.status END
                 RETURNING id, item_id, (xmax = 0) AS inserted`,
                [
                  a.workspaceId,
                  p.id,
                  batch.tool,
                  f.rule,
                  f.severity,
                  f.title,
                  f.message,
                  f.file,
                  f.line,
                  f.fingerprint,
                  scanId,
                ],
              )
            ).rows[0];
            if (!r) continue;
            if (r.inserted) fresh += 1;
            // [PCODE-321 | S15 | v0.1.0] what a dependency finding is about, as the scan says it
            if (f.facts)
              await c.query(
                `UPDATE findings SET cve = coalesce($2, cve), package = coalesce($3, package),
                        package_version = coalesce($4, package_version), fixed_version = coalesce($5, fixed_version),
                        cvss = coalesce($6, cvss) WHERE id = $1`,
                [
                  r.id,
                  f.facts.cve?.replace(/^cve/i, 'CVE').replace(/^ghsa/i, 'GHSA') ?? null,
                  f.facts.package ?? null,
                  f.facts.version ?? null,
                  f.facts.fixedVersion ?? null,
                  f.facts.cvss ?? null,
                ],
              );
            const status = (
              await c.query<{ status: string }>('SELECT status FROM findings WHERE id = $1', [r.id])
            ).rows[0]?.status;
            if (blocksGate(f.severity) && status === 'open' && !r.item_id) {
              const item = await taskFor(c, a, p, { ...f, id: r.id, tool: batch.tool });
              await c.query('UPDATE findings SET item_id = $2 WHERE id = $1', [r.id, item]);
            }
          }
          let fixed = 0;
          if (body.full ?? true)
            fixed =
              (
                await c.query(
                  `UPDATE findings SET status = 'fixed', decided_at = now(), decided_by = NULL, reason = 'Not found by the full scan'
                    WHERE project_id = $1 AND tool = $2 AND status = 'open' AND NOT (fingerprint = ANY($3::text[]))`,
                  [p.id, batch.tool, seen],
                )
              ).rowCount ?? 0;
          await c.query(
            'UPDATE security_scans SET new_count = $2, fixed_count = $3 WHERE id = $1',
            [scanId, fresh, fixed],
          );
          await recordEvent(
            c,
            a.workspaceId,
            {
              actor: actorOf(a),
              verb: 'completed',
              object: { type: 'finding', id: scanId, label: p.key + ' ' + batch.tool + ' scan' },
              parent: { type: 'project', id: p.id, label: p.key },
              changes: {
                scan: {
                  from: null,
                  to: { tool: batch.tool, found: batch.findings.length, new: fresh, fixed },
                },
              },
            },
            { projectId: p.id },
          );
          scans.push({
            id: scanId,
            tool: batch.tool,
            fullScan: body.full ?? true,
            found: batch.findings.length,
            newCount: fresh,
            fixedCount: fixed,
            startedBy: a.user.name,
            createdAt: new Date().toISOString(),
          });
        }
        await syncSecurityGate(c, a.workspaceId, actorOf(a), p.id);
        // [PCODE-176 | S15 | v0.1.0] risk scores, SLAs, the introducing task and the workflow follow each scan
        await refreshFindings(c, p.id);
        return { status: 201, body: scans };
      }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/findings',
    summary: 'The project’s findings, most severe first (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({
      status: s.optional(s.enum(['open', 'fixed', 'accepted', 'false_positive'])),
    }),
    response: s.array(findingOut),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        // [PCODE-179 | S15 | v0.1.0] scores, SLAs and expired acceptances are current before listing
        await refreshFindings(c, p.id);
        const rows = (
          await c.query<FindingRow>(
            FINDING_SELECT +
              ' WHERE f.project_id = $1 AND ($2::text IS NULL OR f.status = $2) ORDER BY f.risk_score DESC, ' +
              SEVERITY_ORDER +
              ', f.first_seen_at DESC LIMIT 500',
            [p.id, query.status ?? null],
          )
        ).rows;
        return { body: rows.map(findingJson) };
      }),
  });

  const scans = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/scans',
    summary: 'The project’s scans, newest first (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.array(scanOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            tool: string;
            full_scan: boolean;
            found: number;
            new_count: number;
            fixed_count: number;
            started_by_name: string | null;
            created_at: Date;
          }>(
            `SELECT s.*, u.name AS started_by_name FROM security_scans s LEFT JOIN users u ON u.id = s.started_by
              WHERE s.project_id = $1 ORDER BY s.created_at DESC LIMIT 50`,
            [p.id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            id: r.id,
            tool: r.tool,
            fullScan: r.full_scan,
            found: r.found,
            newCount: r.new_count,
            fixedCount: r.fixed_count,
            startedBy: r.started_by_name,
            createdAt: r.created_at.toISOString(),
          })),
        };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/findings/:findingId',
    summary: 'One finding (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, findingId: uuid }),
    response: findingOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [params.findingId])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Finding not found');
        await requireProject(c, a, r.project_id);
        return { body: findingJson(r) };
      }),
  });

  const decide = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/findings/:findingId/decision',
    summary: 'Accept the risk, call it a false positive (with a reason), or open it again (admin)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, findingId: uuid }),
    body: s.object({
      status: s.enum(['accepted', 'false_positive', 'open']),
      reason: s.optional(s.string({ max: 2000 })),
    }),
    response: findingOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = (
          await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [params.findingId])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Finding not found');
        await requireProject(c, a, r.project_id);
        const reason = body.reason?.trim() ?? '';
        if (body.status !== 'open' && reason.length < 10)
          throw new HttpError(
            400,
            'invalid_request',
            'Say why, in a sentence: the decision is kept with the finding',
            [{ path: 'body.reason', message: 'is required (at least 10 characters)' }],
          );
        await c.query(
          'UPDATE findings SET status = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1',
          [r.id, body.status, reason, a.user.id],
        );
        const p = (
          await c.query<{ key: string }>('SELECT key FROM projects WHERE id = $1', [r.project_id])
        ).rows[0];
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'finding', id: r.id, label: (p?.key ?? '') + ' ' + r.title },
            parent: { type: 'project', id: r.project_id, label: p?.key ?? '' },
            changes: { status: { from: r.status, to: body.status } },
          },
          { projectId: r.project_id },
        );
        await syncSecurityGate(c, a.workspaceId, actorOf(a), r.project_id);
        const after = (await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [r.id]))
          .rows[0];
        if (!after) throw new Error('finding vanished');
        return { body: findingJson(after) };
      }),
  });

  // [PCODE-142 | S15 | v0.1.0] the Security agent's view, kept as a note on the finding
  const triage = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/findings/:findingId/triage',
    summary: 'The Security agent triages the finding; its note is kept with it (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, findingId: uuid }),
    response: findingOut,
    handler: async ({ params, req }) => {
      const f = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [params.findingId])
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Finding not found');
        await requireProject(c, a, r.project_id);
        return r;
      });
      const user = await requireUser(pool, req);
      const brief = [
        'Rule: ' + f.rule,
        'Severity: ' + f.severity,
        'Where: ' + (f.file ? f.file + (f.line ? ':' + String(f.line) : '') : 'not in a file'),
        'Tool: ' + f.tool,
        'Title: ' + f.title,
        '',
        f.message,
      ].join('\n');
      const asked = await askAgent(pool, models, {
        workspaceId: params.workspaceId,
        projectId: f.project_id,
        agentKey: 'security',
        requestedBy: user.id,
        instruction: 'Triage the finding ' + f.title,
        system: TRIAGE_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: brief }] }],
      });
      return inWorkspace(pool, params.workspaceId, async (c) => {
        await c.query(
          'UPDATE findings SET triage = $2, triage_run_id = $3, triaged_at = now() WHERE id = $1',
          [f.id, asked.text.slice(0, 20_000), asked.runId],
        );
        const after = (await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [f.id]))
          .rows[0];
        if (!after) throw new Error('finding vanished');
        return { body: findingJson(after) };
      });
    },
  });

  // [PCODE-179 | S15 | v0.1.0] any open finding can become a task, not only the serious ones
  const makeTask = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/findings/:findingId/task',
    summary: 'Make a task for an open finding that has none yet (member)',
    tags: ['security'],
    params: s.object({ workspaceId: uuid, findingId: uuid }),
    response: findingOut,
    status: 201,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const f = (
          await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [params.findingId])
        ).rows[0];
        if (!f) throw new HttpError(404, 'not_found', 'Finding not found');
        const p = await requireProject(c, a, f.project_id);
        if (f.item_id)
          throw new HttpError(
            409,
            'conflict',
            'The finding has a task already: ' + (f.item_ref ?? ''),
          );
        if (f.status !== 'open')
          throw new HttpError(409, 'conflict', 'Only an open finding gets a task');
        const item = await taskFor(c, a, p, {
          id: f.id,
          tool: f.tool,
          rule: f.rule,
          severity: f.severity,
          title: f.title,
          message: f.message,
          file: f.file,
          line: f.line,
          fingerprint: '',
        });
        await c.query('UPDATE findings SET item_id = $2 WHERE id = $1', [f.id, item]);
        const after = (await c.query<FindingRow>(FINDING_SELECT + ' WHERE f.id = $1', [f.id]))
          .rows[0];
        if (!after) throw new HttpError(404, 'not_found', 'Finding not found');
        return { status: 201, body: findingJson(after) };
      }),
  });

  return [upload, list, scans, get, decide, triage, makeTask];
}
