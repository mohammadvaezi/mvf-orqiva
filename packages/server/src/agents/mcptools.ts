// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  the outside tools of a run: each MCP server the agent may use is opened, its tools listed and
//          offered to the model as mcp_<server>__<tool>, with the server's kind of action, so the agent's
//          autonomy and rules decide each call as they do for its own tools. A server that cannot be reached
//          leaves its tools out and says so.
import type { ActionClass } from '@orqiva/shared';
import type { PoolClient } from 'pg';
import { McpClient, type McpTool } from './mcpclient.js';
import type { ToolSpec } from './provider.js';
import { open as openSecret } from './secrets.js';

export interface McpBinding {
  serverId: string;
  server: string;
  label: string;
  tool: string;
  cls: ActionClass | 'read';
  spec: ToolSpec;
  client: McpClient;
}

export interface McpServerRow {
  id: string;
  name: string;
  label: string;
  url: string;
  header_name: string;
  secret_sealed: string | null;
  action_class: ActionClass | 'read';
  allowed_tools: string[];
}

/** The name the model sees: letters, digits, _ and -, at most 64 characters. */
export const mcpToolName = (server: string, tool: string): string =>
  ('mcp_' + server + '__' + tool.replace(/[^A-Za-z0-9_-]/g, '_')).slice(0, 64);

/** A client for a server, with its key in its header. */
export function clientFor(row: McpServerRow, fetchImpl?: typeof fetch): McpClient {
  let headers: Record<string, string> = {};
  if (row.secret_sealed) {
    const secret = openSecret(row.secret_sealed);
    headers = {
      [row.header_name]:
        row.header_name.toLowerCase() === 'authorization' && !/^\w+ /.test(secret)
          ? 'Bearer ' + secret
          : secret,
    };
  }
  return new McpClient(row.url, headers, fetchImpl);
}

export const allowedTools = (row: McpServerRow, tools: readonly McpTool[]): McpTool[] =>
  row.allowed_tools.length ? tools.filter((t) => row.allowed_tools.includes(t.name)) : [...tools];

/** The MCP tools an agent may use now, and the servers that could not be reached. */
export async function mcpToolsFor(
  c: PoolClient,
  agentId: string,
  fetchImpl?: typeof fetch,
): Promise<{ tools: Map<string, McpBinding>; problems: string[] }> {
  const rows = (
    await c.query<McpServerRow>(
      `SELECT m.id, m.name, m.label, m.url, m.header_name, m.secret_sealed, m.action_class, m.allowed_tools
         FROM mcp_servers m JOIN agents a ON m.id = ANY(a.mcp_servers)
        WHERE a.id = $1 ORDER BY m.name`,
      [agentId],
    )
  ).rows;
  const tools = new Map<string, McpBinding>();
  const problems: string[] = [];
  for (const row of rows) {
    try {
      const client = clientFor(row, fetchImpl);
      for (const t of allowedTools(row, await client.listTools())) {
        const name = mcpToolName(row.name, t.name);
        tools.set(name, {
          serverId: row.id,
          server: row.name,
          label: row.label,
          tool: t.name,
          cls: row.action_class,
          client,
          spec: {
            name,
            description: ('[' + row.label + '] ' + t.description).slice(0, 1000),
            input_schema: t.inputSchema,
          },
        });
      }
    } catch (e) {
      problems.push(row.label + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  return { tools, problems };
}
