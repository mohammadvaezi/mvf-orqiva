// ── [PCODE-428 | S15 | v0.1.0] T37 low: Request references count per kind ──
// ── [PCODE-427 | S15 | v0.1.0] T37 low: The portal survey waits for a later visit and its field fits ──
// ── [PCODE-337 | S15 | v0.1.0] T34.1b Request votes and duplicate merge, NPS survey, embeddable feedback widget ──
//    Why:  what the client says beyond a single request. Contacts vote on requests; the team merges a
//          duplicate into its original, votes and all; every 90 days a contact is asked how likely they are
//          to recommend the team; and visitors of the client's own site send feedback through a small
//          widget, which only the origins the team allowed may use, a few times a day per visitor.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { requestRef } from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { RateLimiter } from '../auth/ratelimit.js';
import { inSystem } from '../db/pool.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError, type ErrorCode } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, requireProject } from './access.js';
import {
  insertRequest,
  loadRequest,
  mayUse,
  requestJson,
  requestOut,
  teamOnly,
} from './clientrequests.js';
import { portalScope } from './portal.js';

const uuid = s.string({ format: 'uuid' });
/** A contact is asked again after this many days. */
export const NPS_EVERY_DAYS = 90;
/** [PCODE-427 | S15 | v0.1.0] a new contact is first asked after this many days */
export const NPS_FIRST_AFTER_DAYS = 14;

/** Net promoter score: promoters (9–10) minus detractors (0–6), in percent of the answers. */
export function npsOf(scores: readonly number[]): {
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
} {
  const promoters = scores.filter((x) => x >= 9).length;
  const detractors = scores.filter((x) => x <= 6).length;
  return {
    score: scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null,
    promoters,
    passives: scores.length - promoters - detractors,
    detractors,
  };
}

/** An origin as a browser sends it: scheme, host and port, nothing more. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

const widgetOut = s.object({
  id: s.string(),
  name: s.string(),
  projectId: s.nullable(s.string()),
  key: s.string(),
  origins: s.array(s.string()),
  enabled: s.boolean(),
  received: s.number({ integer: true }),
  lastUsedAt: s.nullable(s.string()),
  snippet: s.string(),
});
interface WidgetRow {
  id: string;
  workspace_id: string;
  client_id: string;
  project_id: string | null;
  name: string;
  public_key: string;
  origins: string[];
  enabled: boolean;
  received: number;
  last_used_at: Date | null;
}
const publicBase = (req: IncomingMessage): string => {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0] ?? 'http';
  return process.env['ORQIVA_PUBLIC_URL']?.replace(/\/$/, '') ?? proto + '://' + String(host);
};
const widgetJson = (w: WidgetRow, base: string) => ({
  id: w.id,
  name: w.name,
  projectId: w.project_id,
  key: w.public_key,
  origins: w.origins,
  enabled: w.enabled,
  received: w.received,
  lastUsedAt: w.last_used_at?.toISOString() ?? null,
  snippet: '<script src="' + base + '/widget.js" data-key="' + w.public_key + '" defer></script>',
});

/** The widget's script: a button that opens a small form in its own shadow root and posts as text. */
export const WIDGET_JS = `(function () {
  var me = document.currentScript;
  if (!me) return;
  var key = me.getAttribute('data-key');
  var base = new URL(me.src).origin;
  var label = me.getAttribute('data-label') || 'Feedback';
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>button,input,select,textarea{font:13px/1.4 system-ui,sans-serif}' +
    '.b{background:#4f46e5;color:#fff;border:0;border-radius:18px;padding:8px 14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)}' +
    'form{display:none;flex-direction:column;gap:6px;width:280px;background:#fff;color:#111;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:8px;box-shadow:0 4px 16px rgba(0,0,0,.15)}' +
    'form.o{display:flex}input,select,textarea{border:1px solid #ccc;border-radius:4px;padding:5px}p{margin:0;font:13px system-ui}</style>' +
    '<form><select name="kind"><option value="bug">Something is broken</option><option value="feature">An idea</option><option value="question">A question</option></select>' +
    '<input name="title" maxlength="200" placeholder="In a few words" required>' +
    '<textarea name="text" rows="4" maxlength="5000" placeholder="What happened, what did you expect?"></textarea>' +
    '<input name="email" type="email" maxlength="200" placeholder="Your email (optional)">' +
    '<button class="b" type="submit">Send</button><p role="status"></p></form><button class="b" type="button"></button>';
  var form = root.querySelector('form');
  var toggle = root.querySelector('button[type=button]');
  var status = root.querySelector('p');
  toggle.textContent = label;
  toggle.onclick = function () { form.classList.toggle('o'); };
  form.onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(form);
    status.textContent = 'Sending…';
    fetch(base + '/widget/' + encodeURIComponent(key) + '/feedback', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        kind: f.get('kind'), title: f.get('title'), text: f.get('text'), email: f.get('email'),
        pageUrl: location.href, userAgent: navigator.userAgent,
        viewport: innerWidth + 'x' + innerHeight
      })
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (r && r.ref) { status.textContent = 'Thank you. Your note is ' + r.ref + '.'; form.reset(); }
      else status.textContent = (r && r.error && r.error.message) || 'It could not be sent.';
    }).catch(function () { status.textContent = 'It could not be sent.'; });
  };
  document.body.appendChild(host);
})();
`;

