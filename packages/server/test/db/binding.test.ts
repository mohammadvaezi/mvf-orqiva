// ── [PCODE-467 | S15 | v0.1.0] A project is planned for a client, and every task traces back to the client request it serves ──
//    Why:  a project is for a client or internal, never by accident; the client's open requests can be taken
//          into it, a task names the requests it serves (several tasks per request), and the task's work
//          record says for whom it was done.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Person, type TestApp } from './apphelper.js';
import { hasDatabase } from './testdb.js';

process.env['ORQIVA_SECRET_KEY'] = 'cd'.repeat(32);

describe.skipIf(!hasDatabase)('the client a project is for (PostgreSQL)', () => {
  let t: TestApp;
  let ada: Person;
  let project = '';
  let client = '';
  const W = (p: string): string => '/api/workspaces/' + ada.workspaceId + p;
  type Binding = {
    client: { id: string; name: string } | null;
    internal: boolean;
    requests: {
      id: string;
      ref: string;
      title: string;
      text: string;
      inProject: boolean;
      items: { ref: string }[];
    }[];
  };

  beforeAll(async () => {
    t = await startTestApp();
    ada = await t.signup('Ada');
    project = (
      await t.call<{ id: string }>(ada, 'POST', W('/projects'), {
        key: 'MARK',
        name: 'Marketspider',
      })
    ).body.id;
    client = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Werkstatt Meyer' }))
      .body.id;
  }, 60_000);

  afterAll(async () => {
    await t.stop();
  });

  it('is for a client or internal, never neither', async () => {
    const none = await t.call<Binding>(ada, 'GET', W('/projects/' + project + '/binding'));
    expect(none.body).toEqual({ client: null, internal: false, requests: [] });
    expect(
      (
        await t.call(ada, 'PUT', W('/projects/' + project + '/binding'), {
          clientId: null,
          internal: false,
        })
      ).status,
    ).toBe(400);
    const own = await t.call<Binding>(ada, 'PUT', W('/projects/' + project + '/binding'), {
      clientId: null,
      internal: true,
    });
    expect(own.body).toMatchObject({ client: null, internal: true });
    const theirs = await t.call<Binding>(ada, 'PUT', W('/projects/' + project + '/binding'), {
      clientId: client,
      internal: false,
    });
    expect(theirs.body).toMatchObject({
      client: { id: client, name: 'Werkstatt Meyer' },
      internal: false,
    });
  });

  it('takes the requests in, links the tasks that serve them, and the work record names them', async () => {
    const req = (
      await t.call<{ id: string; ref: string }>(ada, 'POST', W('/client-requests'), {
        kind: 'feature',
        title: 'Keep the stock of our parts',
        body: 'We want to see which parts are missing.',
        clientId: client,
      })
    ).body;
    let b = (await t.call<Binding>(ada, 'GET', W('/projects/' + project + '/binding'))).body;
    // the client has one project now: the request was planned for it at once, or waits to be taken in
    expect(b.requests.map((r) => r.title)).toEqual(['Keep the stock of our parts']);
    expect(b.requests[0]?.text).toBe('We want to see which parts are missing.');
    if (!b.requests[0]?.inProject) {
      const took = await t.call<Binding>(
        ada,
        'POST',
        W('/projects/' + project + '/binding/requests'),
        { requestId: req.id },
      );
      expect(took.status).toBe(201);
      b = took.body;
    }
    expect(b.requests[0]?.inProject).toBe(true);
    const mk = async (title: string) =>
      (
        await t.call<{ id: string; ref: string }>(
          ada,
          'POST',
          W('/projects/' + project + '/items'),
          { title },
        )
      ).body;
    const one = await mk('Parts list');
    const two = await mk('Missing parts report');
    const three = await mk('CI pipeline');
    for (const x of [one, two])
      expect(
        (await t.call(ada, 'PUT', W('/items/' + x.id + '/requests'), { requestIds: [req.id] }))
          .status,
      ).toBe(200);
    b = (await t.call<Binding>(ada, 'GET', W('/projects/' + project + '/binding'))).body;
    expect(b.requests[0]?.items.map((i) => i.ref)).toEqual([one.ref, two.ref]);
    type Work = {
      client: string | null;
      internal: boolean;
      requests: { ref: string; title: string }[];
    };
    const w1 = (await t.call<Work>(ada, 'GET', W('/items/' + one.id + '/work'))).body;
    expect(w1).toMatchObject({
      client: 'Werkstatt Meyer',
      internal: false,
      requests: [{ ref: req.ref, title: 'Keep the stock of our parts' }],
    });
    const w3 = (await t.call<Work>(ada, 'GET', W('/items/' + three.id + '/work'))).body;
    expect(w3.requests).toEqual([]);
    // a request of another client is refused; an empty list unlinks
    const other = (await t.call<{ id: string }>(ada, 'POST', W('/clients'), { name: 'Other GmbH' }))
      .body.id;
    const foreign = (
      await t.call<{ id: string }>(ada, 'POST', W('/client-requests'), {
        kind: 'feature',
        title: 'Elsewhere',
        clientId: other,
      })
    ).body;
    expect(
      (
        await t.call(ada, 'PUT', W('/items/' + three.id + '/requests'), {
          requestIds: [foreign.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call(ada, 'POST', W('/projects/' + project + '/binding/requests'), {
          requestId: foreign.id,
        })
      ).status,
    ).toBe(409);
    await t.call(ada, 'PUT', W('/items/' + two.id + '/requests'), { requestIds: [] });
    expect((await t.call<Work>(ada, 'GET', W('/items/' + two.id + '/work'))).body.requests).toEqual(
      [],
    );
  });
});
