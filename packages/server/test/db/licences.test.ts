// ── [PCODE-359 | S15 | v0.1.0] T35.7a Plan contents enforced ──
// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-148 | S15 | v0.1.0] Add signed licence keys with seats, features and expiry ──
//    Why:  licences against the real database, signed with a key made for the test (the vendor's private
//          key never enters the repository).
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  BUSINESS_FEATURES,
  entitlementOf,
  PREFIX,
  TEAM_PROJECTS,
  type Licence,
} from '@orqiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useLicenceKeyForTests, verifyLicence } from '../../src/licence/licence.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
useLicenceKeyForTests(publicKey.export({ type: 'spki', format: 'pem' }).toString());

const licence = (over: Partial<Licence> = {}): Licence => ({
  v: 1,
  id: 'lic-1',
  customer: 'Acme GmbH',
  email: 'it@acme.example',
  plan: 'business',
  seats: 7,
  features: [],
  issued: '2026-10-04T00:00:00.000Z',
  expires: '2099-01-01T00:00:00.000Z',
  ...over,
});
const tokenOf = (l: Licence, key = privateKey): string => {
  const payload = Buffer.from(JSON.stringify(l));
  return (
    PREFIX + payload.toString('base64url') + '.' + sign(null, payload, key).toString('base64url')
  );
};

describe('licence tokens', () => {
  it('verify only when signed with our key and left unchanged', () => {
    expect(verifyLicence(tokenOf(licence()))).toEqual({ licence: licence() });
    expect(verifyLicence(tokenOf(licence(), other.privateKey))).toEqual({
      problem: 'The licence’s signature does not match; it was changed or not issued by us',
    });
    const t = tokenOf(licence());
    const forged =
      PREFIX +
      Buffer.from(JSON.stringify(licence({ seats: 999 }))).toString('base64url') +
      '.' +
      (t.split('.')[2] ?? '');
    expect('problem' in verifyLicence(forged)).toBe(true);
    expect(verifyLicence('hello')).toEqual({
      problem: 'This is not an Orqiva licence (it should start with PE1.)',
    });
    expect(verifyLicence(tokenOf({ ...licence(), seats: 0 }))).toEqual({
      problem: 'The licence is incomplete: seats is a whole number of 1 or more',
    });
  });

  it('decide seats, features and expiry', () => {
    const now = new Date('2026-10-04T00:00:00Z');
    // [PCODE-359 | S15 | v0.1.0] the free plan keeps the Business contents; Team holds none of them
    expect(entitlementOf(null, 3, now)).toMatchObject({ status: 'free', seats: 5 });
    expect(entitlementOf(null, 3, now).features).toEqual([...BUSINESS_FEATURES]);
    expect(entitlementOf(licence({ plan: 'team' }), 3, now).features).toEqual([]);
    expect(
      entitlementOf(licence({ plan: 'enterprise', features: ['extra'] }), 3, now).features,
    ).toEqual([...BUSINESS_FEATURES, 'sso', 'scim', 'audit-export', 'extra']);
    expect(entitlementOf(licence({ expires: '2026-01-01T00:00:00Z' }), 3, now)).toMatchObject({
      status: 'expired',
      seats: 5,
      problem:
        'The licence expired on 2026-01-01; the free plan’s limits apply until it is renewed',
    });
    expect(entitlementOf(licence(), 8, now)).toMatchObject({ status: 'over_seats' });
  });
});

describe.skipIf(!hasDatabase)('seats in a workspace (PostgreSQL)', () => {
  let t: TestApp;
  let owner: Person;
  const people: Person[] = [];
  const W = (p: string): string => '/api/workspaces/' + owner.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.signup('Olga');
    for (let i = 0; i < 6; i++) people.push(await t.signup('Person ' + String(i)));
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps the free plan to five seats, and says why', async () => {
    for (const p of people.slice(0, 4))
      expect(
        (await t.call(owner, 'POST', W('/members'), { email: p.email, role: 'member' })).status,
      ).toBe(201);
    const full = await t.call<{ error: { message: string } }>(owner, 'POST', W('/members'), {
      email: people[4]?.email,
      role: 'member',
    });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toBe(
      'All 5 seats are taken (free plan); add a licence for more',
    );
    expect(
      (
        await t.call(owner, 'POST', W('/invitations'), {
          email: 'new@example.test',
          role: 'member',
        })
      ).status,
    ).toBe(409);
    const l = await t.call<{ status: string; used: number; seats: number }>(
      owner,
      'GET',
      W('/licence'),
    );
    expect(l.body).toMatchObject({ status: 'free', used: 5, seats: 5 });
  });

  it('takes a licence from the owner only, and gives its seats', async () => {
    const member = people[0] as Person;
    expect((await t.call(member, 'PUT', W('/licence'), { token: tokenOf(licence()) })).status).toBe(
      403,
    );
    expect(
      (await t.call(owner, 'PUT', W('/licence'), { token: tokenOf(licence(), other.privateKey) }))
        .status,
    ).toBe(400);
    const r = await t.call<{
      status: string;
      plan: string;
      seats: number;
      customer: string;
      source: string;
    }>(owner, 'PUT', W('/licence'), {
      token: tokenOf(licence()),
    });
    expect(r.body).toMatchObject({
      status: 'active',
      plan: 'business',
      seats: 7,
      customer: 'Acme GmbH',
      source: 'workspace',
    });
    expect(
      (await t.call(owner, 'POST', W('/members'), { email: people[4]?.email, role: 'member' }))
        .status,
    ).toBe(201);
    const removed = await t.call<{ status: string }>(owner, 'DELETE', W('/licence'));
    expect(removed.body).toMatchObject({ status: 'over_seats' });
    expect(
      (await t.call(owner, 'POST', W('/members'), { email: people[5]?.email, role: 'member' }))
        .status,
    ).toBe(409);
  });
});

