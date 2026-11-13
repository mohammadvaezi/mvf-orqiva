// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-144 | S15 | v0.1.0] Export evidence packs with one click ──
//    Why:  what an auditor asks for, in one download: a readable summary, every control with its status,
//          and the records behind them (scans and findings, test runs, gate sign-offs, proposal signatures,
//          deploys, members and roles, the activity of the period), with a manifest of SHA-256 hashes so
//          nothing can be changed unnoticed. No secret values are in it: the vault is never read here, and
//          signatures leave out addresses and browsers. The export itself is recorded in the activity log.
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { zip, type ZipEntry } from '../export/zip.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject, type Access, type ProjectRow } from './access.js';
import { complianceOf, type ComplianceJson } from './compliance.js';

const uuid = s.string({ format: 'uuid' });
const day = s.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ });

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** The controls of the enabled frameworks (all, when none is enabled) as CSV. */
export function controlsCsv(cm: ComplianceJson): string {
  const on = cm.frameworks.filter((f) => f.enabled);
  const rows = [
    [
      'framework',
      'control',
      'summary',
      'status',
      'evidence',
      'measured',
      'not applicable because',
    ].join(','),
  ];
  for (const f of on.length ? on : cm.frameworks)
    for (const c of f.controls)
      rows.push(
        [
          f.name,
          c.ref,
          c.summary,
          c.status,
          c.evidence
            .map(
              (e) =>
                e.text +
                (e.url ? ' <' + e.url + '>' : '') +
                ' (' +
                (e.addedBy ?? '') +
                ', ' +
                e.addedAt.slice(0, 10) +
                ')',
            )
            .join('; '),
          c.sources.map((x) => x.text + ': ' + x.status + ' (' + x.detail + ')').join('; '),
          c.exemption?.reason ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
  return rows.join('\r\n') + '\r\n';
}

function summaryHtml(
  p: Pick<ProjectRow, 'key' | 'name'>,
  cm: ComplianceJson,
  meta: { from: string; to: string; at: string; by: string },
  files: { path: string; bytes: number; sha256: string }[],
): string {
  const on = cm.frameworks.filter((f) => f.enabled);
  const frameworks = (on.length ? on : cm.frameworks)
    .map(
      (f) =>
        '<h2>' +
        esc(f.name) +
        ' — ' +
        String(f.met) +
        ' of ' +
        String(f.total) +
        ' controls met or not applicable</h2><table><tr><th>Control</th><th>Summary</th><th>Status</th><th>Measured</th></tr>' +
        f.controls
          .map(
            (c) =>
              '<tr><td>' +
              esc(c.ref) +
              '</td><td>' +
              esc(c.summary) +
              '</td><td class="' +
              c.status +
              '">' +
              esc(c.status) +
              '</td><td>' +
              c.sources.map((x) => esc(x.detail)).join('<br>') +
              (c.exemption ? '<br><em>Not applicable: ' + esc(c.exemption.reason) + '</em>' : '') +
              '</td></tr>',
          )
          .join('') +
        '</table>',
    )
    .join('');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence pack ' +
    esc(p.key) +
    '</title><style>body{font:14px system-ui,sans-serif;margin:2rem;max-width:72rem}table{border-collapse:collapse;width:100%;margin-bottom:2rem}' +
    'td,th{border:1px solid #ccc;padding:.4rem;text-align:left;vertical-align:top}.met,.exempt{color:#126b2e}.missing{color:#b42318}.partial{color:#8a5a00}</style></head><body>' +
    '<h1>Evidence pack: ' +
    esc(p.key + ' ' + p.name) +
    '</h1><p>Period ' +
    esc(meta.from) +
    ' to ' +
    esc(meta.to) +
    '. Made by ' +
    esc(meta.by) +
    ' at ' +
    esc(meta.at) +
    ' with Orqiva. Every control is measured from the records in this pack at that moment.</p>' +
    (on.length
      ? ''
      : '<p><strong>No framework is turned on for this project; all are shown.</strong></p>') +
    frameworks +
    '<h2>Files</h2><p>manifest.json lists every file with its SHA-256; check them with any tool (e.g. <code>sha256sum</code>).</p><table><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr>' +
    files
      .map(
        (f) =>
          '<tr><td>' +
          esc(f.path) +
          '</td><td>' +
          String(f.bytes) +
          '</td><td><code>' +
          f.sha256 +
          '</code></td></tr>',
      )
      .join('') +
    '</table></body></html>'
  );
}

/** The records of the pack, each as a JSON file. */
async function records(
  c: PoolClient,
  p: ProjectRow,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  const q = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> =>
    (await c.query<Record<string, unknown>>(sql, [p.id, from, to, ...args])).rows;
  const period = 'BETWEEN $2::date AND ($3::date + 1)';
  return {
    'evidence/security-scans.json': await q(
      `SELECT s.tool, s.full_scan, s.found, s.new_count, s.fixed_count, u.name AS started_by, s.created_at
         FROM security_scans s LEFT JOIN users u ON u.id = s.started_by WHERE s.project_id = $1 AND s.created_at ${period} ORDER BY s.created_at`,
    ),
    'evidence/findings.json': await q(
      `SELECT f.tool, f.rule, f.severity, f.title, f.message, f.file, f.line, f.status, f.reason, u.name AS decided_by, f.decided_at,
              f.first_seen_at, f.last_seen_at, f.triage
         FROM findings f LEFT JOIN users u ON u.id = f.decided_by
        WHERE f.project_id = $1 AND (f.last_seen_at ${period} OR f.status = 'open') ORDER BY f.first_seen_at`,
    ),
    'evidence/test-runs.json': await q(
      `SELECT t.name, t.source, t.status, u.name AS started_by, t.started_at, t.finished_at,
              (SELECT json_agg(json_build_object('case', tc.title, 'key', tc.key, 'status', r.status, 'at', r.at) ORDER BY r.at)
                 FROM test_results r JOIN test_cases tc ON tc.id = r.case_id WHERE r.run_id = t.id) AS results
         FROM test_runs t LEFT JOIN users u ON u.id = t.started_by WHERE t.project_id = $1 AND t.started_at ${period} ORDER BY t.started_at`,
    ),
    'evidence/gates.json': {
      signoffs: await q(
        `SELECT gate_key, decision, note, user_name, at FROM gate_signoffs WHERE project_id = $1 AND at ${period} ORDER BY at`,
      ),
      criteria: await q(
        `SELECT gate_key, criterion_key, text, met, evidence, met_at, $2::text AS _from, $3::text AS _to FROM gate_criteria WHERE project_id = $1 ORDER BY gate_key, position`,
      ),
    },
    'evidence/proposal-signatures.json': await q(
      `SELECT i.title AS idea, p2.version, s.decision, s.typed_name, s.account_name, s.account_email, s.consent_text,
              s.content_sha256, s.note, s.signed_at
         FROM proposal_signatures s JOIN ideas i ON i.id = s.idea_id JOIN proposals p2 ON p2.id = s.proposal_id
        WHERE i.project_id = $1 AND s.signed_at ${period} ORDER BY s.signed_at`,
    ),
    'evidence/deploys.json': await q(
      `SELECT e.name AS environment, d.status, d.ref, d.trigger, u.name AS requested_by, r.name AS runner, d.error,
              d.created_at, d.started_at, d.finished_at,
              (SELECT json_agg(json_build_object('step', st.name, 'status', st.status, 'exit', st.exit_code) ORDER BY st.seq)
                 FROM deploy_steps st WHERE st.run_id = d.id) AS steps
         FROM deploy_runs d JOIN environments e ON e.id = d.environment_id LEFT JOIN users u ON u.id = d.requested_by
         LEFT JOIN runners r ON r.id = d.runner_id WHERE d.project_id = $1 AND d.created_at ${period} ORDER BY d.created_at`,
    ),
    'evidence/members.json': await q(
      `SELECT u.name, u.email, m.role, m.created_at AS member_since, $2::text AS _from, $3::text AS _to
         FROM workspace_members m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = (SELECT workspace_id FROM projects WHERE id = $1) ORDER BY m.role, u.name`,
    ),
    'evidence/activity.json': (
      await q(
        `SELECT envelope FROM activity_events WHERE envelope->>'projectid' = $1::text AND time ${period} ORDER BY sequence LIMIT 5000`,
      )
    ).map((r) => r['envelope']),
  };
}

/** Removes the helper columns that only carry the period into a query. */
const clean = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(clean)
    : v && typeof v === 'object' && !(v instanceof Date)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, x]) => [k, clean(x)]),
        )
      : v;

