// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  the sizes of an asset (drawn in the browser) are kept with it only when their header shows the
//          image they claim to be; an asset with its sizes and its rights downloads as one ZIP. Assets the
//          team shares appear in the client portal for download, never once their rights have expired.
import { assetBase } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { zip, type ZipEntry } from '../export/zip.js';
import type { BlobStore } from '../files/blobstore.js';
import { imageSize } from '../files/imagesize.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access } from './access.js';
import { portalScope } from './portal.js';

const uuid = s.string({ format: 'uuid' });
const assetParams = s.object({ workspaceId: uuid, id: uuid });

interface AssetRow {
  id: string;
  project_id: string;
  file_id: string;
  name: string;
  kind: string;
  rights: string;
  licence: string;
  expires_on: string | null;
  expired: boolean;
  client_visible: boolean;
  mime: string;
  size_bytes: string;
  storage_key: string;
  file_name: string;
}
const ASSET = `SELECT x.id, x.project_id, x.file_id, x.name, x.kind, x.rights, x.licence, x.expires_on::text AS expires_on,
       coalesce(x.expires_on < (now() AT TIME ZONE 'Europe/Berlin')::date, false) AS expired, x.client_visible,
       f.mime, f.size_bytes, f.storage_key, f.name AS file_name
  FROM assets x JOIN files f ON f.id = x.file_id`;

interface RenditionRow {
  id: string;
  asset_id: string;
  file_id: string;
  name: string;
  preset: string;
  format: string;
  width: number;
  height: number;
  size_bytes: string;
  storage_key: string;
  created_at: Date;
}
const RENDITION = `SELECT r.id, r.asset_id, r.file_id, r.name, r.preset, r.format, r.width, r.height, f.size_bytes, f.storage_key, r.created_at
  FROM asset_renditions r JOIN files f ON f.id = r.file_id`;

const renditionOut = s.object({
  id: s.string(),
  name: s.string(),
  preset: s.string(),
  format: s.string(),
  width: s.number({ integer: true }),
  height: s.number({ integer: true }),
  sizeBytes: s.number({ integer: true }),
  url: s.string(),
});
const renditionJson = (r: RenditionRow, url: string) => ({
  id: r.id,
  name: r.name,
  preset: r.preset,
  format: r.format,
  width: r.width,
  height: r.height,
  sizeBytes: Number(r.size_bytes),
  url,
});
const teamUrl = (ws: string, fileId: string): string =>
  '/api/workspaces/' + ws + '/files/' + fileId + '/content';

async function assetOf(c: PoolClient, a: Access, id: string): Promise<AssetRow> {
  const r = (await c.query<AssetRow>(ASSET + ' WHERE x.id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Asset not found');
  try {
    await requireProject(c, a, r.project_id);
  } catch {
    throw new HttpError(404, 'not_found', 'Asset not found');
  }
  return r;
}

const renditionsOf = async (c: PoolClient, assetIds: string[]): Promise<RenditionRow[]> =>
  (
    await c.query<RenditionRow>(
      RENDITION + ' WHERE r.asset_id = ANY($1::uuid[]) ORDER BY r.asset_id, r.width DESC, r.name',
      [assetIds],
    )
  ).rows;

/** What may be done with the files, as a text inside every ZIP. */
export function rightsText(a: {
  name: string;
  licence: string;
  rights: string;
  expires_on: string | null;
}): string {
  return (
    a.name +
    '\n\nLicence: ' +
    (a.licence || 'not noted') +
    '\nWhere it may be used: ' +
    (a.rights || 'not noted') +
    (a.expires_on ? '\nThe rights end on ' + a.expires_on + '.' : '') +
    '\n'
  );
}

/** The ZIP entries of assets: per asset a folder with the original, the sizes and the rights. */
async function zipEntries(
  store: BlobStore,
  assets: AssetRow[],
  renditions: RenditionRow[],
  folders: boolean,
): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  const used = new Set<string>();
  for (const a of assets) {
    let dir = '';
    if (folders) {
      dir = assetBase(a.name);
      for (let n = 2; used.has(dir); n += 1) dir = assetBase(a.name) + '-' + String(n);
      used.add(dir);
      dir += '/';
    }
    out.push({
      name: dir + 'original/' + a.file_name.replace(/[/\\]/g, '-'),
      data: await store.get(a.storage_key),
    });
    for (const r of renditions.filter((x) => x.asset_id === a.id))
      out.push({ name: dir + r.name, data: await store.get(r.storage_key) });
    out.push({ name: dir + 'RIGHTS.txt', data: Buffer.from(rightsText(a), 'utf8') });
  }
  return out;
}

