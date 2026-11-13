// ── [PCODE-284 | S15 | v0.1.0] T29.6 Documents: tree drag and drop, files, image annotation, read analytics, per-task knowledge, checked citations ──
// ── [PCODE-283 | S15 | v0.1.0] T29.5 Documents: named versions in the screen, visual diff, mentions in comments, page search and Cmd-K ──
// ── [PCODE-249 | S15 | v0.1.0] T25.4 Alerts and reminders: budgets, anomalies, doc watchers, stale flags and ideas ──
// ── [PCODE-197 | S15 | v0.1.0] T16.1 Docs from code: API reference, system overview and built-by-task pages, drift warnings ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-186 | S15 | v0.1.0] B7.2 Client portal live: roadmap, acceptance tests, approvals, releases with ratings, shared documents ──
// ── [PCODE-183 | S15 | v0.1.0] B6.1 Activity at scale live: search, query language, facets, histogram, saved views, export, archive, hash chain, webhooks ──
// ── [PCODE-169 | S15 | v0.1.0] B3.2 Documents and UI kit on the server: page tree, versions, comments, backlinks, templates, knowledge, tokens, components, mockups, assets ──
//    Why:  the project's wiki and the agents' knowledge. Pages and folders form a tree; every save is a
//          version, refused when it was written on an older version (two people never overwrite each
//          other silently) or while someone else holds the lock; history, diff, restore and named versions
//          follow. Comments sit on a passage. Links between pages give backlinks, web links get checked.
//          Owners and review dates mark stale pages; a page an agent wrote stays marked until a person
//          approves it. Per agent, the team decides which pages and tags it may read, and every read is kept.
import { DOC_TEMPLATES, lineDiff, mentionsIn, pageLinks, type Mentionable } from '@orqiva/shared';
import { noticeNow, PUSH_SUBJECT, type PushDeps } from '../push/dispatch.js'; // [PCODE-283 | S15 | v0.1.0]
import { lookup } from 'node:dns/promises';
import type { Pool, PoolClient } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s, type Infer } from '../http/schema.js';
import {
  actorOf,
  asMember,
  atLeast,
  requireProject,
  type Access,
  type ProjectRow,
} from './access.js';

const uuid = s.string({ format: 'uuid' });
const day = s.string({ min: 10, max: 10 });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });
const pageParams = s.object({ workspaceId: uuid, pageId: uuid });
const tag = s.string({ min: 1, max: 60 });

interface PageRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  rank: number;
  template: string;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  review_by: string | null;
  agent_written: boolean;
  approved_by_name: string | null;
  approved_at: Date | null;
  generated_from: string;
  locked_by: string | null;
  locked_by_name: string | null;
  tags: string[];
  version: number;
  body: string;
  updated_at: Date;
  open_comments: string;
  backlinks: string;
  stale: boolean;
  client_visible: boolean; // [PCODE-186 | S15 | v0.1.0]
  files?: { id: string; name: string; mime: string }[]; // [PCODE-284 | S15 | v0.1.0]
  generated_key: string | null; // [PCODE-197 | S15 | v0.1.0] built from the code
}

const PAGE_SELECT = `SELECT d.id, d.project_id, d.parent_id, d.kind, d.title, d.rank, d.template, d.status, d.owner_id,
       o.name AS owner_name, d.review_by::text AS review_by, d.agent_written, a.name AS approved_by_name, d.approved_at,
       d.generated_from, d.locked_by, l.name AS locked_by_name, d.tags, d.version, d.body, d.updated_at, d.client_visible, d.generated_key,
       (SELECT count(*) FROM doc_comments c WHERE c.page_id = d.id AND NOT c.resolved) AS open_comments,
       (SELECT count(DISTINCT x.page_id) FROM doc_links x JOIN doc_pages y ON y.id = x.page_id AND y.deleted_at IS NULL WHERE x.to_page_id = d.id) AS backlinks,
       coalesce(d.review_by < (now() AT TIME ZONE 'Europe/Berlin')::date, false) AS stale,
       (SELECT coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime) ORDER BY df.created_at), '[]')
          FROM doc_files df JOIN files f ON f.id = df.file_id AND f.deleted_at IS NULL WHERE df.page_id = d.id) AS files
  FROM doc_pages d LEFT JOIN users o ON o.id = d.owner_id LEFT JOIN users a ON a.id = d.approved_by
  LEFT JOIN users l ON l.id = d.locked_by`;

const nodeOut = s.object({
  id: s.string(),
  parentId: s.nullable(s.string()),
  kind: s.string(),
  title: s.string(),
  rank: s.number(),
  template: s.string(),
  status: s.string(),
  ownerId: s.nullable(s.string()),
  ownerName: s.nullable(s.string()),
  reviewBy: s.nullable(s.string()),
  stale: s.boolean(),
  agentWritten: s.boolean(),
  approvedBy: s.nullable(s.string()),
  approvedAt: s.nullable(s.string()),
  needsApproval: s.boolean(),
  generatedFrom: s.string(),
  lockedBy: s.nullable(s.string()),
  lockedByName: s.nullable(s.string()),
  tags: s.array(s.string()),
  version: s.number({ integer: true }),
  openComments: s.number({ integer: true }),
  backlinks: s.number({ integer: true }),
  updatedAt: s.string(),
  clientVisible: s.boolean(), // [PCODE-186 | S15 | v0.1.0] shared with the project's client
  // [PCODE-284 | S15 | v0.1.0] the files attached to the page
  files: s.array(s.object({ id: s.string(), name: s.string(), mime: s.string() })),
});
const nodeJson = (r: PageRow): Infer<typeof nodeOut> => ({
  id: r.id,
  parentId: r.parent_id,
  kind: r.kind,
  title: r.title,
  rank: r.rank,
  template: r.template,
  status: r.status,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  reviewBy: r.review_by,
  stale: r.stale,
  agentWritten: r.agent_written,
  approvedBy: r.approved_by_name,
  approvedAt: r.approved_at?.toISOString() ?? null,
  needsApproval: r.agent_written && !r.approved_at,
  clientVisible: r.client_visible, // [PCODE-186 | S15 | v0.1.0]
  files: r.files ?? [],
  generatedFrom: r.generated_from,
  lockedBy: r.locked_by,
  lockedByName: r.locked_by_name,
  tags: r.tags,
  version: r.version,
  openComments: Number(r.open_comments),
  backlinks: Number(r.backlinks),
  updatedAt: r.updated_at.toISOString(),
});

