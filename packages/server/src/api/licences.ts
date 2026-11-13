// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
//    Why:  a workspace's licence for people: what plan it is on, how many seats are used, what is limited
//          and why. Only an owner installs or removes a licence, and only a sound one is stored.
import type { Pool } from 'pg';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { entitlement, verifyLicence } from '../licence/licence.js';
import { actorOf, asMember } from './access.js';

const uuid = s.string({ format: 'uuid' });

const licenceOut = s.object({
  status: s.string(),
  plan: s.string(),
  seats: s.number({ integer: true }),
  used: s.number({ integer: true }),
  features: s.array(s.string()),
  customer: s.nullable(s.string()),
  expires: s.nullable(s.string()),
  problem: s.string(),
  source: s.string(),
});

export function licenceRoutes(pool: Pool): Route[] {
  const get = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/licence',
    summary: 'The workspace’s plan, seats and limits (member)',
    tags: ['licence'],
    params: s.object({ workspaceId: uuid }),
    response: licenceOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c, a) => ({
        body: await entitlement(c, a.workspaceId),
      })),
  });

  const install = route({
    method: 'PUT',
    path: '/api/workspaces/:workspaceId/licence',
    summary: 'Install a licence key for the workspace (owner)',
    tags: ['licence'],
    params: s.object({ workspaceId: uuid }),
    body: s.object({ token: s.string({ min: 10, max: 5000 }) }),
    response: licenceOut,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'owner', async (c, a) => {
        const v = verifyLicence(body.token);
        if ('problem' in v)
          throw new HttpError(400, 'invalid_request', v.problem, [
            { path: 'body.token', message: v.problem },
          ]);
        await c.query(
          `INSERT INTO workspace_licences (workspace_id, token, installed_by) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id) DO UPDATE SET token = $2, installed_by = $3, installed_at = now()`,
          [a.workspaceId, body.token.trim(), a.user.id],
        );
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId, label: 'licence' },
          changes: {
            licence: {
              from: null,
              to: { plan: v.licence.plan, seats: v.licence.seats, expires: v.licence.expires },
            },
          },
        });
        return { body: await entitlement(c, a.workspaceId) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/licence',
    summary: 'Remove the workspace’s licence; the free plan applies again (owner)',
    tags: ['licence'],
    params: s.object({ workspaceId: uuid }),
    response: licenceOut,
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'owner', async (c, a) => {
        await c.query('DELETE FROM workspace_licences WHERE workspace_id = $1', [a.workspaceId]);
        await recordEvent(c, a.workspaceId, {
          actor: actorOf(a),
          verb: 'updated',
          object: { type: 'workspace', id: a.workspaceId, label: 'licence' },
          changes: { licence: { from: 'installed', to: null } },
        });
        return { body: await entitlement(c, a.workspaceId) };
      }),
  });

  return [get, install, remove];
}
