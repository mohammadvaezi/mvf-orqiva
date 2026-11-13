// ── [PCODE-277 | S15 | v0.1.0] T28.6 PRD approval by named approvers, reopen on edit, promote to an epic with stories, client in ideation ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-125 | S15 | v0.1.0] Approve proposals with an electronic signature and turn them into a plan ──
//    Why:  the owner's signature and the plan it creates, against the real database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scriptedProvider, type ModelReply } from '../../src/agents/provider.js';
import { proposalHash } from '../../src/api/signing.js';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const say = (text: string): ModelReply => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { input: 10, output: 10 },
});
const content = {
  summary: 'CSV export.',
  problem: 'Finance retypes numbers.',
  goals: [],
  scopeIn: [],
  scopeOut: [],
  risks: [],
  tasks: [
    { title: 'Export endpoint', estimate: 3, description: 'Stream rows' },
    { title: 'Export button', estimate: 2, description: '' },
  ],
};

describe('the signed fingerprint', () => {
  it('does not depend on key order, and changes with the content', () => {
    const a = proposalHash('CSV', 1, content);
    const reordered = Object.fromEntries(Object.entries(content).reverse()) as typeof content;
    expect(proposalHash('CSV', 1, reordered)).toBe(a);
    expect(proposalHash('CSV', 2, content)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe.skipIf(!hasDatabase)('signing a proposal (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let cy: Person;
  let project = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Decision = {
    idea: { status: string };
    signatures: {
      decision: string;
      version: number;
      typedName: string;
      contentSha256: string;
      signer: string;
    }[];
    plan: { id: string; ref: string; title: string; estimate: number | null }[];
  };

  /** An idea interviewed and proposed, ready to sign. */
  const proposed = async (title: string): Promise<string> => {
    const id = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/ideas'), { title })
    ).body.id;
    await t.call(ada, 'POST', W('/ideas/' + id + '/interview'), {});
    await t.call(ada, 'POST', W('/ideas/' + id + '/proposals'), { content });
    return id;
  };

  beforeAll(async () => {
    t = await startTestApp({
      agents: {
        provider: () =>
          Promise.resolve(scriptedProvider(Array.from({ length: 5 }, () => say('READY: ok')))),
      },
    });
    ada = await t.signup('Ada Lovelace');
    cy = await t.signup('Cy');
    await t.call(ada, 'POST', W('/members'), { email: cy.email, role: 'admin' });
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'APP', name: 'App' })
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets only the owner sign the latest version, by their own name and with consent', async () => {
    const idea = await proposed('CSV export');
    const sign = (who: Person, body: Record<string, unknown>) =>
      t.call<{ error: { message: string } }>(who, 'POST', W('/ideas/' + idea + '/sign'), {
        version: 1,
        decision: 'approve',
        name: 'Ada Lovelace',
        consent: true,
        ...body,
      });
    expect((await sign(cy, { name: 'Cy' })).status).toBe(403);
    expect((await sign(ada, { name: 'Ada' })).body.error.message).toBe(
      'Type your full name as it is on your account',
    );
    expect((await sign(ada, { consent: false })).status).toBe(400);
    expect((await sign(ada, { version: 2 })).body.error.message).toContain(
      'Version 1 is the latest',
    );

    const ok = await t.call<Decision>(ada, 'POST', W('/ideas/' + idea + '/sign'), {
      version: 1,
      decision: 'approve',
      name: '  ada   lovelace ',
      consent: true,
      note: 'Go',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.idea.status).toBe('approved');
    expect(ok.body.signatures).toEqual([
      expect.objectContaining({
        decision: 'approved',
        version: 1,
        typedName: 'ada   lovelace',
        signer: 'Ada Lovelace',
      }),
    ]);
    expect(ok.body.signatures[0]?.contentSha256).toBe(proposalHash('CSV export', 1, content));
    // [PCODE-277 | S15 | v0.1.0] approval creates nothing; promotion makes the epic with the tasks under it
    expect(ok.body.plan).toEqual([]);
    expect((await sign(ada, {})).body.error.message).toBe('This idea is already approved');
    const promoted = await t.call<{
      epic: { ref: string };
      items: { id: string; ref: string; kind: string }[];
    }>(ada, 'POST', W('/ideas/' + idea + '/promote'));
    expect(promoted.status).toBe(201);
    expect(promoted.body.epic.ref).toBe('APP-1');
    expect(promoted.body.items.map((x) => [x.ref, x.kind])).toEqual([
      ['APP-2', 'task'],
      ['APP-3', 'task'],
    ]);
    const plan = await t.call<Decision>(ada, 'GET', W('/ideas/' + idea + '/decision'));
    expect(plan.body.plan).toEqual([
      { id: expect.any(String) as string, ref: 'APP-1', title: 'CSV export', estimate: null },
      { id: expect.any(String) as string, ref: 'APP-2', title: 'Export endpoint', estimate: 3 },
      { id: expect.any(String) as string, ref: 'APP-3', title: 'Export button', estimate: 2 },
    ]);
    const item = await t.call<{ description: string; parentId: string | null }>(
      ada,
      'GET',
      W('/items/' + (promoted.body.items[0]?.id ?? '')),
    );
    expect(item.body.description).toBe('Stream rows\n\nFrom idea APP-I1, PRD version 1.');
    // promoted means frozen: no new version, no second promotion
    expect(
      (await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), { content })).status,
    ).toBe(409);
    expect((await t.call(ada, 'POST', W('/ideas/' + idea + '/promote'))).status).toBe(409);
    const events = await inSystem(t.db.pool, async (c) =>
      (
        await c.query<{ type: string }>(
          "SELECT type FROM activity_events WHERE type LIKE 'orqiva.idea.%' ORDER BY sequence",
        )
      ).rows.map((r) => r.type),
    );
    expect(events.slice(-2)).toEqual(['orqiva.idea.approved', 'orqiva.idea.updated']);
  });

  // [PCODE-277 | S15 | v0.1.0]
  it('reopens an approval when the proposal changes before promotion', async () => {
    const idea = await proposed('Dark mode');
    await t.call(ada, 'POST', W('/ideas/' + idea + '/sign'), {
      version: 1,
      decision: 'approve',
      name: 'Ada Lovelace',
      consent: true,
    });
    const v2 = await t.call(ada, 'POST', W('/ideas/' + idea + '/proposals'), { content });
    expect(v2.status).toBe(201);
    const after = await t.call<Decision>(ada, 'GET', W('/ideas/' + idea + '/decision'));
    expect(after.body.idea.status).toBe('proposed');
    // the owner signs the new version; the first signature stays on record
    const again = await t.call<Decision>(ada, 'POST', W('/ideas/' + idea + '/sign'), {
      version: 2,
      decision: 'approve',
      name: 'Ada Lovelace',
      consent: true,
    });
    expect(again.body.idea.status).toBe('approved');
    expect(again.body.signatures.map((s) => s.version)).toEqual([2, 1]);
  });

  it('records a decline and creates nothing', async () => {
    const idea = await proposed('Badges');
    const r = await t.call<Decision>(ada, 'POST', W('/ideas/' + idea + '/sign'), {
      version: 1,
      decision: 'decline',
      name: 'Ada Lovelace',
      consent: true,
    });
    expect(r.body.idea.status).toBe('declined');
    expect(r.body.plan).toEqual([]);
    expect(r.body.signatures.map((s) => s.decision)).toEqual(['declined']);
    const seen = await t.call<Decision>(cy, 'GET', W('/ideas/' + idea + '/decision'));
    expect(seen.body.signatures).toHaveLength(1);
  });
});