const pageOut = s.object({
  page: nodeOut,
  body: s.string(),
  backlinks: s.array(s.object({ id: s.string(), title: s.string() })),
  links: s.array(
    s.object({
      toPageId: s.nullable(s.string()),
      title: s.nullable(s.string()),
      url: s.string(),
      httpStatus: s.nullable(s.number({ integer: true })),
      checkedAt: s.nullable(s.string()),
    }),
  ),
  watching: s.boolean(),
  watchers: s.number({ integer: true }),
});

// ── [PCODE-197 | S15 | v0.1.0] a page built from the code is changed in the code, then rebuilt ──
export function refuseGenerated(p: { generated_key: string | null }): void {
  if (p.generated_key)
    throw new HttpError(
      409,
      'conflict',
      'This page is built from the code: change the code (or its OpenAPI document), then rebuild',
    );
}

export async function pageOf(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<PageRow & { project: ProjectRow }> {
  const r = (
    await c.query<PageRow>(PAGE_SELECT + ' WHERE d.id = $1 AND d.deleted_at IS NULL', [id])
  ).rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'Page not found');
  try {
    return { ...r, project: await requireProject(c, a, r.project_id) };
  } catch {
    throw new HttpError(404, 'not_found', 'Page not found');
  }
}

export async function fullPage(
  c: PoolClient,
  a: Access,
  id: string,
): Promise<Infer<typeof pageOut>> {
  const p = await pageOf(c, a, id);
  const backlinks = (
    await c.query<{ id: string; title: string }>(
      `SELECT DISTINCT y.id, y.title FROM doc_links x JOIN doc_pages y ON y.id = x.page_id AND y.deleted_at IS NULL
        WHERE x.to_page_id = $1 ORDER BY y.title`,
      [p.id],
    )
  ).rows;
  const links = (
    await c.query<{
      to_page_id: string | null;
      title: string | null;
      url: string;
      http_status: number | null;
      checked_at: Date | null;
    }>(
      `SELECT x.to_page_id, y.title, x.url, x.http_status, x.checked_at FROM doc_links x LEFT JOIN doc_pages y ON y.id = x.to_page_id
        WHERE x.page_id = $1 ORDER BY x.url, y.title`,
      [p.id],
    )
  ).rows;
  const w = (
    await c.query<{ n: string; me: boolean }>(
      'SELECT count(*) AS n, bool_or(user_id = $2) AS me FROM doc_watchers WHERE page_id = $1',
      [p.id, a.user.id],
    )
  ).rows[0];
  return {
    page: nodeJson(p),
    body: p.body,
    backlinks,
    links: links.map((l) => ({
      toPageId: l.to_page_id,
      title: l.title,
      url: l.url,
      httpStatus: l.http_status,
      checkedAt: l.checked_at?.toISOString() ?? null,
    })),
    watching: w?.me ?? false,
    watchers: Number(w?.n ?? 0),
  };
}

/** The links of a saved body: to pages of the same project (by id or title) and to the web. */
export async function storeLinks(
  c: PoolClient,
  a: Access,
  page: { id: string; project_id: string },
  body: string,
): Promise<void> {
  const found = pageLinks(body);
  const byTitle = found.titles.length
    ? (
        await c.query<{ id: string }>(
          'SELECT id FROM doc_pages WHERE project_id = $1 AND deleted_at IS NULL AND lower(title) = ANY($2::text[])',
          [page.project_id, found.titles.map((t) => t.toLowerCase())],
        )
      ).rows.map((r) => r.id)
    : [];
  const byId = found.pageIds.length
    ? (
        await c.query<{ id: string }>(
          'SELECT id FROM doc_pages WHERE project_id = $1 AND id = ANY($2::uuid[])',
          [page.project_id, found.pageIds],
        )
      ).rows.map((r) => r.id)
    : [];
  const keep = (
    await c.query<{ url: string; http_status: number | null; checked_at: Date | null }>(
      "SELECT url, http_status, checked_at FROM doc_links WHERE page_id = $1 AND url <> ''",
      [page.id],
    )
  ).rows;
  await c.query('DELETE FROM doc_links WHERE page_id = $1', [page.id]);
  for (const to of new Set([...byId, ...byTitle]))
    if (to !== page.id)
      await c.query(
        'INSERT INTO doc_links (workspace_id, page_id, to_page_id) VALUES ($1, $2, $3)',
        [a.workspaceId, page.id, to],
      );
  for (const url of found.urls.slice(0, 200)) {
    const old = keep.find((k) => k.url === url);
    await c.query(
      'INSERT INTO doc_links (workspace_id, page_id, url, http_status, checked_at) VALUES ($1, $2, $3, $4, $5)',
      [
        a.workspaceId,
        page.id,
        url.slice(0, 2000),
        old?.http_status ?? null,
        old?.checked_at ?? null,
      ],
    );
  }
}

export async function docEvent(
  c: PoolClient,
  a: Access,
  project: ProjectRow,
  verb: 'created' | 'updated' | 'deleted',
  title: string,
): Promise<void> {
  await recordEvent(
    c,
    a.workspaceId,
    {
      actor: actorOf(a),
      verb,
      object: { type: 'project', id: project.id, label: project.key },
      changes: {
        page: { from: verb === 'created' ? null : title, to: verb === 'deleted' ? null : title },
      },
    },
    { projectId: project.id },
  );
}

/**
 * [PCODE-249 | S15 | v0.1.0] Tells the page's watchers, other than the person who did it, what changed: the change waits
 * with the others until the page is quiet for a moment, then they hear of all of them at once.
 */
