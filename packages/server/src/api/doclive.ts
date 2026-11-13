// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
//    Why:  several people edit one page at once through its live draft. Each editor sends its text with
//          the revision it last saw; the server merges three ways against that revision (our own merge:
//          lines, then words; the same words changed differently are kept twice and counted) and answers
//          with the merged text and the new revision. A page changed outside the draft is merged into it
//          on the next join; saving makes the draft the next version for everyone.
import { merge3 } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, type Access } from './access.js';
import { docEvent, pageOf, queueWatchers, refuseGenerated, storeLinks } from './documents.js';

const uuid = s.string({ format: 'uuid' });
const pageParams = s.object({ workspaceId: uuid, pageId: uuid });

/** Revisions kept as ancestors: an editor further behind joins again. */
export const KEEP_REVS = 50;
/** An editor not heard from for this long is no longer shown. */
export const EDITOR_SEEN_MS = 30_000;

interface Live {
  base_version: number;
  rev: number;
  title: string;
  body: string;
}

const liveOut = s.object({
  rev: s.number({ integer: true }),
  title: s.string(),
  body: s.string(),
  baseVersion: s.number({ integer: true }),
  conflicts: s.number({ integer: true }),
  editors: s.array(s.object({ userId: s.string(), name: s.string() })),
});

async function editable(c: PoolClient, a: Access, pageId: string) {
  const p = await pageOf(c, a, pageId);
  if (p.kind !== 'page') throw new HttpError(409, 'conflict', 'A folder has no text');
  refuseGenerated(p);
  if (p.locked_by && p.locked_by !== a.user.id)
    throw new HttpError(409, 'conflict', (p.locked_by_name ?? 'Someone') + ' has locked this page');
  return p;
}

const liveOf = async (c: PoolClient, pageId: string): Promise<Live | undefined> =>
  (
    await c.query<Live>(
      'SELECT base_version, rev, title, body FROM doc_live WHERE page_id = $1 FOR UPDATE',
      [pageId],
    )
  ).rows[0];

/** The text of a stored version of the page ('' before the first). */
const versionText = async (c: PoolClient, pageId: string, version: number): Promise<string> =>
  version <= 0
    ? ''
    : ((
        await c.query<{ body: string }>(
          'SELECT body FROM doc_versions WHERE page_id = $1 AND version = $2',
          [pageId, version],
        )
      ).rows[0]?.body ?? '');

