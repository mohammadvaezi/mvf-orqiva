// ── [PCODE-348 | S15 | v0.1.0] T35.2a Integrations hub; email-in for replies to messages and ideas by email ──
//    Why:  people answer notices from their mail, and ideas arrive by mail. The mail provider (Postmark or
//          any that posts JSON) sends each mail to the webhook with the workspace's key. A reply to a notice
//          goes into its conversation as its sender, without the quoted mail; mail to a project's ideas
//          address from a member becomes an idea. Anything else is refused and logged, never silently lost.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { inboundMail, inboundTarget, replyText, type InboundMail } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { inSystem } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { noticeNow, PUSH_SUBJECT, type PushDeps } from '../push/dispatch.js';
import { asMember, asUser, requireProject } from './access.js';
import { ideaEvent, visibleIdea } from './ideas.js';
import { messageNotices, writeMessage } from './messages.js';

const uuid = s.string({ format: 'uuid' });
const hash = (key: string): string => createHash('sha256').update(key).digest('hex');
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

type Outcome = { outcome: 'message' | 'idea' | 'refused'; detail: string };

async function log(
  c: PoolClient,
  ws: string,
  m: InboundMail | null,
  to: string,
  o: Outcome,
): Promise<void> {
  await c.query(
    `INSERT INTO email_inbound_log (workspace_id, sender, recipient, subject, outcome, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      ws,
      (m?.from ?? '').slice(0, 254),
      to.slice(0, 254),
      (m?.subject ?? '').slice(0, 300),
      o.outcome,
      o.detail.slice(0, 500),
    ],
  );
}

export function emailInRoutes(
  pool: Pool,
  deps: { push?: PushDeps & { subject?: string }; publicUrl?: string } = {},
): Route[] {
  const push = { ...deps.push, subject: deps.push?.subject ?? PUSH_SUBJECT };
  const base = (deps.publicUrl ?? '').replace(/\/$/, '');

  const settings = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/email-in',
    summary:
      'Email-in: the inbound domain, the project addresses for ideas and the mail received lately (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid }),
    response: s.anyObject(),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const cfg = (
          await c.query<{ domain: string; created_at: Date }>(
            'SELECT domain, created_at FROM email_inbound',
          )
        ).rows[0];
        const ideas = (
          await c.query<{ token: string; project_id: string; key: string; name: string }>(
            `SELECT t.token, t.project_id, p.key, p.name FROM email_tokens t JOIN projects p ON p.id = t.project_id
              WHERE t.kind = 'ideas' ORDER BY p.key`,
          )
        ).rows;
        const recent = (
          await c.query<{
            at: Date;
            sender: string;
            recipient: string;
            subject: string;
            outcome: string;
            detail: string;
          }>(
            'SELECT at, sender, recipient, subject, outcome, detail FROM email_inbound_log ORDER BY at DESC LIMIT 20',
          )
        ).rows;
        return {
          body: {
            domain: cfg?.domain ?? null,
            since: cfg?.created_at.toISOString() ?? null,
            webhook: base + '/hooks/email/' + params.workspaceId,
            ideas: cfg
              ? ideas.map((x) => ({
                  projectId: x.project_id,
                  projectKey: x.key,
                  projectName: x.name,
                  address: 'ideas+' + x.token + '@' + cfg.domain,
                }))
              : [],
            recent: recent.map((r) => ({ ...r, at: r.at.toISOString() })),
          },
        };
      }),
  });

  const setUp = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/email-in',
    summary: 'Set the inbound domain and make a new webhook key, shown only now (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({ domain: s.string({ min: 3, max: 200 }) }),
    response: s.object({ domain: s.string(), webhook: s.string(), key: s.string() }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const domain = body.domain.trim().toLowerCase();
        if (!DOMAIN.test(domain))
          throw new HttpError(400, 'invalid_request', 'That is not a mail domain', [
            { path: 'body.domain', message: 'is like mail.example.com' },
          ]);
        const key = randomBytes(24).toString('hex');
        await c.query(
          `INSERT INTO email_inbound (workspace_id, domain, key_hash, created_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id) DO UPDATE SET domain = EXCLUDED.domain, key_hash = EXCLUDED.key_hash,
             created_by = EXCLUDED.created_by, created_at = now()`,
          [a.workspaceId, domain, hash(key), a.user.id],
        );
        return {
          body: { domain, webhook: base + '/hooks/email/' + a.workspaceId + '?key=' + key, key },
        };
      }),
  });

  const turnOff = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/email-in',
    summary: 'Turn email-in off; the addresses stop working (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: { removed: Boolean((await c.query('DELETE FROM email_inbound')).rowCount) },
      })),
  });

  const ideasAddress = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/email-ideas',
    summary:
      'A new address that turns mail from members into ideas of the project; the old one stops (admin)',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid, projectId: uuid }),
    response: s.object({ address: s.nullable(s.string()) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const domain = (await c.query<{ domain: string }>('SELECT domain FROM email_inbound'))
          .rows[0]?.domain;
        if (!domain) throw new HttpError(409, 'conflict', 'Set up email-in first');
        const token = randomBytes(12).toString('hex');
        await c.query("DELETE FROM email_tokens WHERE kind = 'ideas' AND project_id = $1", [
          params.projectId,
        ]);
        await c.query(
          "INSERT INTO email_tokens (token, workspace_id, kind, project_id) VALUES ($1, $2, 'ideas', $3)",
          [token, a.workspaceId, params.projectId],
        );
        return { body: { address: 'ideas+' + token + '@' + domain } };
      }),
  });

  /** One mail: a reply into its conversation, or an idea; the outcome is logged. */
  const receive = async (
    ws: string,
    domain: string,
    m: InboundMail,
  ): Promise<Outcome & { to: string }> => {
    const hit = m.to.map((to) => ({ to, t: inboundTarget(to, domain) })).find((x) => x.t);
    if (!hit?.t)
      return {
        outcome: 'refused',
        detail: 'No Orqiva address among the recipients',
        to: m.to[0] ?? '',
      };
    const target = hit.t;
    const tok = await inSystem(
      pool,
      async (c) =>
        (
          await c.query<{
            user_id: string | null;
            channel_id: string | null;
            parent_id: string | null;
            project_id: string | null;
            email: string | null;
          }>(
            `SELECT t.user_id, t.channel_id, t.parent_id, t.project_id, u.email FROM email_tokens t
             LEFT JOIN users u ON u.id = t.user_id WHERE t.token = $1 AND t.kind = $2 AND t.workspace_id = $3`,
            [target.token, target.kind, ws],
          )
        ).rows[0],
    );
    if (!tok)
      return {
        outcome: 'refused',
        detail: 'The address is not known or no longer works',
        to: hit.to,
      };
    const text = replyText(m.text);
    try {
      if (target.kind === 'reply') {
        if (!tok.user_id || !tok.channel_id || (tok.email ?? '').toLowerCase() !== m.from)
          return {
            outcome: 'refused',
            detail: 'The reply did not come from the person it was sent to',
            to: hit.to,
          };
        if (!text) return { outcome: 'refused', detail: 'The reply was empty', to: hit.to };
        const channelId = tok.channel_id;
        const out = await asUser(pool, tok.user_id, ws, 'guest', (c, a) =>
          writeMessage(c, a, channelId, text.slice(0, 20_000), tok.parent_id ?? undefined),
        );
        for (const n of messageNotices(out, text))
          void noticeNow(pool, ws, n, push).catch(() => undefined);
        return { outcome: 'message', detail: 'Posted as ' + out.a.user.name, to: hit.to };
      }
      // ideas: only from a member of the team
      const sender = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{ id: string }>(
              `SELECT u.id FROM users u JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = $2
              WHERE lower(u.email) = $1 AND m.suspended_at IS NULL AND m.role NOT IN ('guest', 'auditor', 'billing')`,
              [m.from, ws],
            )
          ).rows[0],
      );
      if (!sender || !tok.project_id)
        return {
          outcome: 'refused',
          detail: 'Ideas come by mail only from members of the team',
          to: hit.to,
        };
      const projectId = tok.project_id;
      const title = (m.subject || text.split('\n')[0] || 'Idea by mail').slice(0, 200);
      const ref = await asUser(pool, sender.id, ws, 'member', async (c, a) => {
        const p = await requireProject(c, a, projectId);
        const number = (
          await c.query<{ n: number }>(
            'UPDATE projects SET next_idea_seq = next_idea_seq + 1 WHERE id = $1 RETURNING next_idea_seq - 1 AS n',
            [p.id],
          )
        ).rows[0]?.n;
        const id = (
          await c.query<{ id: string }>(
            'INSERT INTO ideas (workspace_id, project_id, number, title, body, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [ws, p.id, number, title, text.slice(0, 20_000), a.user.id],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('idea insert returned nothing');
        const idea = await visibleIdea(c, a, id);
        await ideaEvent(c, a, idea, 'created');
        return p.key + ' #' + String(number);
      });
      return { outcome: 'idea', detail: 'Idea ' + ref, to: hit.to };
    } catch (e) {
      return {
        outcome: 'refused',
        detail: e instanceof HttpError ? e.message : 'It could not be written',
        to: hit.to,
      };
    }
  };

  const hook = route({
    method: 'POST',
    path: '/hooks/email/:workspaceId',
    summary:
      'Mail from the mail provider’s inbound webhook (Postmark-style or JSON), with the workspace key',
    tags: ['integrations'],
    params: s.object({ workspaceId: uuid }),
    query: s.object({ key: s.optional(s.string({ max: 200 })) }),
    body: s.anyObject(),
    textJson: true,
    response: s.object({ outcome: s.string(), detail: s.string() }),
    handler: async ({ params, query, body, req }) => {
      const key = query.key ?? /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const cfg = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{ domain: string; key_hash: string }>(
              'SELECT domain, key_hash FROM email_inbound WHERE workspace_id = $1',
              [params.workspaceId],
            )
          ).rows[0],
      );
      const ok =
        cfg !== undefined &&
        key.length > 0 &&
        timingSafeEqual(Buffer.from(hash(key)), Buffer.from(cfg.key_hash));
      if (!cfg || !ok) throw new HttpError(401, 'unauthorized', 'Unknown key');
      const m = inboundMail(body);
      const o = m
        ? await receive(params.workspaceId, cfg.domain, m)
        : {
            outcome: 'refused' as const,
            detail: 'Not a mail: sender or recipients missing',
            to: '',
          };
      await inSystem(pool, (c) => log(c, params.workspaceId, m, o.to, o));
      // the provider is told it arrived either way, so it does not send it again
      return { body: { outcome: o.outcome, detail: o.detail } };
    },
  });

  return [settings, setUp, turnOff, ideasAddress, hook];
}
