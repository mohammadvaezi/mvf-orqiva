// ── [PCODE-285 | S15 | v0.1.0] T29.7 Documents import (Markdown, Notion, Confluence) and export (Markdown, HTML, PDF, ZIP) ──
//    Why:  a team brings its wiki along and takes its pages anywhere. An uploaded ZIP (or one file) is
//          read as Markdown files in folders, a Notion export (id suffixes off, a page's sub-pages under
//          it, links between pages kept) or a Confluence HTML export (pages as Markdown, nested by their
//          breadcrumbs). Images and attachments become files of their page, shown inline. A page leaves as
//          Markdown or one HTML file (images embedded); a folder or the whole wiki as a ZIP of Markdown files
//          with their files beside them.
import {
  findNode,
  htmlDocument,
  htmlToMarkdown,
  markdownToHtml,
  parseHtml,
  textOf,
} from '@orqiva/shared';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { zip } from '../export/zip.js';
import type { BlobStore } from '../files/blobstore.js';
import { zipEntries, zipRead } from '../files/docx.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, type Access, type ProjectRow } from './access.js';
import { docEvent, pageOf, storeLinks } from './documents.js';
import { textOf as fileTextOf, visibleFile } from './files.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

/** What one import may hold. */
export const IMPORT_LIMITS = { entries: 3000, pages: 600, files: 400, bytes: 150 * 1024 * 1024 };

export interface ArchiveEntry {
  path: string;
  data: Buffer;
}

export type ImportKind = 'markdown' | 'notion' | 'confluence';

