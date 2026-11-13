// ── [PCODE-334 | S15 | v0.1.0] T33.4c MCP servers per agent: registry, our own MCP client, tools in runs under the agent's rules ──
//    Why:  against the real database and worker, with Orqiva's own MCP endpoint as the outside server:
//          an admin registers it with a sealed key, the test lists its tools, an agent given the server
//          sees only the allowed tools and calls one; a server whose tools act is refused by the rules; and
//          one that cannot be reached is left out with a note.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProvider, ModelReply } from '../../src/agents/provider.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('MCP servers per agent (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  let analyst = '';
  let token = '';
  const offered: string[][] = [];
  let call: { name: string; input: Record<string, unknown> } = {
    name: 'mcp_self__list_projects',
    input: {},
  };
  const provider: ModelProvider = {
    name: 'scripted',
    complete: (req) => {
      offered.push(req.tools.map((x) => x.name).filter((n) => n.startsWith('mcp_')));
      const answered = req.messages.at(-1)?.content.some((b) => b.type === 'tool_result');
      const reply: ModelReply = answered
        ? {
            content: [{ type: 'text', text: 'Done.' }],
            stopReason: 'end_turn',
            usage: { input: 100, output: 5 },
          }
        : {
            content: [{ type: 'tool_use', id: 'm1', name: call.name, input: call.input }],
            stopReason: 'tool_use',
            usage: { input: 100, output: 5 },
          };
      return Promise.resolve(reply);
    },
  };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Detail = {
    run: { status: string };
    steps: { kind: string; content: Record<string, unknown> }[];
  };
  const runOnce = async (): Promise<Detail> => {
    const id = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
        agentId: analyst,
        instruction: 'Which projects are there?',
      })
    ).body.id;
    const end = Date.now() + 15_000;
    for (;;) {
      const d = (await t.call<Detail>(ada, 'GET', W('/agent-runs/' + id))).body;
      if (['succeeded', 'failed'].includes(d.run.status)) return d;
      if (Date.now() > end) throw new Error('run stayed ' + d.run.status);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const results = (d: Detail): string[] =>
    d.steps
      .filter((x) => x.kind === 'tool_result')
      .flatMap((x) => x.content['results'] as { content: string }[])
      .map((x) => x.content);

  beforeAll(async () => {
    t = await startTestApp({ agents: { provider: () => Promise.resolve(provider) } });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), {
        key: 'MCPX',
        name: 'Outside tools',
      })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    const res = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mcp', email: ada.email, password: 'a test password 1' }),
    });
    token = ((await res.json()) as { token: string }).token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps servers for admins, with the key sealed', async () => {
    const body = {
      name: 'self',
      label: 'Orqiva itself',
      url: t.base + '/mcp/' + ada.workspaceId,
      secret: token,
      actionClass: 'read',
      allowedTools: ['list_projects', 'list_items'],
    };
    expect((await t.call(cy, 'POST', W('/mcp-servers'), body)).status).toBe(403);
    expect(
      (await t.call(ada, 'POST', W('/mcp-servers'), { ...body, url: 'http://mcp.example.com/x' }))
        .status,
    ).toBe(400);
    const r = await t.call<
      { id: string; hasSecret: boolean; hint: string } & Record<string, unknown>
    >(ada, 'POST', W('/mcp-servers'), body);
    expect(r.status).toBe(201);
    expect(r.body.hasSecret).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(token);
    const test = await t.call<{
      ok: boolean;
      server: string;
      tools: { name: string; allowed: boolean }[];
    }>(ada, 'POST', W('/mcp-servers/' + r.body.id + '/test'));
    expect(test.body.ok).toBe(true);
    expect(test.body.server).toMatch(/^orqiva/);
    expect(
      test.body.tools
        .filter((x) => x.allowed)
        .map((x) => x.name)
        .sort(),
    ).toEqual(['list_items', 'list_projects']);
    expect(test.body.tools.some((x) => x.name === 'add_comment' && !x.allowed)).toBe(true);
    const a = await t.call<{ mcpServers: string[] }>(ada, 'PATCH', W('/agents/' + analyst), {
      mcpServers: [r.body.id],
    });
    expect(a.body.mcpServers).toEqual([r.body.id]);
    expect(
      (
        await t.call(ada, 'PATCH', W('/agents/' + analyst), {
          mcpServers: ['00000000-0000-4000-8000-000000000000'],
        })
      ).status,
    ).toBe(400);
  });

  it('offers the allowed tools in a run and calls them', async () => {
    const d = await runOnce();
    expect(d.run.status).toBe('succeeded');
    expect(offered[0]?.sort()).toEqual(['mcp_self__list_items', 'mcp_self__list_projects']);
    expect(results(d)[0]).toContain('MCPX');
  });

  it('refuses an acting server’s tool by the rules and leaves out a dead server', async () => {
    const act = await t.call<{ id: string }>(ada, 'POST', W('/mcp-servers'), {
      name: 'act',
      url: t.base + '/mcp/' + ada.workspaceId,
      secret: token,
      allowedTools: ['add_comment'],
    });
    const dead = await t.call<{ id: string }>(ada, 'POST', W('/mcp-servers'), {
      name: 'dead',
      label: 'Dead server',
      url: 'http://127.0.0.1:9/mcp',
    });
    const self = (
      await t.call<{ id: string; name: string }[]>(ada, 'GET', W('/mcp-servers'))
    ).body.find((x) => x.name === 'self')?.id;
    await t.call(ada, 'PATCH', W('/agents/' + analyst), {
      mcpServers: [self, act.body.id, dead.body.id],
    });
    call = { name: 'mcp_act__add_comment', input: { ref: 'MCPX-1', body: 'hi' } };
    const d = await runOnce();
    expect(results(d)[0]).toBe('The rules of this agent do not allow mcp_act__add_comment');
    const note = d.steps.find((x) => x.kind === 'note')?.content['text'];
    expect(String(note)).toMatch(/^Left out the tools of Dead server: /);
    expect(offered.at(-1)).toContain('mcp_act__add_comment');
    // removed, the server leaves the agent too
    expect((await t.call(ada, 'DELETE', W('/mcp-servers/' + dead.body.id))).status).toBe(200);
    const agent = (
      await t.call<{ id: string; mcpServers: string[] }[]>(ada, 'GET', W('/agents'))
    ).body.find((x) => x.id === analyst);
    expect(agent?.mcpServers).toHaveLength(2);
  });
});