// [PCODE-359 | S15 | v0.1.0] a Team workspace is held to the Team plan; Business opens it again
describe.skipIf(!hasDatabase)('plan contents (PostgreSQL)', () => {
  let t: TestApp;
  let owner: Person;
  const W = (p: string): string => '/api/workspaces/' + owner.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.signup('Tess');
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('keeps Team to its projects and features, and names the plan that has them', async () => {
    expect(
      (await t.call(owner, 'PUT', W('/licence'), { token: tokenOf(licence({ plan: 'team' })) }))
        .status,
    ).toBe(200);
    const made: string[] = [];
    for (let i = 0; i < TEAM_PROJECTS; i++) {
      const r = await t.call<{ id: string }>(owner, 'POST', W('/projects'), {
        key: 'TP' + String(i),
        name: 'Team project ' + String(i),
      });
      expect(r.status).toBe(201);
      made.push(r.body.id);
    }
    const sixth = await t.call<{ error: { message: string } }>(owner, 'POST', W('/projects'), {
      key: 'TP9',
      name: 'One too many',
    });
    expect(sixth.status).toBe(403);
    expect(sixth.body.error.message).toContain('The Team plan holds 5 active projects');
    // archiving one makes room; restoring it while full does not
    const first = made[0] ?? '';
    expect((await t.call(owner, 'PATCH', W('/projects/' + first), { archived: true })).status).toBe(
      200,
    );
    expect(
      (await t.call(owner, 'POST', W('/projects'), { key: 'TP9', name: 'Now it fits' })).status,
    ).toBe(201);
    expect(
      (await t.call(owner, 'PATCH', W('/projects/' + first), { archived: false })).status,
    ).toBe(403);

    const project = made[1] ?? '';
    const refused: [string, string, string, unknown][] = [
      ['GET', W('/command-center'), 'The command center', undefined],
      ['POST', W('/agents'), 'Making your own agents', { key: 'mine', name: 'Mine' }],
      ['POST', W('/lifecycle/templates'), 'Your own lifecycles and gates', { name: 'Ours' }],
      ['POST', W('/projects/' + project + '/test-cases'), 'Test management', { title: 'Login' }],
      [
        'PUT',
        W('/projects/' + project + '/compliance/frameworks/iso27001'),
        'Compliance packs',
        { enabled: true },
      ],
      ['GET', W('/activity/export?format=json'), 'The audit log export', undefined],
    ];
    for (const [method, path, what, body] of refused) {
      const r = await t.call<{ error: { message: string } }>(owner, method, path, body);
      expect([path, r.status]).toEqual([path, 403]);
      expect(r.body.error.message).toBe(
        what +
          ' is part of the Business plan. Install a licence that includes it (Settings → Plan and billing)',
      );
    }

    // Business holds all of it
    expect((await t.call(owner, 'PUT', W('/licence'), { token: tokenOf(licence()) })).status).toBe(
      200,
    );
    expect(
      (await t.call(owner, 'PATCH', W('/projects/' + first), { archived: false })).status,
    ).toBe(200);
    expect((await t.call(owner, 'GET', W('/command-center'))).status).toBe(200);
    expect(
      (await t.call(owner, 'POST', W('/projects/' + project + '/test-cases'), { title: 'Login' }))
        .status,
    ).toBe(201);
    expect((await t.call(owner, 'GET', W('/activity/export?format=json'))).status).toBe(200);
  });
});
