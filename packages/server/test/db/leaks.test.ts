// ── [PCODE-325 | S15 | v0.1.0] T32.8b Leak scans of commits, traces and logs ──
//    Why:  a commit message with an Orqiva token revokes it (the leak kept as found in a commit) and one
//          with a cloud key becomes a finding without the key, the message kept redacted; a deploy log's
//          secrets are replaced and reported the same way; an agent that reads a secret leaves a finding.
//          The same place and kind stays one finding.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider } from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { sign } from '../../src/git/webhook.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

// made at run time, so no secret-shaped text sits in this file
const AWS = 'AKIA' + 'Z7Q3XK4P2M9WR5TB';
const STRIPE = 'sk_' + 'live_' + 'q8W2e4R6t8Y0u2I4o6P8a0S2';

describe.skipIf(!hasDatabase)('leak scans of commits, logs and traces (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let token = '';
  const hook = { path: '', secret: '' };
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const P = (p: string): string => W('/projects/' + project + p);
  const sys = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    inSystem(t.db.pool, async (c) => (await c.query(sql, args)).rows as T[]);
  const leaks = () =>
    sys<{ rule: string; title: string; message: string }>(
      "SELECT rule, title, message FROM findings WHERE tool = 'orq-leaks' AND project_id = $1 ORDER BY title",
      [project],
    );
  const push = async (id: string, message: string) => {
    const body = Buffer.from(
      JSON.stringify({
        ref: 'refs/heads/main',
        after: id,
        repository: { full_name: 'acme/shop', default_branch: 'main' },
        commits: [
          {
            id,
            message,
            url: 'https://github.com/acme/shop/commit/' + id,
            timestamp: '2026-10-14T10:00:00Z',
            author: { name: 'Ada', username: 'ada' },
            added: [],
            modified: [],
            removed: [],
          },
        ],
      }),
    );
    const res = await fetch(t.base + hook.path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=' + sign(hook.secret, body),
      },
      body,
    });
    expect(res.status).toBe(200);
    // the scan runs once the host has its answer
    await new Promise((r) => setTimeout(r, 600));
  };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () =>
          Promise.resolve(
            scriptedProvider([
              {
                content: [
                  {
                    type: 'text',
                    text: 'The config says STRIPE=' + STRIPE + ', so payments work.',
                  },
                ],
                stopReason: 'end_turn',
                usage: { input: 100, output: 20 },
              },
            ]),
          ),
      },
    });
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'SHOP', name: 'Shop' })
    ).body.id;
    const r = await t.call<{ connection: { webhookPath: string }; secret: string }>(
      ada,
      'POST',
      P('/git'),
      {
        provider: 'github',
        repo: 'acme/shop',
      },
    );
    Object.assign(hook, { path: r.body.connection.webhookPath, secret: r.body.secret });
    const tok = await fetch(t.base + '/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ci', email: ada.email, password: 'a test password 1' }),
    });
    token = ((await tok.json()) as { token: string }).token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('revokes a token and reports a key found in a commit message', async () => {
    await push('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', 'Deploy with ' + token + ' and ' + AWS);
    const leak = await sys<{ found_in: string; location: string }>(
      'SELECT found_in, location FROM token_leaks WHERE workspace_id = $1',
      [ada.workspaceId],
    );
    expect(leak).toEqual([{ found_in: 'commit', location: 'commit 1a2b3c4 of acme/shop' }]);
    expect(
      (await fetch(t.base + '/auth/me', { headers: { authorization: 'Bearer ' + token } })).status,
    ).toBe(401);
    const found = await leaks();
    expect(found).toEqual([
      expect.objectContaining({
        rule: 'leak/aws-access-key',
        title: 'An AWS access key in commit 1a2b3c4 of acme/shop',
      }),
    ]);
    expect(found[0]?.message).not.toContain(AWS);
    const kept = await sys<{ message: string }>(
      'SELECT message FROM git_commits WHERE project_id = $1',
      [project],
    );
    expect(kept[0]?.message).toBe(
      'Deploy with [redacted Orqiva token] and [redacted AWS access key]',
    );
    // seen again: still one finding
    await push('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', 'Deploy with ' + AWS);
    expect(await leaks()).toHaveLength(1);
    const { article } = await import('../../src/security/leaks.js');
    expect(
      ['private key', 'GitHub token', 'Orqiva token', 'SSH key', 'Google key'].map(article),
    ).toEqual(['A', 'A', 'An', 'An', 'A']);
  });

  it('cleans a deploy log and reports what it held', async () => {
    const env = (
      await t.call<{ id: string }>(ada, 'POST', P('/environments'), {
        key: 'staging',
        name: 'Staging',
        kind: 'compose',
        settings: { dir: '/srv/shop' },
      })
    ).body.id;
    const runnerToken = (
      await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'box' })
    ).body.token;
    const d = await t.call<{ id: string }>(ada, 'POST', W('/environments/' + env + '/deploys'), {
      ref: 'v1',
    });
    const call = (path: string, body?: unknown) =>
      fetch(t.base + path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + runnerToken,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    await call('/api/runner/claim');
    await call('/api/runner/deploys/' + d.body.id + '/steps', {
      seq: 1,
      name: 'migrate',
      status: 'ok',
      output: 'connecting with STRIPE_KEY=' + STRIPE + '\ndone',
    });
    const step = await sys<{ output: string }>(
      'SELECT output FROM deploy_steps WHERE run_id = $1',
      [d.body.id],
    );
    expect(step[0]?.output).toBe('connecting with STRIPE_KEY=[redacted Stripe key]\ndone');
    expect((await leaks()).map((f) => f.rule)).toContain('leak/stripe-key');
  });

  it('reports a secret an agent saw', async () => {
    const before = (await leaks()).length;
    const agents = await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'));
    await t.call(ada, 'PUT', W('/agents/provider'), {
      provider: 'anthropic',
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    });
    const run = await t.call<{ id: string }>(ada, 'POST', P('/agent-runs'), {
      agentId: agents.body.find((x) => x.key === 'analyst')?.id,
      instruction: 'Read the config',
    });
    expect(run.status).toBe(201);
    for (let i = 0; i < 50; i++) {
      const s = await sys<{ status: string }>('SELECT status FROM agent_runs WHERE id = $1', [
        run.body.id,
      ]);
      if (s[0]?.status && !['queued', 'running'].includes(s[0].status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const after = await leaks();
    expect(after.length).toBe(before + 1);
    expect(after.find((f) => f.title.startsWith('A Stripe key in what'))?.title).toMatch(
      /run [0-9a-f]{8}\)$/,
    );
  });
});
