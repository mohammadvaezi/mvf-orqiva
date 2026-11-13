// ── [PCODE-163 | S15 | v0.1.0] B1.2 Roles, clients and portal sign-in on the server ──
//    Why:  the client's whole way in, through the API against PostgreSQL: the team creates a client with its
//          portal domain and assigns a project; an invitation makes a new person the client's contact; that
//          contact then sees exactly their client's project, comments written for them and nothing else,
//          writes only for the client, takes no seat, and the portal's sign-in page knows its domain. The new
//          roles work as members (tester) or read only (auditor).
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

describe.skipIf(!hasDatabase)('clients and the portal (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let helio = '';
  const projects: Record<string, string> = {};
  const items: Record<string, string> = {};
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    for (const key of ['HEL', 'NWL']) {
      projects[key] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key, name: key + ' app' })
      ).body.id;
      items[key] = (
        await t.call<{ id: string }>(ada, 'POST', W('/projects/' + projects[key] + '/items'), {
          title: key + ' booking',
        })
      ).body.id;
    }
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('creates a client with its own portal domain and assigns a project to it', async () => {
    const c = await t.call<{ id: string; portalDomain: string; shares: Record<string, boolean> }>(
      ada,
      'POST',
      W('/clients'),
      {
        name: 'Helio Health AG',
        portalDomain: 'Projects.Helio-Health.de',
        language: 'de',
      },
    );
    expect(c.status).toBe(201);
    expect(c.body.portalDomain).toBe('projects.helio-health.de');
    expect(c.body.shares).toMatchObject({ roadmap: true, budget: true });
    helio = c.body.id;
    expect((await t.call(ada, 'POST', W('/clients'), { name: 'helio health ag' })).status).toBe(
      409,
    );
    expect(
      (await t.call(ada, 'POST', W('/clients'), { name: 'Other', portalDomain: 'not a domain' }))
        .status,
    ).toBe(400);
    expect(
      (
        await t.call(ada, 'PUT', W('/projects/' + (projects['HEL'] ?? '') + '/client'), {
          clientId: helio,
        })
      ).status,
    ).toBe(200);
    const list = await t.call<{ name: string; projects: { key: string }[] }[]>(
      ada,
      'GET',
      W('/clients'),
    );
    expect(list.body[0]?.projects.map((p) => p.key)).toEqual(['HEL']);
  });

  it('makes a new person the client contact through an invitation', async () => {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + helio + '/contacts'),
      {
        email: 'ines@helio.example',
        portalRole: 'approver',
      },
    );
    expect(r.status).toBe(201);
    const token = r.body.invitation?.token ?? '';
    const res = await fetch(t.base + '/auth/invitations/' + token + '/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ines Vogel', password: 'a client password 1' }),
    });
    expect(res.status).toBe(200);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    ines = {
      id: '',
      email: 'ines@helio.example',
      name: 'Ines Vogel',
      cookie,
      workspaceId: ada.workspaceId,
    };
    const me = await t.call<{
      user: { id: string };
      workspaces: { role: string; client: { name: string; portalRoles: string[] } | null }[];
    }>(ines, 'GET', '/auth/me');
    ines.id = me.body.user.id;
    expect(me.body.workspaces[0]).toMatchObject({
      role: 'guest',
      client: { name: 'Helio Health AG', portalRoles: ['approver'] },
    });
    const contacts = await t.call<{ email: string }[]>(
      ada,
      'GET',
      W('/clients/' + helio + '/contacts'),
    );
    expect(contacts.body.map((c) => c.email)).toEqual(['ines@helio.example']);
  });

  it('shows the contact exactly their client: the project, its item, comments written for them', async () => {
    const team = await t.call<{ id: string }>(
      ada,
      'POST',
      W('/items/' + (items['HEL'] ?? '') + '/comments'),
      { body: 'Internal: check the SMS cost' },
    );
    expect(team.status).toBe(201);
    await t.call(ada, 'POST', W('/items/' + (items['HEL'] ?? '') + '/comments'), {
      body: 'Ready for your review',
      visibility: 'client',
    });
    const ps = await t.call<{ key: string }[]>(ines, 'GET', W('/projects'));
    expect(ps.body.map((p) => p.key)).toEqual(['HEL']);
    expect((await t.call(ines, 'GET', W('/items/' + (items['NWL'] ?? '')))).status).toBe(404);
    expect((await t.call(ines, 'GET', W('/items/' + (items['HEL'] ?? '')))).status).toBe(200);
    const comments = await t.call<{ body: string; visibility: string }[]>(
      ines,
      'GET',
      W('/items/' + (items['HEL'] ?? '') + '/comments'),
    );
    expect(comments.body.map((c) => c.body)).toEqual(['Ready for your review']);
    const found = await t.call<{ items: { ref: string }[] }>(ines, 'GET', W('/search?q=booking'));
    expect(found.body.items.map((i) => i.ref)).toEqual(['HEL-1']);
    const clients = await t.call<{ name: string }[]>(ines, 'GET', W('/clients'));
    expect(clients.body.map((c) => c.name)).toEqual(['Helio Health AG']);
  });

  it('lets the contact write only for the client, and keeps them away from team work', async () => {
    const mine = await t.call<{ visibility: string }>(
      ines,
      'POST',
      W('/items/' + (items['HEL'] ?? '') + '/comments'),
      {
        body: 'Looks good',
        visibility: 'team',
      },
    );
    expect(mine.status).toBe(201);
    expect(mine.body.visibility).toBe('client');
    expect(
      (
        await t.call(ines, 'POST', W('/items/' + (items['NWL'] ?? '') + '/comments'), {
          body: 'hi',
        })
      ).status,
    ).toBe(404);
    expect((await t.call(ines, 'POST', W('/clients'), { name: 'Mine' })).status).toBe(403);
    const shell = await t.call<{
      role: string;
      spend: { todayCents: number };
      agents: { running: number };
    }>(ines, 'GET', W('/shell'));
    expect(shell.body).toMatchObject({
      role: 'guest',
      spend: { todayCents: 0 },
      agents: { running: 0 },
    });
  });

  it('counts no seat for client contacts', async () => {
    const lic = await t.call<{ used: number }>(ada, 'GET', W('/licence'));
    expect(lic.body.used).toBe(1);
  });

  it('tells the portal sign-in page which client its domain belongs to', async () => {
    const port = new URL(t.base).port;
    const body = await new Promise<string>((resolve, reject) => {
      const r = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/portal/branding',
          headers: { host: 'projects.helio-health.de' },
        },
        (res) => {
          let data = '';
          res.on('data', (d: Buffer) => (data += d.toString()));
          res.on('end', () => {
            resolve(data);
          });
        },
      );
      r.on('error', reject);
      r.end();
    });
    expect(JSON.parse(body)).toMatchObject({ clientName: 'Helio Health AG', language: 'de' });
    expect((await fetch(t.base + '/api/portal/branding')).status).toBe(404);
  });

  it('gives testers the member’s rights and auditors reading only', async () => {
    const tess = await t.signup('Tess');
    const otto = await t.signup('Otto');
    await t.call(ada, 'POST', W('/members'), { email: tess.email, role: 'tester' });
    await t.call(ada, 'POST', W('/members'), { email: otto.email, role: 'auditor' });
    expect(
      (
        await t.call(tess, 'POST', W('/projects/' + (projects['NWL'] ?? '') + '/items'), {
          title: 'Found a bug',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.call(otto, 'POST', W('/projects/' + (projects['NWL'] ?? '') + '/items'), {
          title: 'No',
        })
      ).status,
    ).toBe(403);
    const seen = await t.call<{ key: string }[]>(otto, 'GET', W('/projects'));
    expect(seen.body.map((p) => p.key).sort()).toEqual(['HEL', 'NWL']);
  });
});
