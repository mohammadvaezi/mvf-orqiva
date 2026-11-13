// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
//    Why:  T11's exit against the real database: signing G1 queues the staging deploy, and the deploy's
//          success with a passing health check is G2's evidence; a failed one is not.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = '12'.repeat(32);

interface Life {
  phases: {
    stages: { id: string; key: string }[];
    gate?: { key: string; criteria: { id: string; key: string; met: boolean; evidence: string }[] };
  }[];
}

describe.skipIf(!hasDatabase)('deploying from a gate (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let token = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const L = (p = ''): string => W('/projects/' + project + '/lifecycle' + p);
  const runner = async (path: string, body?: unknown) => {
    const res = await fetch(t.base + path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return (await res.json()) as { run: { id: string } | null };
  };
  const g2 = async () =>
    (await t.call<{ lifecycle: Life }>(ada, 'GET', L())).body.lifecycle.phases.find(
      (p) => p.gate?.key === 'g2',
    )?.gate?.criteria ?? [];
  /** A runner takes the queued deploy and ends it, with or without a passing health check. */
  const deploy = async (ok: boolean): Promise<void> => {
    const claim = await runner('/api/runner/claim');
    const id = claim.run?.id ?? '';
    await runner('/api/runner/deploys/' + id + '/steps', {
      seq: 1,
      name: 'Start the new version',
      status: 'ok',
    });
    await runner('/api/runner/deploys/' + id + '/steps', {
      seq: 2,
      name: 'Health check',
      status: ok ? 'ok' : 'failed',
    });
    await runner('/api/runner/deploys/' + id + '/finish', { status: ok ? 'succeeded' : 'failed' });
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'NEW', name: 'New' })
    ).body.id;
    await t.call(ada, 'POST', L(), {});
    await t.call(ada, 'POST', W('/projects/' + project + '/environments'), {
      key: 'staging',
      name: 'Staging',
      kind: 'compose',
      settings: { dir: '/srv/new' },
      healthUrl: 'https://staging.example/health',
      deployOnGate: 'g1',
    });
    token = (await t.call<{ token: string }>(ada, 'POST', W('/runners'), { name: 'box' })).body
      .token;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('queues the staging deploy when G1 is signed, once', async () => {
    let life = (await t.call<{ lifecycle: Life }>(ada, 'GET', L())).body.lifecycle;
    const discover = life.phases[0];
    for (const st of discover?.stages ?? []) {
      await t.call(ada, 'POST', L('/stages/' + st.id), { status: 'active' });
      life = (
        await t.call<{ lifecycle: Life }>(ada, 'POST', L('/stages/' + st.id), { status: 'done' })
      ).body.lifecycle;
    }
    for (const c of life.phases[0]?.gate?.criteria ?? [])
      await t.call(ada, 'POST', L('/criteria/' + c.id), { met: true, evidence: 'yes' });
    expect(
      (
        await t.call<{ id: string; status: string }[]>(
          ada,
          'GET',
          W('/projects/' + project + '/deploys'),
        )
      ).body,
    ).toEqual([]);
    expect((await t.call(ada, 'POST', L('/gates/g1'), { decision: 'approve' })).status).toBe(200);
    const deploys = await t.call<{ status: string; trigger: string; environment: string }[]>(
      ada,
      'GET',
      W('/projects/' + project + '/deploys'),
    );
    expect(deploys.body).toEqual([
      expect.objectContaining({ status: 'queued', trigger: 'gate:g1', environment: 'Staging' }),
    ]);
  });

  it('takes a failed deploy as no evidence, and a successful one with its health check as G2’s', async () => {
    await deploy(false);
    expect((await g2()).filter((c) => c.met)).toEqual([]);
    await t.call(ada, 'POST', W('/environments/' + (await envId()) + '/deploys'), {});
    await deploy(true);
    const criteria = await g2();
    expect(criteria.filter((c) => c.met).map((c) => c.key)).toEqual(['provisioned', 'verified']);
    expect(criteria.find((c) => c.key === 'provisioned')?.evidence).toMatch(
      /^Deployed: Staging \(deploy [0-9a-f]{8}, /,
    );
    expect(criteria.find((c) => c.key === 'verified')?.evidence).toBe(
      'Health checks passed: Staging https://staging.example/health',
    );
  });

  const envId = async (): Promise<string> =>
    (await t.call<{ id: string }[]>(ada, 'GET', W('/projects/' + project + '/environments')))
      .body[0]?.id ?? '';
});
