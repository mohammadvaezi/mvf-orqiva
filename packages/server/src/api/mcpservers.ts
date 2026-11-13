// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  admins keep the outside MCP servers agents may use: their address, the header with their key
//          (sealed at once and never shown again), what kind of action their tools are, and which tools
//          agents may call. A test opens the server and lists its tools.
import type { Pool, PoolClient } from 'pg';
import { allowedTools, clientFor, type McpServerRow } from '../agents/mcptools.js';
import { seal, SecretKeyMissing } from '../agents/secrets.js';
import { recordEvent } from '../events/outbox.js';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { actorOf, asMember, type Access } from './access.js';

const uuid = s.string({ format: 'uuid' });
const ws = s.object({ workspaceId: uuid });
const one = s.object({ workspaceId: uuid, serverId: uuid });
const CLASSES = ['read', 'comment', 'write', 'external'] as const;

interface Row extends McpServerRow {
  secret_hint: string;
  tool_count: number | null;
  last_ok_at: Date | null;
  last_error: string;
  created_at: Date;
  agents: string[];
}

const SELECT = `SELECT m.*, coalesce((SELECT array_agg(a.name ORDER BY a.name) FROM agents a WHERE m.id = ANY(a.mcp_servers)), '{}') AS agents
                  FROM mcp_servers m`;

const out = s.object({
  id: s.string(),
  name: s.string(),
  label: s.string(),
  url: s.string(),
  headerName: s.string(),
  hasSecret: s.boolean(),
  hint: s.string(),
  actionClass: s.enum(CLASSES),
  allowedTools: s.array(s.string()),
  toolCount: s.nullable(s.number({ integer: true })),
  lastOkAt: s.nullable(s.string()),
  lastError: s.string(),
  agents: s.array(s.string()),
  createdAt: s.string(),
});

const json = (r: Row) => ({
  id: r.id,
  name: r.name,
  label: r.label,
  url: r.url,
  headerName: r.header_name,
  hasSecret: Boolean(r.secret_sealed),
  hint: r.secret_hint,
  actionClass: r.action_class as (typeof CLASSES)[number],
  allowedTools: r.allowed_tools,
  toolCount: r.tool_count,
  lastOkAt: r.last_ok_at?.toISOString() ?? null,
  lastError: r.last_error,
  agents: r.agents,
  createdAt: r.created_at.toISOString(),
});

/** An address an MCP server can have: https, or http on this machine. */
export function mcpUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'is not an address';
  }
  if (u.username || u.password) return 'carries a name or password; put the key in the header';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    return null;
  return 'must be https (http only on this machine)';
}

const fields = {
  label: s.optional(s.string({ min: 1, max: 80 })),
  url: s.optional(s.string({ min: 8, max: 500 })),
  headerName: s.optional(s.string({ pattern: /^[A-Za-z][A-Za-z0-9-]{0,60}$/ })),
  secret: s.optional(s.nullable(s.string({ min: 1, max: 4000 }))),
  actionClass: s.optional(s.enum(CLASSES)),
  allowedTools: s.optional(s.array(s.string({ min: 1, max: 120 }), { max: 100 })),
};

function sealed(secret: string): { sealed: string; hint: string } {
  try {
    return { sealed: seal(secret.trim()), hint: secret.trim().slice(-4) };
  } catch (e) {
    if (e instanceof SecretKeyMissing) throw new HttpError(409, 'conflict', e.message);
    throw e;
  }
}

async function event(c: PoolClient, a: Access, text: string) {
  await recordEvent(c, a.workspaceId, {
    actor: actorOf(a),
    verb: 'updated',
    object: { type: 'workspace', id: a.workspaceId, label: 'MCP servers' },
    changes: { mcpServers: { from: null, to: text } },
  });
}

