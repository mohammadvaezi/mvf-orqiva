// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
//    Why:  a client contact looks at a design shared with them and pins comments to it; they see only
//          their side's pins, the team sees all of them marked as from the client; nothing of another
//          client's or of an unshared design, and the team's look through the portal stays read only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe.skipIf(!hasDatabase)('client pins on shared designs (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let ines: Person;
  let otto: Person;
  let helio = '';
  let project = '';
  let shared = '';
  let hidden = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;

  async function contact(client: string, email: string): Promise<Person> {
    const r = await t.call<{ invitation: { token: string } | null }>(
      ada,
      'POST',
      W('/clients/' + client + '/contacts'),
      { email, portalRole: 'viewer' },
    );
    const res = await fetch(
      t.base + '/auth/invitations/' + (r.body.invitation?.token ?? '') + '/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: email.split('@')[0], password: 'a client password 1' }),
      },
    );
    const p: Person = {
      id: '',
      email,
      name: email.split('@')[0] ?? '',
      cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      workspaceId: ada.workspaceId,
    };
    p.id = (await t.call<{ user: { id: string } }>(p, 'GET', '/auth/me')).body.user.id;
    return p;
  }
  const mockup = async (title: string): Promise<string> => {
    const file = (
      (await (
        await fetch(t.base + W('/files?name=d.png&projectId=' + project), {
          method: 'POST',
          headers: { cookie: ada.cookie, 'content-type': 'image/png' },
          body: PNG,
        })
      ).json()) as { id: string }
    ).id;
    return (
      await t.call<{ id: string }>(ada, 'POST', W('/projects/' + project + '/mockups'), {
        title,
        fileId: file,
      })
    ).body.id;
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    helio = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Helio' })).body.id;
    const aurum = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Aurum' })).body
      .id;
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), { key: 'PIN', name: 'Pins' })
    ).body.id;
    await t.call(ada, 'PUT', W('/projects/' + project + '/client'), { clientId: helio });
    ines = await contact(helio, 'ines@helio.example');
    otto = await contact(aurum, 'otto@aurum.example');
    shared = await mockup('Booking screen');
    hidden = await mockup('Internal sketch');
    await t.call(ada, 'PUT', W('/mockups/' + shared + '/client'), { shared: true });
    // a pin of the team's own, never shown to the client
    await t.call(ada, 'POST', W('/mockups/' + shared + '/pins'), {
      x: 0.1,
      y: 0.1,
      body: 'Internal: margin feels off',
    });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('lets the client pin a shared design and shows the team where it came from', async () => {
    type View = {
      title: string;
      imageUrl: string;
      mayPin: boolean;
      pins: { body: string; author: string }[];
    };
    const v = await t.call<View>(ines, 'GET', W('/portal/designs/' + shared));
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ title: 'Booking screen', mayPin: true, pins: [] });
    // the image opens for the contact
    expect(
      (await fetch(t.base + v.body.imageUrl, { headers: { cookie: ines.cookie } })).status,
    ).toBe(200);
    const pin = await t.call<{ pins: { body: string; author: string }[] }>(
      ines,
      'POST',
      W('/portal/designs/' + shared + '/pins'),
      { x: 0.5, y: 0.25, body: '  The logo should be larger here  ' },
    );
    expect(pin.status).toBe(201);
    expect(pin.body.pins).toEqual([
      expect.objectContaining({ body: 'The logo should be larger here', author: 'ines' }),
    ]);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/designs/' + shared + '/pins'), {
          x: 0.5,
          y: 0.5,
          body: '   ',
        })
      ).status,
    ).toBe(400);

    // the team sees both pins, the client's marked
    const team = await t.call<{ pins: { body: string; fromClient: boolean }[] }>(
      ada,
      'GET',
      W('/mockups/' + shared),
    );
    expect(team.body.pins.map((p) => [p.body, p.fromClient])).toEqual(
      expect.arrayContaining([
        ['Internal: margin feels off', false],
        ['The logo should be larger here', true],
      ]),
    );
  });

  it('shows nothing unshared or of another client, and the team’s view is read only', async () => {
    expect((await t.call(ines, 'GET', W('/portal/designs/' + hidden))).status).toBe(404);
    expect(
      (
        await t.call(ines, 'POST', W('/portal/designs/' + hidden + '/pins'), {
          x: 0,
          y: 0,
          body: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await t.call(otto, 'GET', W('/portal/designs/' + shared))).status).toBe(404);
    const asTeam = await t.call<{ mayPin: boolean; pins: unknown[] }>(
      ada,
      'GET',
      W('/portal/designs/' + shared + '?clientId=' + helio),
    );
    expect(asTeam.body).toMatchObject({ mayPin: false });
    expect(asTeam.body.pins).toHaveLength(1);
    expect(
      (
        await t.call(ada, 'POST', W('/portal/designs/' + shared + '/pins'), {
          x: 0,
          y: 0,
          body: 'x',
        })
      ).status,
    ).toBe(403);
  });
});