export function assetSizeRoutes(pool: Pool, store: BlobStore): Route[] {
  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/assets/:id/renditions',
    summary: 'The sizes generated from an asset',
    tags: ['uikit'],
    params: assetParams,
    response: s.array(renditionOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const x = await assetOf(c, a, params.id);
        return {
          body: (await renditionsOf(c, [x.id])).map((r) =>
            renditionJson(r, teamUrl(a.workspaceId, r.file_id)),
          ),
        };
      }),
  });

  const add = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/assets/:id/renditions',
    summary:
      'Keep a generated size of an asset: an uploaded image of the project, checked against its header (member)',
    tags: ['uikit'],
    params: assetParams,
    body: s.object({
      fileId: uuid,
      name: s.string({ min: 1, max: 200 }),
      preset: s.optional(s.string({ max: 40 })),
      width: s.number({ integer: true, min: 1, max: 20000 }),
      height: s.number({ integer: true, min: 1, max: 20000 }),
    }),
    response: renditionOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const x = await assetOf(c, a, params.id);
        const name = body.name.trim();
        if (!/^[\w@.-]+(\/[\w@.-]+)*$/.test(name) || name.includes('..'))
          throw new HttpError(400, 'invalid_request', 'A file name with folders, nothing else', [
            {
              path: 'body.name',
              message: 'may hold letters, digits, - _ . @ and / between folders',
            },
          ]);
        const f = (
          await c.query<{ id: string; project_id: string | null; storage_key: string }>(
            'SELECT id, project_id, storage_key FROM files WHERE id = $1 AND deleted_at IS NULL',
            [body.fileId],
          )
        ).rows[0];
        if (!f || f.project_id !== x.project_id)
          throw new HttpError(400, 'invalid_request', 'The file is not one of this project', [
            { path: 'body.fileId', message: 'is not a file of this project' },
          ]);
        const size = imageSize(await store.get(f.storage_key));
        if (!size)
          throw new HttpError(400, 'invalid_request', 'A size is a PNG, WebP, JPEG or GIF image', [
            { path: 'body.fileId', message: 'is not an image the server can read' },
          ]);
        if (size.width !== body.width || size.height !== body.height)
          throw new HttpError(
            400,
            'invalid_request',
            'The image is ' + String(size.width) + ' × ' + String(size.height) + ' px',
            [
              {
                path: 'body.width',
                message:
                  'does not match the image (' +
                  String(size.width) +
                  ' × ' +
                  String(size.height) +
                  ')',
              },
            ],
          );
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO asset_renditions (workspace_id, asset_id, file_id, name, preset, format, width, height, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (asset_id, name) DO UPDATE SET file_id = EXCLUDED.file_id, preset = EXCLUDED.preset, format = EXCLUDED.format,
               width = EXCLUDED.width, height = EXCLUDED.height, created_by = EXCLUDED.created_by, created_at = now()
             RETURNING id`,
            [
              a.workspaceId,
              x.id,
              f.id,
              name,
              body.preset ?? '',
              size.format,
              size.width,
              size.height,
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        const r = (await c.query<RenditionRow>(RENDITION + ' WHERE r.id = $1', [id])).rows[0];
        if (!r) throw new Error('rendition vanished');
        return { status: 201, body: renditionJson(r, teamUrl(a.workspaceId, r.file_id)) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/asset-renditions/:id',
    summary: 'Remove a generated size (member)',
    tags: ['uikit'],
    params: assetParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = (await c.query<RenditionRow>(RENDITION + ' WHERE r.id = $1', [params.id]))
          .rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Size not found');
        await assetOf(c, a, r.asset_id);
        await c.query('DELETE FROM asset_renditions WHERE id = $1', [r.id]);
        return { body: { removed: true } };
      }),
  });

  const download = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/assets/:id/zip',
    summary: 'An asset with all its sizes and its rights as a ZIP',
    tags: ['uikit'],
    params: assetParams,
    response: s.object({}),
    handler: async ({ params, req }) => {
      const { x, rs } = await asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const x = await assetOf(c, a, params.id);
        return { x, rs: await renditionsOf(c, [x.id]) };
      });
      return {
        body: {},
        file: {
          data: zip(await zipEntries(store, [x], rs, false)),
          contentType: 'application/zip',
          name: assetBase(x.name) + '.zip',
        },
      };
    },
  });

  const share = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/assets/:id/client',
    summary: 'Offer an asset in the client portal for download, or stop (member)',
    tags: ['uikit'],
    params: assetParams,
    body: s.object({ shared: s.boolean() }),
    response: s.object({ id: s.string(), clientVisible: s.boolean() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const x = await assetOf(c, a, params.id);
        if (body.shared && x.expired)
          throw new HttpError(409, 'conflict', 'The rights of this asset have expired');
        await c.query('UPDATE assets SET client_visible = $2 WHERE id = $1', [x.id, body.shared]);
        return { body: { id: x.id, clientVisible: body.shared } };
      }),
  });

  // ── the portal ──
  const q = s.object({ clientId: s.optional(uuid) });
  const portalAssets = (c: PoolClient, projectIds: string[]): Promise<AssetRow[]> =>
    c
      .query<AssetRow>(
        ASSET +
          ` WHERE x.project_id = ANY($1::uuid[]) AND x.client_visible AND f.deleted_at IS NULL
              AND NOT coalesce(x.expires_on < (now() AT TIME ZONE 'Europe/Berlin')::date, false)
            ORDER BY x.kind, x.name`,
        [projectIds],
      )
      .then((r) => r.rows);
  const portalUrl = (ws: string, assetId: string, fileId: string, qs: string): string =>
    '/api/workspaces/' + ws + '/portal/assets/' + assetId + '/files/' + fileId + qs;
  const qsOf = (clientId: string | undefined): string =>
    clientId ? '?clientId=' + encodeURIComponent(clientId) : '';

  const portalList = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/assets',
    summary: 'The assets the team offers the client for download, with their sizes and rights',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: q,
    response: s.anyObject(),
    handler: ({ params, query, req }) =>
      portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        if (ctx.shares['assets'] === false)
          throw new HttpError(403, 'forbidden', 'Assets are not shared with ' + ctx.clientName);
        const xs = await portalAssets(c, ctx.projectIds);
        const rs = await renditionsOf(
          c,
          xs.map((x) => x.id),
        );
        const qs = qsOf(query.clientId);
        const ws = params.workspaceId;
        return {
          body: {
            zipUrl: '/api/workspaces/' + ws + '/portal/assets/zip' + qs,
            assets: xs.map((x) => ({
              id: x.id,
              projectId: x.project_id,
              name: x.name,
              kind: x.kind,
              licence: x.licence,
              rights: x.rights,
              expiresOn: x.expires_on,
              mime: x.mime,
              sizeBytes: Number(x.size_bytes),
              url: portalUrl(ws, x.id, x.file_id, qs),
              zipUrl:
                '/api/workspaces/' +
                ws +
                '/portal/assets/zip' +
                qs +
                (qs ? '&' : '?') +
                'assetId=' +
                x.id,
              sizes: rs
                .filter((r) => r.asset_id === x.id)
                .map((r) => renditionJson(r, portalUrl(ws, x.id, r.file_id, qs))),
            })),
          },
        };
      }),
  });

  const portalFile = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/assets/:assetId/files/:fileId',
    summary: 'A file of a shared asset: the original or one of its sizes',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid, assetId: uuid, fileId: uuid }),
    query: q,
    response: s.object({}),
    handler: async ({ params, query, req }) => {
      const f = await portalScope(pool, req, params.workspaceId, query.clientId, async (c, ctx) => {
        if (ctx.shares['assets'] === false)
          throw new HttpError(403, 'forbidden', 'Assets are not shared with ' + ctx.clientName);
        const x = (await portalAssets(c, ctx.projectIds)).find((y) => y.id === params.assetId);
        if (!x) throw new HttpError(404, 'not_found', 'Asset not found');
        if (x.file_id === params.fileId)
          return { key: x.storage_key, mime: x.mime, name: x.file_name };
        const r = (await renditionsOf(c, [x.id])).find((y) => y.file_id === params.fileId);
        if (!r) throw new HttpError(404, 'not_found', 'File not found');
        return {
          key: r.storage_key,
          mime: r.format === 'jpeg' ? 'image/jpeg' : 'image/' + r.format,
          name: r.name.replace(/\//g, '-'),
        };
      });
      return {
        body: {},
        // the original may be an SVG: a download, never a page of ours
        file: { data: await store.get(f.key), contentType: f.mime, name: f.name },
      };
    },
  });

  const portalZip = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/assets/zip',
    summary: 'The shared assets (or one of them) with their sizes and rights as a ZIP',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ clientId: s.optional(uuid), assetId: s.optional(uuid) }),
    response: s.object({}),
    handler: async ({ params, query, req }) => {
      const got = await portalScope(
        pool,
        req,
        params.workspaceId,
        query.clientId,
        async (c, ctx) => {
          if (ctx.shares['assets'] === false)
            throw new HttpError(403, 'forbidden', 'Assets are not shared with ' + ctx.clientName);
          const xs = (await portalAssets(c, ctx.projectIds)).filter(
            (x) => !query.assetId || x.id === query.assetId,
          );
          if (!xs.length) throw new HttpError(404, 'not_found', 'No shared assets');
          return {
            xs,
            rs: await renditionsOf(
              c,
              xs.map((x) => x.id),
            ),
            client: ctx.clientName,
          };
        },
      );
      const one = query.assetId ? got.xs[0] : undefined;
      return {
        body: {},
        file: {
          data: zip(await zipEntries(store, got.xs, got.rs, !one)),
          contentType: 'application/zip',
          name: (one ? assetBase(one.name) : assetBase(got.client) + '-assets') + '.zip',
        },
      };
    },
  });

  return [list, add, remove, download, share, portalList, portalFile, portalZip];
}
