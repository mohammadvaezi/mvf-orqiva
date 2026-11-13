// ── [PCODE-289 | S15 | v0.1.0] T30.3 Brand pages: colour, type, voice, logo use, do and don't ──
//    Why:  the brand book on the server: each section's words, do and don't examples with their
//          pictures, the palette and type drawn from the tokens at the moment they are read, the logos
//          from the assets, and the whole book as one HTML file with its pictures inside.
import {
  BRAND_SECTIONS,
  brandBookHtml,
  brandPalette,
  htmlDocument,
  isBrandSection,
  typeSpecimen,
  type BrandSectionKey,
  type DesignToken,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import type { BlobStore } from '../files/blobstore.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject } from './access.js';
import { visibleFile } from './files.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const fileUrl = (ws: string, id: string): string =>
  '/api/workspaces/' + ws + '/files/' + id + '/content';

interface ExampleRow {
  id: string;
  kind: 'do' | 'dont';
  file_id: string | null;
  caption: string;
  rank: number;
}
const exampleOut = s.object({
  id: s.string(),
  kind: s.string(),
  caption: s.string(),
  imageUrl: s.nullable(s.string()),
});
const exampleJson = (ws: string, r: ExampleRow) => ({
  id: r.id,
  kind: r.kind,
  caption: r.caption,
  imageUrl: r.file_id ? fileUrl(ws, r.file_id) : null,
});

async function tokensOf(c: PoolClient, projectId: string): Promise<DesignToken[]> {
  return (
    await c.query<{
      name: string;
      type: string;
      value_light: string;
      value_dark: string;
      description: string;
      theme_values: Record<string, string>;
    }>('SELECT * FROM design_tokens WHERE project_id = $1 ORDER BY name', [projectId])
  ).rows.map((t) => ({
    name: t.name,
    type: t.type,
    valueLight: t.value_light,
    valueDark: t.value_dark,
    description: t.description,
    themes: t.theme_values,
  }));
}
const logosOf = async (c: PoolClient, projectId: string) =>
  (
    await c.query<{ id: string; name: string; file_id: string; mime: string }>(
      `SELECT a.id, a.name, a.file_id, f.mime FROM assets a JOIN files f ON f.id = a.file_id
        WHERE a.project_id = $1 AND a.kind = 'logo' AND (a.expires_on IS NULL OR a.expires_on >= current_date)
        ORDER BY a.created_at`,
      [projectId],
    )
  ).rows;

export function brandRoutes(pool: Pool, store: BlobStore): Route[] {
  const book = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/brand',
    summary:
      'The brand book: each section’s words, the palette and type from the tokens, the logos and the do and don’t examples',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({
      sections: s.array(
        s.object({
          key: s.string(),
          title: s.string(),
          hint: s.string(),
          body: s.string(),
          updatedBy: s.nullable(s.string()),
          updatedAt: s.nullable(s.string()),
        }),
      ),
      palette: s.array(s.object({ group: s.string(), colours: s.array(s.anyObject()) })),
      type: s.anyObject(),
      logos: s.array(s.object({ id: s.string(), name: s.string(), imageUrl: s.string() })),
      examples: s.array(exampleOut),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const written = new Map(
          (
            await c.query<{ section: string; body: string; by: string | null; updated_at: Date }>(
              'SELECT b.section, b.body, u.name AS by, b.updated_at FROM brand_sections b LEFT JOIN users u ON u.id = b.updated_by WHERE b.project_id = $1',
              [p.id],
            )
          ).rows.map((r) => [r.section, r]),
        );
        const tokens = await tokensOf(c, p.id);
        const examples = (
          await c.query<ExampleRow>(
            'SELECT id, kind, file_id, caption, rank FROM brand_examples WHERE project_id = $1 ORDER BY rank, created_at',
            [p.id],
          )
        ).rows;
        return {
          body: {
            sections: BRAND_SECTIONS.map((x) => {
              const w = written.get(x.key);
              return {
                key: x.key,
                title: x.title,
                hint: x.hint,
                body: w?.body ?? '',
                updatedBy: w?.by ?? null,
                updatedAt: w?.updated_at.toISOString() ?? null,
              };
            }),
            palette: brandPalette(tokens).map((g) => ({
              group: g.group,
              colours: g.colours as unknown as Record<string, unknown>[],
            })),
            type: typeSpecimen(tokens) as unknown as Record<string, unknown>,
            logos: (await logosOf(c, p.id))
              .filter((l) => l.mime.startsWith('image/'))
              .map((l) => ({
                id: l.id,
                name: l.name,
                imageUrl: fileUrl(a.workspaceId, l.file_id),
              })),
            examples: examples.map((r) => exampleJson(a.workspaceId, r)),
          },
        };
      }),
  });

  const write = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/brand/:section',
    summary: 'Write a section of the brand book in Markdown (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, projectId: uuid, section: s.string({ max: 20 }) }),
    body: s.object({ body: s.string({ max: 20000 }) }),
    response: s.object({ key: s.string(), body: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (!isBrandSection(params.section))
          throw new HttpError(404, 'not_found', 'The brand book has no such section');
        await c.query(
          `INSERT INTO brand_sections (workspace_id, project_id, section, body, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, section) DO UPDATE SET body = $4, updated_by = $5, updated_at = now()`,
          [a.workspaceId, p.id, params.section, body.body.trim(), a.user.id],
        );
        return { body: { key: params.section, body: body.body.trim() } };
      }),
  });

  const addExample = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/brand/examples',
    summary: 'Add a do or don’t example: an image of the project and a caption (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      kind: s.enum(['do', 'dont']),
      caption: s.string({ min: 1, max: 500 }),
      fileId: s.optional(uuid),
    }),
    response: exampleOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (body.fileId) {
          const f = await visibleFile(c, a, body.fileId);
          if (f.project_id !== p.id || !f.mime.startsWith('image/'))
            throw new HttpError(
              400,
              'invalid_request',
              'An example shows an image of this project',
              [{ path: 'body.fileId', message: 'is not an image of this project' }],
            );
        }
        const row = (
          await c.query<ExampleRow>(
            `INSERT INTO brand_examples (workspace_id, project_id, kind, file_id, caption, rank, created_by)
             VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(rank), 0) + 1 FROM brand_examples WHERE project_id = $2), $6)
             RETURNING id, kind, file_id, caption, rank`,
            [a.workspaceId, p.id, body.kind, body.fileId ?? null, body.caption.trim(), a.user.id],
          )
        ).rows[0];
        if (!row) throw new Error('example vanished');
        return { status: 201, body: exampleJson(a.workspaceId, row) };
      }),
  });

  const removeExample = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/brand-examples/:id',
    summary: 'Remove a do or don’t example (member)',
    tags: ['uikit'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const row = (
          await c.query<{ project_id: string }>(
            'SELECT project_id FROM brand_examples WHERE id = $1',
            [params.id],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'not_found', 'Example not found');
        await requireProject(c, a, row.project_id);
        await c.query('DELETE FROM brand_examples WHERE id = $1', [params.id]);
        return { body: { removed: true } };
      }),
  });

  /** An image file's bytes as a data address (up to 5 MB). */
  const dataUri = async (c: PoolClient, fileId: string): Promise<string | null> => {
    const f = (
      await c.query<{ storage_key: string; mime: string; size_bytes: number }>(
        'SELECT storage_key, mime, size_bytes::float8 AS size_bytes FROM files WHERE id = $1 AND deleted_at IS NULL',
        [fileId],
      )
    ).rows[0];
    if (
      !f ||
      f.size_bytes > 5 * 1024 * 1024 ||
      !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.mime)
    )
      return null;
    const data = await store.get(f.storage_key).catch(() => null);
    return data ? 'data:' + f.mime + ';base64,' + data.toString('base64') : null;
  };

  const exportBook = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/brand/export',
    summary: 'The brand book as one HTML file with its pictures inside',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({}),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const sections: Partial<Record<BrandSectionKey, string>> = {};
        for (const r of (
          await c.query<{ section: string; body: string }>(
            'SELECT section, body FROM brand_sections WHERE project_id = $1',
            [p.id],
          )
        ).rows)
          if (isBrandSection(r.section)) sections[r.section] = r.body;
        const tokens = await tokensOf(c, p.id);
        const logos = [];
        for (const l of await logosOf(c, p.id))
          logos.push({ name: l.name, src: await dataUri(c, l.file_id) });
        const examples = [];
        for (const e of (
          await c.query<ExampleRow>(
            'SELECT id, kind, file_id, caption, rank FROM brand_examples WHERE project_id = $1 ORDER BY rank, created_at',
            [p.id],
          )
        ).rows)
          examples.push({
            kind: e.kind,
            caption: e.caption,
            src: e.file_id ? await dataUri(c, e.file_id) : null,
          });
        const html = htmlDocument(
          p.name + ' brand book',
          brandBookHtml({
            project: p.key,
            sections,
            palette: brandPalette(tokens),
            type: typeSpecimen(tokens),
            logos,
            examples,
          }),
          p.key + ' · from the design tokens of ' + new Date().toISOString().slice(0, 10),
        );
        return {
          body: {},
          file: {
            data: Buffer.from(html, 'utf8'),
            contentType: 'text/html; charset=utf-8',
            name: p.key.toLowerCase() + '-brand-book.html',
          },
        };
      }),
  });

  return [book, write, addExample, removeExample, exportBook];
}