export function clientVoiceRoutes(pool: Pool): Route[] {
  const reqParams = s.object({ workspaceId: uuid, requestId: uuid });

  const vote = (on: boolean) =>
    route({
      method: on ? 'POST' : 'DELETE',
      path: '/api/workspaces/:workspaceId/client-requests/:requestId/vote',
      summary: on
        ? 'Vote for a request: it matters to you too (contact or team)'
        : 'Take your vote back',
      tags: ['clients'],
      params: reqParams,
      response: requestOut,
      handler: ({ params, req }) =>
        asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
          mayUse(a);
          const r = await loadRequest(c, params.requestId);
          if (on) {
            if (r.merged_into)
              throw new HttpError(
                409,
                'conflict',
                'This request was merged; vote on the other one',
              );
            await c.query(
              `INSERT INTO client_request_votes (workspace_id, request_id, user_id) VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [a.workspaceId, r.id, a.user.id],
            );
          } else
            await c.query(
              'DELETE FROM client_request_votes WHERE request_id = $1 AND user_id = $2',
              [r.id, a.user.id],
            );
          return { body: requestJson(await loadRequest(c, r.id)) };
        }),
    });

  const merge = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/client-requests/:requestId/merge',
    summary:
      'Merge a duplicate into another request of the same client: its votes move along, it is closed (member)',
    tags: ['clients'],
    params: reqParams,
    body: s.object({ intoId: uuid }),
    response: requestOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const dup = await loadRequest(c, params.requestId);
        const into = await loadRequest(c, body.intoId);
        if (dup.id === into.id)
          throw new HttpError(400, 'invalid_request', 'A request cannot be merged into itself');
        if (dup.client_id !== into.client_id)
          throw new HttpError(
            400,
            'invalid_request',
            'Only requests of the same client can be merged',
          );
        if (into.merged_into)
          throw new HttpError(409, 'conflict', 'The other request was merged itself');
        if (dup.merged_into) throw new HttpError(409, 'conflict', 'This request is merged already');
        const dupRef = requestRef(dup.kind, dup.number);
        const intoRef = requestRef(into.kind, into.number);
        // the requester and every voter of the duplicate count for the original
        await c.query(
          `INSERT INTO client_request_votes (workspace_id, request_id, user_id)
           SELECT $1::uuid, $2::uuid, user_id FROM client_request_votes WHERE request_id = $3
           UNION SELECT $1::uuid, $2::uuid, $4::uuid WHERE $4::uuid IS NOT NULL
           ON CONFLICT DO NOTHING`,
          [a.workspaceId, into.id, dup.id, dup.requested_by],
        );
        await c.query(
          `UPDATE client_requests SET merged_into = $2, state = 'declined', closed_at = coalesce(closed_at, now()), updated_at = now()
            WHERE id = $1`,
          [dup.id, into.id],
        );
        for (const [id, text] of [
          [dup.id, 'Merged into ' + intoRef + ' (' + into.title + '): follow it there.'],
          [into.id, dupRef + ' (' + dup.title + ') was merged into this request.'],
        ] as const)
          await c.query(
            `INSERT INTO client_request_messages (workspace_id, request_id, author_id, body, visibility)
             VALUES ($1, $2, $3, $4, 'client')`,
            [a.workspaceId, id, a.user.id, text],
          );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'client_request', id: dup.id, label: dupRef + ' ' + dup.title },
          changes: { mergedInto: { from: null, to: intoRef } },
        });
        return { body: requestJson(await loadRequest(c, into.id)) };
      }),
  });

  // ── NPS ──
  const npsDue = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/portal/nps',
    summary:
      'Whether the contact should be asked for a recommendation score now, and their last one',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    response: s.object({
      due: s.boolean(),
      last: s.nullable(s.object({ score: s.number({ integer: true }), at: s.string() })),
    }),
    handler: ({ params, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        const last = (
          await c.query<{ score: number; created_at: Date }>(
            'SELECT score, created_at FROM client_nps WHERE client_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
            [ctx.clientId, ctx.access.user.id],
          )
        ).rows[0];
        // [PCODE-427 | S15 | v0.1.0] the first time only once the person has worked with the team a while
        const since = (
          await c.query<{ at: Date }>(
            'SELECT min(created_at) AS at FROM client_contacts WHERE client_id = $1 AND user_id = $2',
            [ctx.clientId, ctx.access.user.id],
          )
        ).rows[0]?.at;
        const due =
          !ctx.asTeam &&
          (last
            ? Date.now() - last.created_at.getTime() > NPS_EVERY_DAYS * 86_400_000
            : !!since && Date.now() - since.getTime() > NPS_FIRST_AFTER_DAYS * 86_400_000);
        return {
          body: {
            due,
            last: last ? { score: last.score, at: last.created_at.toISOString() } : null,
          },
        };
      }),
  });

  const npsAnswer = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/portal/nps',
    summary: 'How likely the contact is to recommend the team, 0 to 10, with a comment (contact)',
    tags: ['portal'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({
      score: s.number({ integer: true, min: 0, max: 10 }),
      comment: s.optional(s.string({ max: 2000 })),
    }),
    response: s.object({ ok: s.literal(true) }),
    status: 201,
    handler: ({ params, body, req }) =>
      portalScope(pool, req, params.workspaceId, undefined, async (c, ctx) => {
        if (ctx.asTeam) throw new HttpError(403, 'forbidden', 'Only the client’s contacts answer');
        const recent = (
          await c.query(
            `SELECT 1 FROM client_nps WHERE client_id = $1 AND user_id = $2
               AND created_at > now() - make_interval(days => $3)`,
            [ctx.clientId, ctx.access.user.id, NPS_EVERY_DAYS],
          )
        ).rowCount;
        if (recent) throw new HttpError(409, 'conflict', 'You answered already; thank you');
        await c.query(
          'INSERT INTO client_nps (workspace_id, client_id, user_id, score, comment) VALUES ($1, $2, $3, $4, $5)',
          [
            ctx.access.workspaceId,
            ctx.clientId,
            ctx.access.user.id,
            body.score,
            (body.comment ?? '').trim(),
          ],
        );
        return { status: 201, body: { ok: true as const } };
      }),
  });

  const npsReport = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients-nps',
    summary:
      'The recommendation score per client over the last 180 days, with the latest comments (member)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid }),
    response: s.array(
      s.object({
        clientId: s.string(),
        score: s.nullable(s.number({ integer: true })),
        answers: s.number({ integer: true }),
        promoters: s.number({ integer: true }),
        passives: s.number({ integer: true }),
        detractors: s.number({ integer: true }),
        comments: s.array(
          s.object({
            score: s.number({ integer: true }),
            comment: s.string(),
            name: s.string(),
            at: s.string(),
          }),
        ),
      }),
    ),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const rows = (
          await c.query<{
            client_id: string;
            score: number;
            comment: string;
            name: string | null;
            created_at: Date;
          }>(
            `SELECT n.client_id, n.score, n.comment, u.name, n.created_at FROM client_nps n
               LEFT JOIN users u ON u.id = n.user_id
              WHERE n.created_at > now() - interval '180 days' ORDER BY n.created_at DESC`,
          )
        ).rows;
        const by = new Map<string, typeof rows>();
        for (const r of rows) by.set(r.client_id, [...(by.get(r.client_id) ?? []), r]);
        return {
          body: [...by].map(([clientId, list]) => ({
            clientId,
            ...npsOf(list.map((x) => x.score)),
            answers: list.length,
            comments: list
              .filter((x) => x.comment)
              .slice(0, 5)
              .map((x) => ({
                score: x.score,
                comment: x.comment,
                name: x.name ?? '',
                at: x.created_at.toISOString(),
              })),
          })),
        };
      }),
  });

  // ── the feedback widget ──
  const clientParams = s.object({ workspaceId: uuid, clientId: uuid });
  const listWidgets = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/clients/:clientId/widgets',
    summary: 'The client’s feedback widgets with the snippet for their site (member)',
    tags: ['clients'],
    params: clientParams,
    response: s.array(widgetOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        teamOnly(a);
        const rows = (
          await c.query<WidgetRow>(
            'SELECT * FROM feedback_widgets WHERE client_id = $1 ORDER BY created_at',
            [params.clientId],
          )
        ).rows;
        return { body: rows.map((w) => widgetJson(w, publicBase(req))) };
      }),
  });

  const origins = s.array(s.string({ min: 8, max: 200 }), { max: 20 });
  const cleanOrigins = (list: readonly string[]): string[] => {
    const out = list.map(originOf);
    if (out.some((x) => x === null))
      throw new HttpError(
        400,
        'invalid_request',
        'An origin is a web address like https://www.example.com',
        [{ path: 'body.origins', message: 'holds something that is not a web address' }],
      );
    return [...new Set(out as string[])];
  };

  const createWidget = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/clients/:clientId/widgets',
    summary: 'A feedback widget for the client’s site, with the origins that may use it (admin)',
    tags: ['clients'],
    params: clientParams,
    body: s.object({ name: s.string({ min: 1, max: 80 }), origins, projectId: s.optional(uuid) }),
    response: widgetOut,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        if (!(await c.query('SELECT 1 FROM clients WHERE id = $1', [params.clientId])).rowCount)
          throw new HttpError(404, 'not_found', 'Client not found');
        if (body.projectId) {
          const p = await requireProject(c, a, body.projectId);
          const owner = (
            await c.query<{ client_id: string | null }>(
              'SELECT client_id FROM projects WHERE id = $1',
              [p.id],
            )
          ).rows[0]?.client_id;
          if (owner !== params.clientId)
            throw new HttpError(400, 'invalid_request', 'The project is not the client’s', [
              { path: 'body.projectId', message: 'belongs to another client' },
            ]);
        }
        const w = (
          await c.query<WidgetRow>(
            `INSERT INTO feedback_widgets (workspace_id, client_id, project_id, name, public_key, origins, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
              a.workspaceId,
              params.clientId,
              body.projectId ?? null,
              body.name.trim(),
              'wk_' + randomBytes(18).toString('base64url'),
              cleanOrigins(body.origins),
              a.user.id,
            ],
          )
        ).rows[0];
        if (!w) throw new Error('widget insert returned nothing');
        return { status: 201, body: widgetJson(w, publicBase(req)) };
      }),
  });

  const widgetParams = s.object({ workspaceId: uuid, clientId: uuid, widgetId: uuid });
  const updateWidget = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/clients/:clientId/widgets/:widgetId',
    summary: 'Change a widget’s name or origins, or switch it off (admin)',
    tags: ['clients'],
    params: widgetParams,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 80 })),
      origins: s.optional(origins),
      enabled: s.optional(s.boolean()),
    }),
    response: widgetOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const w = (
          await c.query<WidgetRow>(
            `UPDATE feedback_widgets SET name = coalesce($3, name), origins = coalesce($4, origins), enabled = coalesce($5, enabled)
              WHERE id = $1 AND client_id = $2 RETURNING *`,
            [
              params.widgetId,
              params.clientId,
              body.name?.trim() ?? null,
              body.origins ? cleanOrigins(body.origins) : null,
              body.enabled ?? null,
            ],
          )
        ).rows[0];
        if (!w) throw new HttpError(404, 'not_found', 'Widget not found');
        return { body: widgetJson(w, publicBase(req)) };
      }),
  });

  const removeWidget = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/clients/:clientId/widgets/:widgetId',
    summary: 'Remove a widget; requests it brought stay (admin)',
    tags: ['clients'],
    params: widgetParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (
              await c.query('DELETE FROM feedback_widgets WHERE id = $1 AND client_id = $2', [
                params.widgetId,
                params.clientId,
              ])
            ).rowCount,
          ),
        },
      })),
  });

  const script = route({
    method: 'GET',
    path: '/widget.js',
    summary: 'The feedback widget’s script, for the client’s own site',
    tags: ['clients'],
    response: s.anyObject(),
    handler: () =>
      Promise.resolve({
        body: {},
        file: {
          data: Buffer.from(WIDGET_JS, 'utf8'),
          contentType: 'text/javascript; charset=utf-8',
          name: 'widget.js',
          inline: true,
        },
        headers: {
          'cross-origin-resource-policy': 'cross-origin',
          'cache-control': 'public, max-age=3600',
        },
      }),
  });

  // a visitor may send ten notes a day per widget
  const perVisitor = new RateLimiter(10, 86_400_000);
  const feedback = route({
    method: 'POST',
    path: '/widget/:key/feedback',
    summary:
      'Feedback from the widget on the client’s site: becomes a request of source widget (no sign-in)',
    tags: ['clients'],
    params: s.object({ key: s.string({ pattern: /^wk_[A-Za-z0-9_-]{20,40}$/ }) }),
    textJson: true,
    body: s.object({
      kind: s.optional(s.enum(['bug', 'feature', 'question'])),
      title: s.string({ min: 1, max: 200 }),
      text: s.optional(s.string({ max: 5000 })),
      email: s.optional(s.string({ max: 200 })),
      pageUrl: s.optional(s.string({ max: 1000 })),
      userAgent: s.optional(s.string({ max: 500 })),
      viewport: s.optional(s.string({ max: 20 })),
    }),
    response: s.object({ ref: s.string() }),
    status: 201,
    handler: async ({ params, body, req }) => {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      const cors: Record<string, string> = origin
        ? {
            'access-control-allow-origin': origin,
            vary: 'Origin',
            'cross-origin-resource-policy': 'cross-origin',
          }
        : {};
      const fail = (status: number, code: ErrorCode, message: string): never => {
        throw new HttpError(status, code, message, undefined, cors);
      };
      const w = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<WidgetRow>('SELECT * FROM feedback_widgets WHERE public_key = $1', [
              params.key,
            ])
          ).rows[0],
      );
      if (!w?.enabled) return fail(404, 'not_found', 'This feedback widget is not active');
      // only a page of an allowed site may send; the browser names it in Origin
      if (!origin || !w.origins.includes(origin))
        return fail(403, 'forbidden', 'This site may not send feedback here');
      const ip = req.socket.remoteAddress ?? 'unknown';
      const who = w.id + ' ' + ip;
      if (!perVisitor.allowed(who))
        return fail(429, 'too_many_requests', 'Thank you; that is enough for today');
      perVisitor.fail(who);
      const ref = await inSystem(pool, async (c: PoolClient) => {
        const kind = body.kind ?? 'bug';
        const client = (
          await c.query<{ response_hours: Record<string, number>; no: number }>(
            // [PCODE-428 | S15 | v0.1.0] each kind counts on its own
            'UPDATE clients SET next_request_no = next_request_no + 1 WHERE id = $1 RETURNING response_hours, (SELECT coalesce(max(number), 0) + 1 FROM client_requests WHERE client_id = $1 AND kind = $2) AS no',
            [w.client_id, kind],
          )
        ).rows[0];
        if (!client) return fail(404, 'not_found', 'This feedback widget is not active');
        const id = await insertRequest(c, {
          workspaceId: w.workspace_id,
          clientId: w.client_id,
          projectId: w.project_id,
          number: client.no,
          responseHours: client.response_hours,
          kind,
          title: body.title.trim().slice(0, 255),
          source: 'widget',
          userId: null,
        });
        const page = body.pageUrl && originOf(body.pageUrl) ? body.pageUrl.slice(0, 1000) : '';
        await c.query('UPDATE client_requests SET widget_id = $2, page_url = $3 WHERE id = $1', [
          id,
          w.id,
          page,
        ]);
        const lines = [
          (body.text ?? '').trim() || body.title.trim(),
          '',
          'From the ' + w.name + ' widget' + (body.email?.trim() ? ' · ' + body.email.trim() : ''),
          ...(page ? ['Page: ' + page] : []),
          ...(body.userAgent
            ? ['Browser: ' + body.userAgent + (body.viewport ? ', ' + body.viewport : '')]
            : []),
        ];
        await c.query(
          `INSERT INTO client_request_messages (workspace_id, request_id, author_id, body, visibility)
           VALUES ($1, $2, NULL, $3, 'client')`,
          [w.workspace_id, id, lines.join('\n').slice(0, 20000)],
        );
        await c.query(
          'UPDATE feedback_widgets SET received = received + 1, last_used_at = now() WHERE id = $1',
          [w.id],
        );
        const r = requestRef(kind, client.no);
        await recordEvent(c, w.workspace_id, {
          actor: { kind: 'integration', id: w.id, name: w.name + ' widget' },
          verb: 'created',
          object: { type: 'client_request', id, label: r + ' ' + body.title.trim() },
        });
        return r;
      });
      return { status: 201, body: { ref }, headers: cors };
    },
  });

  return [
    vote(true),
    vote(false),
    merge,
    npsDue,
    npsAnswer,
    npsReport,
    listWidgets,
    createWidget,
    updateWidget,
    removeWidget,
    script,
    feedback,
  ];
}
