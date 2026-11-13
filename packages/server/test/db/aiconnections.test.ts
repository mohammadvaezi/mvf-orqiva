// ── [PCODE-240 | S15 | v0.1.0] T24.1 AI provider connections: Anthropic, OpenAI, Azure, Gemini, Bedrock, Grok, fallbacks, prices ──
//    Why:  the connections against the real database and the agent worker, with recorded provider answers
//          instead of the network: an admin adds connections (wrong keys, foreign addresses and unknown
//          regions are refused), tests one, and an agent run goes to OpenAI and is priced from the shipped
//          list; when OpenAI fails, Gemini takes over and the run says so; a project's own key replaces the
//          workspace key; an agent with its own connection uses its own model; the old provider setting
//          still works; a member never sees the connections.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '5a'.repeat(32);

const WS_KEY = 'sk-test-workspace-0123456789abcd';
const PROJECT_KEY = 'sk-proj-project-0123456789abcd';

interface Call {
  url: string;
  auth: string;
  body: Record<string, unknown>;
}

describe.skipIf(!hasDatabase)('AI connections (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  let analyst = '';
  const calls: Call[] = [];
  let openaiDown = false;

  /** OpenAI and Gemini as they answer, recorded; OpenAI can be switched off. */
  const answer = (url: string, init?: RequestInit): Response => {
    const u = url;
    const h = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse((init?.body as string | undefined) ?? '{}') as Record<string, unknown>;
    calls.push({ url: u, auth: h['authorization'] ?? h['x-goog-api-key'] ?? '', body });
    const json = (x: unknown, status = 200) =>
      new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://api.openai.com/')) {
      if (openaiDown) return json({ error: { message: 'The server is overloaded' } }, 503);
      return json({
        choices: [{ message: { content: 'OK, the task is clear.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2000, completion_tokens: 100 },
      });
    }
    if (u.startsWith('https://generativelanguage.googleapis.com/'))
      return json({
        candidates: [{ content: { parts: [{ text: 'Gemini read it.' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
      });
    return json({ error: { message: 'unexpected address ' + u } }, 404);
  };
  const aiFetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(answer(url, init))) as typeof fetch;

  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  interface Conn {
    id: string;
    provider: string;
    hint: string;
    models: { agent: string; reading: string; audio: string };
    uses: string[];
    lastUsedAt: string | null;
    lastError: string;
  }
  const connections = async () =>
    (
      await t.call<{ connections: Conn[]; settings: Record<string, string | null> }>(
        ada,
        'GET',
        W('/ai/connections'),
      )
    ).body;
  const run = async (instruction: string) => {
    const r = await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/agent-runs'), {
      agentId: analyst,
      instruction,
    });
    expect(r.status).toBe(201);
    const end = Date.now() + 10_000;
    for (;;) {
      const d = await t.call<{
        run: { status: string; model: string; costMicros: number; error: string };
        steps: { kind: string; content: Record<string, unknown> }[];
      }>(ada, 'GET', W('/agent-runs/' + r.body.id));
      if (['succeeded', 'failed'].includes(d.body.run.status)) return d.body;
      if (Date.now() > end) throw new Error('run stayed ' + d.body.run.status);
      await new Promise((res) => setTimeout(res, 50));
    }
  };

  beforeAll(async () => {
    t = await startTestApp({ aiFetch });
    ada = await t.signup('Ada');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'HEL', name: 'Helio' })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('refuses keys of another provider, foreign addresses and unknown regions', async () => {
    const add = (body: Record<string, unknown>) => t.call(ada, 'POST', W('/ai/connections'), body);
    const wrong = await add({ provider: 'openai', key: 'sk-ant-api03-0123456789abcdefghij' });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).toContain('An OpenAI API key starts with sk-');
    expect((await add({ provider: 'openai' })).status).toBe(400);
    const metadata = await add({
      provider: 'azure',
      key: 'azure-key-0123456789abcdef',
      endpoint: 'https://169.254.169.254/openai',
    });
    expect(metadata.status).toBe(400);
    expect(JSON.stringify(metadata.body)).toContain('Azure OpenAI resource');
    expect(
      (await add({ provider: 'bedrock', key: 'bedrock-key-0123456789', region: 'mars' })).status,
    ).toBe(400);
    expect(
      (
        await add({
          provider: 'bedrock',
          region: 'eu-central-1',
          auth: 'accessKeys',
          accessKeyId: 'nope',
          secretAccessKey: 'x'.repeat(40),
        })
      ).status,
    ).toBe(400);
    expect((await t.call(cy, 'POST', W('/ai/connections'), { provider: 'demo' })).status).toBe(403);
  });

  it('adds OpenAI, keeps the key sealed, tests it and runs an agent on it, priced from the shipped list', async () => {
    const created = await t.call<Conn>(ada, 'POST', W('/ai/connections'), {
      provider: 'openai',
      key: WS_KEY,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      provider: 'openai',
      hint: 'abcd',
      models: { agent: 'gpt-5', reading: 'gpt-5-mini', audio: 'gpt-4o-transcribe' },
      // the first connection serves agents at once
      uses: ['agents'],
    });
    const listed = await t.call(ada, 'GET', W('/ai/connections'));
    expect(JSON.stringify(listed.body)).not.toContain(WS_KEY);
    expect((await t.call(cy, 'GET', W('/ai/connections'))).status).toBe(403);
    // the settings are readable by members (which connection serves what), not the connections
    expect(
      (await t.call<{ agentConnectionId: string }>(cy, 'GET', W('/ai/settings'))).body
        .agentConnectionId,
    ).toBe(created.body.id);

    const test = await t.call<{ ok: boolean; answer: string; model: string }>(
      ada,
      'POST',
      W('/ai/connections/' + created.body.id + '/test'),
      {},
    );
    expect(test.body).toMatchObject({ ok: true, model: 'gpt-5', answer: 'OK, the task is clear.' });

    const done = await run('Read HEL and say what is open');
    expect(done.run).toMatchObject({ status: 'succeeded', model: 'gpt-5' });
    // 2000 in at 1.25 USD and 100 out at 10 USD per million tokens: 3500 millionths of a dollar
    expect(done.run.costMicros).toBe(3500);
    expect(done.steps.find((s) => s.kind === 'model')?.content).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
    });
    const sent = calls.filter((c) => c.url.includes('/chat/completions')).pop();
    expect(sent?.auth).toBe('Bearer ' + WS_KEY);
    expect(sent?.body['model']).toBe('gpt-5');
    expect((await connections()).connections[0]?.lastUsedAt).not.toBeNull();
  });

  it('lets Gemini take over when OpenAI fails, and the run says so', async () => {
    const gemini = await t.call<Conn>(ada, 'POST', W('/ai/connections'), {
      provider: 'gemini',
      key: 'AIzaSy-gemini-0123456789',
    });
    expect(gemini.status).toBe(201);
    expect(gemini.body.uses).toEqual([]);
    const set = await t.call<Record<string, string | null>>(ada, 'PUT', W('/ai/settings'), {
      fallbackConnectionId: gemini.body.id,
    });
    expect(set.body['fallbackConnectionId']).toBe(gemini.body.id);
    openaiDown = true;
    const done = await run('Again, please');
    openaiDown = false;
    expect(done.run).toMatchObject({ status: 'succeeded', model: 'gemini-2.5-flash' });
    expect(done.steps.find((s) => s.kind === 'note')?.content['text'] as string | undefined).toBe(
      'openai (gpt-5) failed (The model provider answered 503: The server is overloaded); gemini (gemini-2.5-flash) takes over',
    );
    // 1000 in at 0.30 USD and 50 out at 2.50 USD per million tokens
    expect(done.run.costMicros).toBe(425);
    const list = (await connections()).connections;
    expect(list.find((c) => c.provider === 'openai')?.lastError).toContain('503');
    expect(list.find((c) => c.provider === 'gemini')).toMatchObject({ uses: ['fallback'] });
    expect(list.find((c) => c.provider === 'gemini')?.lastUsedAt).not.toBeNull();
  });

  it('uses the project’s own key for its provider', async () => {
    const put = await t.call(ada, 'PUT', W('/projects/' + project + '/provider-key'), {
      provider: 'openai',
      key: PROJECT_KEY,
      label: 'Helio pays',
    });
    expect(put.status).toBe(200);
    await run('With the client’s key');
    expect(calls.filter((c) => c.url.includes('/chat/completions')).pop()?.auth).toBe(
      'Bearer ' + PROJECT_KEY,
    );
    const keys = await t.call<
      { projectKey: string | null; provider: string; lastUsedAt: string | null }[]
    >(ada, 'GET', W('/provider-keys'));
    expect(keys.body.find((k) => k.projectKey === 'HEL')).toMatchObject({ provider: 'openai' });
    expect(keys.body.find((k) => k.projectKey === 'HEL')?.lastUsedAt).not.toBeNull();
    await t.call(ada, 'DELETE', W('/projects/' + project + '/provider-key?provider=openai'));
  });

  it('runs an agent on its own connection with its own model', async () => {
    const list = (await connections()).connections;
    const gemini = list.find((c) => c.provider === 'gemini')?.id;
    const patched = await t.call<{ connectionId: string | null }>(
      ada,
      'PATCH',
      W('/agents/' + analyst),
      { connectionId: gemini, model: 'gemini-2.5-pro' },
    );
    expect(patched.body.connectionId).toBe(gemini);
    const done = await run('On Gemini Pro');
    expect(done.run).toMatchObject({ status: 'succeeded', model: 'gemini-2.5-pro' });
    expect(calls.pop()?.url).toContain('/models/gemini-2.5-pro:generateContent');
    // removing the connection sends the agent back to the workspace's connection
    expect((await t.call(ada, 'DELETE', W('/ai/connections/' + String(gemini)))).body).toEqual({
      removed: true,
    });
    const agent = (
      await t.call<{ id: string; connectionId: string | null }[]>(ada, 'GET', W('/agents'))
    ).body.find((a) => a.id === analyst);
    expect(agent?.connectionId).toBeNull();
    expect((await connections()).settings['fallbackConnectionId']).toBeNull();
  });

  it('refuses a connection that cannot do the job, and keeps the provider setting of before working', async () => {
    const claude = await t.call<Conn>(ada, 'POST', W('/ai/connections'), {
      provider: 'anthropic',
      key: 'sk-ant-api03-0123456789abcdefghij',
    });
    const audio = await t.call(ada, 'PUT', W('/ai/settings'), {
      audioConnectionId: claude.body.id,
    });
    expect(audio.status).toBe(400);
    expect(JSON.stringify(audio.body)).toContain('Anthropic does not write transcripts');
    expect(
      (await t.call(ada, 'PUT', W('/ai/settings'), { readingConnectionId: claude.body.id })).status,
    ).toBe(200);
    // the single provider of before: the demo model becomes the connection for agents
    await t.call(ada, 'PUT', W('/agents/provider'), { provider: 'demo' });
    const after = await connections();
    const demo = after.connections.find((c) => c.provider === 'demo');
    expect(after.settings['agentConnectionId']).toBe(demo?.id);
    expect(after.settings['readingConnectionId']).toBe(claude.body.id);
  });
});