export async function queueWatchers(
  c: PoolClient,
  a: Access,
  pageId: string,
  what: string,
): Promise<void> {
  await c.query(
    `INSERT INTO doc_watch_pending (workspace_id, page_id, user_id, changes)
     SELECT $1, w.page_id, w.user_id, jsonb_build_array(jsonb_build_object('who', $4::text, 'what', $5::text))
       FROM doc_watchers w WHERE w.page_id = $2 AND w.user_id <> $3
     ON CONFLICT (page_id, user_id) DO UPDATE SET
       changes = CASE WHEN jsonb_array_length(doc_watch_pending.changes) >= 20 THEN doc_watch_pending.changes
                      ELSE doc_watch_pending.changes || EXCLUDED.changes END,
       last_at = now()`,
    [a.workspaceId, pageId, a.user.id, a.user.name, what],
  );
}

/** Pages an agent may read in a project: the pages under each scoped page, and pages with a scoped tag. */
export async function readablePages(
  c: PoolClient,
  projectId: string,
  agentKey: string,
  itemId: string | null = null, // [PCODE-284 | S15 | v0.1.0] the task the agent works on
): Promise<{ id: string; title: string; version: number; body: string }[]> {
  return (
    await c.query<{ id: string; title: string; version: number; body: string }>(
      `WITH RECURSIVE scoped(id) AS (
         SELECT page_id FROM knowledge_scopes WHERE project_id = $1 AND agent_key = $2 AND page_id IS NOT NULL
         UNION SELECT page_id FROM item_knowledge WHERE item_id = $3
         UNION SELECT d.id FROM doc_pages d JOIN scoped s ON d.parent_id = s.id)
       SELECT d.id, d.title, d.version, d.body FROM doc_pages d
        WHERE d.project_id = $1 AND d.deleted_at IS NULL AND d.kind = 'page'
          AND (d.id IN (SELECT id FROM scoped)
               OR d.tags && (SELECT coalesce(array_agg(tag), '{}') FROM knowledge_scopes WHERE project_id = $1 AND agent_key = $2 AND tag <> ''))
        ORDER BY d.title`,
      [projectId, agentKey, itemId],
    )
  ).rows;
}

/** Notes what an agent read and cited, for the page's read log. */
export async function recordRead(
  c: PoolClient,
  workspaceId: string,
  read: {
    projectId: string;
    agentKey: string;
    runId: string | null;
    pageId: string;
    version: number;
    passage: string;
    citedOk?: boolean | null; // [PCODE-284 | S15 | v0.1.0] whether the cited passage is on the page
  },
): Promise<void> {
  await c.query(
    'INSERT INTO knowledge_reads (workspace_id, project_id, agent_key, agent_run_id, page_id, version, passage, cited_ok) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      workspaceId,
      read.projectId,
      read.agentKey,
      read.runId,
      read.pageId,
      read.version,
      read.passage.slice(0, 2000),
      read.citedOk ?? null,
    ],
  );
}

/** [PCODE-284 | S15 | v0.1.0] Whether a cited passage is on the page, spaces and line breaks aside. */
export function citedOn(body: string, passage: string): boolean {
  const flat = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const p = flat(passage);
  return p.length > 0 && flat(body).includes(p);
}

export interface LinkCheckDeps {
  /** [PCODE-283 | S15 | v0.1.0] mentions in comments are pushed like other notices */
  push?: PushDeps;
  fetchImpl?: typeof fetch;
  /** tests check links to the test server itself; real installs never reach private addresses */
  allowPrivate?: boolean;
}

