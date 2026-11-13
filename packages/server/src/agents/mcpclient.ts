// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  agents use outside tools through the open Model Context Protocol, spoken by our own client:
//          JSON-RPC 2.0 over HTTP POST (Streamable HTTP). It opens with initialize and the initialized
//          notification, keeps the server's session id, lists tools page by page and calls them. A server
//          may answer with JSON or with an event stream; both are read, within a time and size limit.

export const MCP_CLIENT_VERSION = '2025-06-18';
const MAX_BYTES = 1_000_000;

export class McpError extends Error {}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface RpcAnswer {
  id?: unknown;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

/** The JSON-RPC answer with this id, from a JSON body or from an event stream's data lines. */
export function answerOf(body: string, contentType: string, id: number): RpcAnswer {
  const candidates: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        candidates.push(JSON.parse(data));
      } catch {
        // a stray line is not ours
      }
    }
  } else {
    try {
      candidates.push(JSON.parse(body));
    } catch {
      throw new McpError('The server answered with something that is not JSON');
    }
  }
  const flat: unknown[] = candidates.flatMap((c): unknown[] =>
    Array.isArray(c) ? (c as unknown[]) : [c],
  );
  const mine = flat.find(
    (c): c is RpcAnswer => typeof c === 'object' && c !== null && (c as RpcAnswer).id === id,
  );
  if (!mine) throw new McpError('The server gave no answer to the request');
  return mine;
}

export class McpClient {
  private session: string | null = null;
  private nextId = 1;
  private ready = false;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(payload: Record<string, unknown>): Promise<{ body: string; type: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          ...this.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': MCP_CLIENT_VERSION,
          'user-agent': 'Orqiva',
          ...(this.session ? { 'mcp-session-id': this.session } : {}),
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new McpError(
        'The server could not be reached: ' + (e instanceof Error ? e.message : String(e)),
      );
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (res.status === 401 || res.status === 403) throw new McpError('The server refused the key');
    if (!res.ok && res.status !== 202)
      throw new McpError('The server answered ' + String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new McpError('The server’s answer is larger than 1 MB');
    return { body: buf.toString('utf8'), type: res.headers.get('content-type') ?? '' };
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const r = await this.post({ jsonrpc: '2.0', id, method, params });
    const a = answerOf(r.body, r.type, id);
    if (a.error) throw new McpError(a.error.message ?? 'The server reported an error');
    return a.result ?? {};
  }

  /** initialize, then the initialized notification; once per client. */
  async open(): Promise<{ name: string; version: string }> {
    const r = await this.request('initialize', {
      protocolVersion: MCP_CLIENT_VERSION,
      capabilities: {},
      clientInfo: { name: 'orqiva', version: '0.1.0' },
    });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.ready = true;
    const info = (r['serverInfo'] ?? {}) as { name?: unknown; version?: unknown };
    return {
      name: typeof info.name === 'string' ? info.name : '',
      version: typeof info.version === 'string' ? info.version : '',
    };
  }

  /** Every tool, following the server's pages (at most ten). */
  async listTools(): Promise<McpTool[]> {
    if (!this.ready) await this.open();
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      for (const t of (r['tools'] ?? []) as Record<string, unknown>[])
        if (typeof t['name'] === 'string')
          out.push({
            name: t['name'],
            description: typeof t['description'] === 'string' ? t['description'] : '',
            inputSchema:
              typeof t['inputSchema'] === 'object' && t['inputSchema'] !== null
                ? (t['inputSchema'] as Record<string, unknown>)
                : { type: 'object', properties: {} },
          });
      cursor = typeof r['nextCursor'] === 'string' && r['nextCursor'] ? r['nextCursor'] : undefined;
      if (!cursor) break;
    }
    return out;
  }

  /** A tool's answer as text, and whether the server calls it an error. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    if (!this.ready) await this.open();
    const r = await this.request('tools/call', { name, arguments: args });
    const parts = ((r['content'] ?? []) as { type?: string; text?: string }[]).map((c) =>
      c.type === 'text' && typeof c.text === 'string' ? c.text : '[' + (c.type ?? 'content') + ']',
    );
    const structured = r['structuredContent'];
    if (!parts.length && structured !== undefined) parts.push(JSON.stringify(structured));
    return { text: parts.join('\n'), isError: r['isError'] === true };
  }
}
