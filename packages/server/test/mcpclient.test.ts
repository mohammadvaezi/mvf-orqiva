// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  our MCP client reads answers sent as an event stream as well as JSON, keeps the session id the
//          server hands out, follows tool pages, and reports a server's errors in words.
import { describe, expect, it } from 'vitest';
import { answerOf, McpClient, McpError } from '../src/agents/mcpclient.js';

describe('MCP answers', () => {
  it('finds its answer in an event stream among other messages', () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n' +
      'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":true}}\n\n';
    expect(answerOf(body, 'text/event-stream', 3)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { ok: true },
    });
    expect(() => answerOf(body, 'text/event-stream', 4)).toThrow(McpError);
    expect(() => answerOf('<html>', 'text/html', 1)).toThrow('not JSON');
  });
});

describe('the MCP client', () => {
  it('opens, keeps the session, follows pages and calls a tool', async () => {
    const seen: { method: string; session: string | null; auth: string | null }[] = [];
    const fake: typeof fetch = (_url, init) => Promise.resolve(answer(init));
    const answer = (init?: RequestInit): Response => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        id?: number;
        method: string;
        params?: { cursor?: string; name?: string };
      };
      const h = new Headers(init?.headers);
      seen.push({
        method: body.method,
        session: h.get('mcp-session-id'),
        auth: h.get('authorization'),
      });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const reply = (result: unknown) =>
        new Response('data: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) + '\n\n', {
          headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' },
        });
      if (body.method === 'initialize')
        return reply({ serverInfo: { name: 'tickets', version: '2.1' } });
      if (body.method === 'tools/list')
        return reply(
          body.params?.cursor
            ? { tools: [{ name: 'close_ticket', description: 'Close one' }] }
            : {
                tools: [{ name: 'find_ticket', inputSchema: { type: 'object' } }],
                nextCursor: 'p2',
              },
        );
      if (body.method === 'tools/call')
        return body.params?.name === 'boom'
          ? new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                error: { code: -32602, message: 'No such ticket' },
              }),
              {
                headers: { 'content-type': 'application/json' },
              },
            )
          : reply({
              content: [{ type: 'text', text: 'T-1 is open' }, { type: 'image' }],
              isError: false,
            });
      return new Response('', { status: 500 });
    };
    const c = new McpClient('https://mcp.test/x', { authorization: 'Bearer k' }, fake);
    expect(await c.open()).toEqual({ name: 'tickets', version: '2.1' });
    expect((await c.listTools()).map((t) => t.name)).toEqual(['find_ticket', 'close_ticket']);
    expect(await c.callTool('find_ticket', { id: 1 })).toEqual({
      text: 'T-1 is open\n[image]',
      isError: false,
    });
    await expect(c.callTool('boom', {})).rejects.toThrow('No such ticket');
    expect(seen.map((x) => x.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/list',
      'tools/call',
      'tools/call',
    ]);
    expect(seen[0]?.session).toBeNull();
    expect(seen.slice(1).every((x) => x.session === 'sess-1' && x.auth === 'Bearer k')).toBe(true);
  });

  it('says when the server refuses the key', async () => {
    const c = new McpClient('https://mcp.test/x', {}, () =>
      Promise.resolve(new Response('', { status: 401 })),
    );
    await expect(c.listTools()).rejects.toThrow('refused the key');
  });
});