export function mcpServerRoutes(pool: Pool, fetchImpl?: typeof fetch): Route[] {
  const byId = async (c: PoolClient, id: string): Promise<Row> => {
    const r = (await c.query<Row>(SELECT + ' WHERE m.id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'MCP server not found');
    return r;
  };
  const badUrl = (url: string): void => {
    const p = mcpUrlProblem(url);
    if (p)
      throw new HttpError(400, 'invalid_request', 'The address ' + p, [
        { path: 'body.url', message: p },
      ]);
  };

  const list = route({
    method: 'GET',
    path: '/api/workspaces/:workspaceId/mcp-servers',
    summary:
      'The MCP servers agents may use, with the agents that use each; never the keys (member)',
    tags: ['agents'],
    params: ws,
    response: s.array(out),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'member', async (c) => ({
        body: (await c.query<Row>(SELECT + ' ORDER BY m.name')).rows.map(json),
      })),
  });

  const create = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/mcp-servers',
    summary: 'Add an MCP server: its name, address, key header and kind of action (admin)',
    tags: ['agents'],
    params: ws,
    body: s.object({
      ...fields,
      name: s.string({ pattern: /^[a-z][a-z0-9-]{0,19}$/ }),
      url: s.string({ min: 8, max: 500 }),
    }),
    response: out,
    status: 201,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        badUrl(body.url);
        if ((await c.query('SELECT 1 FROM mcp_servers WHERE name = $1', [body.name])).rowCount)
          throw new HttpError(
            409,
            'conflict',
            'There is an MCP server named ' + body.name + ' already',
          );
        const sec = body.secret ? sealed(body.secret) : null;
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO mcp_servers (workspace_id, name, label, url, header_name, secret_sealed, secret_hint,
                                      action_class, allowed_tools, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              a.workspaceId,
              body.name,
              (body.label ?? body.name).trim(),
              body.url.trim(),
              body.headerName ?? 'Authorization',
              sec?.sealed ?? null,
              sec?.hint ?? '',
              body.actionClass ?? 'external',
              [...new Set(body.allowedTools ?? [])],
              a.user.id,
            ],
          )
        ).rows[0]?.id;
        if (!id) throw new Error('MCP server insert returned nothing');
        await event(c, a, body.name + ' added');
        return { status: 201, body: json(await byId(c, id)) };
      }),
  });

  const update = route({
    method: 'PATCH',
    path: '/api/workspaces/:workspaceId/mcp-servers/:serverId',
    summary: 'Change an MCP server; a key of null takes it away (admin)',
    tags: ['agents'],
    params: one,
    body: s.object(fields),
    response: out,
    handler: ({ params, body, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        const cur = await byId(c, params.serverId);
        if (body.url !== undefined) badUrl(body.url);
        const sec = body.secret ? sealed(body.secret) : null;
        await c.query(
          `UPDATE mcp_servers SET label = coalesce($2, label), url = coalesce($3, url), header_name = coalesce($4, header_name),
                  secret_sealed = CASE WHEN $5 THEN secret_sealed ELSE $6 END,
                  secret_hint = CASE WHEN $5 THEN secret_hint ELSE $7 END,
                  action_class = coalesce($8, action_class), allowed_tools = coalesce($9, allowed_tools)
            WHERE id = $1`,
          [
            cur.id,
            body.label?.trim() ?? null,
            body.url?.trim() ?? null,
            body.headerName ?? null,
            body.secret === undefined,
            sec?.sealed ?? null,
            sec?.hint ?? '',
            body.actionClass ?? null,
            body.allowedTools ? [...new Set(body.allowedTools)] : null,
          ],
        );
        await event(c, a, cur.name + ' changed');
        return { body: json(await byId(c, cur.id)) };
      }),
  });

  const remove = route({
    method: 'DELETE',
    path: '/api/workspaces/:workspaceId/mcp-servers/:serverId',
    summary: 'Remove an MCP server; agents stop using it (admin)',
    tags: ['agents'],
    params: one,
    response: s.object({ removed: s.boolean() }),
    handler: ({ params, req }) =>
      asMember(pool, req, params.workspaceId, 'admin', async (c, a) => {
        await c.query('UPDATE agents SET mcp_servers = array_remove(mcp_servers, $1::uuid)', [
          params.serverId,
        ]);
        const r = (
          await c.query<{ name: string }>('DELETE FROM mcp_servers WHERE id = $1 RETURNING name', [
            params.serverId,
          ])
        ).rows[0];
        if (r) await event(c, a, r.name + ' removed');
        return { body: { removed: Boolean(r) } };
      }),
  });

  const test = route({
    method: 'POST',
    path: '/api/workspaces/:workspaceId/mcp-servers/:serverId/test',
    summary: 'Open the MCP server and list its tools; the ones agents may call are marked (admin)',
    tags: ['agents'],
    params: one,
    response: s.object({
      ok: s.boolean(),
      server: s.string(),
      tools: s.array(s.object({ name: s.string(), description: s.string(), allowed: s.boolean() })),
      ms: s.number({ integer: true }),
      error: s.string(),
    }),
    handler: async ({ params, req }) => {
      const row = await asMember(pool, req, params.workspaceId, 'admin', (c) =>
        byId(c, params.serverId),
      );
      const started = Date.now();
      let result: {
        ok: boolean;
        server: string;
        tools: { name: string; description: string; allowed: boolean }[];
        error: string;
      };
      try {
        const client = clientFor(row, fetchImpl);
        const info = await client.open();
        const tools = await client.listTools();
        const allowed = new Set(allowedTools(row, tools).map((t) => t.name));
        result = {
          ok: true,
          server: [info.name, info.version].filter(Boolean).join(' '),
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description.slice(0, 300),
            allowed: allowed.has(t.name),
          })),
          error: '',
        };
      } catch (e) {
        result = {
          ok: false,
          server: '',
          tools: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
      await asMember(pool, req, params.workspaceId, 'admin', (c) =>
        result.ok
          ? c.query(
              "UPDATE mcp_servers SET tool_count = $2, last_ok_at = now(), last_error = '' WHERE id = $1",
              [row.id, result.tools.length],
            )
          : c.query('UPDATE mcp_servers SET last_error = left($2, 500) WHERE id = $1', [
              row.id,
              result.error,
            ]),
      );
      return { body: { ...result, ms: Date.now() - started } };
    },
  });

  return [list, create, update, remove, test];
}