async function storeRev(c: PoolClient, a: Access, pageId: string, live: Live): Promise<void> {
  await c.query(
    `INSERT INTO doc_live (page_id, workspace_id, base_version, rev, title, body, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (page_id) DO UPDATE SET base_version = EXCLUDED.base_version, rev = EXCLUDED.rev, title = EXCLUDED.title,
       body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [pageId, a.workspaceId, live.base_version, live.rev, live.title, live.body, a.user.id],
  );
  await c.query(
    'INSERT INTO doc_live_revs (workspace_id, page_id, rev, title, body) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [a.workspaceId, pageId, live.rev, live.title, live.body],
  );
  await c.query('DELETE FROM doc_live_revs WHERE page_id = $1 AND rev <= $2', [
    pageId,
    live.rev - KEEP_REVS,
  ]);
}

async function seen(c: PoolClient, a: Access, pageId: string) {
  await c.query(
    `INSERT INTO doc_live_editors (workspace_id, page_id, user_id, seen_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (page_id, user_id) DO UPDATE SET seen_at = now()`,
    [a.workspaceId, pageId, a.user.id],
  );
  return (
    await c.query<{ user_id: string; name: string }>(
      `SELECT e.user_id, u.name FROM doc_live_editors e JOIN users u ON u.id = e.user_id
        WHERE e.page_id = $1 AND e.seen_at > now() - make_interval(secs => $2) ORDER BY e.seen_at`,
      [pageId, EDITOR_SEEN_MS / 1000],
    )
  ).rows.map((r) => ({ userId: r.user_id, name: r.name }));
}

export function docLiveRoutes(pool: Pool): Route[] {
  const join = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/live',
    summary:
      'Join the page’s live draft (made from the page when there is none; a page changed outside it is merged in) (member)',
    tags: ['documents'],
    params: pageParams,
    response: liveOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await editable(c, a, params.pageId);
        await c.query('SELECT 1 FROM doc_pages WHERE id = $1 FOR UPDATE', [p.id]);
        let live = await liveOf(c, p.id);
        let conflicts = 0;
        if (!live) {
          live = { base_version: p.version, rev: 1, title: p.title, body: p.body };
          await storeRev(c, a, p.id, live);
        } else if (live.base_version !== p.version) {
          // the page was saved outside the draft (an agent, the API): its change joins the draft
          const base = await versionText(c, p.id, live.base_version);
          const m = merge3(base, live.body, p.body);
          conflicts = m.conflicts;
          live = { base_version: p.version, rev: live.rev + 1, title: live.title, body: m.text };
          await storeRev(c, a, p.id, live);
        }
        return {
          body: {
            rev: live.rev,
            title: live.title,
            body: live.body,
            baseVersion: live.base_version,
            conflicts,
            editors: await seen(c, a, p.id),
          },
        };
      }),
  });

  const sync = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/live/sync',
    summary:
      'Send the text as edited since a revision; the server merges it with what others sent and answers with the result (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({
      rev: s.number({ integer: true, min: 1 }),
      title: s.string({ min: 1, max: 200 }),
      body: s.string({ max: 500_000 }),
    }),
    response: liveOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await editable(c, a, params.pageId);
        const live = await liveOf(c, p.id);
        if (!live)
          throw new HttpError(
            409,
            'conflict',
            'The draft was saved or closed; open the page again',
          );
        const anc = (
          await c.query<{ title: string; body: string }>(
            'SELECT title, body FROM doc_live_revs WHERE page_id = $1 AND rev = $2',
            [p.id, body.rev],
          )
        ).rows[0];
        if (!anc || body.rev > live.rev)
          throw new HttpError(409, 'conflict', 'Your copy is too far behind; open the page again');
        let next = live;
        let conflicts = 0;
        if (body.body !== anc.body || body.title !== anc.title) {
          const m =
            body.rev === live.rev
              ? { text: body.body, conflicts: 0 }
              : merge3(anc.body, body.body, live.body);
          conflicts = m.conflicts;
          const title = body.title !== anc.title ? body.title : live.title;
          if (m.text !== live.body || title !== live.title) {
            next = { base_version: live.base_version, rev: live.rev + 1, title, body: m.text };
            await storeRev(c, a, p.id, next);
          }
        }
        return {
          body: {
            rev: next.rev,
            title: next.title,
            body: next.body,
            baseVersion: next.base_version,
            conflicts,
            editors: await seen(c, a, p.id),
          },
        };
      }),
  });

  const leave = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/docs/:pageId/live',
    summary:
      'Leave the live draft; the last one out of an unchanged draft closes it, a changed one waits for the others (member)',
    tags: ['documents'],
    params: pageParams,
    response: s.object({ left: s.boolean(), open: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await pageOf(c, a, params.pageId);
        await c.query('DELETE FROM doc_live_editors WHERE page_id = $1 AND user_id = $2', [
          p.id,
          a.user.id,
        ]);
        const live = await liveOf(c, p.id);
        const others = Number(
          (
            await c.query<{ n: string }>(
              'SELECT count(*) AS n FROM doc_live_editors WHERE page_id = $1 AND seen_at > now() - make_interval(secs => $2)',
              [p.id, EDITOR_SEEN_MS / 1000],
            )
          ).rows[0]?.n ?? 0,
        );
        if (live && !others && live.body === p.body && live.title === p.title) {
          await c.query('DELETE FROM doc_live WHERE page_id = $1', [p.id]);
          await c.query('DELETE FROM doc_live_revs WHERE page_id = $1', [p.id]);
          return { body: { left: true, open: false } };
        }
        return { body: { left: true, open: Boolean(live) } };
      }),
  });

  const commit = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/docs/:pageId/live/save',
    summary:
      'Send the last text and save the merged draft as the page’s next version, for everyone editing it (member)',
    tags: ['documents'],
    params: pageParams,
    body: s.object({
      rev: s.number({ integer: true, min: 1 }),
      title: s.string({ min: 1, max: 200 }),
      body: s.string({ max: 500_000 }),
    }),
    response: s.object({
      version: s.number({ integer: true }),
      conflicts: s.number({ integer: true }),
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await editable(c, a, params.pageId);
        await c.query('SELECT 1 FROM doc_pages WHERE id = $1 FOR UPDATE', [p.id]);
        const now = await pageOf(c, a, p.id);
        const live = await liveOf(c, p.id);
        if (!live)
          throw new HttpError(
            409,
            'conflict',
            'The draft was saved or closed; open the page again',
          );
        const anc = (
          await c.query<{ title: string; body: string }>(
            'SELECT title, body FROM doc_live_revs WHERE page_id = $1 AND rev = $2',
            [p.id, body.rev],
          )
        ).rows[0];
        if (!anc)
          throw new HttpError(409, 'conflict', 'Your copy is too far behind; open the page again');
        let conflicts = 0;
        let text = live.body;
        let title = live.title;
        if (body.body !== anc.body || body.title !== anc.title) {
          const m =
            body.rev === live.rev
              ? { text: body.body, conflicts: 0 }
              : merge3(anc.body, body.body, live.body);
          text = m.text;
          conflicts += m.conflicts;
          if (body.title !== anc.title) title = body.title;
        }
        // a save outside the draft since it began joins too
        if (live.base_version !== now.version) {
          const m = merge3(await versionText(c, p.id, live.base_version), text, now.body);
          text = m.text;
          conflicts += m.conflicts;
        }
        let version = now.version;
        if (text !== now.body || title !== now.title) {
          version = now.version + 1;
          await c.query(
            'UPDATE doc_pages SET title = $2, body = $3, version = $4, updated_at = now() WHERE id = $1',
            [p.id, title, text, version],
          );
          await c.query(
            'INSERT INTO doc_versions (workspace_id, page_id, version, title, body, author_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [a.workspaceId, p.id, version, title, text, a.user.id],
          );
          await storeLinks(c, a, p, text);
          await docEvent(c, a, p.project, 'updated', title);
          await queueWatchers(c, a, p.id, 'edited it');
        }
        await c.query('DELETE FROM doc_live WHERE page_id = $1', [p.id]);
        await c.query('DELETE FROM doc_live_revs WHERE page_id = $1', [p.id]);
        await c.query('DELETE FROM doc_live_editors WHERE page_id = $1', [p.id]);
        return { body: { version, conflicts } };
      }),
  });

  return [join, sync, leave, commit];
}
