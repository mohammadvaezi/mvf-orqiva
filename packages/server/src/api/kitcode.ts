// ── [PCODE-290 | S15 | v0.1.0] T30.4 UI kit in the code: component usage, a lint for non-token values, the agent rule ──
//    Why:  what `orq kit scan` finds in the repository lands here: each component's uses (with the files
//          that use it most), and the colours and sizes written by hand, replaced by every scan. The kit
//          rule for agents is built here from the tokens and components, for agent runs and the loop.
import { kitRule, type DesignToken } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

/** The agents whose work shapes UI get the kit rule. */
export const UI_AGENTS = new Set(['developer', 'architect', 'reviewer', 'tester']);

/** The kit rule of a project, or '' when it has no tokens and no components. */
export async function kitRuleFor(c: PoolClient, projectId: string): Promise<string> {
  const tokens = (
    await c.query<{ name: string; type: string; value_light: string }>(
      'SELECT name, type, value_light FROM design_tokens WHERE project_id = $1 ORDER BY name LIMIT 300',
      [projectId],
    )
  ).rows.map((t): DesignToken => ({
    name: t.name,
    type: t.type,
    valueLight: t.value_light,
    valueDark: '',
    description: '',
  }));
  const components = (
    await c.query<{ name: string; code_path: string; status: string }>(
      'SELECT name, code_path, status FROM ui_components WHERE project_id = $1 ORDER BY name LIMIT 200',
      [projectId],
    )
  ).rows.map((x) => ({ name: x.name, codePath: x.code_path, status: x.status }));
  return kitRule(tokens, components);
}

const findingIn = s.object({
  path: s.string({ min: 1, max: 500 }),
  line: s.number({ integer: true, min: 1 }),
  kind: s.enum(['colour', 'size']),
  value: s.string({ min: 1, max: 100 }),
  token: s.nullable(s.string({ max: 100 })),
});

export function kitCodeRoutes(pool: Pool): Route[] {
  const scan = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/kit-scan',
    summary:
      'Send what orq kit scan found: component uses and the colours and sizes written by hand; replaces the last scan (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      files: s.number({ integer: true, min: 0, max: 1_000_000 }),
      usage: s.array(
        s.object({
          name: s.string({ min: 1, max: 120 }),
          count: s.number({ integer: true, min: 0, max: 10_000_000 }),
          files: s.array(
            s.object({
              path: s.string({ min: 1, max: 500 }),
              count: s.number({ integer: true, min: 1 }),
            }),
            { max: 10 },
          ),
        }),
        { max: 2000 },
      ),
      findings: s.array(findingIn, { max: 5000 }),
    }),
    response: s.object({
      components: s.number({ integer: true }),
      findings: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        // every component of the inventory is counted: one the scan did not find is used nowhere
        const named = new Map(body.usage.map((u) => [u.name, u]));
        const comps = (
          await c.query<{ id: string; name: string }>(
            'SELECT id, name FROM ui_components WHERE project_id = $1',
            [p.id],
          )
        ).rows;
        for (const comp of comps) {
          const u = named.get(comp.name);
          await c.query(
            'UPDATE ui_components SET usage_count = $2, usage_files = $3, usage_scanned_at = now() WHERE id = $1',
            [comp.id, u?.count ?? 0, JSON.stringify(u?.files ?? [])],
          );
        }
        await c.query('DELETE FROM kit_findings WHERE project_id = $1', [p.id]);
        if (body.findings.length)
          await c.query(
            `INSERT INTO kit_findings (workspace_id, project_id, path, line, kind, value, token)
             SELECT $1, $2, f.path, f.line, f.kind, f.value, f.token
               FROM jsonb_to_recordset($3::jsonb) AS f(path text, line int, kind text, value text, token text)`,
            [a.workspaceId, p.id, JSON.stringify(body.findings)],
          );
        await c.query(
          `INSERT INTO kit_scans (project_id, workspace_id, files, findings, scanned_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id) DO UPDATE SET files = $3, findings = $4, scanned_by = $5, scanned_at = now()`,
          [p.id, a.workspaceId, body.files, body.findings.length, a.user.id],
        );
        return {
          status: 201,
          body: { components: comps.length, findings: body.findings.length },
        };
      }),
  });

  const findings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/kit-findings',
    summary:
      'The colours and sizes the last scan found written by hand, with the token of the same value, by file',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({
      scan: s.nullable(
        s.object({
          files: s.number({ integer: true }),
          findings: s.number({ integer: true }),
          by: s.nullable(s.string()),
          at: s.string(),
        }),
      ),
      withToken: s.number({ integer: true }),
      files: s.array(
        s.object({
          path: s.string(),
          findings: s.array(
            s.object({
              line: s.number({ integer: true }),
              kind: s.string(),
              value: s.string(),
              token: s.nullable(s.string()),
            }),
          ),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const run = (
          await c.query<{ files: number; findings: number; by: string | null; scanned_at: Date }>(
            'SELECT k.files, k.findings, u.name AS by, k.scanned_at FROM kit_scans k LEFT JOIN users u ON u.id = k.scanned_by WHERE k.project_id = $1',
            [p.id],
          )
        ).rows[0];
        const rows = (
          await c.query<{
            path: string;
            line: number;
            kind: string;
            value: string;
            token: string | null;
          }>(
            'SELECT path, line, kind, value, token FROM kit_findings WHERE project_id = $1 ORDER BY path, line LIMIT 2000',
            [p.id],
          )
        ).rows;
        const byFile = new Map<string, typeof rows>();
        for (const r of rows) byFile.set(r.path, [...(byFile.get(r.path) ?? []), r]);
        return {
          body: {
            scan: run
              ? {
                  files: run.files,
                  findings: run.findings,
                  by: run.by,
                  at: run.scanned_at.toISOString(),
                }
              : null,
            withToken: rows.filter((r) => r.token).length,
            files: [...byFile.entries()]
              .sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))
              .map(([path, list]) => ({
                path,
                findings: list.map((f) => ({
                  line: f.line,
                  kind: f.kind,
                  value: f.value,
                  token: f.token,
                })),
              })),
          },
        };
      }),
  });

  const rule = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/kit-rule',
    summary: 'The rule agents get when they write UI: the tokens and components to use',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({ rule: s.string() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        return { body: { rule: await kitRuleFor(c, p.id) } };
      }),
  });

  return [scan, findings, rule];
}
