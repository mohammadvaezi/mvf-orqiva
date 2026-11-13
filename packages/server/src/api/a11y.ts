// ── [PCODE-296 | S15 | v0.1.0] T30.9 Accessibility checks: alt text, names, focus order, target size, in the code and on the page ──
//    Why:  what `orq a11y scan` finds in the code replaces the last scan; what the page audit finds on a
//          screen (sent from CI with `orq a11y report`) replaces that screen's last report. Both show in
//          the UI kit's Checks, by file and by screen.
import { A11Y_RULES } from '@orqiva/shared';
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { screenName } from './visual.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const RULES = Object.keys(A11Y_RULES) as [keyof typeof A11Y_RULES, ...(keyof typeof A11Y_RULES)[]];

const codeFinding = s.object({
  path: s.string({ min: 1, max: 500 }),
  line: s.number({ integer: true, min: 1 }),
  rule: s.enum(RULES),
  snippet: s.string({ max: 200 }),
});
const pageFinding = s.object({
  rule: s.enum(RULES),
  selector: s.string({ max: 500 }),
  message: s.string({ max: 500 }),
});

interface ReportRow {
  id: string;
  source: string;
  name: string;
  url: string;
  title: string;
  files: number;
  checked: Record<string, number>;
  findings: { rule: string }[];
  commit_sha: string;
  by: string | null;
  created_at: Date;
}

/** How many findings of each rule. */
export function countRules(findings: readonly { rule: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.rule] = (out[f.rule] ?? 0) + 1;
  return out;
}

export function a11yRoutes(pool: Pool): Route[] {
  const code = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/a11y/code',
    summary: 'Send what orq a11y scan found in the code; replaces the last scan (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      files: s.number({ integer: true, min: 0, max: 1_000_000 }),
      findings: s.array(codeFinding, { max: 5000 }),
      commit: s.optional(s.string({ max: 64 })),
    }),
    response: s.object({ findings: s.number({ integer: true }) }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        await c.query(
          `INSERT INTO a11y_reports (workspace_id, project_id, source, name, files, findings, commit_sha, created_by)
           VALUES ($1, $2, 'code', '', $3, $4, $5, $6)
           ON CONFLICT (project_id, source, name) DO UPDATE SET files = $3, findings = $4, commit_sha = $5, created_by = $6, created_at = now()`,
          [
            a.workspaceId,
            p.id,
            body.files,
            JSON.stringify(body.findings),
            body.commit ?? '',
            a.user.id,
          ],
        );
        return { status: 201, body: { findings: body.findings.length } };
      }),
  });

  const page = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/a11y/pages',
    summary:
      'Send the page audit of one screen (from orq a11y report); replaces its last report (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      name: s.string({ min: 1, max: 120 }),
      url: s.optional(s.string({ max: 2000 })),
      title: s.optional(s.string({ max: 300 })),
      checked: s.optional(
        s.object({
          targets: s.number({ integer: true, min: 0 }),
          focusable: s.number({ integer: true, min: 0 }),
          images: s.number({ integer: true, min: 0 }),
        }),
      ),
      findings: s.array(pageFinding, { max: 500 }),
      commit: s.optional(s.string({ max: 64 })),
    }),
    response: s.object({ findings: s.number({ integer: true }) }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const name = screenName(body.name);
        if (!name)
          throw new HttpError(
            400,
            'invalid_request',
            'A screen name of words, digits, - _ . / and spaces',
            [{ path: 'body.name', message: 'is not a screen name' }],
          );
        await c.query(
          `INSERT INTO a11y_reports (workspace_id, project_id, source, name, url, title, checked, findings, commit_sha, created_by)
           VALUES ($1, $2, 'page', $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (project_id, source, name) DO UPDATE SET url = $4, title = $5, checked = $6, findings = $7, commit_sha = $8,
             created_by = $9, created_at = now()`,
          [
            a.workspaceId,
            p.id,
            name,
            body.url ?? '',
            body.title ?? '',
            JSON.stringify(body.checked ?? {}),
            JSON.stringify(body.findings),
            body.commit ?? '',
            a.user.id,
          ],
        );
        return { status: 201, body: { findings: body.findings.length } };
      }),
  });

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/a11y',
    summary: 'The latest accessibility scan of the code and the latest audit of each screen',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({ code: s.nullable(s.anyObject()), pages: s.array(s.anyObject()) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<ReportRow>(
            `SELECT r.id, r.source, r.name, r.url, r.title, r.files, r.checked, r.findings, r.commit_sha, u.name AS by, r.created_at
               FROM a11y_reports r LEFT JOIN users u ON u.id = r.created_by
              WHERE r.project_id = $1 ORDER BY jsonb_array_length(r.findings) DESC, r.name`,
            [p.id],
          )
        ).rows;
        const json = (r: ReportRow) => ({
          id: r.id,
          name: r.name,
          url: r.url,
          title: r.title,
          files: r.files,
          checked: r.checked,
          counts: countRules(r.findings),
          findings: r.findings.slice(0, 2000),
          commit: r.commit_sha,
          by: r.by,
          at: r.created_at.toISOString(),
        });
        const scan = rows.find((r) => r.source === 'code');
        return {
          body: {
            code: scan ? json(scan) : null,
            pages: rows.filter((r) => r.source === 'page').map(json),
          },
        };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/a11y-reports/:id',
    summary: 'Remove a screen’s accessibility report (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (
          await c.query<{ project_id: string }>(
            'SELECT project_id FROM a11y_reports WHERE id = $1',
            [params.id],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Report not found');
        await requireProject(c, a, r.project_id);
        await c.query('DELETE FROM a11y_reports WHERE id = $1', [params.id]);
        return { body: { removed: true } };
      }),
  });

  return [code, page, list, remove];
}
