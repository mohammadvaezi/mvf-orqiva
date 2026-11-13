// ── [PCODE-310 | S15 | v0.1.0] T31.9a MCP tools for the code map and pull requests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
// ── [PCODE-121 | S15 | v0.1.0] Add our own MCP server over HTTP with the agent tools ──
//    Why:  outside agents (Claude Code or any MCP client) reach Orqiva through a server we wrote from the
//          open protocol: JSON-RPC 2.0 over HTTP POST at /mcp/<workspace id>, signed in with a personal API
//          token. The tools are the agents' own, run as the token's person with their role, so a client can do
//          nothing that person could not. The person stands behind the client, so a move needs no second
//          approval; finishing or cancelling work stays with people in the app, as for every agent.
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.js';
import { route, type Route } from '../http/router.js';
import { s } from '../http/schema.js';
import { DEFAULT_TOOLS } from '../agents/defaults.js';
import { runTool, toolSpecs } from '../agents/tools.js';
import { actorOf, asMember } from './access.js';
import { CODE_TOOLS, isCodeTool, pullOf, runCodeTool } from './mcpcode.js'; // [PCODE-310 | S15 | v0.1.0]
import { ensureFiles } from './prreview.js'; // [PCODE-310 | S15 | v0.1.0]

/** Protocol versions we speak, newest first; a client asking for another gets the newest. */
export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

const SERVER_INFO = { name: 'orqiva', title: 'Orqiva', version: '0.1.0' };

const INSTRUCTIONS =
  'Orqiva tasks of one workspace. Name a project by its key (e.g. APP) and a task by its reference ' +
  '(e.g. APP-12). list_projects shows the projects you may see. You act as the person whose token you use. ' +
  // [PCODE-310 | S15 | v0.1.0]
  'code_map and code_dependencies read the scanned code; list_pull_requests, get_pull_request and ' +
  'comment_on_pull_request the reviews (drafts are posted by you in Orqiva).';

const LIST_PROJECTS = {
  name: 'list_projects',
  description: 'List the projects you may see: key, name and description.',
  inputSchema: { type: 'object', properties: {} },
};

type Id = string | number | null;
type RpcReply = { jsonrpc: '2.0'; id: Id } & (
  { result: Record<string, unknown> } | { error: { code: number; message: string; data?: unknown } }
);

const ok = (id: Id, result: Record<string, unknown>): RpcReply => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string): RpcReply => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

// JSON-RPC 2.0 error codes
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export function mcpRoutes(pool: Pool, fetchImpl?: typeof fetch): Route[] {
  const endpoint = route({
    method: 'POST',
    path: '/mcp/:workspaceId',
    summary:
      'MCP server (JSON-RPC 2.0): initialize, tools/list, tools/call; personal API token only',
    tags: ['agents'],
    params: s.object({ workspaceId: s.string({ format: 'uuid' }) }),
    body: s.anyObject(),
    response: s.anyObject(),
    handler: async ({ params, body, req }) => {
      // a browser's cookie never opens this door: a page could otherwise drive tools as its visitor
      if (!/^Bearer (?:orq|pe)_/.test(req.headers.authorization ?? ''))
        throw new HttpError(401, 'unauthorized', 'Send a personal API token as Bearer', undefined, {
          'www-authenticate': 'Bearer realm="orqiva"',
        });
      const rawId = body['id'];
      const id: Id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const method = body['method'];
      if (body['jsonrpc'] !== '2.0' || typeof method !== 'string')
        return { body: fail(id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request') };
      const isNotification = !('id' in body);
      const p = body['params'];
      const rpcParams =
        typeof p === 'object' && p !== null && !Array.isArray(p)
          ? (p as Record<string, unknown>)
          : {};

      // [PCODE-310 | S15 | v0.1.0] a pull request's files are read from the host before they are shown or
      // commented on, as the review screen does; a host that cannot be reached leaves what is kept
      const call = rpcParams['name'];
      const callArgs = rpcParams['arguments'];
      if (
        method === 'tools/call' &&
        (call === 'get_pull_request' || call === 'comment_on_pull_request') &&
        typeof callArgs === 'object' &&
        callArgs !== null &&
        !Array.isArray(callArgs)
      ) {
        const pullId = await asMember(pool, req, params.workspaceId, 'member', (c, a) =>
          pullOf(c, a, callArgs as Record<string, unknown>).then((x) => x.id),
        ).catch(() => null);
        if (pullId)
          await ensureFiles(pool, req, params.workspaceId, pullId, false, fetchImpl).catch(
            () => undefined,
          );
      }
      return asMember(pool, req, params.workspaceId, 'guest', async (c, a) => {
        // notifications (initialized, cancelled, …) need no answer
        if (isNotification) return { status: 202, body: {} };
        switch (method) {
          case 'initialize': {
            const asked = rpcParams['protocolVersion'];
            const version = MCP_VERSIONS.find((v) => v === asked) ?? MCP_VERSIONS[0];
            return {
              body: ok(id, {
                protocolVersion: version,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions: INSTRUCTIONS,
              }),
            };
          }
          case 'ping':
            return { body: ok(id, {}) };
          case 'tools/list':
            return {
              body: ok(id, {
                tools: [
                  LIST_PROJECTS,
                  ...toolSpecs(DEFAULT_TOOLS).map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.input_schema,
                  })),
                  ...CODE_TOOLS, // [PCODE-310 | S15 | v0.1.0]
                ],
              }),
            };
          case 'tools/call': {
            const name = rpcParams['name'];
            const args = rpcParams['arguments'] ?? {};
            if (typeof name !== 'string' || typeof args !== 'object' || Array.isArray(args))
              return {
                body: fail(id, INVALID_PARAMS, 'tools/call needs a name and an arguments object'),
              };
            if (name === LIST_PROJECTS.name) {
              const rows = (
                await c.query<{ key: string; name: string; description: string }>(
                  `SELECT p.key, p.name, p.description FROM projects p
                   WHERE p.archived_at IS NULL AND ($1 <> 'guest' OR guest_sees_project(p.id, $2))
                   ORDER BY p.key`,
                  [a.role, a.user.id],
                )
              ).rows;
              return {
                body: ok(id, {
                  content: [{ type: 'text', text: JSON.stringify(rows) }],
                  isError: false,
                }),
              };
            }
            // [PCODE-310 | S15 | v0.1.0] the code map and the pull requests
            if (isCodeTool(name)) {
              const r = await runCodeTool(name, args as Record<string, unknown>, c, a);
              return {
                body: ok(id, { content: [{ type: 'text', text: r.content }], isError: !r.ok }),
              };
            }
            if (!(DEFAULT_TOOLS as readonly string[]).includes(name))
              return { body: fail(id, INVALID_PARAMS, 'Unknown tool: ' + name) };
            const r = await runTool(name, args as Record<string, unknown>, {
              c,
              access: a,
              actor: actorOf(a),
            });
            return {
              body: ok(id, { content: [{ type: 'text', text: r.content }], isError: !r.ok }),
            };
          }
          default:
            return { body: fail(id, METHOD_NOT_FOUND, 'Method not found: ' + method) };
        }
      });
    },
  });

  return [endpoint];
}
