// ── [PCODE-310 | S15 | v0.1.0] T31.9a MCP tools for the code map and pull requests ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-121 | S15 | v0.1.0] Add our own MCP server over HTTP with the agent tools ──
//    Why:  the endpoint called the way an MCP client calls it: handshake, tool list, tool calls as the
//          token's person, a guest's refusal, and errors in JSON-RPC form.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('the MCP server (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let gus: Person;
  let adaToken = '';
  let gusToken = '';
  let item = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  const tokenFor = async (email: string, n: number): Promise<string> => {
    const res = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mcp', email, password: 'a test password ' + String(n) }),
    });
    return ((await res.json()) as { token: string }).token;
  };
  let nextId = 0;
  const rpc = async (
    token: string,
    method: string,
    params?: unknown,
    opts: { notify?: boolean; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(t.base + '/mcp/' + ada.workspaceId, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...opts.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(opts.notify ? {} : { id: ++nextId }),
        ...(params === undefined ? {} : { params }),
      }),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
  };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the result's shape
  const result = <T>(r: { body: Record<string, unknown> }): T => r.body['result'] as T;
  type CallResult = { content: { type: string; text: string }[]; isError: boolean };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    gus = await t.signup('Gus');
    await t.call(ada, 'POST', W('/members'), { email: gus.email, role: 'guest' });
    const app = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
    await t.call(ada, 'POST', W('/projects'), { key: 'OPS', name: 'Ops' });
    await t.call(ada, 'POST', W('/projects/' + app + '/guests'), { userId: gus.id });
    item = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + app + '/items'), {
        title: 'Export the report',
      })
    ).body.id;
    adaToken = await tokenFor(ada.email, 1);
    gusToken = await tokenFor(gus.email, 2);
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('shakes hands, agreeing on a protocol version', async () => {
    const r = await rpc(adaToken, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ jsonrpc: '2.0', id: nextId });
    expect(result<Record<string, unknown>>(r)).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'orqiva' },
    });
    const unknown = await rpc(adaToken, 'initialize', { protocolVersion: '1999-01-01' });
    expect(result<{ protocolVersion: string }>(unknown).protocolVersion).toBe('2025-06-18');
    // the initialized notification gets no answer body
    expect(
      (await rpc(adaToken, 'notifications/initialized', undefined, { notify: true })).status,
    ).toBe(202);
    expect(result(await rpc(adaToken, 'ping'))).toEqual({});
  });

  it('lists the tools with their input schemas', async () => {
    const tools = result<{ tools: { name: string; inputSchema: { type: string } }[] }>(
      await rpc(adaToken, 'tools/list'),
    ).tools;
    expect(tools.map((x) => x.name)).toEqual([
      'list_projects',
      'list_items',
      'get_item',
      'add_comment',
      'create_item',
      'update_item',
      'move_item',
      // [PCODE-310 | S15 | v0.1.0]
      'code_map',
      'code_dependencies',
      'list_pull_requests',
      'get_pull_request',
      'comment_on_pull_request',
    ]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
  });

  it('runs tools as the token’s person', async () => {
    const projects = result<CallResult>(
      await rpc(adaToken, 'tools/call', { name: 'list_projects', arguments: {} }),
    );
    expect(JSON.parse(projects.content[0]?.text ?? '')).toEqual([
      { key: 'APP', name: 'App', description: '' },
      { key: 'OPS', name: 'Ops', description: '' },
    ]);
    const r = result<CallResult>(
      await rpc(adaToken, 'tools/call', {
        name: 'add_comment',
        arguments: { ref: 'APP-1', body: 'From my editor.' },
      }),
    );
    expect(r.isError).toBe(false);
    const comments = await t.call<{ authorName: string; body: string }[]>(
      ada,
      'GET',
      W('/items/' + item + '/comments'),
    );
    expect(comments.body).toEqual([
      expect.objectContaining({ authorName: 'Ada', body: 'From my editor.' }),
    ]);
    // a person behind the client: the move happens at once, in their name
    const moved = result<CallResult>(
      await rpc(adaToken, 'tools/call', {
        name: 'move_item',
        arguments: { ref: 'APP-1', state: 'In Progress' },
      }),
    );
    expect(moved.isError).toBe(false);
  });

  it('keeps a guest to their projects and to reading', async () => {
    const seen = result<CallResult>(
      await rpc(gusToken, 'tools/call', { name: 'list_projects', arguments: {} }),
    );
    expect(JSON.parse(seen.content[0]?.text ?? '')).toEqual([
      { key: 'APP', name: 'App', description: '' },
    ]);
    const hidden = result<CallResult>(
      await rpc(gusToken, 'tools/call', { name: 'list_items', arguments: { project: 'OPS' } }),
    );
    expect(hidden).toMatchObject({ isError: true });
    expect(hidden.content[0]?.text).toContain('No project OPS that this role can see');
    const write = result<CallResult>(
      await rpc(gusToken, 'tools/call', {
        name: 'add_comment',
        arguments: { ref: 'APP-1', body: 'x' },
      }),
    );
    expect(write.isError).toBe(true);
  });

  it('answers mistakes in JSON-RPC form, and refuses cookies and strangers', async () => {
    expect((await rpc(adaToken, 'resources/list')).body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32601 },
    });
    expect(
      (await rpc(adaToken, 'tools/call', { name: 'drop_tables', arguments: {} })).body,
    ).toMatchObject({
      error: { code: -32602 },
    });
    expect((await rpc(adaToken, 'tools/call', { arguments: {} })).body).toMatchObject({
      error: { code: -32602 },
    });

    const anonymous = await rpc('', 'tools/list');
    expect(anonymous.status).toBe(401);
    const withCookie = await rpc('', 'tools/list', undefined, { headers: { cookie: ada.cookie } });
    expect(withCookie.status).toBe(401);
    const stranger = await t.signup('Sam');
    const samToken = await tokenFor(stranger.email, 3);
    expect((await rpc(samToken, 'tools/list')).status).toBe(404);
  });
});