/** Loopback, private, link-local and unique-local addresses are not checked: no probing of the inside. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.replace(/^::ffff:/i, ''));
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const x = ip.toLowerCase();
  return (
    x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80')
  );
}

// [PCODE-183 | S15 | v0.1.0] webhooks reach public addresses only, like link checks
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
    const all = await lookup(host, { all: true });
    return all.length > 0 && all.every((x) => !isPrivateAddress(x.address));
  } catch {
    return false;
  }
}

export function documentRoutes(pool: Pool, deps: LinkCheckDeps = {}): Route[] {
  const tree = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs',
    summary:
      'The project’s page tree (without bodies), with status, owners, stale and approval marks',
    tags: ['documents'],
    params: projectParams,
    response: s.array(nodeOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<PageRow>(
            PAGE_SELECT +
              ' WHERE d.project_id = $1 AND d.deleted_at IS NULL ORDER BY d.parent_id NULLS FIRST, d.rank, d.title',
            [params.projectId],
          )
        ).rows;
        return { body: rows.map(nodeJson) };
      }),
  });

  const templates = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/doc-templates',
    summary: 'The page templates: ADR, RFC, runbook, postmortem, meeting notes, API doc',
    tags: ['documents'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(s.object({ key: s.string(), title: s.string(), body: s.string() })),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', () =>
        Promise.resolve({ body: [...DOC_TEMPLATES] }),
      ),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs',
    summary:
      'Create a page or a folder, from a template or empty, at the end of its parent (member)',
    tags: ['documents'],
    params: projectParams,
    body: s.object({
      title: s.string({ min: 1, max: 200 }),
      kind: s.optional(s.enum(['page', 'folder'])),
      parentId: s.optional(s.nullable(uuid)),
      template: s.optional(s.string({ max: 40 })),
      body: s.optional(s.string({ max: 500_000 })),
      tags: s.optional(s.array(tag, { max: 20 })),
    }),
    response: pageOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const project = await requireProject(c, a, params.projectId);
        if (body.parentId) {
          const parent = await pageOf(c, a, body.parentId);
          if (parent.project_id !== project.id)
            throw new HttpError(400, 'invalid_request', 'The parent belongs to another project', [
              { path: 'body.parentId', message: 'is not a page of this project' },
            ]);
        }
        const tpl = body.template ? DOC_TEMPLATES.find((t) => t.key === body.template) : undefined;
        if (body.template && !tpl)
          throw new HttpError(400, 'invalid_request', 'Unknown template', [
            {
              path: 'body.template',
              message: 'is not one of ' + DOC_TEMPLATES.map((t) => t.key).join(', '),
            },
          ]);
        const kind = body.kind ?? 'page';
        const title =
          (tpl && !body.title.startsWith(tpl.title.trim()) ? tpl.title : '') + body.title.trim();
        const text = kind === 'folder' ? '' : (body.body ?? tpl?.body ?? '');
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO doc_pages (workspace_id, project_id, parent_id, kind, title, rank, template, owner_id, tags, version, body, created_by)
             VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(rank), 0) + 1 FROM doc_pages WHERE project_id = $2 AND parent_id IS NOT DISTINCT FROM $3),
                     $6, $7, $8, $9, $10, $7) RETURNING id`,
            [
              a.workspaceId,
              project.id,
              body.parentId ?? null,
              kind,
              title,
              tpl?.key ?? '',
              a.user.id,
              body.tags ?? [],
              kind === 'page' ? 1 : 0,
              text,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('page insert returned nothing');
        if (kind === 'page') {
          await c.query(
            'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, author_id) VALUES ($1, $2, 1, $3, $4, $5)',
            [a.workspaceId, id, title, text, a.user.id],
          );
          await storeLinks(c, a, { id, project_id: project.id }, text);
        }
        await docEvent(c, a, project, 'created', title);
        return { status: 201, body: await fullPage(c, a, id) };
      }),
  });

  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId',
    summary: 'One page with its body, links, backlinks and watchers',
    tags: ['documents'],
    params: pageParams,
    response: pageOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const page = await fullPage(c, a, params.pageId);
        // [PCODE-284 | S15 | v0.1.0] who read which version
        await c.query(
          `INSERT INTO doc_reads (workspace_id, page_id, user_id, version) VALUES ($1, $2, $3, $4)
           ON CONFLICT (page_id, user_id) DO UPDATE SET version = EXCLUDED.version, reads = doc_reads.reads + 1, last_at = now()`,
          [a.workspaceId, params.pageId, a.user.id, page.page.version],
        );
        return { body: page };
      }),
  });

  const save = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/docs/:pageId',
    summary:
      'Save the page as a new version; refused when it was edited on an older version or is locked by someone else (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({
      title: s.optional(s.string({ min: 1, max: 200 })),
      body: s.string({ max: 500_000 }),
      baseVersion: s.number({ integer: true, min: 0 }),
    }),
    response: pageOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        if (p.kind !== 'page') throw new HttpError(409, 'conflict', 'A folder has no text');
        refuseGenerated(p);
        await c.query('SELECT 1 FROM doc_pages WHERE id = $1 FOR UPDATE', [p.id]);
        const now = await pageOf(c, a, p.id);
        if (now.locked_by && now.locked_by !== a.user.id)
          throw new HttpError(
            409,
            'conflict',
            (now.locked_by_name ?? 'Someone') + ' has locked this page',
          );
        if (body.baseVersion !== now.version)
          throw new HttpError(
            409,
            'conflict',
            'The page changed since you opened it (version ' +
              String(now.version) +
              '); reload, then apply your change again',
          );
        const title = body.title?.trim() ?? now.title;
        if (title === now.title && body.body === now.body)
          return { body: await fullPage(c, a, p.id) };
        const v = now.version + 1;
        await c.query(
          'UPDATE doc_pages SET title = $2, body = $3, version = $4, updated_at = now() WHERE id = $1',
          [p.id, title, body.body, v],
        );
        await c.query(
          'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, author_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [a.workspaceId, p.id, v, title, body.body, a.user.id],
        );
        await storeLinks(c, a, p, body.body);
        await docEvent(c, a, p.project, 'updated', title);
        await queueWatchers(c, a, p.id, 'edited it'); // [PCODE-249 | S15 | v0.1.0]
        return { body: await fullPage(c, a, p.id) };
      }),
  });

  const change = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/docs/:pageId',
    summary:
      'Move a page in the tree, rename it, set its status, owner, review date or tags, lock or unlock it (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({
      title: s.optional(s.string({ min: 1, max: 200 })),
      parentId: s.optional(s.nullable(uuid)),
      rank: s.optional(s.number({ min: -1e12, max: 1e12 })),
      status: s.optional(s.enum(['draft', 'in_review', 'published'])),
      ownerId: s.optional(s.nullable(uuid)),
      reviewBy: s.optional(s.nullable(day)),
      tags: s.optional(s.array(tag, { max: 20 })),
      locked: s.optional(s.boolean()),
    }),
    response: pageOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        if (body.parentId) {
          const parent = await pageOf(c, a, body.parentId);
          const loop = await c.query(
            `WITH RECURSIVE up(id, parent_id) AS (SELECT id, parent_id FROM doc_pages WHERE id = $1
               UNION ALL SELECT d.id, d.parent_id FROM doc_pages d JOIN up ON d.id = up.parent_id) SELECT 1 FROM up WHERE id = $2`,
            [parent.id, p.id],
          );
          if (parent.project_id !== p.project_id || loop.rowCount)
            throw new HttpError(
              400,
              'invalid_request',
              'A page moves under another page of its project, not under itself',
              [{ path: 'body.parentId', message: 'would make a loop or leave the project' }],
            );
        }
        if (body.reviewBy && !/^\d{4}-\d{2}-\d{2}$/.test(body.reviewBy))
          throw new HttpError(400, 'invalid_request', 'Dates are written YYYY-MM-DD', [
            { path: 'body.reviewBy', message: 'is not a date' },
          ]);
        if (body.ownerId) {
          const ok = await c.query(
            "SELECT 1 FROM workspace_members WHERE user_id = $1 AND role <> 'guest'",
            [body.ownerId],
          );
          if (!ok.rowCount)
            throw new HttpError(400, 'invalid_request', 'The owner is a member of the team', [
              { path: 'body.ownerId', message: 'is not a team member' },
            ]);
        }
        if (
          body.locked === false &&
          p.locked_by &&
          p.locked_by !== a.user.id &&
          !atLeast(a.role, 'admin')
        )
          throw new HttpError(
            403,
            'forbidden',
            'Only ' + (p.locked_by_name ?? 'whoever locked it') + ' or an admin unlocks this page',
          );
        if (body.locked === true && p.locked_by && p.locked_by !== a.user.id)
          throw new HttpError(
            409,
            'conflict',
            (p.locked_by_name ?? 'Someone') + ' has locked this page',
          );
        await c.query(
          `UPDATE doc_pages SET title = coalesce($2, title),
                  parent_id = CASE WHEN $3 THEN $4::uuid ELSE parent_id END,
                  rank = coalesce($5, rank), status = coalesce($6, status),
                  owner_id = CASE WHEN $7 THEN $8::uuid ELSE owner_id END,
                  review_by = CASE WHEN $9 THEN $10::date ELSE review_by END,
                  tags = coalesce($11, tags),
                  locked_by = CASE WHEN $12::boolean IS NULL THEN locked_by WHEN $12 THEN $13::uuid ELSE NULL END,
                  updated_at = now()
            WHERE id = $1`,
          [
            p.id,
            body.title?.trim() ?? null,
            body.parentId !== undefined,
            body.parentId ?? null,
            body.rank ?? null,
            body.status ?? null,
            body.ownerId !== undefined,
            body.ownerId ?? null,
            body.reviewBy !== undefined,
            body.reviewBy ?? null,
            body.tags ?? null,
            body.locked ?? null,
            a.user.id,
          ],
        );
        // [PCODE-249 | S15 | v0.1.0] a new name or status is news for the watchers; moving and tags are not
        if (body.title && body.title.trim() !== p.title)
          await queueWatchers(c, a, p.id, 'renamed it from ' + p.title);
        if (body.status && body.status !== p.status)
          await queueWatchers(c, a, p.id, 'set it to ' + body.status.replace('_', ' '));
        return { body: await fullPage(c, a, p.id) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/docs/:pageId',
    summary: 'Remove a page and everything under it (member)',
    tags: ['documents'],
    params: pageParams,
    response: s.object({ removed: s.number({ integer: true }) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        if (p.locked_by && p.locked_by !== a.user.id)
          throw new HttpError(
            409,
            'conflict',
            (p.locked_by_name ?? 'Someone') + ' has locked this page',
          );
        const r = await c.query(
          `WITH RECURSIVE down(id) AS (SELECT $1::uuid UNION SELECT d.id FROM doc_pages d JOIN down ON d.parent_id = down.id)
           UPDATE doc_pages SET deleted_at = now() WHERE id IN (SELECT id FROM down) AND deleted_at IS NULL`,
          [p.id],
        );
        await docEvent(c, a, p.project, 'deleted', p.title);
        return { body: { removed: r.rowCount ?? 0 } };
      }),
  });

  const versionOut = s.object({
    version: s.number({ integer: true }),
    title: s.string(),
    name: s.string(),
    author: s.nullable(s.string()),
    byAgent: s.boolean(),
    createdAt: s.string(),
    size: s.number({ integer: true }),
  });
  const versions = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/versions',
    summary: 'The page’s history, newest first',
    tags: ['documents'],
    params: pageParams,
    response: s.array(versionOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const rows = (
          await c.query<{
            version: number;
            title: string;
            name: string;
            author: string | null;
            agent_run_id: string | null;
            created_at: Date;
            size: number;
          }>(
            `SELECT v.version, v.title, v.name, u.name AS author, v.agent_run_id, v.created_at, length(v.body) AS size
               FROM doc_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.page_id = $1 ORDER BY v.version DESC`,
            [p.id],
          )
        ).rows;
        return {
          body: rows.map((r) => ({
            version: r.version,
            title: r.title,
            name: r.name,
            author: r.author,
            byAgent: r.agent_run_id !== null,
            createdAt: r.created_at.toISOString(),
            size: r.size,
          })),
        };
      }),
  });

  const versionOf = async (
    c: PoolClient,
    pageId: string,
    v: number,
  ): Promise<{ title: string; body: string }> => {
    const r = (
      await c.query<{ title: string; body: string }>(
        'SELECT title, body FROM doc_versions WHERE page_id = $1 AND version = $2',
        [pageId, v],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Version ' + String(v) + ' not found');
    return r;
  };

  const diff = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/diff',
    summary: 'What changed between two versions, line by line',
    tags: ['documents'],
    params: pageParams,
    query: s.object({ from: s.string({ min: 1, max: 8 }), to: s.string({ min: 1, max: 8 }) }),
    response: s.object({
      from: s.number({ integer: true }),
      to: s.number({ integer: true }),
      titleFrom: s.string(),
      titleTo: s.string(),
      lines: s.array(s.object({ op: s.string(), text: s.string() })),
    }),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const [from, to] = [Number(query.from), Number(query.to)];
        if (!Number.isInteger(from) || !Number.isInteger(to))
          throw new HttpError(400, 'invalid_request', 'Versions are numbers', [
            { path: 'query', message: 'from and to are version numbers' },
          ]);
        const [x, y] = [await versionOf(c, p.id, from), await versionOf(c, p.id, to)];
        return {
          body: { from, to, titleFrom: x.title, titleTo: y.title, lines: lineDiff(x.body, y.body) },
        };
      }),
  });

  const versionParams = s.object({
    workspaceId: uuid,
    pageId: uuid,
    version: s.string({ min: 1, max: 8 }),
  });
  // [PCODE-283 | S15 | v0.1.0] a version's own text, for the rendered diff
  const versionGet = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/versions/:version',
    summary: 'One version of the page with its title, name and text',
    tags: ['documents'],
    params: versionParams,
    response: s.object({
      version: s.number({ integer: true }),
      title: s.string(),
      name: s.string(),
      body: s.string(),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const r = (
          await c.query<{ title: string; name: string; body: string }>(
            'SELECT title, name, body FROM doc_versions WHERE page_id = $1 AND version = $2',
            [p.id, Number(params.version)],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, 'not_found', 'Version not found');
        return { body: { version: Number(params.version), ...r } };
      }),
  });
  const restore = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/versions/:version/restore',
    summary: 'Bring back an earlier version as the newest one; nothing is lost (member)',
    tags: ['documents'],
    params: versionParams,
    response: pageOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        refuseGenerated(p); // [PCODE-197 | S15 | v0.1.0]
        if (p.locked_by && p.locked_by !== a.user.id)
          throw new HttpError(
            409,
            'conflict',
            (p.locked_by_name ?? 'Someone') + ' has locked this page',
          );
        await c.query('SELECT 1 FROM doc_pages WHERE id = $1 FOR UPDATE', [p.id]);
        const old = await versionOf(c, p.id, Number(params.version));
        const v = p.version + 1;
        await c.query(
          'UPDATE doc_pages SET title = $2, body = $3, version = $4, updated_at = now() WHERE id = $1',
          [p.id, old.title, old.body, v],
        );
        await c.query(
          'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, name, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            a.workspaceId,
            p.id,
            v,
            old.title,
            old.body,
            'Restored version ' + params.version,
            a.user.id,
          ],
        );
        await storeLinks(c, a, p, old.body);
        await docEvent(c, a, p.project, 'updated', old.title);
        await queueWatchers(c, a, p.id, 'restored version ' + params.version); // [PCODE-249 | S15 | v0.1.0]
        return { body: await fullPage(c, a, p.id) };
      }),
  });

  const nameVersion = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/docs/:pageId/versions/:version',
    summary: 'Name a version, e.g. “Sent to the client” (member)',
    tags: ['documents'],
    params: versionParams,
    body: s.object({ name: s.string({ max: 120 }) }),
    response: s.object({ version: s.number({ integer: true }), name: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const r = await c.query(
          'UPDATE doc_versions SET name = $3 WHERE page_id = $1 AND version = $2',
          [p.id, Number(params.version), body.name.trim()],
        );
        if (!r.rowCount) throw new HttpError(404, 'not_found', 'Version not found');
        return { body: { version: Number(params.version), name: body.name.trim() } };
      }),
  });

  const approve = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/approve',
    summary: 'A person approves a page an agent wrote; the mark goes away (member)',
    tags: ['documents'],
    params: pageParams,
    response: pageOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        if (!p.agent_written)
          throw new HttpError(409, 'conflict', 'Only a page an agent wrote needs approval');
        await c.query('UPDATE doc_pages SET approved_by = $2, approved_at = now() WHERE id = $1', [
          p.id,
          a.user.id,
        ]);
        return { body: await fullPage(c, a, p.id) };
      }),
  });

  const watch = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/watch',
    summary: 'Watch a page, or stop watching it',
    tags: ['documents'],
    params: pageParams,
    response: s.object({ watching: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const gone = await c.query('DELETE FROM doc_watchers WHERE page_id = $1 AND user_id = $2', [
          p.id,
          a.user.id,
        ]);
        if (!gone.rowCount)
          await c.query(
            'INSERT INTO doc_watchers (workspace_id, page_id, user_id) VALUES ($1, $2, $3)',
            [a.workspaceId, p.id, a.user.id],
          );
        return { body: { watching: !gone.rowCount } };
      }),
  });

  // ── comments ──
  const commentOut = s.object({
    id: s.string(),
    anchor: s.string(),
    body: s.string(),
    authorId: s.nullable(s.string()),
    authorName: s.nullable(s.string()),
    resolved: s.boolean(),
    createdAt: s.string(),
  });
  interface CommentRow {
    id: string;
    page_id: string;
    anchor: string;
    body: string;
    author_id: string | null;
    author_name: string | null;
    resolved: boolean;
    created_at: Date;
  }
  const COMMENT_SELECT =
    'SELECT c.id, c.page_id, c.anchor, c.body, c.author_id, u.name AS author_name, c.resolved, c.created_at FROM doc_comments c LEFT JOIN users u ON u.id = c.author_id';
  const commentJson = (r: CommentRow) => ({
    id: r.id,
    anchor: r.anchor,
    body: r.body,
    authorId: r.author_id,
    authorName: r.author_name,
    resolved: r.resolved,
    createdAt: r.created_at.toISOString(),
  });
  const comments = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/docs/:pageId/comments',
    summary: 'The comments of a page, open ones first',
    tags: ['documents'],
    params: pageParams,
    response: s.array(commentOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        return {
          body: (
            await c.query<CommentRow>(
              COMMENT_SELECT + ' WHERE c.page_id = $1 ORDER BY c.resolved, c.created_at',
              [p.id],
            )
          ).rows.map(commentJson),
        };
      }),
  });
  const addComment = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/comments',
    summary: 'Comment on the page or on a passage of it (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({
      body: s.string({ min: 1, max: 8000 }),
      anchor: s.optional(s.string({ max: 1000 })),
    }),
    response: commentOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        const anchor = body.anchor?.trim() ?? '';
        if (anchor && !p.body.includes(anchor))
          throw new HttpError(400, 'invalid_request', 'The passage is not on the page', [
            { path: 'body.anchor', message: 'is not in the page' },
          ]);
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO doc_comments (workspace_id, page_id, anchor, body, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [a.workspaceId, p.id, anchor, body.body.trim(), a.user.id],
          )
        ).rows[0]?.id;
        await queueWatchers(c, a, p.id, 'commented: ' + body.body.trim().slice(0, 120)); // [PCODE-249 | S15 | v0.1.0]
        const row = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE c.id = $1', [id])).rows[0];
        if (!row) throw new Error('comment vanished');
        // [PCODE-283 | S15 | v0.1.0] the people the comment names, among those who see the project
        const people = (
          await c.query<Mentionable>(
            `SELECT u.id, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
              WHERE m.role <> 'guest' OR guest_sees_project($1, u.id)`,
            [p.project_id],
          )
        ).rows;
        const named = mentionsIn(body.body, people).filter((x) => x.id !== a.user.id);
        return {
          status: 201,
          body: commentJson(row),
          named: named.map((x) => x.id),
          page: { id: p.id, title: p.title, projectId: p.project_id },
          who: a.user.name,
        };
      }).then((r) => {
        if (r.named.length)
          void noticeNow(
            pool,
            params.workspaceId,
            {
              inboxKind: 'mention',
              userIds: r.named,
              title: r.who + ' mentioned you on ' + r.page.title,
              body: body.body.trim().slice(0, 200),
              url: '/projects/' + r.page.projectId + '/documents?page=' + r.page.id,
              tag: 'doc-comment-' + r.body.id,
              object: { type: 'doc_page', id: r.page.id },
              priority: 'normal',
              projectId: r.page.projectId,
            },
            { ...deps.push, subject: deps.push?.subject ?? PUSH_SUBJECT },
          ).catch(() => undefined);
        return { status: r.status, body: r.body };
      }),
  });
  const commentOf = async (c: PoolClient, a: Access, id: string): Promise<CommentRow> => {
    const r = (await c.query<CommentRow>(COMMENT_SELECT + ' WHERE c.id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Comment not found');
    await pageOf(c, a, r.page_id);
    return r;
  };
  const changeComment = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/doc-comments/:id',
    summary: 'Resolve or reopen a comment; its author changes the text (member)',
    tags: ['documents'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    body: s.object({
      resolved: s.optional(s.boolean()),
      body: s.optional(s.string({ min: 1, max: 8000 })),
    }),
    response: commentOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await commentOf(c, a, params.id);
        if (body.body !== undefined && r.author_id !== a.user.id)
          throw new HttpError(403, 'forbidden', 'Only its author changes a comment');
        await c.query(
          'UPDATE doc_comments SET resolved = coalesce($2, resolved), body = coalesce($3, body) WHERE id = $1',
          [r.id, body.resolved ?? null, body.body?.trim() ?? null],
        );
        return { body: commentJson(await commentOf(c, a, r.id)) };
      }),
  });
  const removeComment = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/doc-comments/:id',
    summary: 'Remove a comment: its author or an admin',
    tags: ['documents'],
    params: s.object({ workspaceId: uuid, id: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const r = await commentOf(c, a, params.id);
        if (r.author_id !== a.user.id && !atLeast(a.role, 'admin'))
          throw new HttpError(403, 'forbidden', 'Only its author or an admin removes a comment');
        await c.query('DELETE FROM doc_comments WHERE id = $1', [r.id]);
        return { body: { removed: true } };
      }),
  });

  // ── search and link check ──
  const search = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs/search',
    summary: 'Pages whose title or text match, best first, with the matching passage',
    tags: ['documents'],
    params: projectParams,
    query: s.object({ q: s.string({ min: 1, max: 200 }), tag: s.optional(tag) }),
    response: s.array(
      s.object({
        id: s.string(),
        title: s.string(),
        snippet: s.string(),
        tags: s.array(s.string()),
      }),
    ),
    handler: ({ params, query, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const words = query.q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
        if (!words.length) return { body: [] };
        const tsq = words.map((w) => w + ':*').join(' & ');
        const rows = (
          await c.query<{ id: string; title: string; snippet: string; tags: string[] }>(
            `SELECT id, title, tags, ts_headline('simple', body, to_tsquery('simple', $2), 'MaxWords=24, MinWords=8, StartSel=«, StopSel=»') AS snippet
               FROM doc_pages WHERE project_id = $1 AND deleted_at IS NULL AND search @@ to_tsquery('simple', $2)
                AND ($3::text IS NULL OR $3 = ANY(tags))
              ORDER BY ts_rank(search, to_tsquery('simple', $2)) DESC LIMIT 30`,
            [params.projectId, tsq, query.tag ?? null],
          )
        ).rows;
        return { body: rows };
      }),
  });

  const checkLinks = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/docs/check-links',
    summary:
      'Check the web links of the project’s pages (at most 50 at a time, the oldest checks first) (member)',
    tags: ['documents'],
    params: projectParams,
    response: s.object({
      checked: s.number({ integer: true }),
      broken: s.array(
        s.object({
          pageId: s.string(),
          title: s.string(),
          url: s.string(),
          httpStatus: s.number({ integer: true }),
        }),
      ),
    }),
    handler: async ({ params, req }) => {
      const urls = await asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        await requireProject(c, a, params.projectId);
        return (
          await c.query<{ url: string }>(
            `SELECT x.url FROM doc_links x JOIN doc_pages d ON d.id = x.page_id AND d.deleted_at IS NULL
              WHERE d.project_id = $1 AND x.url <> '' GROUP BY x.url ORDER BY min(x.checked_at) NULLS FIRST LIMIT 50`,
            [params.projectId],
          )
        ).rows.map((r) => r.url);
      });
      const doFetch = deps.fetchImpl ?? fetch;
      const results = await Promise.all(
        urls.map(async (url) => {
          // a redirect is an answer (not followed), so a public link cannot bounce the check inside
          if (!deps.allowPrivate && !(await isPublicUrl(url))) return { url, status: 0 };
          try {
            const r = await doFetch(url, {
              method: 'HEAD',
              redirect: 'manual',
              signal: AbortSignal.timeout(5000),
            });
            const status =
              r.status === 405
                ? (
                    await doFetch(url, {
                      method: 'GET',
                      redirect: 'manual',
                      signal: AbortSignal.timeout(5000),
                    })
                  ).status
                : r.status;
            return { url, status };
          } catch {
            return { url, status: 0 };
          }
        }),
      );
      return asMember(pool, req, params.workspaceId, 'member', async (c) => {
        for (const r of results)
          await c.query(
            'UPDATE doc_links SET http_status = $2, checked_at = now() WHERE url = $1',
            [r.url, r.status],
          );
        const broken = (
          await c.query<{ page_id: string; title: string; url: string; http_status: number }>(
            `SELECT x.page_id, d.title, x.url, x.http_status FROM doc_links x JOIN doc_pages d ON d.id = x.page_id AND d.deleted_at IS NULL
              WHERE d.project_id = $1 AND x.url <> '' AND (x.http_status = 0 OR x.http_status >= 400) ORDER BY d.title`,
            [params.projectId],
          )
        ).rows;
        return {
          body: {
            checked: results.length,
            broken: broken.map((b) => ({
              pageId: b.page_id,
              title: b.title,
              url: b.url,
              httpStatus: b.http_status,
            })),
          },
        };
      });
    },
  });

  // ── agent knowledge ──
  const scopeOut = s.object({
    agentKey: s.string(),
    pages: s.array(s.object({ id: s.string(), title: s.string() })),
    tags: s.array(s.string()),
    readable: s.number({ integer: true }),
  });
  const knowledge = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/knowledge',
    summary: 'Per agent: the pages and tags it may read, and the last reads it made',
    tags: ['documents'],
    params: projectParams,
    response: s.object({
      scopes: s.array(scopeOut),
      reads: s.array(
        s.object({
          agentKey: s.string(),
          pageId: s.nullable(s.string()),
          title: s.nullable(s.string()),
          version: s.nullable(s.number({ integer: true })),
          passage: s.string(),
          citedOk: s.nullable(s.boolean()), // [PCODE-284 | S15 | v0.1.0]
          runId: s.nullable(s.string()),
          at: s.string(),
        }),
      ),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const rows = (
          await c.query<{
            agent_key: string;
            page_id: string | null;
            title: string | null;
            tag: string;
          }>(
            'SELECT k.agent_key, k.page_id, d.title, k.tag FROM knowledge_scopes k LEFT JOIN doc_pages d ON d.id = k.page_id WHERE k.project_id = $1 ORDER BY k.agent_key, d.title, k.tag',
            [params.projectId],
          )
        ).rows;
        const agents = [...new Set(rows.map((r) => r.agent_key))];
        const scopes = [];
        for (const key of agents)
          scopes.push({
            agentKey: key,
            pages: rows
              .filter((r) => r.agent_key === key && r.page_id)
              .map((r) => ({ id: r.page_id ?? '', title: r.title ?? '' })),
            tags: rows.filter((r) => r.agent_key === key && r.tag).map((r) => r.tag),
            readable: (await readablePages(c, params.projectId, key)).length,
          });
        const reads = (
          await c.query<{
            agent_key: string;
            page_id: string | null;
            title: string | null;
            version: number | null;
            passage: string;
            agent_run_id: string | null;
            cited_ok: boolean | null;
            created_at: Date;
          }>(
            'SELECT k.agent_key, k.page_id, d.title, k.version, k.passage, k.agent_run_id, k.cited_ok, k.created_at FROM knowledge_reads k LEFT JOIN doc_pages d ON d.id = k.page_id WHERE k.project_id = $1 ORDER BY k.created_at DESC LIMIT 100',
            [params.projectId],
          )
        ).rows;
        return {
          body: {
            scopes,
            reads: reads.map((r) => ({
              agentKey: r.agent_key,
              pageId: r.page_id,
              title: r.title,
              version: r.version,
              passage: r.passage,
              runId: r.agent_run_id,
              citedOk: r.cited_ok, // [PCODE-284 | S15 | v0.1.0]
              at: r.created_at.toISOString(),
            })),
          },
        };
      }),
  });
  const setScope = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/knowledge/:agentKey',
    summary:
      'What one agent may read in this project: pages (with what is under them) and tags (admin)',
    tags: ['documents'],
    params: s.object({
      workspaceId: uuid,
      projectId: uuid,
      agentKey: s.string({ min: 2, max: 40 }),
    }),
    body: s.object({ pageIds: s.array(uuid, { max: 200 }), tags: s.array(tag, { max: 50 }) }),
    response: scopeOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        if (!/^[a-z][a-z0-9_-]{1,39}$/.test(params.agentKey))
          throw new HttpError(400, 'invalid_request', 'Agent keys are lower case', [
            { path: 'params.agentKey', message: 'is not an agent key' },
          ]);
        const pages = [...new Set(body.pageIds)];
        if (pages.length) {
          const n = (
            await c.query<{ n: string }>(
              'SELECT count(*) AS n FROM doc_pages WHERE project_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL',
              [p.id, pages],
            )
          ).rows[0]?.n;
          if (Number(n) !== pages.length)
            throw new HttpError(400, 'invalid_request', 'Every page belongs to this project', [
              { path: 'body.pageIds', message: 'names a page of another project' },
            ]);
        }
        await c.query('DELETE FROM knowledge_scopes WHERE project_id = $1 AND agent_key = $2', [
          p.id,
          params.agentKey,
        ]);
        for (const id of pages)
          await c.query(
            'INSERT INTO knowledge_scopes (workspace_id, project_id, agent_key, page_id, created_by) VALUES ($1, $2, $3, $4, $5)',
            [a.workspaceId, p.id, params.agentKey, id, a.user.id],
          );
        for (const t of [...new Set(body.tags.map((x) => x.trim()).filter(Boolean))])
          await c.query(
            'INSERT INTO knowledge_scopes (workspace_id, project_id, agent_key, tag, created_by) VALUES ($1, $2, $3, $4, $5)',
            [a.workspaceId, p.id, params.agentKey, t, a.user.id],
          );
        const titles = (
          await c.query<{ id: string; title: string }>(
            'SELECT id, title FROM doc_pages WHERE id = ANY($1::uuid[]) ORDER BY title',
            [pages],
          )
        ).rows;
        return {
          body: {
            agentKey: params.agentKey,
            pages: titles,
            tags: [...new Set(body.tags.map((x) => x.trim()).filter(Boolean))].sort(),
            readable: (await readablePages(c, p.id, params.agentKey)).length,
          },
        };
      }),
  });

  return [
    tree,
    templates,
    create,
    get,
    save,
    change,
    remove,
    versions,
    diff,
    restore,
    nameVersion,
    approve,
    watch,
    comments,
    addComment,
    changeComment,
    removeComment,
    search,
    checkLinks,
    knowledge,
    setScope,
    versionGet, // [PCODE-283 | S15 | v0.1.0]
  ];
}
