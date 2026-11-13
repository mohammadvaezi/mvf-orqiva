// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-181 | S15 | v0.1.0] B5.2 Tokens and costs live: AI spend, budgets, prices, provider keys per project, access tokens with scopes, policy, leak revocation ──
//    Why:  tokens and costs against the real database: scopes and the workspace a token is bound to,
//          approval of broad scopes, service accounts, rotation with overlap, the IP allow-list, a leaked
//          token revoked from a comment; budgets with their use and the hard stop, the workspace's own
//          price used by the runtime, the spend per day, and provider keys per project.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  scriptedProvider,
  type ModelProvider,
  type ModelReply,
} from '../../src/agents/provider.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'ab'.repeat(32);

const say = (text: string, input = 1000): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input, output: 0 },
});

describe.skipIf(!hasDatabase)('tokens and costs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let mo: Person;
  let other = '';
  let project = '';
  let analyst = '';
  let current: ModelProvider | null = null;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const bearer = async (
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(t.base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  type Token = { id: string; token: string; state: string };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () => {
          if (!current) throw new Error('no script');
          return Promise.resolve(current);
        },
      },
    });
    ada = await t.signup('Ada');
    mo = await t.signup('Mo');
    await t.call(ada, 'POST', W('/members'), { email: mo.email, role: 'member' });
    other = (await t.call<{ id: string }>(mo, 'POST', '/api/workspaces', { name: 'Elsewhere' }))
      .body.id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'TOK', name: 'Tokens' })
    ).body.id;
    analyst =
      (await t.call<{ id: string; key: string }[]>(ada, 'GET', W('/agents'))).body.find(
        (a) => a.key === 'analyst',
      )?.id ?? '';
    await inSystem(t.db.pool, (c) =>
      c.query(
        "INSERT INTO fx_rates (day, usd_eur, source) VALUES (current_date, 0.5, 'test') ON CONFLICT (day) DO UPDATE SET usd_eur = 0.5",
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('binds a token to the workspace and lets its scopes decide', async () => {
    expect(
      (await t.call(mo, 'POST', W('/access-tokens'), { name: 'x', scopes: ['fly'] })).status,
    ).toBe(400);
    expect(
      (
        await t.call(mo, 'POST', W('/access-tokens'), {
          name: 'x',
          scopes: ['read'],
          expiresInDays: 400,
        })
      ).status,
    ).toBe(400);
    const r = await t.call<Token>(mo, 'POST', W('/access-tokens'), {
      name: 'Read only',
      scopes: ['read'],
      expiresInDays: 30,
    });
    expect(r.body.token).toMatch(/^orq_pat_/);
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(200);
    expect(
      (await bearer(r.body.token, 'POST', W('/projects/' + project + '/items'), { title: 'Nope' }))
        .status,
    ).toBe(403);
    expect(
      (await bearer(r.body.token, 'GET', '/api/workspaces/' + other + '/projects')).status,
    ).toBe(404);
    const list = await t.call<
      { id: string; useCount: number; lastUsedIp: string | null; mine: boolean }[]
    >(mo, 'GET', W('/access-tokens'));
    expect(list.body.find((x) => x.id === r.body.id)).toMatchObject({ useCount: 3, mine: true });
    expect(list.body.find((x) => x.id === r.body.id)?.lastUsedIp).toBeTruthy();
  });

  it('holds broad scopes until another admin approves', async () => {
    expect(
      (await t.call(mo, 'POST', W('/access-tokens'), { name: 'adm', scopes: ['admin'] })).status,
    ).toBe(403);
    const r = await t.call<Token>(mo, 'POST', W('/access-tokens'), {
      name: 'Deployer',
      scopes: ['read', 'deploys'],
    });
    expect(r.body.state).toBe('pending');
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(401);
    expect((await t.call(mo, 'POST', W('/access-tokens/' + r.body.id + '/approve'))).status).toBe(
      403,
    );
    expect(
      (await t.call<{ state: string }>(ada, 'POST', W('/access-tokens/' + r.body.id + '/approve')))
        .body.state,
    ).toBe('active');
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(200);
  });

  it('makes service accounts and rotates with a day of overlap', async () => {
    expect(
      (
        await t.call(mo, 'POST', W('/service-accounts'), {
          name: 'CI',
          kind: 'service',
          role: 'member',
          scopes: ['read'],
        })
      ).status,
    ).toBe(403);
    const sa = await t.call<Token & { userId: string }>(ada, 'POST', W('/service-accounts'), {
      name: 'CI bot',
      kind: 'service',
      role: 'member',
      scopes: ['read', 'write'],
    });
    expect(sa.body.token).toMatch(/^orq_svc_/);
    expect(
      (
        await bearer(sa.body.token, 'POST', W('/projects/' + project + '/items'), {
          title: 'From CI',
        })
      ).status,
    ).toBe(201);
    const rot = await t.call<Token>(ada, 'POST', W('/access-tokens/' + sa.body.id + '/rotate'));
    expect(rot.status).toBe(201);
    expect((await bearer(rot.body.token, 'GET', W('/projects'))).status).toBe(200);
    expect((await bearer(sa.body.token, 'GET', W('/projects'))).status).toBe(200);
    const all = await t.call<{ id: string; isService: boolean; expiresAt: string }[]>(
      ada,
      'GET',
      W('/access-tokens'),
    );
    const old = all.body.find((x) => x.id === sa.body.id);
    expect(old?.isService).toBe(true);
    expect(new Date(old?.expiresAt ?? 0).getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    expect((await t.call(ada, 'POST', W('/access-tokens/' + rot.body.id + '/revoke'))).status).toBe(
      200,
    );
    expect((await bearer(rot.body.token, 'GET', W('/projects'))).status).toBe(401);
  });

  it('keeps tokens to the allowed addresses', async () => {
    const r = await t.call<Token>(mo, 'POST', W('/access-tokens'), {
      name: 'IP',
      scopes: ['read'],
    });
    const policy = {
      maxDaysPersonal: 90,
      maxDaysService: 365,
      requireExpiry: true,
      approveBroadScopes: true,
      revokeUnusedDays: null,
    };
    expect(
      (await t.call(ada, 'PUT', W('/token-policy'), { ...policy, ipAllow: ['somewhere'] })).status,
    ).toBe(400);
    await t.call(ada, 'PUT', W('/token-policy'), { ...policy, ipAllow: ['10.0.0.0/8'] });
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(401);
    await t.call(ada, 'PUT', W('/token-policy'), { ...policy, ipAllow: [] });
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(200);
  });

  it('stops tokens that were not used for longer than the policy allows', async () => {
    const r = await t.call<Token>(mo, 'POST', W('/access-tokens'), {
      name: 'Old',
      scopes: ['read'],
    });
    await inSystem(t.db.pool, (c) =>
      c.query("UPDATE api_tokens SET created_at = now() - interval '30 days' WHERE id = $1", [
        r.body.id,
      ]),
    );
    const policy = {
      maxDaysPersonal: 90,
      maxDaysService: 365,
      requireExpiry: true,
      approveBroadScopes: true,
      ipAllow: [],
    };
    await t.call(ada, 'PUT', W('/token-policy'), { ...policy, revokeUnusedDays: 14 });
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(401);
    await t.call(ada, 'PUT', W('/token-policy'), { ...policy, revokeUnusedDays: null });
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(200);
  });

  it('revokes a token pasted into a comment and records the leak', async () => {
    const r = await t.call<Token>(mo, 'POST', W('/access-tokens'), {
      name: 'Pasted',
      scopes: ['read'],
    });
    const item = (
      await t.call<{ id: string }>(mo, 'POST', W('/projects/' + project + '/items'), {
        title: 'Help',
      })
    ).body.id;
    await t.call(mo, 'POST', W('/items/' + item + '/comments'), {
      body: 'try with ' + r.body.token + ' please',
    });
    expect((await bearer(r.body.token, 'GET', W('/projects'))).status).toBe(401);
    const leaks = await t.call<
      { tokenName: string; foundIn: string; ownerName: string; revokedAt: string }[]
    >(ada, 'GET', W('/token-leaks'));
    expect(leaks.body[0]).toMatchObject({
      tokenName: 'Pasted',
      foundIn: 'comment',
      ownerName: 'Mo',
    });
    expect(leaks.body[0]?.revokedAt).toBeTruthy();
    expect((await t.call(mo, 'GET', W('/token-leaks'))).status).toBe(403);
  });

  it('uses the workspace price, counts budgets and stops at a hard one', async () => {
    // 1000 tokens at 2000 USD a million = 2 USD = 1 € a turn at 0.5
    expect(
      (
        await t.call(ada, 'POST', W('/model-prices'), {
          provider: 'scripted',
          model: 'claude-sonnet-5-5',
          effectiveFrom: '2026-01-01',
          inputUsd: 2000,
          outputUsd: 0,
        })
      ).status,
    ).toBe(201);
    await t.call(ada, 'PATCH', W('/agents/' + analyst), { model: 'claude-sonnet-5-5' });
    const prices = await t.call<{ prices: { model: string; source: string; inputUsd: number }[] }>(
      mo,
      'GET',
      W('/model-prices'),
    );
    expect(
      prices.body.prices.find((p) => p.model === 'claude-sonnet-5-5' && p.source === 'workspace')
        ?.inputUsd,
    ).toBe(2000);
    expect(
      (
        await t.call(ada, 'POST', W('/budgets'), {
          scopeType: 'project',
          period: 'month',
          amountCents: 150,
        })
      ).status,
    ).toBe(400);
    const b = await t.call<{ id: string; scopeLabel: string }>(ada, 'POST', W('/budgets'), {
      scopeType: 'project',
      scopeId: project,
      period: 'month',
      amountCents: 150,
      hardStop: true,
    });
    expect(b.body.scopeLabel).toBe('TOK');
    const run = async (): Promise<{ status: string; error: string }> => {
      current = scriptedProvider([say('Done.')]);
      const r = await t.call<{ id: string }>(
        ada,
        'POST',
        W('/projects/' + project + '/agent-runs'),
        { agentId: analyst, instruction: 'Go' },
      );
      const end = Date.now() + 10_000;
      for (;;) {
        const x = await t.call<{ run: { status: string; error: string } }>(
          ada,
          'GET',
          W('/agent-runs/' + r.body.id),
        );
        if (['succeeded', 'failed'].includes(x.body.run.status)) return x.body.run;
        if (Date.now() > end) throw new Error('stuck');
        await new Promise((res) => setTimeout(res, 50));
      }
    };
    expect((await run()).status).toBe('succeeded');
    expect((await run()).status).toBe('succeeded');
    const stopped = await run();
    expect(stopped).toMatchObject({
      status: 'failed',
      error: 'The project budget of 1,50 € for this month is used up',
    });
    const list = await t.call<{ id: string; usedCents: number }[]>(mo, 'GET', W('/budgets'));
    expect(list.body.find((x) => x.id === b.body.id)?.usedCents).toBe(200);
    const spend = await t.call<{
      monthCents: number;
      todayRuns: number;
      byProject: { key: string; cents: number }[];
      days: unknown[];
    }>(mo, 'GET', W('/ai-spend?days=7'));
    expect(spend.body).toMatchObject({
      monthCents: 200,
      todayRuns: 3,
      byProject: [{ key: 'TOK', cents: 200 }],
    });
    expect(spend.body.days).toHaveLength(7);
    expect((await t.call(ada, 'DELETE', W('/budgets/' + b.body.id))).status).toBe(200);
  });

  it('keeps a project’s own provider key, never shown again', async () => {
    expect(
      (
        await t.call(ada, 'PUT', W('/projects/' + project + '/provider-key'), {
          key: 'not-a-key-at-all-really',
        })
      ).status,
    ).toBe(400);
    const k = await t.call<{ hint: string }>(
      ada,
      'PUT',
      W('/projects/' + project + '/provider-key'),
      { key: 'sk-ant-api03-' + 'x'.repeat(30) + 'WXYZ', label: 'Client pays' },
    );
    expect(k.body.hint).toBe('WXYZ');
    expect((await t.call(mo, 'GET', W('/provider-keys'))).status).toBe(403);
    const keys = await t.call<{ projectKey: string | null; label: string; hint: string }[]>(
      ada,
      'GET',
      W('/provider-keys'),
    );
    expect(keys.body.find((x) => x.projectKey === 'TOK')).toMatchObject({
      label: 'Client pays',
      hint: 'WXYZ',
    });
    expect(JSON.stringify(keys.body)).not.toContain('sk-ant');
    expect(
      (
        await t.call<{ removed: boolean }>(
          ada,
          'DELETE',
          W('/projects/' + project + '/provider-key'),
        )
      ).body.removed,
    ).toBe(true);
  });
});
