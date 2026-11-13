// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-117 | S15 | v0.1.0] Build the lifecycle engine: phases, stages, gates, criteria, sign-off, live ──
//    Why:  the T07 exit check against the real database: a project walks Ideation → Approval, and the
//          gate blocks exactly when it should, for whom it should, with every decision recorded.
import type { LifecycleState, ServerMessage } from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RawWsClient } from '../wsclient.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('the lifecycle engine (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person; // owner
  let bob: Person; // admin
  let cy: Person; // member
  let project = '';
  let board: RawWsClient;
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  const L = (p = ''): string => W('/projects/' + project + '/lifecycle' + p);
  type Reply = { lifecycle: LifecycleState; error?: { message: string } };
  const stage = (life: LifecycleState, key: string) =>
    life.phases.flatMap((p) => p.stages).find((s) => s.key === key) ?? {
      id: 'missing',
      status: '',
    };
  const gate = (life: LifecycleState, key: string) =>
    life.phases.find((p) => p.gate?.key === key)?.gate;
  const read = async (): Promise<LifecycleState> =>
    (await t.call<Reply>(ada, 'GET', L())).body.lifecycle;

  beforeAll(async () => {
    t = await startTestApp({ live: true });
    ada = await t.signup('Ada');
    bob = await t.signup('Bob');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: bob.email, role: 'admin' });
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'member' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'NEW', name: 'New product' })
    ).body.id;
    board = await RawWsClient.open(t.port, { cookie: cy.cookie });
    board.sendJson({ type: 'subscribe', workspaceId: ada.workspaceId });
    await board.until(() => board.messages<ServerMessage>().some((m) => m.type === 'subscribed'));
  }, 60_000);

  afterAll(async () => {
    board.destroy();
    await t.stop();
  });

  it('starts from the default template: four phases, 14 stages, three gates, only an admin starts it', async () => {
    expect((await t.call<Reply>(ada, 'GET', L())).body.lifecycle).toBeNull();
    expect((await t.call(cy, 'POST', L(), {})).status).toBe(403);
    const r = await t.call<Reply>(bob, 'POST', L(), {});
    expect(r.status).toBe(201);
    const life = r.body.lifecycle;
    expect(life.phases.map((p) => p.key)).toEqual(['discover', 'plan', 'build', 'ship']);
    expect(life.phases.flatMap((p) => p.stages)).toHaveLength(14);
    expect(life.phases.map((p) => p.gate?.status ?? null)).toEqual([
      'open',
      'locked',
      'locked',
      null,
    ]);
    expect(life.currentPhase).toBe('discover');
    expect((await t.call(bob, 'POST', L(), {})).status).toBe(409);
  });

  it('refuses to start work behind a closed gate, and says why', async () => {
    const life = await read();
    expect(stage(life, 'sprint-planning')).toMatchObject({
      blockedBy: 'Waiting for the gate before this phase',
    });
    const r = await t.call<Reply>(cy, 'POST', L('/stages/' + stage(life, 'sprint-planning').id), {
      status: 'active',
    });
    expect(r.status).toBe(409);
    expect(r.body.error?.message).toContain('the gate before Plan and set up is not approved');
  });

  it('walks Ideation to Approval; G1 opens only when stages and criteria are complete, and only for the owner', async () => {
    let life = await read();
    for (const key of ['ideation', 'interview', 'proposal']) {
      expect(
        (await t.call(cy, 'POST', L('/stages/' + stage(life, key).id), { status: 'active' }))
          .status,
      ).toBe(200);
      life = (
        await t.call<Reply>(cy, 'POST', L('/stages/' + stage(life, key).id), {
          status: 'done',
          note: key + ' done',
        })
      ).body.lifecycle;
    }
    // Approval still open: G1 says so, and refuses
    const g1 = gate(life, 'g1');
    expect(g1?.status).toBe('open');
    expect(g1?.missing).toContain('Stage Approval is not finished');
    expect(g1?.missing.filter((m) => m.startsWith('Not met'))).toHaveLength(4);
    expect((await t.call(ada, 'POST', L('/gates/g1'), { decision: 'approve' })).status).toBe(409);

    life = (
      await t.call<Reply>(cy, 'POST', L('/stages/' + stage(life, 'approval').id), {
        status: 'done',
      })
    ).body.lifecycle;
    for (const c of gate(life, 'g1')?.criteria ?? [])
      life = (
        await t.call<Reply>(cy, 'POST', L('/criteria/' + c.id), {
          met: true,
          evidence: 'see the proposal, ' + c.key,
        })
      ).body.lifecycle;
    expect(gate(life, 'g1')).toMatchObject({ status: 'ready', missing: [] });
    expect(gate(life, 'g1')?.criteria[0]).toMatchObject({
      met: true,
      metBy: 'Cy',
      evidence: 'see the proposal, proposal',
    });

    // G1 is the owner's: a member and an admin may not sign it
    expect((await t.call(cy, 'POST', L('/gates/g1'), { decision: 'approve' })).status).toBe(403);
    expect((await t.call(bob, 'POST', L('/gates/g1'), { decision: 'approve' })).status).toBe(403);
    // the owner first rejects, then approves; both are recorded
    life = (
      await t.call<Reply>(ada, 'POST', L('/gates/g1'), {
        decision: 'reject',
        note: 'Budget too high',
      })
    ).body.lifecycle;
    expect(gate(life, 'g1')?.status).toBe('rejected');
    expect(stage(life, 'sprint-planning')).toMatchObject({
      blockedBy: 'Waiting for the gate before this phase',
    });
    life = (await t.call<Reply>(ada, 'POST', L('/gates/g1'), { decision: 'approve', note: 'Go' }))
      .body.lifecycle;
    expect(gate(life, 'g1')?.status).toBe('approved');
    expect(gate(life, 'g1')?.signoffs.map((x) => [x.decision, x.by, x.note])).toEqual([
      ['reject', 'Ada', 'Budget too high'],
      ['approve', 'Ada', 'Go'],
    ]);
    expect(life.currentPhase).toBe('plan');
    expect(gate(life, 'g2')?.status).toBe('open');
    expect(stage(life, 'sprint-planning')).toMatchObject({ blockedBy: null });
  });

  it('keeps an approved gate closed to changes, and lets an admin reopen it only while nothing after it started', async () => {
    let life = await read();
    expect(
      (await t.call(cy, 'POST', L('/stages/' + stage(life, 'proposal').id), { status: 'active' }))
        .status,
    ).toBe(409);
    expect(
      (
        await t.call(cy, 'POST', L('/criteria/' + String(gate(life, 'g1')?.criteria[0]?.id)), {
          met: false,
        })
      ).status,
    ).toBe(409);
    expect((await t.call(cy, 'POST', L('/gates/g1'), { decision: 'reopen' })).status).toBe(403);
    life = (
      await t.call<Reply>(bob, 'POST', L('/gates/g1'), {
        decision: 'reopen',
        note: 'Scope changed',
      })
    ).body.lifecycle;
    expect(gate(life, 'g1')?.status).toBe('ready');
    life = (await t.call<Reply>(ada, 'POST', L('/gates/g1'), { decision: 'approve' })).body
      .lifecycle;
    await t.call(cy, 'POST', L('/stages/' + stage(life, 'sprint-planning').id), {
      status: 'active',
    });
    const r = await t.call<Reply>(bob, 'POST', L('/gates/g1'), { decision: 'reopen' });
    expect(r.status).toBe(409);
    expect(r.body.error?.message).toContain('has started');
  });

  it('tells the board live, and shows every project’s position', async () => {
    await board.until(() =>
      board
        .messages<ServerMessage>()
        .some((m) => m.type === 'event' && m.event.type === 'orqiva.gate.approved'),
    );
    expect(
      board
        .messages<ServerMessage>()
        .some((m) => m.type === 'event' && m.event.type === 'orqiva.stage.completed'),
    ).toBe(true);
    const overview = await t.call<
      { key: string; phase: string; gates: { key: string; status: string }[] }[]
    >(cy, 'GET', W('/lifecycle'));
    expect(overview.body).toEqual([
      expect.objectContaining({
        key: 'NEW',
        phase: 'plan',
        gates: [
          expect.objectContaining({ key: 'g1', status: 'approved' }),
          expect.objectContaining({ key: 'g2', status: 'open' }),
          expect.objectContaining({ key: 'g3', status: 'locked' }),
        ],
      }),
    ]);
  });
});
