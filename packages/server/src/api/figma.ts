// ── [PCODE-351 | S15 | v0.1.0] T35.3b Settings for teams and projects in the screen, project leads as project admins, budget warnings at 50/80/100 % ──
// ── [PCODE-297 | S15 | v0.1.0] T30.10 Figma two-way sync: variables and components, tested against recorded Figma answers ──
//    Why:  a project's Figma file, compared with its tokens. Checking reads Figma, records what both
//          sides agree on as the base, links the components by name and keeps the comparison to show.
//          Taking and sending read Figma again first, so a decision never acts on a stale comparison:
//          what is sent goes to Figma in one request, what is taken is written to the tokens, and the
//          base moves with both.
import {
  componentKey,
  figmaComponentLinks,
  figmaFileKey,
  figmaPushBody,
  figmaSide,
  orqivaSide,
  sideFromJson,
  sideToJson,
  syncPlan,
  type SyncChange,
  type SyncPlan,
  type SyncSide,
  type SyncToken,
} from '@orqiva/shared';
import type { Pool, PoolClient } from 'pg';
import { open, seal, SecretKeyMissing } from '../agents/secrets.js';
import {
  FigmaError,
  figmaComponents,
  figmaVariables,
  figmaWriteVariables,
  type FigmaConn,
} from '../figma/client.js';
import { apiUrlProblem } from '../git/hostapi.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember, requireProject, requireProjectAdmin } from './access.js';
import { asToken, loadTokens } from './uikit.js';

const uuid = s.string({ format: 'uuid' });
const projectParams = s.object({ workspaceId: uuid, projectId: uuid });

interface LinkRow {
  project_id: string;
  file_key: string;
  api_token: string | null;
  api_url: string | null;
  snapshot: Record<string, SyncToken>;
  plan: SyncPlan | null;
  skipped: { name: string; reason: string }[];
  components_linked: number;
  checked_at: Date | null;
  pulled_at: Date | null;
  pushed_at: Date | null;
}

const linkJson = (r: LinkRow) => ({
  fileKey: r.file_key,
  fileUrl: 'https://www.figma.com/design/' + r.file_key + '/',
  apiUrl: r.api_url,
  hasToken: Boolean(r.api_token),
  componentsLinked: r.components_linked,
  checkedAt: r.checked_at?.toISOString() ?? null,
  pulledAt: r.pulled_at?.toISOString() ?? null,
  pushedAt: r.pushed_at?.toISOString() ?? null,
});

async function linkOf(c: PoolClient, projectId: string): Promise<LinkRow> {
  const r = (await c.query<LinkRow>('SELECT * FROM figma_links WHERE project_id = $1', [projectId]))
    .rows[0];
  if (!r) throw new HttpError(404, 'not_found', 'The project has no Figma file');
  return r;
}

function connOf(r: LinkRow): FigmaConn {
  if (!r.api_token) throw new HttpError(409, 'conflict', 'The Figma link has no access token');
  let token: string;
  try {
    token = open(r.api_token);
  } catch {
    throw new HttpError(409, 'conflict', 'The Figma token cannot be read; set it again');
  }
  return { fileKey: r.file_key, token, apiUrl: r.api_url };
}

/** Figma's answer as an error the person can act on. */
async function viaFigma<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof FigmaError)
      throw new HttpError(
        e.status === 401 || e.status === 403 ? 409 : 502,
        'bad_gateway',
        e.message,
      );
    throw e;
  }
}

/** Both sides now, and the comparison with the base. */
async function compare(c: PoolClient, link: LinkRow, conn: FigmaConn, fetchImpl?: typeof fetch) {
  const answer = await viaFigma(() => figmaVariables(conn, fetchImpl));
  const fig = figmaSide(answer);
  const orq = orqivaSide((await loadTokens(c, link.project_id)).map(asToken));
  const base = sideFromJson(link.snapshot);
  return { fig, orq, base, plan: syncPlan(base, orq, fig.tokens) };
}

