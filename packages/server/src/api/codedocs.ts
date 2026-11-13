// ── [PCODE-281 | S15 | v0.1.0] T29.3 Document embeds: live task lists, designs, Gantt, repo code; README import ──
// ── [PCODE-199 | S15 | v0.1.0] T16.3 Handover pack on the server: checks, team checklist, frozen packs, PDF, client acceptance in the portal ──
// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
//    Why:  documentation that cannot fall behind, because it is built from what the server already knows
//          about the repository: the OpenAPI inventory, the code scan and the fingerprints. A rebuild
//          updates the pages in the "Built from the code" folder in place (a new version only when the
//          text changed) and drops a page whose source is gone. Pages written by hand that name repo files
//          are checked against the code scan: a file changed after the page, or gone, is drift.
import {
  isReadme,
  codePages,
  codeRefs,
  driftOf,
  type CodeEndpoint,
  type CodeFileFacts,
  type CodeMark,
  type DriftRef,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access, type ProjectRow } from './access.js';
import { docEvent, storeLinks } from './documents.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
export const CODE_FOLDER = 'Built from the code';

/** What the server knows about the project's code, as the page builders take it. */
export async function codeFacts(
  c: PoolClient,
  projectId: string,
): Promise<{ endpoints: CodeEndpoint[]; files: CodeFileFacts[]; marks: CodeMark[] }> {
  const endpoints = (
    await c.query<CodeEndpoint>(
      `SELECT e.kind, e.method, e.path, e.summary, e.auth, e.tag, p.key || '-' || i.sequence AS ref
         FROM api_endpoints e LEFT JOIN items i ON i.id = e.item_id LEFT JOIN projects p ON p.id = i.project_id
        WHERE e.project_id = $1`,
      [projectId],
    )
  ).rows;
  const files = (
    await c.query<CodeFileFacts>(
      `SELECT path, language, lines, complexity, churn, authors, agent_share AS "agentShare"
         FROM code_files WHERE project_id = $1`,
      [projectId],
    )
  ).rows;
  const marks = (
    await c.query<CodeMark>(
      `SELECT p.key || '-' || i.sequence AS ref, i.title, f.sprint_code AS sprint, f.path, f.line, f.kind
         FROM item_fingerprints f JOIN items i ON i.id = f.item_id JOIN projects p ON p.id = i.project_id
        WHERE f.project_id = $1`,
      [projectId],
    )
  ).rows;
  return { endpoints, files, marks };
}