const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
const mimeOf = (name: string): string =>
  MIMES[(/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream';

/** Which kind of export an archive is. */
export function importKind(paths: readonly string[], firstHtml = ''): ImportKind {
  if (paths.some((p) => /\.html?$/i.test(p)) && !paths.some((p) => /\.(md|markdown)$/i.test(p)))
    return 'confluence';
  if (/confluence/i.test(firstHtml)) return 'confluence';
  if (
    paths.some((p) =>
      NOTION_ID.test(
        p
          .replace(/\.(md|markdown)$/i, '')
          .split('/')
          .pop() ?? '',
      ),
    )
  )
    return 'notion';
  return 'markdown';
}

/** A path inside an archive, resolved from a file's folder; null when it leaves the archive. */
export function resolvePath(fromFile: string, href: string): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return null;
  let rel = href.split('#')[0]?.split('?')[0] ?? '';
  try {
    rel = decodeURIComponent(rel);
  } catch {
    // kept as written
  }
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** A page's title and body from a Markdown file: its first heading, or its name. */
export function markdownTitle(
  path: string,
  text: string,
  notion: boolean,
): { title: string; body: string } {
  const name = (path.split('/').pop() ?? path).replace(/\.(md|markdown|txt)$/i, '');
  const clean = notion ? name.replace(NOTION_ID, '') : name;
  const m = /^\s*#\s+(.+?)\s*$/m.exec(text);
  if (m && text.trimStart().startsWith('#'))
    return {
      title: (m[1] ?? clean).trim().slice(0, 200),
      body: text.replace(/^\s*#\s+.+\n?/, '').replace(/^\n+/, ''),
    };
  return { title: clean.slice(0, 200) || 'Untitled', body: text };
}

interface Planned {
  key: string;
  kind: 'page' | 'folder';
  title: string;
  parentKey: string | null;
  body: string;
  /** archive paths of files the body names */
  assets: string[];
}

/** Plans the pages of a Markdown or Notion archive. */
export function planMarkdown(
  entries: readonly ArchiveEntry[],
  notion: boolean,
): { plan: Planned[]; skipped: string[] } {
  const files = new Map(entries.map((e) => [e.path, e]));
  const pages = entries.filter((e) => /\.(md|markdown|txt)$/i.test(e.path));
  const plan = new Map<string, Planned>();
  const skipped: string[] = [];
  const pageOfDir = (dir: string): string | null => {
    // Notion keeps a page's sub-pages in a folder named like the page
    for (const ext of ['.md', '.markdown']) if (files.has(dir + ext)) return dir + ext;
    return null;
  };
  const folder = (dir: string): string | null => {
    if (!dir) return null;
    const owner = pageOfDir(dir);
    if (owner) return owner;
    if (!plan.has(dir)) {
      const parentDir = dir.split('/').slice(0, -1).join('/');
      const name = dir.split('/').pop() ?? dir;
      plan.set(dir, {
        key: dir,
        kind: 'folder',
        title: (notion ? name.replace(NOTION_ID, '') : name).slice(0, 200) || 'Folder',
        parentKey: folder(parentDir),
        body: '',
        assets: [],
      });
    }
    return dir;
  };
  // titles first, so links between pages can name them
  const titles = new Map<string, string>();
  for (const p of pages)
    titles.set(p.path, markdownTitle(p.path, p.data.toString('utf8'), notion).title);
  for (const p of pages) {
    const text = p.data.toString('utf8').replace(/\r\n/g, '\n');
    const { title, body } = markdownTitle(p.path, text, notion);
    const assets: string[] = [];
    const fixed = body.replace(
      /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (all, bang: string, label: string, href: string) => {
        const target = resolvePath(p.path, href);
        if (!target) return all;
        if (titles.has(target)) return '[[' + (titles.get(target) ?? label) + ']]';
        if (files.has(target)) {
          assets.push(target);
          return bang + '[' + label + '](asset:' + encodeURIComponent(target) + ')';
        }
        return all;
      },
    );
    const dir = p.path.split('/').slice(0, -1).join('/');
    plan.set(p.path, {
      key: p.path,
      kind: 'page',
      title,
      parentKey: folder(dir),
      body: fixed,
      assets,
    });
  }
  for (const e of entries)
    if (
      !/\.(md|markdown|txt)$/i.test(e.path) &&
      !plan.has(e.path) &&
      !pages.some((p) => p.path === e.path)
    ) {
      const used = [...plan.values()].some((x) => x.assets.includes(e.path));
      if (!used && !/(^|\/)(\.|__MACOSX)/.test(e.path)) skipped.push(e.path);
    }
  return { plan: [...plan.values()], skipped };
}

/** Plans the pages of a Confluence HTML export: titles, breadcrumbs, the main content as Markdown. */
export function planConfluence(entries: readonly ArchiveEntry[]): {
  plan: Planned[];
  skipped: string[];
} {
  const files = new Map(entries.map((e) => [e.path, e]));
  const htmls = entries.filter((e) => /\.html?$/i.test(e.path));
  const parsed = htmls.map((e) => ({ e, tree: parseHtml(e.data.toString('utf8')) }));
  const titleOf = new Map<string, string>();
  for (const { e, tree } of parsed) {
    const raw = textOf(
      findNode(tree, (n) => n.tag === 'title') ?? { tag: 'x', attrs: {}, children: [] },
    ).trim();
    titleOf.set(
      e.path,
      (raw.includes(' : ') ? raw.slice(raw.indexOf(' : ') + 3) : raw || e.path)
        .trim()
        .slice(0, 200),
    );
  }
  const plan: Planned[] = [];
  for (const { e, tree } of parsed) {
    const crumbs = findNode(
      tree,
      (n) => n.attrs['id'] === 'breadcrumbs' || n.attrs['id'] === 'breadcrumb-section',
    );
    const links: string[] = [];
    const collect = (n: typeof tree): void => {
      for (const c of n.children)
        if (typeof c !== 'string') {
          if (c.tag === 'a' && c.attrs['href']) links.push(c.attrs['href']);
          collect(c);
        }
    };
    if (crumbs) collect(crumbs);
    const parents = links
      .map((h) => resolvePath(e.path, h))
      .filter(
        (p): p is string =>
          p !== null && p !== e.path && titleOf.has(p) && !/(^|\/)index\.html?$/i.test(p),
      );
    const main =
      findNode(tree, (n) => n.attrs['id'] === 'main-content') ??
      findNode(tree, (n) => n.tag === 'body') ??
      tree;
    const assets: string[] = [];
    const body = htmlToMarkdown(main, {
      url: (href, kind) => {
        const target = resolvePath(e.path, href);
        if (!target) return null;
        if (kind === 'link' && titleOf.has(target)) return 'page:' + encodeURIComponent(target);
        if (files.has(target)) {
          assets.push(target);
          return 'asset:' + encodeURIComponent(target);
        }
        return null;
      },
    }).replace(
      /\[([^\]]*)\]\(page:([^)]+)\)/g,
      (_a, label: string, p: string) => '[[' + (titleOf.get(decodeURIComponent(p)) ?? label) + ']]',
    );
    plan.push({
      key: e.path,
      kind: 'page',
      title: titleOf.get(e.path) ?? e.path,
      parentKey: parents.at(-1) ?? null,
      body,
      assets,
    });
  }
  const used = new Set(plan.flatMap((p) => p.assets));
  const skipped = entries
    .filter(
      (e) =>
        !/\.html?$/i.test(e.path) &&
        !used.has(e.path) &&
        !/\.(css|js|gif)$/i.test(e.path) &&
        !/(^|\/)(\.|__MACOSX|styles\/|images\/icons)/.test(e.path),
    )
    .map((e) => e.path);
  return { plan, skipped };
}

/** The entries of an uploaded archive or the one file itself. */
export function archiveOf(name: string, data: Buffer): ArchiveEntry[] {
  if (!/\.zip$/i.test(name)) return [{ path: name, data }];
  let list;
  try {
    list = zipEntries(data);
  } catch {
    throw new HttpError(400, 'invalid_request', name + ' is not a ZIP archive that can be read');
  }
  if (list.length > IMPORT_LIMITS.entries)
    throw new HttpError(413, 'payload_too_large', 'The archive holds more than 3000 entries');
  const out: ArchiveEntry[] = [];
  let total = 0;
  for (const e of list) {
    if (e.name.endsWith('/')) continue;
    let bytes: Buffer;
    try {
      bytes = zipRead(data, e);
    } catch {
      throw new HttpError(
        400,
        'invalid_request',
        'The archive entry ' + e.name + ' cannot be read',
      );
    }
    total += bytes.length;
    if (total > IMPORT_LIMITS.bytes)
      throw new HttpError(413, 'payload_too_large', 'The archive unpacks to more than 150 MB');
    out.push({ path: e.name.replace(/\\/g, '/'), data: bytes });
  }
  // an archive with one top folder is read from inside it
  const tops = new Set(out.map((e) => e.path.split('/')[0]));
  if (tops.size === 1 && out.every((e) => e.path.includes('/'))) {
    const top = [...tops][0] ?? '';
    for (const e of out) e.path = e.path.slice(top.length + 1);
  }
  return out;
}

async function insertPage(
  c: PoolClient,
  a: Access,
  project: ProjectRow,
  parentId: string | null,
  kind: 'page' | 'folder',
  title: string,
  body: string,
): Promise<string> {
  const id = (
    await c.query<{ id: string }>(
      `INSERT INTO doc_pages (workspace_id, project_id, parent_id, kind, title, rank, owner_id, version, body, created_by)
       VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(rank), 0) + 1 FROM doc_pages WHERE project_id = $2 AND parent_id IS NOT DISTINCT FROM $3),
               $6, $7, $8, $6) RETURNING id`,
      [
        a.workspaceId,
        project.id,
        parentId,
        kind,
        title || 'Untitled',
        a.user.id,
        kind === 'page' ? 1 : 0,
        kind === 'page' ? body.slice(0, 500_000) : '',
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('page insert returned nothing');
  if (kind === 'page') {
    await c.query(
      'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, author_id) VALUES ($1, $2, 1, $3, $4, $5)',
      [a.workspaceId, id, title, body.slice(0, 500_000), a.user.id],
    );
    await storeLinks(c, a, { id, project_id: project.id }, body);
  }
  return id;
}

const safeName = (s: string): string =>
  s
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Untitled';
const OWN_FILE = /\/api\/workspaces\/[0-9a-f-]{36}\/files\/([0-9a-f-]{36})\/content/g;

export function docIoRoutes(pool: Pool, store: BlobStore): Route[] {
  const importRoute = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs/import',
    summary:
      'Import an uploaded ZIP or file into the wiki: Markdown files and folders, a Notion export or a Confluence HTML export, with their images (member)',
    tags: ['documents'],
    params: projectParams,
    body: s.object({
      fileId: uuid,
      parentId: s.optional(s.nullable(uuid)),
      kind: s.optional(s.enum(['auto', 'markdown', 'notion', 'confluence'])),
    }),
    response: s.object({
      kind: s.string(),
      pages: s.number({ integer: true }),
      folders: s.number({ integer: true }),
      files: s.number({ integer: true }),
      skipped: s.array(s.string()),
      firstPageId: s.nullable(s.string()),
    }),
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const f = await visibleFile(c, a, body.fileId);
        if (f.project_id && f.project_id !== project.id)
          throw new HttpError(400, 'invalid_request', 'The file belongs to another project', [
            { path: 'body.fileId', message: 'is not a file of this project' },
          ]);
        if (body.parentId) {
          const parent = await pageOf(c, a, body.parentId);
          if (parent.project_id !== project.id)
            throw new HttpError(400, 'invalid_request', 'The folder belongs to another project');
        }
        const data = await store.get(f.storage_key).catch(() => {
          throw new HttpError(410, 'gone', 'The uploaded file is no longer stored');
        });
        const entries = archiveOf(f.name, data);
        const firstHtml =
          entries.find((e) => /\.html?$/i.test(e.path))?.data.toString('utf8', 0, 4000) ?? '';
        const kind =
          !body.kind || body.kind === 'auto'
            ? importKind(
                entries.map((e) => e.path),
                firstHtml,
              )
            : body.kind;
        const { plan, skipped } =
          kind === 'confluence'
            ? planConfluence(entries)
            : planMarkdown(entries, kind === 'notion');
        if (!plan.some((p) => p.kind === 'page'))
          throw new HttpError(
            400,
            'invalid_request',
            'No pages found: the archive holds no Markdown or HTML files',
          );
        if (plan.length > IMPORT_LIMITS.pages)
          throw new HttpError(413, 'payload_too_large', 'More than 600 pages in one import');
        const byKey = new Map(plan.map((p) => [p.key, p]));
        const ids = new Map<string, string>();
        const files = new Map(entries.map((e) => [e.path, e]));
        const uploaded = new Map<string, string>();
        let fileCount = 0;
        const make = async (p: Planned, depth = 0): Promise<string> => {
          const done = ids.get(p.key);
          if (done) return done;
          if (depth > 40) throw new HttpError(400, 'invalid_request', 'The pages nest too deep');
          const parent = p.parentKey ? byKey.get(p.parentKey) : undefined;
          const parentId = parent ? await make(parent, depth + 1) : (body.parentId ?? null);
          const id = await insertPage(c, a, project, parentId, p.kind, p.title, '');
          ids.set(p.key, id);
          return id;
        };
        for (const p of plan) await make(p);
        // the files the pages name, stored once each and attached to their pages
        for (const p of plan) {
          if (p.kind !== 'page') continue;
          const pageId = ids.get(p.key) ?? '';
          let text = p.body;
          for (const path of [...new Set(p.assets)]) {
            let fileId = uploaded.get(path);
            const e = files.get(path);
            if (!fileId && e && fileCount < IMPORT_LIMITS.files) {
              const put = await store.put(e.data);
              const name = path.split('/').pop() ?? path;
              const text2 = fileTextOf(name, mimeOf(name), e.data);
              fileId = (
                await c.query<{ id: string }>(
                  `INSERT INTO files (workspace_id, project_id, name, mime, size_bytes, sha256, storage_key, text_content, text_kind, uploaded_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
                  [
                    a.workspaceId,
                    project.id,
                    name,
                    mimeOf(name),
                    e.data.length,
                    put.sha256,
                    put.key,
                    text2 ?? '',
                    text2 === null ? 'none' : 'extracted',
                    a.user.id,
                  ],
                )
              ).rows[0]?.id;
              if (fileId) {
                uploaded.set(path, fileId);
                fileCount++;
              }
            }
            if (fileId) {
              await c.query(
                'INSERT INTO doc_files (workspace_id, page_id, file_id, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                [a.workspaceId, pageId, fileId, a.user.id],
              );
              text = text
                .split('asset:' + encodeURIComponent(path))
                .join('/api/workspaces/' + a.workspaceId + '/files/' + fileId + '/content');
            }
          }
          // what could not be stored stays a plain name
          text = text.replace(
            /\(asset:([^)]+)\)/g,
            (_m, x: string) => '(' + decodeURIComponent(x) + ')',
          );
          await c.query('UPDATE doc_pages SET body = $2 WHERE id = $1', [
            pageId,
            text.slice(0, 500_000),
          ]);
          await c.query('UPDATE doc_versions SET body = $2 WHERE page_id = $1 AND version = 1', [
            pageId,
            text.slice(0, 500_000),
          ]);
          await storeLinks(c, a, { id: pageId, project_id: project.id }, text);
        }
        await docEvent(
          c,
          a,
          project,
          'created',
          plan.find((p) => p.kind === 'page')?.title ?? 'Import',
        );
        return {
          status: 201,
          body: {
            kind,
            pages: plan.filter((p) => p.kind === 'page').length,
            folders: plan.filter((p) => p.kind === 'folder').length,
            files: fileCount,
            skipped: skipped.slice(0, 50),
            firstPageId: ids.get(plan.find((p) => p.kind === 'page')?.key ?? '') ?? null,
          },
        };
      }),
  });

  /** An own file's bytes as a data URI for a standalone HTML page (up to 5 MB). */
  const dataUri = async (c: PoolClient, fileId: string): Promise<string | null> => {
    const f = (
      await c.query<{ storage_key: string; mime: string; size_bytes: string }>(
        'SELECT storage_key, mime, size_bytes FROM files WHERE id = $1 AND deleted_at IS NULL',
        [fileId],
      )
    ).rows[0];
    if (!f || Number(f.size_bytes) > 5 * 1024 * 1024 || !f.mime.startsWith('image/')) return null;
    const data = await store.get(f.storage_key).catch(() => null);
    return data ? 'data:' + f.mime + ';base64,' + data.toString('base64') : null;
  };

  const exportPage = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/export',
    summary: 'A page as a file: Markdown, or one HTML file with its images embedded',
    tags: ['documents'],
    params: s.object({ workspaceId: uuid, pageId: uuid }),
    query: s.object({ format: s.enum(['md', 'html']) }),
    response: s.object({}),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        if (p.kind !== 'page') throw new HttpError(409, 'conflict', 'A folder exports as a ZIP');
        const base = safeName(p.title);
        if (query.format === 'md')
          return {
            body: {},
            file: {
              data: Buffer.from('# ' + p.title + '\n\n' + p.body, 'utf8'),
              contentType: 'text/markdown; charset=utf-8',
              name: base + '.md',
            },
          };
        const images = new Map<string, string | null>();
        for (const m of p.body.matchAll(OWN_FILE))
          if (m[1] && !images.has(m[1])) images.set(m[1], await dataUri(c, m[1]));
        const html = htmlDocument(
          p.title,
          markdownToHtml(p.body, {
            url: (href, kind) => {
              const id = /\/files\/([0-9a-f-]{36})\/content$/.exec(href)?.[1];
              if (kind === 'image' && id) return images.get(id) ?? null;
              return href;
            },
          }),
          'Version ' +
            String(p.version) +
            ' · ' +
            p.project.key +
            ' · exported ' +
            new Date().toISOString().slice(0, 10),
        );
        return {
          body: {},
          file: {
            data: Buffer.from(html, 'utf8'),
            contentType: 'text/html; charset=utf-8',
            name: base + '.html',
          },
        };
      }),
  });

  const exportTree = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs/export',
    summary:
      'A folder, or the whole wiki, as a ZIP of Markdown files in their folders with their files',
    tags: ['documents'],
    params: projectParams,
    query: s.object({ folder: s.optional(uuid) }),
    response: s.object({}),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            id: string;
            parent_id: string | null;
            kind: string;
            title: string;
            body: string;
          }>(
            `WITH RECURSIVE under(id) AS (
               SELECT id FROM doc_pages WHERE project_id = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL AND parent_id IS NULL OR id = $2)
               UNION SELECT d.id FROM doc_pages d JOIN under u ON d.parent_id = u.id WHERE d.deleted_at IS NULL)
             SELECT d.id, d.parent_id, d.kind, d.title, d.body FROM doc_pages d WHERE d.id IN (SELECT id FROM under) ORDER BY d.rank`,
            [project.id, query.folder ?? null],
          )
        ).rows;
        if (!rows.length) throw new HttpError(404, 'not_found', 'Nothing to export');
        const byId = new Map(rows.map((r) => [r.id, r]));
        const used = new Set<string>();
        const pathOf = new Map<string, string>();
        const dir = (id: string | null): string => {
          if (
            !id ||
            !byId.has(id) ||
            (query.folder && id === query.folder && byId.get(id)?.kind === 'folder')
          )
            return '';
          const known = pathOf.get(id);
          if (known !== undefined) return known;
          const r = byId.get(id);
          const parent = dir(r?.parent_id ?? null);
          let name = (parent ? parent + '/' : '') + safeName(r?.title ?? 'Untitled');
          for (let k = 2; used.has(name.toLowerCase()); k++)
            name = (parent ? parent + '/' : '') + safeName(r?.title ?? '') + ' ' + String(k);
          used.add(name.toLowerCase());
          pathOf.set(id, name);
          return name;
        };
        const entries: { name: string; data: Buffer }[] = [];
        const fileNames = new Map<string, string>();
        for (const r of rows) {
          if (r.kind !== 'page') continue;
          const path = dir(r.id);
          const depth = path.split('/').length - 1;
          let text = '# ' + r.title + '\n\n' + r.body;
          for (const m of r.body.matchAll(OWN_FILE)) {
            const id = m[1] ?? '';
            if (!fileNames.has(id)) {
              const f = (
                await c.query<{ name: string; storage_key: string }>(
                  'SELECT name, storage_key FROM files WHERE id = $1 AND deleted_at IS NULL',
                  [id],
                )
              ).rows[0];
              const data = f ? await store.get(f.storage_key).catch(() => null) : null;
              if (!f || !data) continue;
              const short = createHash('sha256').update(id).digest('hex').slice(0, 6);
              const name = 'files/' + short + '-' + safeName(f.name);
              fileNames.set(id, name);
              entries.push({ name, data });
            }
            text = text.split(m[0]).join('../'.repeat(depth) + (fileNames.get(id) ?? ''));
          }
          entries.push({ name: path + '.md', data: Buffer.from(text, 'utf8') });
        }
        const top = query.folder
          ? safeName(byId.get(query.folder)?.title ?? 'wiki')
          : project.key.toLowerCase() + '-wiki';
        return {
          body: {},
          file: { data: zip(entries), contentType: 'application/zip', name: top + '.zip' },
        };
      }),
  });

  return [importRoute, exportPage, exportTree];
}