/** The base after a comparison: what both sides agree on now is agreed. */
function agreed(base: SyncSide, orq: SyncSide, fig: SyncSide): SyncSide {
  const out = new Map(base);
  for (const [n, o] of orq) {
    const f = fig.get(n);
    if (
      f &&
      JSON.stringify(sideToJson(new Map([[n, o]]))) ===
        JSON.stringify(sideToJson(new Map([[n, f]])))
    )
      out.set(n, o);
  }
  for (const n of [...out.keys()]) if (!orq.has(n) && !fig.has(n)) out.delete(n);
  return out;
}

const planOut = s.anyObject();

export function figmaRoutes(pool: Pool, fetchImpl?: typeof fetch): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/projects/:projectId/figma',
    summary: 'The project’s Figma file and the last comparison of its variables with the tokens',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({
      link: s.nullable(s.anyObject()),
      plan: s.nullable(planOut),
      skipped: s.array(s.anyObject()),
    }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'auditor', async (c, a) => {
        await requireProject(c, a, params.projectId);
        const r = (
          await c.query<LinkRow>('SELECT * FROM figma_links WHERE project_id = $1', [
            params.projectId,
          ])
        ).rows[0];
        return {
          body: r
            ? { link: linkJson(r), plan: r.plan ? { ...r.plan } : null, skipped: r.skipped }
            : { link: null, plan: null, skipped: [] },
        };
      }),
  });

  const connect = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/projects/:projectId/figma',
    summary:
      'Link a Figma file (its link or key) with an access token, sealed and never shown again; leaving the token out keeps the one set (admin)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      file: s.string({ min: 10, max: 500 }),
      token: s.optional(s.nullable(s.string({ min: 8, max: 500 }))),
      apiUrl: s.optional(s.nullable(s.string({ max: 500 }))),
    }),
    response: s.anyObject(),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        const key = figmaFileKey(body.file);
        if (!key)
          throw new HttpError(400, 'invalid_request', 'A Figma file link or key', [
            { path: 'body.file', message: 'is not a Figma file link' },
          ]);
        const url = body.apiUrl?.trim() || null;
        const bad = url ? apiUrlProblem(url) : null;
        if (bad)
          throw new HttpError(400, 'invalid_request', 'The API address ' + bad, [
            { path: 'body.apiUrl', message: bad },
          ]);
        let sealed: string | null | undefined;
        try {
          sealed =
            body.token === undefined ? undefined : body.token ? seal(body.token.trim()) : null;
        } catch (e) {
          if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
          throw e;
        }
        const old = (
          await c.query<{ file_key: string }>(
            'SELECT file_key FROM figma_links WHERE project_id = $1',
            [p.id],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO figma_links (project_id, workspace_id, file_key, api_token, api_url, linked_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id) DO UPDATE SET file_key = $3, api_url = $5, linked_by = $6,
             api_token = CASE WHEN $7 THEN figma_links.api_token ELSE $4 END,
             -- another file starts from nothing
             snapshot = CASE WHEN figma_links.file_key = $3 THEN figma_links.snapshot ELSE '{}'::jsonb END,
             plan = CASE WHEN figma_links.file_key = $3 THEN figma_links.plan ELSE NULL END`,
          [
            p.id,
            a.workspaceId,
            key,
            sealed ?? null,
            url,
            a.user.id,
            sealed === undefined && Boolean(old),
          ],
        );
        return { body: linkJson(await linkOf(c, p.id)) };
      }),
  });

  const unlink = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/projects/:projectId/figma',
    summary: 'Unlink the Figma file; the tokens stay as they are (admin)',
    tags: ['uikit'],
    params: projectParams,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        // [PCODE-351 | S15 | v0.1.0] an admin, or the lead of this project
        await requireProjectAdmin(c, a, params.projectId);
        const p = await requireProject(c, a, params.projectId);
        await c.query('DELETE FROM figma_links WHERE project_id = $1', [p.id]);
        return { body: { removed: true } };
      }),
  });

  const check = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/figma/check',
    summary:
      'Read the Figma file: compare its variables with the tokens, link the components by name (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({}),
    response: s.object({ link: s.anyObject(), plan: planOut, skipped: s.array(s.anyObject()) }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const link = await linkOf(c, p.id);
        const conn = connOf(link);
        const { fig, orq, base, plan } = await compare(c, link, conn, fetchImpl);
        // components: a link to their Figma node, unless one points elsewhere already
        const links = figmaComponentLinks(
          link.file_key,
          await viaFigma(() => figmaComponents(conn, fetchImpl)),
        );
        let linked = 0;
        const comps = (
          await c.query<{ id: string; name: string; design_url: string }>(
            'SELECT id, name, design_url FROM ui_components WHERE project_id = $1',
            [p.id],
          )
        ).rows;
        for (const comp of comps) {
          const url = links.get(componentKey(comp.name));
          if (!url) continue;
          linked += 1;
          if (comp.design_url && !comp.design_url.includes('figma.com')) continue;
          if (comp.design_url !== url)
            await c.query(
              'UPDATE ui_components SET design_url = $2, updated_at = now() WHERE id = $1',
              [comp.id, url],
            );
        }
        await c.query(
          'UPDATE figma_links SET snapshot = $2, plan = $3, skipped = $4, components_linked = $5, checked_at = now() WHERE project_id = $1',
          [
            p.id,
            JSON.stringify(sideToJson(agreed(base, orq, fig.tokens))),
            JSON.stringify(plan),
            JSON.stringify(fig.index.skipped),
            linked,
          ],
        );
        const after = await linkOf(c, p.id);
        return { body: { link: linkJson(after), plan: { ...plan }, skipped: fig.index.skipped } };
      }),
  });

  const apply = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/projects/:projectId/figma/apply',
    summary:
      'Take tokens from Figma and send tokens to Figma, by name; a conflict is decided by the list it is in (member)',
    tags: ['uikit'],
    params: projectParams,
    body: s.object({
      take: s.array(s.string({ min: 1, max: 100 }), { max: 2000 }),
      send: s.array(s.string({ min: 1, max: 100 }), { max: 2000 }),
    }),
    response: s.object({
      taken: s.number({ integer: true }),
      sent: s.number({ integer: true }),
      notSent: s.array(s.anyObject()),
      plan: planOut,
    }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => {
        const p = await requireProject(c, a, params.projectId);
        const both = body.take.filter((n) => body.send.includes(n));
        if (both.length)
          throw new HttpError(400, 'invalid_request', 'A token is either taken or sent', [
            { path: 'body.send', message: String(both[0]) + ' is in both lists' },
          ]);
        const link = await linkOf(c, p.id);
        const conn = connOf(link);
        const { fig, base, plan } = await compare(c, link, conn, fetchImpl);
        const pick = (
          names: readonly string[],
          from: readonly SyncChange[],
          other: 'orqiva' | 'figma',
        ) =>
          names.flatMap((n): SyncChange[] => {
            const ch = from.find((x) => x.name === n);
            if (ch) return [ch];
            const k = plan.conflicts.find((x) => x.name === n);
            if (!k) return [];
            const to = other === 'figma' ? k.figma : k.orqiva;
            const fromTok = other === 'figma' ? k.orqiva : k.figma;
            return [
              { name: n, kind: !fromTok ? 'add' : !to ? 'remove' : 'change', from: fromTok, to },
            ];
          });
        const take = pick(body.take, plan.pull, 'figma');
        const send = pick(body.send, plan.push, 'orqiva');
        const unknown = [...body.take, ...body.send].filter(
          (n) => !take.some((x) => x.name === n) && !send.some((x) => x.name === n),
        );
        if (unknown.length)
          throw new HttpError(
            409,
            'conflict',
            'Nothing waits for ' + unknown.slice(0, 3).join(', ') + ' now; check Figma again',
            [{ path: 'body', message: unknown.join(', ') + ' are in sync or unknown' }],
          );
        const next = new Map(base);
        // to Figma first: if Figma refuses, nothing in Orqiva has changed
        let notSent: { name: string; reason: string }[] = [];
        if (send.length) {
          const { body: req2, skipped } = figmaPushBody(send, fig.index);
          notSent = skipped;
          await viaFigma(() => figmaWriteVariables(conn, req2, fetchImpl));
          for (const ch of send)
            if (!skipped.some((x) => x.name === ch.name)) {
              if (ch.to) next.set(ch.name, ch.to);
              else next.delete(ch.name);
            }
        }
        // into Orqiva: tokens, and themes for modes it does not have yet
        const themes = new Set(
          (
            await c.query<{ name: string }>('SELECT name FROM token_themes WHERE project_id = $1', [
              p.id,
            ])
          ).rows.map((t) => t.name),
        );
        for (const ch of take) {
          if (!ch.to) {
            await c.query('DELETE FROM design_tokens WHERE project_id = $1 AND name = $2', [
              p.id,
              ch.name,
            ]);
            next.delete(ch.name);
            continue;
          }
          for (const t of Object.keys(ch.to.themes))
            if (!themes.has(t)) {
              await c.query(
                "INSERT INTO token_themes (workspace_id, project_id, name, base, description) VALUES ($1, $2, $3, 'light', 'From the Figma mode of this name') ON CONFLICT DO NOTHING",
                [a.workspaceId, p.id, t],
              );
              themes.add(t);
            }
          await c.query(
            `INSERT INTO design_tokens (workspace_id, project_id, name, type, value_light, value_dark, description, theme_values, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (project_id, name) DO UPDATE SET type = $4, value_light = $5, value_dark = $6,
               description = CASE WHEN $7 = '' THEN design_tokens.description ELSE $7 END, theme_values = $8, updated_by = $9, updated_at = now()`,
            [
              a.workspaceId,
              p.id,
              ch.name,
              ch.to.type,
              ch.to.light,
              ch.to.dark === ch.to.light ? '' : ch.to.dark,
              ch.to.description.slice(0, 1000),
              JSON.stringify(ch.to.themes),
              a.user.id,
            ],
          );
          next.set(ch.name, ch.to);
        }
        // what both now hold is the new base, and the comparison is shown fresh
        const nowOrq = orqivaSide((await loadTokens(c, p.id)).map(asToken));
        const after = new Map(next);
        for (const n of [...after.keys()])
          if (!nowOrq.has(n) && !fig.tokens.has(n) && !send.some((x) => x.name === n))
            after.delete(n);
        const fresh = syncPlan(after, nowOrq, applySent(fig.tokens, send, notSent));
        await c.query(
          `UPDATE figma_links SET snapshot = $2, plan = $3,
             pulled_at = CASE WHEN $4 THEN now() ELSE pulled_at END,
             pushed_at = CASE WHEN $5 THEN now() ELSE pushed_at END WHERE project_id = $1`,
          [
            p.id,
            JSON.stringify(sideToJson(after)),
            JSON.stringify(fresh),
            take.length > 0,
            send.length > 0,
          ],
        );
        return {
          body: {
            taken: take.length,
            sent: send.length - notSent.length,
            notSent,
            plan: { ...fresh },
          },
        };
      }),
  });

  return [get, connect, unlink, check, apply];
}

/** Figma's side as it is after the sent changes, without asking it again. */
function applySent(
  fig: SyncSide,
  sent: readonly SyncChange[],
  notSent: readonly { name: string }[],
): SyncSide {
  const out = new Map(fig);
  for (const ch of sent) {
    if (notSent.some((x) => x.name === ch.name)) continue;
    if (ch.to) out.set(ch.name, ch.to);
    else out.delete(ch.name);
  }
  return out;
}