export async function buildPack(
  c: PoolClient,
  a: Access,
  p: ProjectRow,
  from: string,
  to: string,
  now = new Date(),
): Promise<{
  name: string;
  data: Buffer;
  files: { path: string; bytes: number; sha256: string }[];
}> {
  const cm = await complianceOf(c, p.id);
  const json = (v: unknown): Buffer =>
    Buffer.from(JSON.stringify(clean(v), null, 2) + '\n', 'utf8');
  const entries: ZipEntry[] = [
    { name: 'controls.csv', data: Buffer.from(controlsCsv(cm), 'utf8') },
    { name: 'compliance.json', data: json(cm) },
    ...Object.entries(await records(c, p, from, to)).map(([name, v]) => ({ name, data: json(v) })),
  ];
  const files = entries.map((e) => ({
    path: e.name,
    bytes: e.data.length,
    sha256: sha256(e.data),
  }));
  const meta = { from, to, at: now.toISOString(), by: a.user.name };
  const manifest = json({
    project: { key: p.key, name: p.name },
    period: { from, to },
    generatedAt: meta.at,
    generatedBy: a.user.name,
    note: 'Every other file of this pack with its SHA-256. README.html is a readable copy of controls.csv.',
    files,
  });
  const readme = Buffer.from(summaryHtml(p, cm, meta, files), 'utf8');
  const all = [
    { name: 'README.html', data: readme },
    { name: 'manifest.json', data: manifest },
    ...entries,
  ];
  return {
    name: 'evidence-' + p.key + '-' + meta.at.slice(0, 10) + '.zip',
    data: zip(all, now),
    files,
  };
}

export function evidenceRoutes(pool: Pool): Route[] {
  const pack = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/evidence-pack',
    summary: 'Download the evidence pack (ZIP) of a period, default the last 90 days (member)',
    tags: ['compliance'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    query: s.object({ from: s.optional(day), to: s.optional(day) }),
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const to = query.to ?? new Date().toISOString().slice(0, 10);
        const from =
          query.from ?? new Date(Date.parse(to) - 90 * 86_400_000).toISOString().slice(0, 10);
        if (from > to)
          throw new HttpError(400, 'invalid_request', 'The period ends before it starts', [
            { path: 'query.from', message: 'is after to' },
          ]);
        const built = await buildPack(c, a, p, from, to);
        await recordEvent(
          c,
          a.workspaceId,
          {
            actor: actorOf(a),
            verb: 'updated',
            object: { type: 'project', id: p.id, label: p.key },
            changes: { evidencePack: { from: null, to: { from, to, files: built.files.length } } },
          },
          { projectId: p.id },
        );
        return {
          body: {},
          file: { data: built.data, contentType: 'application/zip', name: built.name },
        };
      }),
  });
  return [pack];
}
