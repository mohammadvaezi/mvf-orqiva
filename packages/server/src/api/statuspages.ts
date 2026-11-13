// ── [PCODE-341 | S15 | v0.1.0] T34.2b Public status pages per client and environment; incident update templates ──
//    Why:  a client may want its users to see how things stand without an account: its status page opens
//          to everyone at a short name, one environment at a time if asked. Incident updates start from
//          templates, the four steps built in and a workspace's own.
import { BUILTIN_UPDATE_TEMPLATES } from '@orqiva/shared';
import type { Pool } from 'pg';
import { inSystem, inWorkspace } from '../db/pool.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { asMember } from './access.js';
import { statusPage } from './status.js';

const uuid = s.string({ format: 'uuid' });
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

const templateOut = s.object({
  id: s.nullable(s.string()),
  name: s.string(),
  audience: s.enum(['team', 'client']),
  body: s.string(),
  builtIn: s.boolean(),
});

export function statusPageRoutes(pool: Pool): Route[] {
  const publicPage = route({
    method: 'GET',
    path: '/api/public/status/:slug',
    summary:
      'A client’s public status page: components by environment, uptime and reported incidents; no sign-in',
    tags: ['portal'],
    params: s.object({ slug: s.string({ pattern: SLUG }) }),
    query: s.object({ environment: s.optional(s.string({ max: 30 })) }),
    response: s.anyObject(),
    handler: async ({ params, query }) => {
      const cl = await inSystem(
        pool,
        async (c) =>
          (
            await c.query<{
              id: string;
              workspace_id: string;
              name: string;
              branding: Record<string, unknown>;
            }>(
              'SELECT id, workspace_id, name, branding FROM clients WHERE status_slug = $1 AND status_public AND archived_at IS NULL',
              [params.slug],
            )
          ).rows[0],
      );
      if (!cl) throw new HttpError(404, 'not_found', 'There is no public status page here');
      const page = await inWorkspace(pool, cl.workspace_id, async (c) => {
        const projectIds = (
          await c.query<{ id: string }>(
            'SELECT id FROM projects WHERE client_id = $1 AND archived_at IS NULL',
            [cl.id],
          )
        ).rows.map((r) => r.id);
        return statusPage(c, cl.id, projectIds, query.environment ?? null);
      });
      // incidents, uptime and components only: postmortems stay in the portal
      return {
        body: {
          name: cl.name,
          color: typeof cl.branding['primary'] === 'string' ? cl.branding['primary'] : null,
          incidents: page.incidents,
          components: page.components,
        },
        headers: { 'cache-control': 'public, max-age=30' },
      };
    },
  });

  const settings = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/clients/:clientId/status-page',
    summary: 'Open the client’s status page to everyone at a short name, or close it (admin)',
    tags: ['clients'],
    params: s.object({ workspaceId: uuid, clientId: uuid }),
    body: s.object({ public: s.boolean(), slug: s.optional(s.string({ pattern: SLUG })) }),
    response: s.object({ public: s.boolean(), slug: s.nullable(s.string()) }),
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => {
        const cur = (
          await c.query<{ status_slug: string | null }>(
            'SELECT status_slug FROM clients WHERE id = $1',
            [params.clientId],
          )
        ).rows[0];
        if (!cur) throw new HttpError(404, 'not_found', 'Client not found');
        const slug = body.slug ?? cur.status_slug;
        if (body.public && !slug)
          throw new HttpError(400, 'invalid_request', 'Choose a short name for the page', [
            { path: 'body.slug', message: 'is needed to open the page' },
          ]);
        if (slug && slug !== cur.status_slug) {
          const taken = await inSystem(
            pool,
            async (sc) =>
              (await sc.query('SELECT 1 FROM clients WHERE status_slug = $1', [slug])).rowCount,
          );
          if (taken) throw new HttpError(409, 'conflict', 'The name ' + slug + ' is taken');
        }
        await c.query('UPDATE clients SET status_public = $2, status_slug = $3 WHERE id = $1', [
          params.clientId,
          body.public,
          slug,
        ]);
        return { body: { public: body.public, slug } };
      }),
  });

  const ws = s.object({ workspaceId: uuid });
  const listTemplates = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/incident-templates',
    summary: 'The update templates: the built-in steps and the workspace’s own (member)',
    tags: ['incidents'],
    params: ws,
    response: s.array(templateOut),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => {
        const own = (
          await c.query<{ id: string; name: string; audience: 'team' | 'client'; body: string }>(
            'SELECT id, name, audience, body FROM incident_update_templates ORDER BY name',
          )
        ).rows;
        return {
          body: [
            ...BUILTIN_UPDATE_TEMPLATES.filter((b) => !own.some((o) => o.name === b.name)).map(
              (b) => ({
                id: null,
                ...b,
                builtIn: true,
              }),
            ),
            ...own.map((o) => ({ ...o, builtIn: false })),
          ],
        };
      }),
  });

  const saveTemplate = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/incident-templates',
    summary: 'Keep a template by its name; one named like a built-in replaces it (admin)',
    tags: ['incidents'],
    params: ws,
    body: s.object({
      name: s.string({ min: 1, max: 60 }),
      audience: s.enum(['team', 'client']),
      body: s.string({ min: 1, max: 4000 }),
    }),
    response: templateOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const r = (
          await c.query<{ id: string; name: string; audience: 'team' | 'client'; body: string }>(
            `INSERT INTO incident_update_templates (workspace_id, name, audience, body, created_by) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (workspace_id, name) DO UPDATE SET audience = EXCLUDED.audience, body = EXCLUDED.body
             RETURNING id, name, audience, body`,
            [a.workspaceId, body.name.trim(), body.audience, body.body.trim(), a.user.id],
          )
        ).rows[0];
        if (!r) throw new Error('template insert returned nothing');
        return { body: { ...r, builtIn: false } };
      }),
  });

  const removeTemplate = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/incident-templates/:templateId',
    summary: 'Remove a workspace template; a built-in it replaced comes back (admin)',
    tags: ['incidents'],
    params: s.object({ workspaceId: uuid, templateId: uuid }),
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c) => ({
        body: {
          removed: Boolean(
            (
              await c.query('DELETE FROM incident_update_templates WHERE id = $1', [
                params.templateId,
              ])
            ).rowCount,
          ),
        },
      })),
  });

  return [publicPage, settings, listTemplates, saveTemplate, removeTemplate];
}
