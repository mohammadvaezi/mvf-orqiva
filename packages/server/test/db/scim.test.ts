// ── [PCODE-213 | S15 | v0.1.0] T19.2 SCIM 2.0 provisioning (users, role groups, suspend on deactivate) and identity settings (SAML, SCIM tokens) ──
//    Why:  SCIM against PostgreSQL the way an identity provider uses it: with a token an admin made, it
//          looks a person up, creates them, deactivates them (they then reach nothing), gives them a role
//          through a group and removes them; a wrong or revoked token gets a SCIM error.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inSystem } from '../../src/db/pool.js';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';
import { installLicence } from './licencehelper.js';

describe.skipIf(!hasDatabase)('SCIM provisioning (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let token = '';
  let tokenId = '';
  let ines = '';
  const scim = async (method: string, path: string, body?: unknown, bearer = token) => {
    const res = await fetch(t.base + '/scim/v2' + path, {
      method,
      headers: {
        authorization: 'Bearer ' + bearer,
        ...(body ? { 'content-type': 'application/scim+json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      type: res.headers.get('content-type') ?? '',
      body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
    };
  };
  const membership = async (email: string) =>
    (
      await inSystem(t.db.pool, (c) =>
        c.query<{ role: string; suspended: boolean }>(
          'SELECT m.role, m.suspended_at IS NOT NULL AS suspended FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = $2',
          [ada.workspaceId, email],
        ),
      )
    ).rows[0];

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    await installLicence(t, ada); // [PCODE-219 | S15 | v0.1.0] SAML and SCIM are Enterprise features
    const made = await t.call<{ id: string; token: string; baseUrl: string }>(
      ada,
      'POST',
      '/api/workspaces/' + ada.workspaceId + '/scim/tokens',
      {
        name: 'Okta',
      },
    );
    token = made.body.token;
    tokenId = made.body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('describes itself and refuses a wrong token the SCIM way', async () => {
    expect(token).toMatch(/^orq_scim_[\w-]{43}$/);
    const cfg = await scim('GET', '/ServiceProviderConfig');
    expect(cfg.type).toContain('application/scim+json');
    expect(cfg.body['patch']).toEqual({ supported: true });
    const bad = await scim('GET', '/Users', undefined, 'orq_scim_' + 'x'.repeat(43));
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
    });
  });

  it('creates a person, finds them by userName and refuses a second create', async () => {
    const user = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Ines@Helio.example',
      externalId: '00u1',
      name: { givenName: 'Ines', familyName: 'Vogel' },
      emails: [{ value: 'ines@helio.example', primary: true }],
      active: true,
    };
    const made = await scim('POST', '/Users', user);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      userName: 'ines@helio.example',
      externalId: '00u1',
      displayName: 'Ines Vogel',
      active: true,
    });
    ines = String(made.body['id']);
    expect((await scim('POST', '/Users', user)).status).toBe(409);
    const found = await scim(
      'GET',
      '/Users?filter=' + encodeURIComponent('userName eq "ines@helio.example"'),
    );
    expect(found.body).toMatchObject({ totalResults: 1 });
    expect((await scim('GET', '/Users?filter=' + encodeURIComponent('title co "x"'))).status).toBe(
      400,
    );
    expect(await membership('ines@helio.example')).toEqual({ role: 'member', suspended: false });
  });

  it('deactivates and restores through active, and gives a role through a group', async () => {
    const off = await scim('PATCH', '/Users/' + ines, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', value: { active: false } }],
    });
    expect(off.body['active']).toBe(false);
    expect(await membership('ines@helio.example')).toEqual({ role: 'member', suspended: true });
    await scim('PATCH', '/Users/' + ines, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: true }],
    });
    expect((await membership('ines@helio.example'))?.suspended).toBe(false);
    const g = await scim('PATCH', '/Groups/admin', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'add', path: 'members', value: [{ value: ines }] }],
    });
    expect(g.body['members']).toEqual([{ value: ines, display: 'ines@helio.example' }]);
    expect((await membership('ines@helio.example'))?.role).toBe('admin');
    // the owner is not moved by the directory
    const owner = await scim('PATCH', '/Groups/guest', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'add', path: 'members', value: [{ value: ada.id }] }],
    });
    expect(owner.status).toBe(400);
    expect((await scim('GET', '/Groups/nonsense')).status).toBe(404);
  });

  it('removes a person, and a revoked token stops working', async () => {
    expect((await scim('DELETE', '/Users/' + ines)).status).toBe(204);
    expect(await membership('ines@helio.example')).toBeUndefined();
    expect((await scim('GET', '/Users/' + ines)).status).toBe(404);
    await t.call(ada, 'DELETE', '/api/workspaces/' + ada.workspaceId + '/scim/tokens/' + tokenId);
    expect((await scim('GET', '/Users')).status).toBe(401);
  });
});