/** Rebuilds the "Built from the code" folder; returns what changed. */
export async function rebuildCodeDocs(
  c: PoolClient,
  a: Access,
  project: ProjectRow,
): Promise<{ created: number; updated: number; unchanged: number; removed: number }> {
  // [PCODE-281 | S15 | v0.1.0] the README files the last scan sent become pages too
  const readmes = (
    await c.query<{ path: string; text: string }>(
      'SELECT path, text FROM code_texts WHERE project_id = $1 ORDER BY path',
      [project.id],
    )
  ).rows.filter((r) => isReadme(r.path));
  const pages = [
    ...codePages(await codeFacts(c, project.id)),
    ...readmes.map((r) => {
      const dir = r.path.split('/').slice(0, -1).join('/');
      return {
        // a key holds at most 80 characters: a deep path keeps its end
        key: 'readme:' + r.path.slice(-73),
        title: (dir ? 'README: ' + dir : 'README').slice(0, 200),
        body: r.text.replace(/\r\n/g, '\n').trim() + '\n',
        from: r.path,
      };
    }),
  ];
  const existing = new Map(
    (
      await c.query<{
        id: string;
        generated_key: string;
        title: string;
        body: string;
        version: number;
      }>(
        `SELECT id, generated_key, title, body, version FROM doc_pages
          WHERE project_id = $1 AND generated_key IS NOT NULL AND deleted_at IS NULL FOR UPDATE`,
        [project.id],
      )
    ).rows.map((r) => [r.generated_key, r]),
  );
  let folder = existing.get('folder')?.id;
  if (!folder && pages.length) {
    folder = (
      await c.query<{ id: string }>(
        `INSERT INTO doc_pages (workspace_id, project_id, kind, title, rank, status, generated_key, generated_from, created_by)
         VALUES ($1, $2, 'folder', $3, (SELECT coalesce(max(rank), 0) + 1 FROM doc_pages WHERE project_id = $2 AND parent_id IS NULL),
                 'published', 'folder', 'the code', $4) RETURNING id`,
        [a.workspaceId, project.id, CODE_FOLDER, a.user.id],
      )
    ).rows[0]?.id;
  }
  const out = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  for (const [rank, page] of pages.entries()) {
    const old = existing.get(page.key);
    if (!old) {
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO doc_pages (workspace_id, project_id, parent_id, kind, title, rank, status, generated_key, generated_from, version, body, tags, created_by)
           VALUES ($1, $2, $3, 'page', $4, $5, 'published', $6, $7, 1, $8, '{from-code}', $9) RETURNING id`,
          [
            a.workspaceId,
            project.id,
            folder,
            page.title,
            rank + 1,
            page.key,
            page.from,
            page.body,
            a.user.id,
          ],
        )
      ).rows[0]?.id;
      if (!id) throw new Error('page insert returned nothing');
      await c.query(
        `INSERT INTO doc_versions (workspace_id, page_id, version, title, body, name, author_id) VALUES ($1, $2, 1, $3, $4, 'Built from the code', $5)`,
        [a.workspaceId, id, page.title, page.body, a.user.id],
      );
      await storeLinks(c, a, { id, project_id: project.id }, page.body);
      await docEvent(c, a, project, 'created', page.title);
      out.created++;
      continue;
    }
    await c.query(
      'UPDATE doc_pages SET parent_id = $2, rank = $3, generated_from = $4 WHERE id = $1',
      [old.id, folder, rank + 1, page.from],
    );
    if (old.title === page.title && old.body === page.body) {
      out.unchanged++;
      continue;
    }
    const v = old.version + 1;
    await c.query(
      'UPDATE doc_pages SET title = $2, body = $3, version = $4, updated_at = now() WHERE id = $1',
      [old.id, page.title, page.body, v],
    );
    await c.query(
      `INSERT INTO doc_versions (workspace_id, page_id, version, title, body, name, author_id) VALUES ($1, $2, $3, $4, $5, 'Rebuilt from the code', $6)`,
      [a.workspaceId, old.id, v, page.title, page.body, a.user.id],
    );
    await storeLinks(c, a, { id: old.id, project_id: project.id }, page.body);
    await docEvent(c, a, project, 'updated', page.title);
    out.updated++;
  }
  const keep = new Set(pages.map((p) => p.key));
  for (const [key, old] of existing) {
    if (key === 'folder' || keep.has(key)) continue;
    await c.query('UPDATE doc_pages SET deleted_at = now() WHERE id = $1', [old.id]);
    await docEvent(c, a, project, 'deleted', old.title);
    out.removed++;
  }
  return out;
}

// ── [PCODE-199 | S15 | v0.1.0] the pages that disagree with the code, for the drift route and the handover checks ──
export async function driftPages(
  c: PoolClient,
  projectId: string,
): Promise<{ pageId: string; title: string; ownerName: string | null; refs: DriftRef[] }[]> {
  const files = new Map(
    (
      await c.query<{ path: string; last_commit_at: Date | null }>(
        'SELECT path, last_commit_at FROM code_files WHERE project_id = $1',
        [projectId],
      )
    ).rows.map((f) => [f.path, f.last_commit_at]),
  );
  const pages = (
    await c.query<{
      id: string;
      title: string;
      owner_name: string | null;
      body: string;
      written: Date;
    }>(
      `SELECT d.id, d.title, o.name AS owner_name, d.body, greatest(d.updated_at, d.approved_at) AS written
         FROM doc_pages d LEFT JOIN users o ON o.id = d.owner_id
        WHERE d.project_id = $1 AND d.kind = 'page' AND d.generated_key IS NULL AND d.deleted_at IS NULL
        ORDER BY d.title`,
      [projectId],
    )
  ).rows;
  return pages
    .map((p) => ({
      pageId: p.id,
      title: p.title,
      ownerName: p.owner_name,
      refs: driftOf(codeRefs(p.body), p.written, files),
    }))
    .filter((p) => p.refs.length > 0);
}

const driftRef = s.object({
  path: s.string(),
  line: s.nullable(s.number({ integer: true })),
  state: s.enum(['changed', 'gone']),
  changedAt: s.nullable(s.string()),
});

export function codeDocRoutes(pool: Pool): Route[] {
  const rebuild = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs/from-code',
    summary:
      'Rebuild the pages built from the code: API reference, system overview, built by task (member)',
    tags: ['documents'],
    params: projectParams,
    response: s.object({
      created: s.number({ integer: true }),
      updated: s.number({ integer: true }),
      unchanged: s.number({ integer: true }),
      removed: s.number({ integer: true }),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        return { body: await rebuildCodeDocs(c, a, project) };
      }),
  });

  const drift = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs/drift',
    summary:
      'Pages written by hand that disagree with the code: a file they name changed after them, or is gone',
    tags: ['documents'],
    params: projectParams,
    response: s.array(
      s.object({
        pageId: s.string(),
        title: s.string(),
        ownerName: s.nullable(s.string()),
        refs: s.array(driftRef),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return { body: await driftPages(c, params.projectId) };
      }),
  });

  return [rebuild, drift];
}
